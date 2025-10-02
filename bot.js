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
const chests = {};

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
		if (bossList.includes(entity.username)) return false;

		const distance = entity.position.distanceTo(position);

		if (distance < 5) return true;
	});
}

async function attackEnemy(enemy) {
	const pos = bot.entity.position;
	const enemyGoal = new goals.GoalNear(pos.x, pos.y, pos.z, 4);
	const pathToBot = bot.pathfinder.getPathFromTo(defaultMove, enemy.position, enemyGoal);

	let path = pathToBot.next().value.result;

	while (path.status === 'partial') {
		path = pathToBot.next().value.result;
	}

	const timeToArrival = getPathDuration(path);
	const timeToDrawBow = 4;

	if (bot.archery.canShoot() && timeToArrival > timeToDrawBow) {
		// Only shoot if not already shooting
		if (!bot.archery.isShooting()) {
			sendMessage(`Shooting at ${enemy}!`);

			// slow down
			const slowMove = new Movements(bot);
			slowMove.allowSprinting = false;
			bot.pathfinder.setMovements(slowMove);

			const goal = new goals.GoalFollow(enemy, 8);
			bot.pathfinder.setGoal(goal);

			await bot.archery.shoot(enemy);

			// restore movement speed
			bot.pathfinder.setMovements(defaultMove);
		}
	} else {
		// Reset shooting state when switching to melee
		if (bot.archery.isShooting()) {
			bot.archery.resetShooting();
		}
		
		let goal = new goals.GoalFollow(enemy, 4);
		await bot.melee.equip();

		try {
			await bot.pathfinder.goto(goal);
			await bot.melee.punch(enemy);
		} catch (err) {
			// ignore pathfinding errors
		}
	}
}

async function loop() {
	if (!guarding) return;

	const enemy = findThreat();

	if (enemy) {
		await attackEnemy(enemy);
		return;
	}

	let goal = new goals.GoalFollow(guardedPlayer.entity, 4);
	try {
		await bot.pathfinder.goto(goal);
	} catch (err) {
		// ignore pathfinding errors
	}
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

	bot.chat("I'm a robot.");
	
	defaultMove = new Movements(bot);
	bot.pathfinder.setMovements(defaultMove);

	// find a boss
	while (true) {
		let foundBoss = bot.nearestEntity((entity)=>{
			return bossList.includes(entity.username);
		});

		if (foundBoss) {
			guardedPlayer = bot.players[foundBoss.username];
			break;
		}

		const enemy = findThreat();
		if (enemy) await attackEnemy(enemy);

		await bot.waitForTicks(5);
	}

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
	if (bot.food > HUNGER_LIMIT) return;

	sendMessage(`hunger has reached ${bot.food}!`);

	await eatFood();
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

		if (attacker && !targetList.includes(attacker.username)) {
			targetList.push(attacker.username);
		}
	}
});