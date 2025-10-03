// list of weapons in order of preference
const weaponList = [
	'netherite_sword',
	'netherite_axe',
	'diamond_sword',
	'diamond_axe',
	'iron_sword',
	'iron_axe',
	'wooden_sword',
	'wooden_axe',
	'golden_sword',
	'golden_axe',
];

async function equipBestWeapon(bot) {
	for (itemName of weaponList) {
		let item = bot.registry.itemsByName[itemName];
		let hasItem = bot.inventory.count(item.id) > 0;
		
		if (hasItem) {
			await bot.equip(item.id);
			break;
		}
	}
}

async function punch(bot, target) {
	if (target) await bot.attack(target);
}

async function crit(bot, target) {
	await bot.setControlState("jump", true);
    await bot.waitForTicks(10);

    if (target) await bot.attack(target);

	await bot.setControlState("jump", false);
}

module.exports = (bot) => {
    bot.melee = {};
    let lastAttack = 0;

    async function attackWithCooldown(target, attackFunction) {
        const now = Date.now();
        const heldItem = bot.heldItem;
        let cooldown = 0; // Default cooldown for fists or other items

        if (heldItem) {
            if (heldItem.name.includes('sword')) {
                cooldown = 650; // 13 ticks * 50ms/tick
            } else if (heldItem.name.includes('axe')) {
                cooldown = 1000; // 20 ticks * 50ms/tick
            }
        }

        if (now - lastAttack > cooldown) {
            await attackFunction(bot, target);
            lastAttack = now;
        }
    }

    bot.melee.crit = async (target) => {
        await attackWithCooldown(target, crit);
    };

    bot.melee.equip = async () => {
        await equipBestWeapon(bot);
    };

    bot.melee.punch = async (target) => {
        await attackWithCooldown(target, punch);
    };

    bot.commands.crit = async (targetName, { log }) => {
        const target = bot.getEntity(targetName);

        if (target) await bot.melee.crit(target);
        else log(`Couldn't find ${targetName}.`);
    };

    bot.commands.equip = bot.melee.equip;

    bot.commands.punch = async (targetName, { log }) => {
        const target = bot.getEntity(targetName);

        if (target) bot.melee.punch(target);
        else log(`Couldn't find ${targetName}.`);
    };
};