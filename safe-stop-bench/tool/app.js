/* Proofline, browser edition: start-up, the AI settings dialog and the theme.
 * The key typed here is kept in this browser only (this tab by default) and sent only to the provider the visitor picks.
 */
(function () {
  "use strict";
  const PL = window.PL, h = PL.h, $ = id => document.getElementById(id);
  const dlg = $("settings");

  function fillModels(p) {
    $("s-models").replaceChildren(...PL.PROVIDERS[p].models.map(m => h("option", { value: m })));
    $("s-model").placeholder = p === "anthropic" ? "claude-sonnet-5-5" : "the model id your provider gives";
  }
  function syncDialog() {
    const p = $("s-provider").value;
    $("s-ai-fields").hidden = p === "off";
    $("s-base-wrap").hidden = p !== "compatible";
    $("s-effort-wrap").hidden = p !== "anthropic";
    fillModels(p);
  }
  PL.openSettings = function () {
    const s = PL.settings;
    $("s-name").value = s.name; $("s-provider").value = s.provider; $("s-base").value = s.base;
    $("s-model").value = s.model || PL.PROVIDERS[s.provider].def; $("s-effort").value = s.effort;
    $("s-key").value = PL.getKey(); $("s-key").type = "password"; $("s-show").textContent = "Show";
    document.querySelectorAll('input[name="s-store"]').forEach(r => { r.checked = r.value === (PL.store.get(PL.LS, PL.K.key) ? "local" : s.keyStore); });
    $("s-test-out").textContent = ""; syncDialog();
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
  };
  function readDialog() {
    const where = (document.querySelector('input[name="s-store"]:checked') || {}).value || "session";
    return { name: $("s-name").value.trim().slice(0, 60), provider: $("s-provider").value, base: $("s-base").value.trim(),
      model: $("s-model").value.trim(), effort: $("s-effort").value, keyStore: where, key: $("s-key").value.trim() };
  }
  function applyDialog() {
    const d = readDialog();
    if (d.provider === "compatible" && d.base && !/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(d.base)) { PL.toast("Use an https:// URL, or http://localhost for a local model."); return false; }
    if (d.provider !== "off" && !d.model) d.model = PL.PROVIDERS[d.provider].def;
    PL.settings = { name: d.name, provider: d.provider, base: d.base, model: d.model, effort: d.effort, keyStore: d.keyStore };
    PL.saveSettings(); PL.setKey(d.provider === "off" ? PL.getKey() : d.key, d.keyStore);
    return true;
  }
  PL.updateChip = () => { const c = $("ai-chip"); c.textContent = "AI: " + PL.aiLabel(); c.classList.toggle("on", PL.aiReady()); };

  $("s-provider").addEventListener("change", () => { const p = $("s-provider").value; if (!$("s-model").value || !PL.PROVIDERS[p].models.includes($("s-model").value)) $("s-model").value = PL.PROVIDERS[p].def; syncDialog(); });
  $("s-show").addEventListener("click", () => { const k = $("s-key"); k.type = k.type === "password" ? "text" : "password"; $("s-show").textContent = k.type === "password" ? "Show" : "Hide"; });
  $("s-cancel").addEventListener("click", () => dlg.close());
  $("s-forget").addEventListener("click", () => { PL.setKey("", "session"); $("s-key").value = ""; $("s-test-out").textContent = "Key removed from this browser."; PL.updateChip(); });
  $("s-test").addEventListener("click", async () => {
    const before = { settings: Object.assign({}, PL.settings), key: PL.getKey(), where: PL.store.get(PL.LS, PL.K.key) ? "local" : "session" };
    if (!applyDialog()) return;
    const out = $("s-test-out");
    if (!PL.aiReady()) { out.className = "small err"; out.textContent = "Pick a provider, a model and a key first."; }
    else {
      out.className = "small"; out.textContent = "Testing…";
      try {
        const r = await PL.askModel("Reply with the single word OK.", "Say OK.", { maxTokens: 400, effort: "low" });
        out.className = "small ok"; out.textContent = "Connected: " + PL.settings.model + " answered in " + r.usage.seconds.toFixed(1) + " s (" + (r.usage.in + r.usage.out) + " tokens).";
      } catch (e) { out.className = "small err"; out.textContent = e.message; }
    }
    if (!dlg.open) return;
    PL.settings = before.settings; PL.saveSettings(); PL.setKey(before.key, before.where);   // Test does not save; Save does
  });
  $("settings-form").addEventListener("submit", e => { e.preventDefault(); if (applyDialog()) { dlg.close(); PL.updateChip(); PL.route(); PL.toast(PL.aiReady() ? "AI on: " + PL.aiLabel() : "Saved. AI is off."); } });
  $("ai-chip").addEventListener("click", PL.openSettings);
  $("notice-settings").addEventListener("click", PL.openSettings);

  PL.applyTheme = () => { const t = PL.store.get(PL.LS, PL.K.theme); if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t); else document.documentElement.removeAttribute("data-theme"); };
  $("theme-btn").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    PL.store.set(PL.LS, PL.K.theme, cur === "dark" ? "light" : "dark"); PL.applyTheme();
  });

  window.addEventListener("hashchange", () => { PL.route(); window.scrollTo(0, 0); });
  window.addEventListener("storage", e => { if (e.key === PL.K.req) { PL.requests = PL.loadRequests(); PL.route(); } if (e.key === PL.K.set) { PL.settings = PL.loadSettings(); PL.updateChip(); } });
  PL.applyTheme(); PL.updateChip(); PL.route();
})();
