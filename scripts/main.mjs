import { registerApproval, requestApproval } from "./approval.mjs";
import { configureItem, CONFIGURE_LABEL, DISPLAY_NAME, ID, itemLabel, matchingItems, rollKey } from "./items.mjs";

const states = new WeakMap();
const attachedForms = new WeakSet();

function applyBonus(app, state, items) {
  const hadItems = state.appliedItems?.length;
  state.appliedItems = items;
  // Older dnd5e dialogs finalize cached rolls. Rebuild before native submission.
  if (hadItems || items.length) app.rebuild();
}

Hooks.once("init", () => {
  if (game.system.id !== "dnd5e") return;
  registerApproval();
  Hooks.on("renderSettingsConfig", (_app, element) => {
    const tab = element.querySelector(`[data-action="tab"][data-tab="${ID}"]`);
    const label = tab?.querySelector("span:not([data-count])");
    if (label) label.textContent = DISPLAY_NAME;
    else if (tab) {
      const text = Array.from(tab.childNodes).find(node =>
        node.nodeType === Node.TEXT_NODE && node.textContent.trim() === game.modules.get(ID)?.title);
      if (text) text.textContent = DISPLAY_NAME;
    }
  });
  Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
    const item = app.document;
    if (item?.documentName !== "Item" || !item.isOwner || item.pack && game.packs.get(item.pack)?.locked) return;
    controls.push({
      label: CONFIGURE_LABEL, icon: "fa-solid fa-dice-d20",
      onClick: () => configureItem(item).catch(error => {
        console.error(ID, error);
        ui.notifications.error("Could not save the item bonuses.");
      })
    });
  });
  Hooks.on("renderRollConfigurationDialog", renderCategories);
  Hooks.on("closeRollConfigurationDialog", app => states.get(app)?.controller.abort());
  Hooks.on("dnd5e.postBuildRollConfig", (_process, config, index, { app } = {}) => {
    if (index !== 0 || !config.parts) return;
    for (const item of states.get(app)?.appliedItems ?? []) {
      // Brackets delimit Foundry term flavors, and @ starts a roll-data reference.
      const label = item.name.replace(/[\[\]@<>\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim() || DISPLAY_NAME;
      config.parts.push(`${item.bonus}[${label}]`);
    }
  });
});

function renderCategories(app, element) {
  const actor = app.config?.subject;
  const key = rollKey(app.config);
  if (!key || actor?.documentName !== "Actor") return;
  const field = element.querySelector('input[name="roll.0.situational"]');
  const form = field?.form;
  if (!form || form.querySelector(".kg-circumstance-categories")) return;
  const items = matchingItems(actor, key);
  if (!items.length) return;

  if (!states.has(app)) {
    states.set(app, { selected: new Set(), open: new Set(), controller: new AbortController() });
  }
  const state = states.get(app);
  const section = document.createElement("div");
  section.className = "kg-circumstance-categories";
  const groups = Map.groupBy(items, item => item.category);
  const options = new Map();

  function refresh() {
    const selected = items.filter(item => state.selected.has(item.id));
    for (const item of items) {
      const input = options.get(item.id);
      input.checked = state.selected.has(item.id);
      input.disabled = state.waiting || (!input.checked && selected.length > 0
        && (!item.stack || selected.some(choice => !choice.stack)));
    }
    for (const button of section.querySelectorAll("button")) {
      const count = groups.get(button.dataset.category).filter(item => state.selected.has(item.id)).length;
      button.textContent = count ? `${button.dataset.category} (${count})` : button.dataset.category;
    }
    section.querySelector(".kg-circumstance-status").textContent = state.waiting ? "Waiting for GM approval…" : "";
  }

  for (const [category, entries] of groups) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "kg-circumstance-category";
    button.dataset.category = category;
    const panel = document.createElement("div");
    panel.className = "kg-circumstance-options";
    panel.id = `${app.id}-kg-circumstance-${section.childElementCount}`;
    panel.hidden = !state.open.has(category);
    button.setAttribute("aria-controls", panel.id);
    button.setAttribute("aria-expanded", String(!panel.hidden));
    button.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      if (panel.hidden) state.open.delete(category);
      else state.open.add(category);
      button.setAttribute("aria-expanded", String(!panel.hidden));
    });

    for (const item of entries) {
      const label = document.createElement("label");
      label.className = "kg-circumstance-option";
      const input = document.createElement("input");
      input.type = "checkbox";
      const labelText = document.createElement("span");
      labelText.textContent = itemLabel(item);
      label.append(input, labelText);
      panel.append(label);
      options.set(item.id, input);
      input.addEventListener("change", event => {
        event.stopPropagation();
        if (input.checked) state.selected.add(item.id);
        else state.selected.delete(item.id);
        refresh();
      });
    }
    section.append(button, panel);
  }
  const status = document.createElement("div");
  status.className = "kg-circumstance-status";
  status.setAttribute("role", "status");
  section.append(status);
  refresh();
  field.closest(".form-group").after(section);
  state.refresh = refresh;

  if (attachedForms.has(form)) return;
  attachedForms.add(form);
  form.addEventListener("submit", async event => {
    if (state.replaying) return;
    if (state.waiting) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const choices = matchingItems(actor, key).filter(item => state.selected.has(item.id));
    if (!choices.length || (choices.length > 1 && choices.some(item => !item.stack))) {
      applyBonus(app, state, []);
      return;
    }
    if (game.user.isGM || !game.settings.get(ID, "requireApproval")) {
      applyBonus(app, state, choices);
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    state.waiting = true;
    const submitter = event.submitter;
    state.refresh();
    const approved = await requestApproval(actor, key, choices, state.controller.signal);
    if (state.controller.signal.aborted || !form.isConnected) return;
    const current = matchingItems(actor, key).filter(item => approved.includes(item.id)
      && choices.some(choice => choice.id === item.id && itemLabel(choice) === itemLabel(item)));
    state.waiting = false;
    state.refresh();
    state.replaying = true;
    try {
      applyBonus(app, state, current);
      const button = submitter?.form === form ? submitter
        : Array.from(form.querySelectorAll('button[type="submit"]')).find(candidate =>
          candidate.dataset.action === submitter?.dataset.action);
      form.requestSubmit(button);
    } finally {
      state.replaying = false;
    }
  }, { capture: true });
}
