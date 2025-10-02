const hawkeye = require('minecrafthawkeye');

let isShooting = false;

function hasArrows(bot) {
	let arrowItem = bot.registry.itemsByName['arrow'];
	let arrows = bot.inventory.count(arrowItem.id);

	return arrows > 0;
}

function hasBow(bot) {
	let bowItem = bot.registry.itemsByName['bow'];
	return bot.inventory.count(bowItem.id) > 0;
}

async function shoot(bot, target) {
	if (isShooting) return;  // Prevent overlapping shots

	// Debug logging for target entity validity
	console.log("=== ARCHERY SHOOT DEBUG ===");
	console.log("Target entity:", target ? {
		id: target.id,
		username: target.username,
		type: target.type,
		kind: target.kind,
		isValid: target.isValid,
		position: target.position
	} : "NULL");
	console.log("========================");

	// Check if target is valid before shooting
	if (!target || !target.isValid || !target.position) {
		console.log("WARNING: Invalid target entity in archery.shoot, skipping shot");
		isShooting = false;
		return;
	}
	
	isShooting = true;
	try {
		await bot.hawkEye.oneShot(target, "bow");
		// wait for the bow to be fully drawn before shooting again
		await bot.waitForTicks(50);
	} finally {
		isShooting = false;
	}
};

module.exports = (bot)=>{
	bot.loadPlugin(hawkeye.default);
	bot.archery = {};

	bot.archery.canShoot = ()=>{
		return hasArrows(bot) && hasBow(bot);
	};

	bot.archery.hasArrows = ()=>{
		return hasArrows(bot);
	};

	bot.archery.hasBow = ()=>{
		return hasBow(bot);
	};

	bot.archery.isShooting = ()=>{
		return isShooting;
	};

	bot.archery.resetShooting = ()=>{
		isShooting = false;
	};

	bot.archery.shoot = async (target)=>{
		await shoot(bot, target);
	};

	bot.commands.shoot = async (targetName, { log })=>{
		const target = bot.getEntity(targetName);

		if (target) bot.archery.shoot(target);
		else log(`Couldn't find ${targetName}.`);
	};
};