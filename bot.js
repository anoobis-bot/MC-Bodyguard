const mineflayer = require('mineflayer');
const fs = require('fs');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

const meleePlugin = require('./melee.js');
const archeryPlugin = require('./archery.js');
const armorPlugin = require('./armor.js');

if (process.argv.length < 5) process.exit();

const [botName, hostName, hostPort] = process.argv.slice(2);

const LINE_BREAKS = /\r?\n/g;
const HUNGER_LIMIT = 5;

const bossList = fs.readFileSync("boss-list.txt", "utf8").split(LINE_BREAKS);
const targetList = fs.readFileSync("target-list.txt", "utf8").split(LINE_BREAKS);

let defaultMove;
let guardedPlayer;
let guarding = true;
let isFleeing = false;
let fleeTickCounter = 0;
const chests = {};

let moved = 0

function getPathDuration(path) {
	return path.cost; // TODO: calculate duration of path (in seconds)
}

const bot = mineflayer.createBot({
    username: botName,
    host: hostName,
    port: hostPort,
    viewDistance: "tiny",
});

bot.on('kicked', console.log);
bot.on('error', console.log);

bot.loadPlugin(pathfinder);
bot.loadPlugin(meleePlugin);
bot.loadPlugin(archeryPlugin);
bot.loadPlugin(armorPlugin);

bot.getEntity = (name)=>{
	return bot.nearestEntity((entity)=>{
		return entity.displayName === name || entity.username === name;
	});
}

function findThreat() {
	return bot.nearestEntity((entity)=>{
		if (entity.kind !== "Hostile mobs" && !targetList.includes(entity.username)) return false;

		const distanceFromBot = entity.position.distanceTo(bot.entity.position);

		if (distanceFromBot < 8) return true;

		if (!guardedPlayer || !guardedPlayer.entity) return false;

		const distanceFromPlayer = entity.position.distanceTo(guardedPlayer.entity.position);

		if (distanceFromPlayer < 16) return true;
	});
}

function findAttacker(position=bot.entity.position) {
	return bot.nearestEntity((entity)=>{
		if (entity.type !== 'mob' && entity.type !== 'player') return false;
		if (bossList.includes(entity.username)) return false;

		const distance = entity.position.distanceTo(position);

		if (distance < 5) return true;
	});
}

let currentTarget = null;

async function handleFleeing() {
    if (!isFleeing) return false;

    fleeTickCounter++;
    if (fleeTickCounter >= 5) {
        fleeTickCounter = 0; // Reset counter

        const hostiles = Object.values(bot.entities).filter(entity => entity.kind === 'Hostile mobs' && entity.position.distanceTo(bot.entity.position) < 10);

        if (hostiles.length > 0) {
            // Check for hostiles within 5 radius
            const hostilesIn5Radius = hostiles.some(hostile => hostile.position.distanceTo(bot.entity.position) < 5);

            if (!hostilesIn5Radius) {
                // Eat food if no hostiles are within 5 radius
                if (bot.food < 20) {
                    await eatFood(sendMessage);
                }
            }

            // Calculate the center of mass of the hostiles
            const centerOfMass = hostiles.reduce((acc, hostile) => acc.add(hostile.position), new Vec3(0, 0, 0));
            centerOfMass.scale(1 / hostiles.length);

            // Calculate a vector pointing from the center of mass to the bot
            const fleeVector = bot.entity.position.minus(centerOfMass);

            // If the bot is perfectly centered, pick a random direction to flee
            if (fleeVector.x === 0 && fleeVector.y === 0 && fleeVector.z === 0) {
                fleeVector.set(Math.random() - 0.5, 0, Math.random() - 0.5);
            }

            // Normalize and scale the vector to get a target point 24 blocks away
            const targetPos = bot.entity.position.plus(fleeVector.normalize().scale(24));

            // Create a simple goal to go to that point
            const goal = new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 1);
            bot.pathfinder.setGoal(goal);

        } else {
            // If no hostiles are nearby anymore, clear the goal.
            bot.pathfinder.setGoal(null);
            // Eat food if no hostiles are nearby
            if (bot.food < 20) {
                await eatFood(sendMessage);
            }
        }
    }
    return true; // Is fleeing
}

async function handleCombat() {
    const enemy = findThreat();
    if (!enemy) {
        if (currentTarget) {
            // Clear target and goal if the threat is gone
            currentTarget = null;
            bot.pathfinder.setGoal(null);
        }
        return false; 
    }

    if (!enemy.isValid || !enemy.position) {
        return true; 
    }

    const distance = bot.entity.position.distanceTo(enemy.position);
    const tactic = (bot.archery.canShoot() && distance > 6) ? 'archery' : 'melee';

    // Set goal only if the target or tactic changes
    if (enemy !== currentTarget || bot.pathfinder.goal === null) {
	// if (!moved){
		// moved = 1
		console.log(`=== GOAL SETTING ===`);
		console.log(`New target: ${enemy.displayName}, Tactic: ${tactic}, Distance: ${distance.toFixed(2)}`);
        currentTarget = enemy;
        const goalRange = (tactic === 'archery') ? 8 : 4;
        const goal = new goals.GoalFollow(enemy, goalRange);
        bot.pathfinder.setGoal(goal);
    }

    // Execute the chosen tactic
    if (tactic === 'archery') {
        if (!bot.archery.isShooting()) {
            sendMessage(`Shooting at ${enemy.displayName}!`);
            console.log(`=== ARCHERY COMBAT DEBUG ===`);
            console.log(`Setting slowMove for archery, disabling sprint`);
            console.log(`Previous movements:`, bot.pathfinder.movements ? {
                allowSprinting: bot.pathfinder.movements.allowSprinting,
                canDig: bot.pathfinder.movements.canDig,
                canOpenDoors: bot.pathfinder.movements.canOpenDoors
            } : 'none');
            
            // const slowMove = new Movements(bot);
            // slowMove.allowSprinting = false;
            // bot.pathfinder.setMovements(slowMove);
            
            console.log(`After setting slowMove:`, {
                allowSprinting: bot.pathfinder.movements.allowSprinting,
                canDig: bot.pathfinder.movements.canDig,
                canOpenDoors: bot.pathfinder.movements.canOpenDoors
            });
            console.log(`========================`);
            
            await bot.archery.shoot(enemy);
            
            console.log(`=== ARCHERY COMPLETE DEBUG ===`);
            console.log(`Restoring defaultMove after shooting`);
            bot.pathfinder.setMovements(defaultMove);
            console.log(`After restoring defaultMove:`, {
                allowSprinting: bot.pathfinder.movements.allowSprinting,
                canDig: bot.pathfinder.movements.canDig,
                canOpenDoors: bot.pathfinder.movements.canOpenDoors
            });
            console.log(`========================`);
        }
    } else { // Melee tactic
        console.log(`=== MELEE COMBAT DEBUG ===`);
        console.log(`Ensuring defaultMove for melee combat`);
        // bot.pathfinder.setMovements(defaultMove);
        console.log(`Movements after setting:`, {
            allowSprinting: bot.pathfinder.movements.allowSprinting,
            canDig: bot.pathfinder.movements.canDig,
            canOpenDoors: bot.pathfinder.movements.canOpenDoors
        });
        console.log(`========================`);
        
        if (bot.archery.isShooting()) {
            bot.archery.resetShooting();
        }
        
        await bot.melee.equip();

        if (distance < 5) {
            await bot.melee.punch(enemy);
        }
    }
    return true; // Enemy was handled
}

async function handleGuarding() {
    if (guardedPlayer && guardedPlayer.entity) {
        // Clear combat target when switching to guard mode
        if (currentTarget) currentTarget = null;

        const goal = new goals.GoalFollow(guardedPlayer.entity, 4);
        if (!bot.pathfinder.goal || !(bot.pathfinder.goal instanceof goals.GoalFollow) || bot.pathfinder.goal.entity !== guardedPlayer.entity) {
            bot.pathfinder.setGoal(goal);
        }
    } else {
        bot.pathfinder.setGoal(null);
        const foundBoss = bot.nearestEntity((entity) => bossList.includes(entity.username));
        if (foundBoss) {
            guardedPlayer = bot.players[foundBoss.username];
        }
    }
}

async function loop() {
	if (await handleFleeing()) return;

	if (!guarding) {
        bot.pathfinder.setGoal(null);
        return;
    }

    if (await handleCombat()) return;
    
    await handleGuarding();
}

async function eatFood(log=sendMessage) {
	if (bot.food === 20) {
		log(`too full to eat`);
		return;
	}

	for (food of bot.registry.foodsArray) {
		const amount = bot.inventory.count(food.id);

		if (amount === 0) continue;

		log(`found ${amount} ${food.displayName}`);
		
		await bot.equip(food.id);

		await bot.consume();

		log(`ate 1 ${food.displayName}`);

		return;
	}

	log("out of food");
}

bot.commands = {
	"continue": async ()=>{
		guarding = true;
	},

	"eat": async ({ log })=>{
		await eatFood(log);
	},

	"guard": async (username, { log })=>{
		const player = bot.players[username];

		if (!player) {
			log(`Player "${username}" does not exist.`);
			return;
		}

		guardedPlayer = player;
	},

	"ping": async ({ log })=>{
		log("pong");
	},

	"status": async ({ log })=>{
		log(`❤${bot.health} 🥕${bot.food}`);
	},

	"stop": async ({ log })=>{
		log("Stopping.");
		bot.pathfinder.setGoal(null);
		guarding = false;
	},

	"set": async function(...args) {
		const context = args.pop();
		const { log } = context;
		const subcommand = args[0];

		if (subcommand === 'chest') {
			const params = args.slice(1);
			if (params.length === 4) {
				const name = params[3];
				const [x, y, z] = params.slice(0, 3).map(Number);
				if ([x, y, z].some(isNaN)) {
					log('Usage: set chest <x> <y> <z> <name>');
					return;
				}

				// Check for existing coordinates and remove old entry
				for (const existingName in chests) {
					const loc = chests[existingName];
					if (loc.x === x && loc.y === y && loc.z === z) {
						delete chests[existingName];
						break;
					}
				}

				chests[name] = new Vec3(x, y, z);
				log(`Chest '${name}' set to ${chests[name]}`);

				// Save to file
				try {
					const chestsToSave = Object.entries(chests).map(([name, loc]) => ({
						name: name,
						x: loc.x,
						y: loc.y,
						z: loc.z,
					}));
					fs.writeFileSync('chests.json', JSON.stringify(chestsToSave, null, 2));
					log('file saved');
				} catch (err) {
					console.error('Error saving chests.json:', err);
					log('Error saving file.');
				}
			} else {
				log('Usage: set chest <x> <y> <z> <name>');
			}
		} else {
			log("Unknown set command. Available: chest");
		}
	},

	"unload": async function(...args) {
		const { log } = args.pop();
		const name = args[0];

		if (!name) {
			log("Usage: unload <name>");
			return;
		}

		const chestLocation = chests[name];
		if (!chestLocation) {
			log(`Chest '${name}' not found. Use 'set chest <x> <y> <z> <name>' to define it.`);
			return;
		}

		log(`Unloading to chest '${name}'...`);
		const originalGuarding = guarding;
		guarding = false; // Stop guarding while unloading

		try {
			const goal = new goals.GoalNear(chestLocation.x, chestLocation.y, chestLocation.z, 1);
			await bot.pathfinder.goto(goal);
		} catch (err) {
			log(`Could not pathfind to chest: ${err.message}`);
			guarding = originalGuarding; // Resume guarding if failed
			return;
		}

		const chestBlock = bot.blockAt(chestLocation);
		if (!chestBlock || !chestBlock.name.includes('chest')) {
			log("No chest at the specified location.");
			guarding = originalGuarding; // Resume guarding
			return;
		}

		try {
			const chest = await bot.openChest(chestBlock);
			const items = bot.inventory.items();
			if (items.length === 0) {
				log("Inventory is empty.");
			} else {
				for (const item of items) {
					await chest.deposit(item.type, null, item.count);
				}
				log(`Unloaded all items into chest '${name}'.`);
			}
			chest.close();
		} catch (err) {
			log(`Error while unloading: ${err.message}`);
		}

		guarding = originalGuarding; // Resume guarding
	},
};

async function runCommand(tokens, user, log) {
	const commandFunction = bot.commands[tokens[0]];

	if (!commandFunction) {
		log("Unknown command.");
		return;
	}

    await commandFunction(...tokens.slice(1), {
    	user: user,
		log: log,
    });
}

function sendMessage(text) {
	process.send({
		type: "message",
		text: text,
	});
}

process.on('message', (data)=>{
	if (data.type === "command") {
		runCommand(data.command, user="admin", log=sendMessage);
		return;
	}

	console.log(`${botName} recieved unknown message: `, data);
});

bot.once("spawn", async ()=>{
	// Load chests
    try {
        const chestsData = fs.readFileSync('chests.json', 'utf8');
        const chestsFromFile = JSON.parse(chestsData);
        for (const chest of chestsFromFile) {
            chests[chest.name] = new Vec3(chest.x, chest.y, chest.z);
        }
        console.log('Loaded chests from file.');
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.log('chests.json not found, starting with no chests.');
        } else {
            console.error('Error loading chests.json:', err);
        }
    }

	bot.chat("I have awoken.");
	
	defaultMove = new Movements(bot);
	bot.pathfinder.setMovements(defaultMove);

	// Wait for a few seconds before starting the main loop
	await bot.waitForTicks(100); // 5 seconds

	// protect boss
	while (true) {
		await bot.waitForTicks(1);
		await loop();
	}
});

bot.on("chat", async (username, message)=>{
	if (!bossList.includes(username)) return;

	const tokens = message.split(' ');

	await runCommand(tokens, user=username, log=bot.chat);
});

bot.on("whisper", async (username, message)=>{
	if (!bossList.includes(username)) return;

	const tokens = message.split(' ');

	await runCommand(tokens, user=username, log=(text)=>bot.whisper(username, text));
});

bot.on("health", async ()=>{
	// Handle hunger
	if (bot.food <= HUNGER_LIMIT) {
		sendMessage(`hunger has reached ${bot.food}!`);
		await eatFood();
	}

	// Handle fleeing
	if (bot.health <= 6 && !isFleeing) {
		sendMessage("Health is critical! Entering runaway mode.");
		isFleeing = true;
		guarding = false;
		bot.pathfinder.setMovements(defaultMove); // Ensure bot can sprint away
	} else if (isFleeing && bot.health > 15) {
		sendMessage("Health recovered. Resuming duties.");
		isFleeing = false;
		guarding = true;
		bot.pathfinder.setGoal(null); // Clear the runaway goal
	}
});

bot.on("entityGone", (entity)=>{
	const targetIndex = targetList.indexOf(entity.username);

	if (targetIndex === -1) return;
	
	targetList.splice(targetIndex, 1);
});

bot.on("entityHurt", (entity)=>{
	let attacked = false;

	if (entity === bot.entity) attacked = true;

	if (guardedPlayer && guardedPlayer.entity) {
		if (entity === guardedPlayer.entity) attacked = true;
	}

	if (attacked) {
		sendMessage(`${entity.username} was hurt!`);

		const attacker = findAttacker(bot.entity.position);
		
		// Debug logging for entity validity
		console.log("=== ENTITY HURT DEBUG ===");
		console.log("Hurt entity:", entity ? {
			id: entity.id,
			username: entity.username,
			type: entity.type,
			kind: entity.kind,
			isValid: entity.isValid,
			position: entity.position
		} : "NULL");
		console.log("Attacker found:", attacker ? {
			id: attacker.id,
			username: attacker.username,
			type: attacker.type,
			kind: attacker.kind,
			isValid: attacker.isValid,
			position: attacker.position
		} : "NULL");
		console.log("Bot entities count:", Object.keys(bot.entities).length);
		console.log("========================");

		if (attacker && attacker.username && !targetList.includes(attacker.username)) {
			targetList.push(attacker.username);
			console.log(`Added ${attacker.username} to target list`);
		}
	}
});