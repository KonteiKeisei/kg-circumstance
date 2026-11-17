# KG Circumstance

Configure an inventory item's roll bonuses from the item sheet's header menu under **Configure Circumstance**. Enter the item's name, subject, category, and one or more roll bonuses. For example, set up **Arcane Foresight** with the subject **Divination**, category **Reading Material**, and **Arcana Check +5**. Remove all bonus rows and save to disable the item's bonuses.

Open a matching roll dialog. Below **Situational Bonus**, each available item category has its own button. Expand a category, select applicable items, and submit using the normal roll controls. Every selected item must allow stacking for multiple items to contribute. Fast-forward rolls that bypass the dialog also bypass item selection.

Enable **Require GM approval** in the world settings to send an active GM a private review prompt before a player's roll. The GM can approve individual bonuses. A denied or expired request rolls with only the approved bonuses, if any. The player gets a notice if the GM declines, no GM is online, or the request times out after 60 seconds.

For local installation, copy the `kg-circumstance` folder into Foundry's `Data/modules` and enable it in a dnd5e world. The module targets Foundry V13.347 and V14 with dnd5e 5.3 or newer. It uses the native dnd5e roll dialog and requires no additional modules.

To rename the module, edit `title` in `module.json`. Keep `id` and the installation folder as `kg-circumstance` to preserve item flags and world settings.
