import { DISPLAY_NAME, ID, escape, itemLabel, matchingItems, rollLabel } from "./items.mjs";

const REVIEW_TIME = 60_000;
const pending = new Map();

export function registerApproval() {
  game.settings.register(ID, "requireApproval", {
    name: "Require GM approval",
    hint: "Ask an active GM to review selected item bonuses before a player rolls.",
    scope: "world", config: true, type: Boolean, default: false
  });

  Hooks.on("createChatMessage", message => {
    const request = message.getFlag(ID, "request");
    if (request && game.user.isGM && message.whisper.includes(game.user.id)) {
      review(message, request).catch(error => console.error(ID, error));
    }
  });
  Hooks.on("updateChatMessage", (message, _changes, _options, userId) => {
    const request = message.getFlag(ID, "request");
    const decision = message.getFlag(ID, "decision");
    const respond = pending.get(request?.id);
    if (respond && decision && game.users.get(userId)?.isGM && userId === request.gm) {
      respond(decision.ids);
    }
  });
}

export async function requestApproval(actor, key, items, signal) {
  if (signal.aborted) return [];
  const gm = game.users.activeGM;
  if (!gm) {
    ui.notifications.warn("No GM is connected. Rolling without item bonuses.");
    return [];
  }
  const id = foundry.utils.randomID();
  const expires = Date.now() + REVIEW_TIME;
  return new Promise(resolve => {
    const finish = ids => {
      clearTimeout(timeout);
      pending.delete(id);
      signal.removeEventListener("abort", cancel);
      resolve(ids);
    };
    const cancel = () => finish([]);
    const timeout = setTimeout(() => {
      ui.notifications.warn("GM review timed out. Rolling without item bonuses.");
      finish([]);
    }, REVIEW_TIME);
    signal.addEventListener("abort", cancel, { once: true });
    pending.set(id, approved => {
      const ids = Array.isArray(approved) ? items.filter(item => approved.includes(item.id)).map(item => item.id) : [];
      if (ids.length < items.length) ui.notifications.info("The GM declined one or more item bonuses.");
      finish(ids);
    });

    ChatMessage.create({
      whisper: [gm.id],
      content: `<p>${escape(actor.name)} requested item bonuses for a roll.</p>
        <ul>${items.map(item => `<li>${escape(itemLabel(item))}</li>`).join("")}</ul>`,
      flags: { [ID]: { request: { id, actor: actor.uuid, key, ids: items.map(item => item.id), gm: gm.id, expires } } }
    }).catch(error => {
      console.error(ID, error);
      if (!pending.has(id)) return;
      ui.notifications.warn("GM review could not be sent. Rolling without item bonuses.");
      finish([]);
    });
  });
}

async function review(message, request) {
  if (request.gm !== game.user.id || Date.now() >= request.expires) return;
  const actor = await fromUuid(request.actor);
  if (actor?.documentName !== "Actor" || !actor.testUserPermission(message.author, "OWNER")) return;
  const items = matchingItems(actor, request.key).filter(item => request.ids.includes(item.id));
  if (!items.length || (items.length > 1 && items.some(item => !item.stack))) {
    await message.setFlag(ID, "decision", { ids: [] });
    return;
  }
  const { DialogV2 } = foundry.applications.api;
  let reviewDialog;
  const expiry = setTimeout(() => reviewDialog?.close(), Math.max(0, request.expires - Date.now()));
  try {
    const ids = await DialogV2.wait({
      window: { title: `${DISPLAY_NAME} | Approve Bonuses` },
      content: `<p>${escape(message.author.name)} is rolling for ${escape(actor.name)}.</p>
        <fieldset><legend>${escape(rollLabel(request.key))}</legend>
        ${items.map(item => `<label class="kg-circumstance-option">
          <input type="checkbox" value="${escape(item.id)}" checked>
          <span>${escape(itemLabel(item))}</span></label>`).join("")}</fieldset>`,
      render: (_event, dialog) => { reviewDialog = dialog; },
      buttons: [{
        action: "approve", label: "Approve Selected",
        callback: (_event, { form }) => Array.from(form.querySelectorAll("input:checked"), input => input.value)
      }, { action: "deny", label: "Deny All", type: "button", default: true }]
    });
    if (Date.now() < request.expires) {
      await message.setFlag(ID, "decision", { ids: Array.isArray(ids) ? ids : [] });
    }
  } finally {
    clearTimeout(expiry);
  }
}
