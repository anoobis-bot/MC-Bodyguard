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

module.exports = (bot) => {
    bot.loadPlugin(hawkeye.default);
    bot.archery = {};
    let lastShotTime = 0;

    bot.archery.canShoot = () => {
        return hasArrows(bot) && hasBow(bot);
    };

    bot.archery.hasArrows = () => {
        return hasArrows(bot);
    };

    bot.archery.hasBow = () => {
        return hasBow(bot);
    };

    bot.archery.isShooting = () => {
        return isShooting;
    };

    bot.archery.resetShooting = () => {
        isShooting = false;
    };

    bot.archery.shoot = async (target) => {
        const now = Date.now();
        if (now - lastShotTime < 3000) return; // Enforce 2-second cooldown

        if (isShooting) return; // Prevent overlapping shots

        // Check if target is valid before shooting
        if (!target || !target.isValid || !target.position) {
            console.log("WARNING: Invalid target entity in archery.shoot, skipping shot");
            return;
        }

        lastShotTime = now;
        isShooting = true;
        try {
            await bot.hawkEye.oneShot(target, "bow");
        } finally {
            isShooting = false;
        }
    };

    bot.commands.shoot = async (targetName, { log }) => {
        const target = bot.getEntity(targetName);

        if (target) bot.archery.shoot(target);
        else log(`Couldn't find ${targetName}.`);
    };
};