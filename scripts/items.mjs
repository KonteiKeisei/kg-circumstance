export const ID = "kg-circumstance";
export const DISPLAY_NAME = "Circumstance";
export const CONFIGURE_LABEL = "Configure Circumstance";
export const escape = value => foundry.utils.escapeHTML(String(value ?? ""));

function categoryFor(item) {
  const identifier = item.system.identifier ?? "";
  if (item.system.type?.value === "scroll" || /^(book|scroll)(-|$)/i.test(identifier)) {
    return "Reading Material";
  }
  if (item.system.type?.value === "gem") return "Gems";
  return "Equipment";
}

function rollOptions() {
  const { skills, abilities, tools } = CONFIG.DND5E;
  const options = (entries, type, suffix) => Object.entries(entries).map(([key, entry]) => {
    const nativeLabel = type === "tool" ? game.dnd5e?.utils?.keyLabel?.(key, { trait: "tool" }) : undefined;
    const label = (typeof entry === "string" ? entry : entry?.label) || nativeLabel;
    const fallback = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ")
      .replace(/\b\w/g, initial => initial.toUpperCase());
    const name = label && label !== key ? game.i18n.localize(label) : fallback;
    return [`${type}:${key}`, `${name} ${suffix}`];
  });
  return [
    ...options(skills, "skill", "Check"),
    ...options(abilities, "ability", "Check"),
    ...options(abilities, "save", "Save"),
    ...options(tools, "tool", "Check")
  ];
}

export function rollLabel(key) {
  return rollOptions().find(([value]) => value === key)?.[1] ?? key;
}

export function rollKey(config) {
  const hooks = config?.hookNames ?? [];
  if (hooks.includes("skill")) return `skill:${config.skill}`;
  if (hooks.includes("tool")) return `tool:${config.tool}`;
  if (hooks.includes("savingThrow")) return `save:${config.ability}`;
  if (hooks.includes("abilityCheck")) return `ability:${config.ability}`;
}

export function matchingItems(actor, key) {
  return Array.from(actor?.items ?? []).flatMap(item => {
    const aid = item.getFlag(ID, "aid");
    if (!aid || item.system.quantity === 0) return [];
    const bonus = aid.bonuses?.find(entry => entry.roll === key)?.value;
    if (!Number.isSafeInteger(bonus) || bonus === 0) return [];
    return [{
      id: item.id, name: item.name, subject: aid.subject,
      category: aid.category || categoryFor(item), bonus, stack: aid.stack === true
    }];
  });
}

export function itemLabel(item) {
  const subject = item.subject ? ` - ${item.subject}` : "";
  const sign = item.bonus > 0 ? "+" : "";
  return `${item.name}${subject}: ${sign}${item.bonus}`;
}

export async function configureItem(item) {
  const aid = item.getFlag(ID, "aid") ?? {};
  const options = rollOptions();
  const row = ({ roll, value } = {}) => `
    <div class="kg-circumstance-rule">
      <select aria-label="Roll type" required>
        ${options.map(([key, label]) => `<option value="${escape(key)}"
          ${key === roll ? "selected" : ""}>${escape(label)}</option>`).join("")}
      </select>
      <input type="number" step="1" required aria-label="Bonus" value="${escape(value ?? 5)}">
      <button type="button" data-remove aria-label="Remove bonus"><i class="fa-solid fa-trash"></i></button>
    </div>`;
  const { DialogV2 } = foundry.applications.api;
  const result = await DialogV2.wait({
    window: { title: CONFIGURE_LABEL },
    position: { width: 500 },
    content: `
      <div class="form-group"><label>Item name</label>
        <input name="itemName" required value="${escape(item.name)}"></div>
      <div class="form-group"><label>Subject</label>
        <input name="subject" value="${escape(aid.subject)}" placeholder="Divination"></div>
      <div class="form-group"><label>Roll dialog category</label>
        <input name="category" list="kg-circumstance-categories" required
               value="${escape(aid.category || categoryFor(item))}"></div>
      <datalist id="kg-circumstance-categories">
        <option value="Reading Material"><option value="Gems"><option value="Equipment">
        <option value="Tools"><option value="Wondrous Items">
      </datalist>
      <div class="form-group"><label>Can stack with other items</label>
        <input type="checkbox" name="stack" ${aid.stack ? "checked" : ""}></div>
      <fieldset><legend>Bonuses</legend>
        <div data-rules>${(aid.bonuses ?? [{}]).map(row).join("")}</div>
        <button type="button" data-add>Add Bonus</button>
      </fieldset>`,
    render: (_event, dialog) => {
      const rules = dialog.element.querySelector("[data-rules]");
      dialog.element.querySelector("[data-add]").addEventListener("click", () => {
        rules.insertAdjacentHTML("beforeend", row());
      });
      rules.addEventListener("click", event => {
        event.target.closest("[data-remove]")?.closest(".kg-circumstance-rule").remove();
      });
    },
    buttons: [{
      action: "save", label: "Save", default: true,
      callback: (_event, { form }) => ({
        name: form.elements.itemName.value.trim(),
        subject: form.elements.subject.value.trim(),
        category: form.elements.category.value.trim(),
        stack: form.elements.stack.checked,
        bonuses: Array.from(form.querySelectorAll(".kg-circumstance-rule"), rule => ({
          roll: rule.querySelector("select").value,
          value: rule.querySelector("input").valueAsNumber
        }))
      })
    }, { action: "cancel", label: "Cancel", type: "button" }]
  });
  if (!result || result === "cancel") return;
  const { name, bonuses, ...fields } = result;
  if (!name || !fields.category || bonuses.some(({ value }) => !Number.isSafeInteger(value) || !value)
    || new Set(bonuses.map(({ roll }) => roll)).size !== bonuses.length) {
    ui.notifications.warn("Enter a name, a category, and one nonzero integer bonus per roll type.");
    return;
  }
  const flag = bonuses.length ? `flags.${ID}.aid` : `flags.${ID}.-=aid`;
  await item.update({ name, [flag]: bonuses.length ? { ...fields, bonuses } : null });
}
