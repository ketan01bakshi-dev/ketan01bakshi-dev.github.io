/* Proofline, browser edition: the pages. All six stages for your own project, and the real OTA pilot as a read-only sample.
 * AI-assisted, synthetic, illustrative. Makes no claim of compliance with any standard.
 */
(function () {
  "use strict";
  const PL = window.PL, S = PL.scope, E = PL.engines, h = PL.h, norm = PL.norm;
  const STATE_KEYS = { approved: "approved", "in-review": "in-review", draft: "drafting", drafting: "drafting", complete: "complete", reopened: "reopened", stale: "reopened", rejected: "rejected", none: "missing" };
  const busy = new Set();
  const isBusy = (id, what) => busy.has(id + ":" + what);
  async function work(req, what, fn) {
    const k = req.id + ":" + what;
    if (busy.has(k)) return;
    busy.add(k); PL.route();
    if (E.BY_KEY[what]) markStart(req, what);
    try { await fn(); } catch (e) { PL.toast(e.message); } finally { busy.delete(k); PL.saveRequests(); PL.route(); }
  }

  // ------------------------------------------------------------------ timing: measured in this browser, shared only on a click
  /* Per stage: when work started, hands-on seconds (tab visible and a key/mouse/touch event in the last 2 minutes), AI seconds,
     and the person's own estimate of the same work by hand. Nothing leaves the browser unless the person copies or emails it. */
  const IDLE_MS = 120000, TICK_S = 5;
  function timing(req, key) {
    req.timing = req.timing || {};
    return req.timing[key] = req.timing[key] || { started: null, active_s: 0, ai_s: 0, estimate_h: null };
  }
  function markStart(req, key) { const t = timing(req, key); if (!t.started) t.started = PL.nowIso(); }
  let lastInput = Date.now(), track = null, unsaved = 0;
  ["keydown", "mousedown", "pointermove", "wheel", "touchstart", "scroll"].forEach(ev => window.addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true, capture: true }));
  setInterval(() => {
    if (!track || document.visibilityState !== "visible" || Date.now() - lastInput > IDLE_MS) return;
    const r = PL.findReq(track.id);
    if (!r) return;
    timing(r, track.key).active_s += TICK_S;
    if (++unsaved >= 6) { unsaved = 0; PL.saveRequests(); }
  }, TICK_S * 1000);
  window.addEventListener("pagehide", () => { if (unsaved) PL.saveRequests(); });
  const aiSecondsOf = (req, key) => {
    if (key === "requirements") return timing(req, key).ai_s || 0;
    const m = { plan: () => req.plan && req.plan.meta, architecture: () => req.architecture && req.architecture.meta, guides: () => req.guides && req.guides.index.meta, firmware: () => req.firmware && req.firmware.meta,
      electrical: () => ({ llm: req.elecInputsUsage }) }[key]();
    return (m && m.llm && m.llm.seconds) || 0;
  };
  const dur = s => s == null ? "–" : s < 90 ? Math.round(s) + " s" : s < 5400 ? Math.round(s / 60) + " min" : PL.fmt(s / 3600, 1) + " h";
  const btn = (label, fn, cls, extra) => h("button", Object.assign({ class: "btn " + (cls || ""), type: "button", text: label, onclick: fn }, extra || {}));
  const small = (label, fn, extra) => h("button", Object.assign({ class: "btn-small", type: "button", text: label, onclick: fn }, extra || {}));
  const muted = t => h("p", { class: "muted small", text: t });
  const statusBadge = s => PL.badge({ covered: "approved", partial: "assumed_open", missing: "open_decision", deferred: "drafting" }[s] || "drafting", s);

  // ------------------------------------------------------------------ migration of older saved requests
  function migrate(req) {
    req.gates = req.gates || {};
    if (req.review && !req.gates.scope_review) { req.gates.scope_review = req.review; delete req.review; }
    req.inventory = req.inventory || E.blankInventory();
    req.guideLog = req.guideLog || [];
    return req;
  }
  PL.requests.forEach(migrate);

  // ------------------------------------------------------------------ the OTA example (editable copy) and the read-only pilot sample
  const OTA_EXAMPLE = {
    title: "OTA software updates, the way production vehicles do them",
    description: "I want the bench's ECUs to take software updates over the air the way a production vehicle does: signed images, safe to interrupt, only when the vehicle is in a fit state, with a record of what was installed.",
    motivation: "Pilot 1 of Proofline. The bench already has a large part of this, so the tool can be checked against a feature whose real state is known.",
    constraints: "Parts already owned: two ESP32-S3 boards, MCP2515 CAN modules. Budget ₹3000 for anything new.",
    notes: "AI-assisted, synthetic, illustrative example.",
    context: "Bench: two ESP32-S3 boards (board A = bus node, board B = safety controller) on a 500 kbit/s CAN bus with MCP2515 + TJA1050, a PC running Python scenarios, a vehicle plant model and an oracle. Board B already has A/B slots, SHA-256 + HMAC image check, trial boot with a 3 s health window, rollback and Wi-Fi with TLS.",
    items: {
      function_boundary: ["answered", "Updating the software of the bench's ECUs over the air. Real: boards A and B, the CAN bus, the Wi-Fi/MQTT path, the signing tools on the PC. Simulated: the rest of the fleet, the vehicle state and the 12 V supply."],
      target_hardware_toolchain: ["assumed", "ESP32-S3 class boards, Arduino core built with arduino-cli, C++17 core shared with the PC. No new board.", false],
      test_levels: ["answered", "Emulated board, then real board B over USB, MQTT gateway and Wi-Fi with TLS; staged rollout on a mixed fleet."],
      criticality: ["assumed", "The update path protects a safety controller, so a failed or interrupted update must never leave unverified code running. No standard integrity level is claimed.", false],
      fault_cases: ["answered", "Tampered image, wrong key, corrupted chunk, reset at 1/50/99 % of the download, lost and repeated chunks, unhealthy image, reset during trial boot, older version, power lost at each write of the commit. Still to decide: supply sag, one ECU failing after another committed."],
      evidence: ["assumed", "Test reports, manifest and the release verdict. UNECE R156 and ISO 24089 are used as a reference only; no compliance is claimed.", true],
    },
    inventory: {
      caps: [
        { id: "REQ:REL-01", axis: "requirements", name: "Signed image is verified before it is written", status: "exists" },
        { id: "REQ:REL-11", axis: "requirements", name: "Power cut at each persistent write leaves a bootable image", status: "exists" },
        { id: "CAN:0x7E2", axis: "architecture", name: "UDS request id for the safety node", status: "reserved" },
        { id: "SW:ota-ab-slots", axis: "software", name: "A/B slots, trial boot and rollback on board B", status: "exists" },
        { id: "SW:uds-0x34", axis: "software", name: "UDS RequestDownload 0x34 TransferData 0x36", status: "not found" },
        { id: "SW:ecdsa", axis: "software", name: "asymmetric signature verify ECDSA", status: "not found" },
        { id: "REL:REL-01..12", axis: "tests", name: "OTA release matrix on the real board", status: "pass" },
        { id: "TEST:supply-sag", axis: "tests", name: "update under supply sag", status: "no result" },
        { id: "HW:board-a", axis: "hardware", name: "ESP32-S3 board A bus node", status: "proven" },
        { id: "HW:board-b", axis: "hardware", name: "ESP32-S3 board B safety node", status: "proven" },
        { id: "HW:relay", axis: "hardware", name: "5 V relay module for power cut", status: "ordered" },
        { id: "PLANT:vehicle", axis: "plant", name: "vehicle plant model in CI", status: "verified" },
        { id: "PLANT:supply", axis: "plant", name: "12 V supply and battery model", status: "exists" },
      ],
      parts: [{ part: "resistor kit 1 % E96", vendor: "local shop", price_inr: 350 }, { part: "relay module 5 V 1 channel", vendor: "local shop", price_inr: 120 }],
      boards: [
        { id: "board-a", name: "ESP32-S3 board A (bus node)", role: "gateway: downloads and runs the update client", mcu: "ESP32-S3", logic_v: 3.3, flash_kib: 1280, flash_used_kib: 410, ram_kib: 320, free_pins: "4 5 6 7 15 16", adc_pins: "4 5 6 7", avoid_pins: "0 3 19 20 43 44 45 46", pin_limit_ma: 20, adc_limit_v: 2.45, adc_bits: 12 },
        { id: "board-b", name: "ESP32-S3 board B (safety node)", role: "safety controller: verifies and installs the image", mcu: "ESP32-S3", logic_v: 3.3, flash_kib: 1280, flash_used_kib: 1008, ram_kib: 320, free_pins: "1 2 6 7 8 9", adc_pins: "1 2 6 7 8 9", avoid_pins: "0 3 19 20 43 44 45 46", pin_limit_ma: 20, adc_limit_v: 2.45, adc_bits: 12 },
      ],
      can: { bitrate_kbps: 500, baseline_load_pct: 1.11, load_limit_pct: 25, ids: [
        { id: "0x100", name: "PLN_ActuatorCmd", sender: "board-a", status: "active" }, { id: "0x101", name: "SAF_Status", sender: "board-b", status: "active" },
        { id: "0x7E2", name: "UDS_SafetyNode_Req", sender: "board-a", status: "reserved" }, { id: "0x7EA", name: "UDS_SafetyNode_Resp", sender: "board-b", status: "reserved" }] },
    },
  };
  function newRequest(f) {
    const id = PL.slug(f.title);
    return migrate({ id, title: f.title, description: f.description, motivation: f.motivation || "", constraints: f.constraints || "", notes: f.notes || "",
      requester: PL.settings.name || "", created: PL.today(), context: f.context || "", scope: S.blankScope(id), chat: [], additions: [], audit: [], gates: {}, inventory: E.blankInventory() });
  }
  function loadExample() {
    const req = newRequest(OTA_EXAMPLE);
    req.requester = "Example";
    Object.entries(OTA_EXAMPLE.items).forEach(([k, v]) => {
      const it = S.itemMap(req.scope)[k];
      if (v[0] === "answered") { it.status = "answered"; it.answer = v[1]; }
      else { it.status = "assumed"; it.assumption = { text: v[1], accepted: v[2] }; if (v[2]) it.assumption.accepted_by = "Example"; }
    });
    req.inventory = PL.clone(OTA_EXAMPLE.inventory);
    req.chat.push({ role: "assistant", text: "This is the OTA example, partly filled, with a small inventory of what the bench has. " + S.ruleQuestion(req.scope), at: PL.nowIso(), meta: "rules" });
    PL.audit(req, "loaded the OTA example");
    PL.requests.unshift(req); PL.saveRequests();
    location.hash = "#/r/" + req.id;
  }
  let sampleCache = null;
  async function loadSample() {
    if (sampleCache) return sampleCache;
    const res = await fetch("sample-ota.json", { credentials: "omit" });
    if (!res.ok) throw new Error("could not load the sample (" + res.status + ")");
    const s = await res.json();
    const gates = {};
    s.audit.forEach(a => { gates[a.gate] = { action: a.action, actor: a.actor, at: a.at, hash: a.hash }; });
    const fr = s.feature_request;
    sampleCache = { sample: true, id: "sample", title: fr.title, description: fr.description, motivation: fr.motivation, constraints: "", requester: fr.requester, created: fr.created,
      scope: s.scope, plan: s.plan, architecture: s.architecture, electrical: s.electrical, guides: s.guides,
      firmware: { swd: s.firmware.swd.map(x => Object.assign({ module: x.file.replace(/\.md$/, "") }, x)), od_decisions: s.firmware.od_decisions, ladderSample: s.firmware.ladder },
      sampleGates: gates, sampleAudit: s.audit, usage: s.usage, gates: {}, inventory: E.blankInventory(), guideLog: [] };
    return sampleCache;
  }
  PL.loadSample = loadSample;

  // ------------------------------------------------------------------ the frame of a request page: header, stage strip, gate
  const base = req => req.sample ? "#/sample" : "#/r/" + encodeURIComponent(req.id);
  async function strip(req, cur) {
    const items = [];
    for (const s of E.STAGES) {
      const st = await E.stageState(req, s.key);
      items.push(h("a", { class: "stage" + (s.key === cur ? " cur" : ""), href: base(req) + (s.path ? "/" + s.path : ""), "aria-current": s.key === cur ? "page" : null },
        h("span", { class: "n", text: String(s.n) }), h("span", { class: "nm", text: s.name }), PL.badge(STATE_KEYS[st.key] || "drafting", st.label)));
    }
    if (!req.sample) items.push(h("a", { class: "stage inv" + (cur === "inventory" ? " cur" : ""), href: base(req) + "/inventory" }, h("span", { class: "n", text: "◆" }), h("span", { class: "nm", text: "Project inventory" }),
      h("span", { class: "muted small", text: (req.inventory.caps || []).length + " capabilities, " + (req.inventory.boards || []).length + " boards" })));
    return h("nav", { class: "strip", "aria-label": "Pipeline stages" }, items);
  }
  async function frame(req, cur, body) {
    const st = E.BY_KEY[cur];
    const other = { inventory: ["Project inventory", "What your project already has. Stage 2 compares the approved requirements with this; stages 3 and 4 use the boards and the CAN registry."],
      timing: ["Timing", "How long each stage took you, measured in this browser, next to your own estimate of the same work by hand. Nothing is sent unless you choose to share it."] }[cur];
    PL.mount(
      h("p", { class: "small crumbs" }, h("a", { href: "#/", text: "← All requests" }), req.sample ? h("span", { class: "badge b-in-review", text: "read-only sample: the real OTA pilot" }) : h("a", { href: base(req) + "/timing", text: "⏱ Timing" })),
      h("h1", { text: (st ? st.name : other[0]) + ": " + req.title }),
      h("p", { class: "muted lede-s", text: st ? st.desc : other[1] }),
      await strip(req, cur),
      body);
  }
  async function gatePanel(req, key) {
    const st = E.BY_KEY[key];
    if (req.sample) {
      const hist = (req.sampleAudit || []).filter(a => a.gate === st.gate);
      return PL.section("Gate " + st.gate,
        h("p", { class: "small", text: "This is the gate history of the real pilot. Every approval is bound to the hash of exactly what was approved; a change voids it." }),
        h("ul", { class: "audit" }, hist.map(a => h("li", { text: a.at.replace("T", " ") + " · " + a.actor + " · " + a.action + " · hash " + a.hash + (a.reason ? " · " + a.reason : "") }))));
    }
    const s = await E.stageState(req, key);
    if (s.key === "none") return null;
    const g = req.gates[st.gate], reason = h("textarea", { placeholder: "Reason (required to reject)", maxlength: 2000 });
    const kids = [h("p", { class: "hash", text: "SHA-256 " + s.h })];
    if (s.blockers.length) kids.push(h("p", { class: "blockers", text: "Cannot be submitted yet: " + s.blockers.join("; ") + "." }));
    if (s.key === "in-review") {
      kids.push(reason, h("div", { class: "row mt" },
        btn("Approve this exact version", async () => {
          const n = PL.needName(); if (!n) return;
          if ((await E.stageHash(req, key)) !== g.hash) return PL.toast("It changed since it was submitted. Submit it again.");
          req.gates[st.gate] = { state: "approved", hash: g.hash, by: n, at: PL.nowIso(), reason: reason.value.trim() };
          PL.audit(req, st.gate + ": approved " + g.hash.slice(0, 12)); PL.saveRequests(); PL.route();
        }, "btn-primary"),
        btn("Reject", () => {
          const n = PL.needName(); if (!n) return;
          if (!reason.value.trim()) return PL.toast("Rejecting needs a reason.");
          req.gates[st.gate] = { state: "rejected", hash: g.hash, by: n, at: PL.nowIso(), reason: reason.value.trim() };
          PL.audit(req, st.gate + ": rejected: " + reason.value.trim()); PL.saveRequests(); PL.route();
        }, "btn-danger")));
    } else if (s.key === "approved") {
      kids.push(h("p", {}, PL.badge("approved", "approved"), " by " + g.by + " on " + g.at.replace("T", " ").replace("Z", " UTC") + (g.reason ? ". " + g.reason : ".")));
    } else {
      if (s.key === "rejected") kids.push(h("p", { class: "blockers", text: "Rejected by " + g.by + ": " + g.reason }));
      if (s.key === "reopened") kids.push(h("p", { class: "blockers", text: "It changed after it was approved; the old approval no longer counts." }));
      kids.push(h("div", { class: "row" }, btn("Submit for " + st.gate.replace("_", " "), async () => {
        req.gates[st.gate] = { state: "submitted", hash: await E.stageHash(req, key), by: PL.needName() || "(no name)", at: PL.nowIso() };
        PL.audit(req, st.gate + ": submitted"); PL.saveRequests(); PL.route();
      }, "btn-primary", { disabled: s.blockers.length > 0 })));
    }
    return h("section", { class: "card panel gate" }, h("h2", { class: "sec-title" }, "Gate ", h("code", { text: st.gate }), " ", PL.badge(STATE_KEYS[s.key] || "drafting", s.label)), kids);
  }
  function genBar(req, key, label, fn, needs) {
    const ai = PL.aiReady(), going = isBusy(req.id, key);
    return h("div", { class: "card genbar" },
      h("div", { class: "row" },
        btn(going ? "Working…" : label + (ai ? " with AI" : ""), () => work(req, key, () => fn(ai)), "btn-primary", { disabled: going || !!needs }),
        ai ? btn("Rules only (no AI)", () => work(req, key, () => fn(false)), "", { disabled: going || !!needs }) : btn("Add your AI key (optional)", PL.openSettings),
        h("span", { class: "muted small", text: needs || (ai ? "AI: " + PL.aiLabel() + " · your key, your cost" : "Without AI, code makes a plain draft you can edit.") })),
      going ? h("p", { class: "thinking", text: "Working… an AI call takes 10 to 60 s." }) : null);
  }
  const metaLine = m => m ? muted("Made " + String(m.generated || "").replace("T", " ").replace("Z", " UTC") + " · " + PL.usageLine(m.llm) + ((m.notes || []).length ? " · " + m.notes.slice(0, 3).join(" · ") : "")) : null;

  // ------------------------------------------------------------------ home, new, help
  async function viewHome() {
    const list = h("ul", { class: "req-list" });
    for (const r of PL.requests) {
      const dots = [];
      for (const s of E.STAGES) { const st = await E.stageState(r, s.key); dots.push(h("span", { class: "dot d-" + (STATE_KEYS[st.key] || "drafting"), title: s.name + ": " + st.label })); }
      list.appendChild(h("li", { class: "card" },
        h("a", { class: "title", href: "#/r/" + encodeURIComponent(r.id), text: r.title }), h("span", { class: "dots", "aria-label": "stage states" }, dots),
        h("span", { class: "grow" }),
        small("Export", () => PL.download(r.id + ".proofline.json", JSON.stringify(r, null, 2))),
        small("Delete", () => {
          if ((window.prompt("Type the id to delete this request from this browser:\n" + r.id) || "").trim() !== r.id) return PL.toast("Not deleted.");
          PL.requests = PL.requests.filter(x => x !== r); PL.saveRequests(); PL.route();
        }, { class: "btn-small btn-danger" })));
    }
    const file = h("input", { type: "file", accept: ".json,application/json", hidden: true, onchange: e => importFile(e.target.files[0]) });
    PL.mount(
      h("section", { class: "intro" },
        h("h1", { text: "From a feature idea to wired, testable hardware, with a person approving every step" }),
        h("p", { class: "lede", text: "Proofline takes one feature for an embedded or vehicle project through six stages: requirements, gap analysis, architecture, electrical checks, integration guides and firmware requirements. Code does every check and every number; AI (with your own key) only drafts; you approve each stage, and the approval is bound to a SHA-256 of exactly what you approved." }),
        h("div", { class: "cta-grid" },
          h("a", { class: "cta card", href: "#/sample" }, h("strong", { text: "Explore the real pilot" }), h("span", { text: "All six stages of the OTA pilot run on the Safe-Stop Bench: 20 needs, 34 gaps, 4 new CAN ids, 11 electrical findings, 4 guides. Read-only." })),
          h("a", { class: "cta card", href: "#/new" }, h("strong", { text: "Start your own feature" }), h("span", { text: "Describe it, agree the scope, then run every stage on your project. Works without AI." })),
          h("button", { class: "cta card", type: "button", onclick: loadExample }, h("strong", { text: "Try it on the OTA example" }), h("span", { text: "A partly filled copy you can edit and push through all six stages yourself." })))),
      h("p", { class: "invite" }, h("strong", { text: "Be the first measured team. " }), "Each request has a ⏱ Timing page that measures your hands-on time per stage in this browser. Add your own estimate of the same work by hand, and share the result if you like. The first one sent goes on the Proofline page."),
      h("div", { class: "row" }, btn("Import a request (.json)", () => file.click()), file, btn(PL.aiReady() ? "AI: " + PL.aiLabel() : "Add your AI key (optional)", PL.openSettings)),
      h("h2", { text: "Your requests (saved in this browser)" }),
      PL.requests.length ? list : h("p", { class: "empty", text: "None yet." }));
  }
  function importFile(f) {
    if (!f) return;
    f.text().then(t => {
      const r = JSON.parse(t);
      if (!r || typeof r.title !== "string" || !r.scope || S.validateShape(r.scope).length) throw new Error("not a Proofline request file");
      r.id = PL.findReq(r.id) ? PL.slug(r.title) : String(r.id || PL.slug(r.title));
      r.scope.feature_id = r.id; r.chat = Array.isArray(r.chat) ? r.chat : []; r.additions = Array.isArray(r.additions) ? r.additions : []; r.audit = Array.isArray(r.audit) ? r.audit : [];
      migrate(r); PL.audit(r, "imported from a file"); PL.requests.unshift(r); PL.saveRequests(); location.hash = "#/r/" + r.id;
    }).catch(e => PL.toast("Import failed: " + e.message));
  }
  function viewNew() {
    const f = {};
    const field = (k, label, o) => { const el = h(o && o.area ? "textarea" : "input", Object.assign({ id: "f-" + k, maxlength: (o && o.max) || 4000 }, o && o.req ? { required: true } : {})); f[k] = el; return h("label", { for: "f-" + k }, label, el); };
    PL.mount(h("h1", { text: "New feature request" }), h("form", { class: "card", onsubmit: e => {
      e.preventDefault();
      const v = k => f[k].value.trim();
      if (!v("title") || !v("description")) return PL.toast("Title and description are needed.");
      const req = newRequest({ title: v("title"), description: v("description"), motivation: v("motivation"), constraints: v("constraints"), notes: v("notes"), context: v("context") });
      req.chat.push({ role: "assistant", text: "Tell me about the feature in your own words. " + S.ruleQuestion(req.scope), at: PL.nowIso(), meta: "rules" });
      PL.audit(req, "created the request"); PL.requests.unshift(req); PL.saveRequests(); location.hash = "#/r/" + req.id;
    } },
      field("title", "Title", { req: true, max: 140 }), field("description", "What should it do?", { area: true, req: true }),
      field("motivation", "Why (optional)", { area: true }), field("constraints", "Constraints: budget (₹), date, parts you own (optional)", { area: true }),
      field("context", "Project context (optional): what your project already has. The AI grounds its assumptions in this.", { area: true, max: 12000 }),
      field("notes", "Notes (optional)", { area: true }),
      h("div", { class: "row mt" }, h("button", { class: "btn btn-primary", type: "submit", text: "Create request" }), h("a", { class: "btn", href: "#/", text: "Cancel" }))));
    f.title.focus();
  }
  function viewHelp() {
    const li = t => h("li", { text: t });
    PL.mount(h("h1", { text: "How Proofline works" }),
      h("div", { class: "grid2" },
        PL.section("Rules decide, the model drafts, you approve",
          h("ol", { class: "steps" }, E.STAGES.map(s => h("li", {}, h("strong", { text: s.name + ". " }), s.desc)))),
        PL.section("Your keys and your data",
          h("ul", { class: "facts" },
            li("This page is static: no server, no account, no analytics, no third-party scripts."),
            li("Everything you type is saved in this browser only. Export what you want to keep."),
            li("AI is optional. Add your own key in AI settings: Anthropic (Claude), OpenAI, or any OpenAI-compatible endpoint, including a local model."),
            li("Your key is sent only to the provider you choose, straight from your browser, and kept for this tab only unless you choose otherwise."),
            li("The owner's own keys and subscription are not used by this page in any way.")),
          h("div", { class: "row mt" }, btn("AI settings", PL.openSettings), btn("Delete all my data here", () => {
            if (!window.confirm("Delete every request, your settings and any saved key from this browser?")) return;
            Object.values(PL.K).forEach(k => { PL.store.del(PL.LS, k); PL.store.del(PL.SS, k); });
            PL.requests = []; PL.settings = PL.loadSettings(); PL.applyTheme(); PL.updateChip(); PL.toast("Deleted."); location.hash = "#/";
          }, "btn-danger")))),
      PL.section("What the browser edition does differently from the local tool",
        h("ul", { class: "facts" },
          li("Gap analysis compares your scope with an inventory you enter (or the AI drafts and you correct), not with a scan of a repository."),
          li("Electrical checks use the same hand calculations at every corner; the local tool also runs ngspice."),
          li("Firmware: F0 (the design) is checked by code; F1 to F3 (build, unit tests, mutation tests) are results you record, because a browser cannot compile your firmware. F4 and F5 stay with the owner, on real boards."),
          li("The tool never orders parts, never runs a command and never touches hardware. You do, with the guide."))));
  }

  // ------------------------------------------------------------------ stage 1: feature requirements (chat + checklist)
  async function viewRequirements(req) {
    const id = req.id, st = await E.stageState(req, "requirements"), c = S.completeness(req.scope);
    const save = what => { if (what) PL.audit(req, what); PL.saveRequests(); PL.route(); };
    let chat = null;
    if (!req.sample) {
      const log = h("div", { class: "chat-log", "aria-live": "polite" });
      (req.chat || []).forEach(m => log.appendChild(h("div", { class: "msg " + m.role }, h("span", { class: "who", text: m.role === "person" ? (m.by || "you") : "assistant" }), m.text, m.meta ? h("span", { class: "meta", text: m.meta }) : null)));
      const input = h("textarea", { id: "chat-in", placeholder: PL.aiReady() ? "Describe the feature, answer the questions…" : "Notes for the log. Without AI, fill the checklist by hand.", maxlength: 6000 });
      chat = h("section", { class: "card chat", "aria-label": "Chat" },
        h("div", { class: "row" }, h("h2", { text: "Scope chat", class: "sec-title m0" }), h("span", { class: "grow" }), small("AI: " + PL.aiLabel(), PL.openSettings)),
        log, isBusy(id, "chat") ? h("p", { class: "thinking", text: "Thinking… (10 to 40 s)" }) : null,
        h("form", { class: "chat-form", onsubmit: e => { e.preventDefault(); send(req, input.value); } }, input,
          h("div", { class: "row mt" }, h("button", { class: "btn btn-primary", type: "submit", text: "Send", disabled: isBusy(id, "chat") }), h("span", { class: "muted small", text: PL.aiReady() ? "Sent to " + PL.PROVIDERS[PL.settings.provider].label + " with your key." : "No AI: rule-based questions." }))));
      setTimeout(() => { log.scrollTop = log.scrollHeight; }, 0);
    }
    const items = S.itemMap(req.scope), cards = h("div", { class: "checklist" });
    S.KEYS.forEach(k => {
      const it = items[k], state = S.itemState(it), card = h("article", { class: "item s-" + state, id: "item-" + k }), editor = h("div", { class: "editor", hidden: true });
      const openEditor = mode => {
        const ta = h("textarea", { value: mode === "answer" ? (it.answer || "") : (it.assumption ? it.assumption.text : ""), maxlength: 6000 });
        editor.replaceChildren(ta, h("div", { class: "row mt" },
          small(mode === "answer" ? "Save answer" : "Save assumption (not accepted)", () => { try { req.scope = S.editItem(req.scope, k, mode, ta.value); req.additions = (req.additions || []).filter(a => a.key !== k); save(S.frId(k) + ": " + mode + " edited by hand"); } catch (e) { PL.toast(e.message); } }),
          small("Cancel", () => { editor.hidden = true; })));
        editor.hidden = false; ta.focus();
      };
      const actions = h("div", { class: "actions" });
      if (!req.sample) {
        if (it.status === "missing") PL.append(actions, small("Answer", () => openEditor("answer")), small("Add an assumption", () => openEditor("assume")));
        if (it.status === "answered") PL.append(actions, small("Edit", () => openEditor("answer")), small("Clear", () => { req.scope = S.editItem(req.scope, k, "clear"); save(S.frId(k) + " cleared"); }));
        if (it.status === "assumed") {
          PL.append(actions, !it.assumption.accepted ? small("Accept", () => { const n = PL.needName(); if (!n) return; req.scope = S.editItem(req.scope, k, "accept", "", n); save(S.frId(k) + " assumption accepted"); })
            : small("Un-accept", () => { req.scope = S.editItem(req.scope, k, "unaccept"); save(S.frId(k) + " assumption un-accepted"); }),
          small("Edit", () => openEditor("assume")), small("Replace with an answer", () => openEditor("answer")), small("Clear", () => { req.scope = S.editItem(req.scope, k, "clear"); save(S.frId(k) + " cleared"); }));
        }
      }
      const od = state === "open_decision" ? S.openSentences(it) : [];
      PL.append(card, h("div", { class: "item-head" }, h("span", { class: "fr", text: S.frId(k) }), h("h3", { text: S.LABEL[k] }), PL.badge(state, S.STATE_LABEL[state])),
        it.status === "missing" ? h("p", { class: "q", text: S.QUESTION[k] }) : h("p", { class: "text", text: S.fullText(it) }),
        it.status === "assumed" && it.assumption.accepted_by ? h("p", { class: "by", text: "Accepted by " + it.assumption.accepted_by }) : null,
        od.length ? h("p", { class: "od", text: "To decide: " + od.join(" ") }) : null, actions, editor);
      (req.additions || []).filter(a => a.key === k).forEach(a => {
        const stale = S.fullText(it) !== a.base;
        card.appendChild(h("div", { class: "addition" }, h("strong", { text: "Proposed addition from your chat: " }), "“" + a.quote + "”",
          stale ? muted("The item changed after this was proposed; reject it and say it again.") : null,
          h("div", { class: "row mt" },
            stale ? null : small("Add to this item", () => {
              const n = PL.needName(); if (!n) return;
              const s2 = PL.clone(req.scope), x = S.itemMap(s2)[k], merged = a.base + " [Added by " + n + ": " + a.quote + "]";
              if (x.status === "answered") x.answer = merged; else x.assumption.text = merged;
              req.scope = s2; req.additions = req.additions.filter(y => y.id !== a.id); save(S.frId(k) + ": addition accepted");
            }),
            small("Reject", () => { req.additions = req.additions.filter(y => y.id !== a.id); save(S.frId(k) + ": addition rejected"); }))));
      });
      cards.appendChild(card);
    });
    const head = h("div", { class: "row" }, h("p", { class: "progress m0", text: S.progressLine(c) }), h("span", { class: "grow" }),
      req.sample ? null : small("scope.json", async () => PL.download(req.id + ".scope.json", JSON.stringify(S.scopeArtifact(req.scope), null, 2))),
      req.sample ? null : small("Rename", () => { const t = (window.prompt("New title:", req.title) || "").trim(); if (t) { req.title = t.slice(0, 140); save("renamed"); } }));
    let ctx = null;
    if (!req.sample) {
      const ta = h("textarea", { value: req.context || "", maxlength: 12000, placeholder: "boards, buses, toolchain, what already works, what you own" });
      ta.addEventListener("change", () => { req.context = ta.value; PL.saveRequests(); PL.toast("Project context saved."); });
      ctx = h("details", { class: "card panel" }, h("summary", { text: "Project context (used by the AI for its assumptions)" }), ta);
    }
    await frame(req, "requirements", [head, h("div", { class: req.sample ? "" : "work" }, chat, h("section", { "aria-label": "Checklist" }, cards)), ctx,
      req.sample ? PL.section("AI use in this stage", muted(PL.usageLine(Object.assign({}, req.usage.by_stage.requirements, { seconds: req.usage.by_stage.requirements.seconds })) + " · API-equivalent $" + req.usage.by_stage.requirements.api_equivalent_usd)) : null,
      await gatePanel(req, "requirements")]);
    void st;
  }
  async function send(req, text) {
    text = String(text || "").trim();
    if (!text || isBusy(req.id, "chat")) return;
    req.chat.push({ role: "person", by: PL.settings.name || "you", text, at: PL.nowIso() }); PL.saveRequests();
    if (!PL.aiReady()) { req.chat.push({ role: "assistant", text: S.ruleQuestion(req.scope), at: PL.nowIso(), meta: "rules (no AI configured)" }); PL.saveRequests(); return PL.route(); }
    await work(req, "chat", async () => {
      try {
        const r = await S.runTurn(req, text);
        let outcomes = [], reply, source;
        if (r.proposals) {
          const applied = S.applyProposals(req.scope, r.proposals);
          req.scope = applied.scope; outcomes = applied.outcomes; req.additions = (req.additions || []).concat(applied.pending);
          [reply, source] = S.chooseReply(req.scope, r.proposals);
        } else [reply, source] = [S.ruleQuestion(req.scope), "rules"];
        timing(req, "requirements").ai_s += (r.usage && r.usage.seconds) || 0;
        req.chat.push({ role: "assistant", text: reply, at: PL.nowIso(), meta: [PL.usageLine(r.usage), outcomes.length ? "applied: " + outcomes.join("; ") : "nothing applied",
          r.rejected.length ? r.rejected.length + " proposal(s) dropped by the rules (" + r.rejected.map(x => (x.key || "?") + ": " + x.reason).slice(0, 4).join("; ") + ")" : null,
          source === "rules" ? "reply written by the rules" : null].concat(r.notes).filter(Boolean).join(" · ") });
        if (outcomes.length) PL.audit(req, "chat turn: " + outcomes.join("; "));
      } catch (e) { req.chat.push({ role: "assistant", text: S.ruleQuestion(req.scope), at: PL.nowIso(), meta: e.message + " · the rule-based question is used" }); }
    });
  }

  // ------------------------------------------------------------------ editable tables (inventory, architecture draft, electrical inputs)
  function editTable(cols, rows, onSave, opts) {
    opts = opts || {};
    const body = h("tbody");
    const cell = (r, c) => {
      let el;
      if (c.options) { el = h("select", {}, c.options.map(o => h("option", { value: o, text: o }))); el.value = r[c.key] == null ? c.options[0] : r[c.key]; }
      else el = h("input", { value: r[c.key] == null ? "" : (Array.isArray(r[c.key]) ? r[c.key].join(" ") : String(r[c.key])), type: c.num ? "number" : "text", step: c.num ? "any" : null, placeholder: c.ph || "", "aria-label": c.label });
      el.addEventListener("change", () => {
        let v = el.value;
        if (c.num) v = v === "" ? null : Number(v);
        if (c.list) v = E.listOf(v);
        r[c.key] = v; onSave();
      });
      return h("td", {}, el);
    };
    rows.forEach((r, i) => body.appendChild(h("tr", {}, cols.map(c => cell(r, c)), h("td", {}, small("✕", () => { rows.splice(i, 1); onSave(true); }, { "aria-label": "Remove row" })))));
    return h("div", {}, h("div", { class: "table-scroll" }, h("table", { class: "grid edit" }, h("thead", {}, h("tr", {}, cols.map(c => h("th", { text: c.label })), h("th"))), body)),
      h("div", { class: "row mt" }, small("+ Add row", () => { rows.push(Object.assign({}, opts.blank || {})); onSave(true); }), opts.extra || null));
  }

  async function viewInventory(req) {
    const inv = req.inventory;
    const save = rerender => { PL.saveRequests(); if (rerender) PL.route(); };
    const allStatus = PL.uniq([].concat(...Object.values(E.CAP_STATUSES)));
    const draftInv = async () => {
      const sys = `You turn a person's description of their embedded project into a capability inventory for a gap analysis. Only list what the text says exists (or is ordered / not found). Never invent.
Answer with ONE JSON object: {"caps":[{"id":"KIND:short-name","axis":"requirements|architecture|software|tests|hardware|plant","name":"...","status":"..."}],"boards":[{"id":"board-x","name":"...","role":"...","mcu":"...","logic_v":3.3}],"can_ids":[{"id":"0x100","name":"PREFIX_Name","sender":"board-x","status":"active|reserved"}]}
Allowed status per axis: ${JSON.stringify(E.CAP_STATUSES)}. No prose outside the JSON.`;
      const r = await PL.askJSON(sys, "PROJECT CONTEXT\n" + (req.context || "") + "\n\nFEATURE\n" + req.title + ": " + req.description + "\n\nAnswer with the JSON object only.", d => { if (!Array.isArray(d.caps)) throw new Error('"caps" must be a list'); });
      if (!r.data) throw new Error("The model answer was unusable. Fill the tables by hand.");
      const have = new Set(inv.caps.map(c => c.id));
      r.data.caps.forEach(c => { if (c && c.id && E.AXES.includes(c.axis) && E.CAP_STATUSES[c.axis].includes(c.status) && !have.has(c.id)) inv.caps.push({ id: String(c.id).slice(0, 60), axis: c.axis, name: norm(c.name).slice(0, 160), status: c.status, notes: "drafted by AI: check it" }); });
      (r.data.boards || []).forEach(b => { if (b && b.id && !inv.boards.some(x => x.id === b.id)) inv.boards.push({ id: String(b.id).slice(0, 40), name: norm(b.name || ""), role: norm(b.role || ""), mcu: norm(b.mcu || ""), logic_v: Number(b.logic_v) || 3.3 }); });
      (r.data.can_ids || []).forEach(x => { if (x && /^0x[0-9a-f]{1,3}$/i.test(x.id) && !inv.can.ids.some(y => y.id === x.id)) inv.can.ids.push({ id: x.id, name: x.name, sender: x.sender, status: x.status === "reserved" ? "reserved" : "active" }); });
      PL.audit(req, "inventory drafted by AI (" + r.data.caps.length + " capabilities)");
    };
    const file = h("input", { type: "file", accept: ".json", hidden: true, onchange: e => e.target.files[0].text().then(t => { const d = JSON.parse(t); if (!Array.isArray(d.caps)) throw new Error("no caps list"); req.inventory = Object.assign(E.blankInventory(), d); save(true); }).catch(er => PL.toast("Import failed: " + er.message)) });
    await frame(req, "inventory", [
      h("div", { class: "card genbar" }, h("div", { class: "row" },
        btn(isBusy(req.id, "inv") ? "Working…" : "Draft from my project context with AI", () => work(req, "inv", draftInv), "btn-primary", { disabled: !PL.aiReady() || isBusy(req.id, "inv") }),
        btn("Export inventory", () => PL.download(req.id + ".inventory.json", JSON.stringify(inv, null, 2))), btn("Import inventory", () => file.click()), file,
        h("span", { class: "muted small", text: PL.aiReady() ? "The AI only lists what your project context says; you correct it." : "Add an AI key to draft it from your project context, or type it in." }))),
      PL.section("Capabilities (what exists today)", muted("Statuses decide coverage: hardware owned/fitted/proven covers, ordered is partial, wishlist is missing; a test covers only with a passing result; software 'not found' makes a need missing."),
        editTable([{ key: "id", label: "Id", ph: "SW:can-driver" }, { key: "axis", label: "Axis", options: E.AXES }, { key: "name", label: "Name", ph: "what it is" }, { key: "status", label: "Status", options: allStatus }, { key: "notes", label: "Notes" }],
          inv.caps, save, { blank: { id: "", axis: "software", name: "", status: "exists" } })),
      PL.section("Boards", muted("Pins as space-separated numbers. Leave a list empty if you don't know it: the checks then say UNVERIFIED instead of guessing."),
        editTable([{ key: "id", label: "Id" }, { key: "name", label: "Name" }, { key: "role", label: "Role" }, { key: "mcu", label: "MCU" }, { key: "logic_v", label: "Logic V", num: true },
          { key: "flash_kib", label: "Flash KiB", num: true }, { key: "flash_used_kib", label: "Used KiB", num: true }, { key: "free_pins", label: "Free pins", list: true }, { key: "adc_pins", label: "ADC pins", list: true },
          { key: "avoid_pins", label: "Avoid pins", list: true }, { key: "pin_limit_ma", label: "Pin mA", num: true }, { key: "adc_limit_v", label: "ADC max V", num: true }, { key: "adc_bits", label: "ADC bits", num: true }],
          inv.boards, save, { blank: { id: "board-" + (inv.boards.length + 1), logic_v: 3.3 } })),
      PL.section("CAN bus and id registry",
        h("div", { class: "row" }, ["bitrate_kbps", "baseline_load_pct", "load_limit_pct"].map(k => h("label", { class: "inline-field" }, { bitrate_kbps: "Bit rate (kbit/s)", baseline_load_pct: "Current load %", load_limit_pct: "Your load limit %" }[k],
          h("input", { type: "number", step: "any", value: inv.can[k] == null ? "" : inv.can[k], onchange: e => { inv.can[k] = e.target.value === "" ? null : Number(e.target.value); save(); } })))),
        editTable([{ key: "id", label: "Id (hex)", ph: "0x100" }, { key: "name", label: "Name", ph: "PREFIX_Name" }, { key: "sender", label: "Sender" }, { key: "status", label: "Status", options: ["active", "reserved"] }],
          inv.can.ids, save, { blank: { status: "active" } })),
      PL.section("Parts catalogue (for the BOM)", muted("Prices in ₹ as you know them. BOM lines come only from here, or say 'needs a quote'."),
        editTable([{ key: "part", label: "Part" }, { key: "vendor", label: "Vendor" }, { key: "price_inr", label: "Price ₹", num: true }], inv.parts, save)),
    ]);
  }

  // ------------------------------------------------------------------ stage 2: gap analysis & plan
  async function viewPlan(req) {
    const scopeOk = req.sample || (await E.stageState(req, "requirements")).key === "approved";
    const p = req.plan;
    const gen = req.sample ? null : genBar(req, "plan", p ? "Run the gap analysis again" : "Run the gap analysis", async ai => {
      req.plan = await E.generatePlan(req, ai); PL.audit(req, "gap analysis made (" + req.plan.gap_report.gaps.length + " gaps)");
    }, scopeOk ? null : "Needs an approved scope (stage 1).");
    if (!p) return frame(req, "plan", [gen, (req.inventory.caps || []).length ? null : PL.section("Tip", h("p", {}, "Fill the ", h("a", { href: base(req) + "/inventory", text: "project inventory" }), " first: with no capabilities, every need is missing."))]);
    const gr = p.gap_report, sum = gr.summary;
    const axisTable = PL.table([{ key: "axis", label: "Axis" }, { key: "covered", label: "Covered" }, { key: "partial", label: "Partial" }, { key: "missing", label: "Missing" }],
      Object.entries(sum.by_axis).map(([a, v]) => Object.assign({ axis: a }, v)).concat([Object.assign({ axis: "total" }, sum.total)]));
    const needs = h("div", { class: "needs-list" }, gr.needs.map(n => h("details", { class: "need" },
      h("summary", {}, h("span", { class: "mono", text: n.id + " " }), h("span", { text: n.text.slice(0, 160) }), " ", (n.assessments || []).map(a => h("span", { class: "ax" }, a.axis.slice(0, 4) + " ", statusBadge(a.status)))),
      h("p", { class: "small muted", text: "Source: " + (n.source.kind || "") + (n.source.scope_key ? " · scope item " + n.source.scope_key : "") + (n.source.practice_id ? " · practice " + n.source.practice_id : "") + (n.source.quote ? " · “" + n.source.quote.slice(0, 160) + "”" : "") }),
      PL.table([{ label: "Axis", key: "axis" }, { label: "Status", render: a => statusBadge(a.status) }, { label: "Counted evidence", render: a => evidenceCell(req, n, a) }, { label: "Rule", key: "rule", cls: "t" },
        { label: "Possible evidence (hint)", render: a => hintCell(req, n, a) }], n.assessments || []))));
    const bom = p.bom;
    const items = p.action_plan.items;
    await frame(req, "plan", [gen,
      metaLine(p.meta),
      h("div", { class: "grid2" }, PL.section("Coverage by axis", axisTable, muted(sum.needs + " needs; a gap is every need-axis pair that is not covered.")),
        PL.section("Owner decisions", gr.open_decisions.length ? h("ul", {}, gr.open_decisions.map(o => h("li", {}, h("strong", { text: o.id + " " }), o.text))) : muted("None."),
          h("h3", { class: "mt", text: "Fit checks" }), h("ul", { class: "small" }, (gr.fit_checks || []).map(f => h("li", {}, PL.badge(f.status === "ok" ? "approved" : f.status === "conflict" ? "rejected" : "drafting", f.status), " " + f.text))))),
      PL.section("Needs and their evidence", muted("Status per axis is decided by code from the counted evidence. " + (req.sample ? "" : "Add a hint as evidence or remove one, and the rules run again (this changes the hash).")), needs),
      PL.section("Action plan (" + items.length + " work items)", PL.table([{ key: "id", label: "Id" }, { key: "stage", label: "Stage" }, { key: "title", label: "Work", render: i => h("div", {}, h("strong", { text: i.title }), i.detail ? h("div", { class: "small muted", text: i.detail }) : null) },
        { key: "owner", label: "Owner" }, { label: "Closes", render: i => i.gap_ids.join(", ") }, { label: "After", render: i => (i.depends_on || []).join(", ") }], items)),
      PL.section("Bill of materials (proposed, never ordered)", bom.lines.length ? PL.table([{ key: "part", label: "Part" }, { key: "qty", label: "Qty" }, { key: "vendor", label: "Vendor" }, { label: "Price ₹", render: l => l.price_inr == null ? "needs a quote" : String(l.price_inr) },
        { key: "reason", label: "Why", cls: "t" }, { key: "conflict", label: "Conflict" }], bom.lines) : muted("No part to buy."),
        muted("Known total: " + (bom.total_known_inr == null ? "unknown" : "₹" + bom.total_known_inr) + " · " + bom.unpriced_lines + " unpriced line(s). " + (bom.note || ""))),
      req.sample ? PL.section("AI use in this stage", muted(PL.usageLine(req.usage.by_stage.plan) + " · API-equivalent $" + req.usage.by_stage.plan.api_equivalent_usd)) : null,
      await gatePanel(req, "plan")]);
  }
  function evidenceCell(req, n, a) {
    const ids = a.inventory_ids && a.inventory_ids.length ? a.inventory_ids : (a.cited || []);
    if (req.sample) return h("span", { class: "small mono", text: (a.inventory_ids || []).slice(0, 8).join(", ") + ((a.inventory_ids || []).length > 8 ? " …" : "") });
    return h("span", {}, ids.map(id => h("span", { class: "chip" }, id, " ", h("button", { class: "x", type: "button", "aria-label": "Remove " + id, text: "✕", onclick: () => { req.plan = E.replanWithEvidence(req, n.id, a.axis, id, false); PL.audit(req, "evidence removed: " + id); PL.saveRequests(); PL.route(); } }))));
  }
  function hintCell(req, n, a) {
    const hints = a.hints || [];
    if (!hints.length) return "";
    return h("span", {}, hints.map(x => h("span", { class: "chip hint", title: x.why }, x.id + " ", req.sample ? null : h("button", { class: "x", type: "button", text: "count it", onclick: () => { req.plan = E.replanWithEvidence(req, n.id, a.axis, x.id, true); PL.audit(req, "evidence counted by hand: " + x.id); PL.saveRequests(); PL.route(); } }))));
  }

  // ------------------------------------------------------------------ stage 3: architecture
  async function viewArchitecture(req) {
    const a = req.architecture;
    const gen = req.sample ? null : genBar(req, "architecture", a ? "Draft the architecture again" : "Draft the architecture", async ai => {
      req.architecture = await E.generateArchitecture(req, ai); PL.audit(req, "architecture drafted");
    }, !req.plan ? "Needs a gap analysis (stage 2)." : !(req.inventory.boards || []).length ? "Add at least one board in the project inventory." : null);
    if (!a) return frame(req, "architecture", [gen]);
    const per = (a.budgets || {}).per_node || [], bus = (a.budgets || {}).bus || [];
    let editor = null;
    if (!req.sample && a.draft) {
      if (!req.archDraft || req.archDraft.run_id !== a.meta.run_id) req.archDraft = Object.assign(PL.clone(a.draft), { run_id: a.meta.run_id });
      const d = req.archDraft;
      const save = rerender => { PL.saveRequests(); if (rerender) PL.route(); };
      editor = h("details", { class: "card panel" }, h("summary", { text: "Edit the draft (functions, messages, flash estimates) and recompute" }),
        h("h3", { text: "Functions" }), editTable([{ key: "name", label: "Name" }, { key: "node", label: "Board", options: (req.inventory.boards || []).map(b => b.id) }, { key: "gap_ids", label: "Gap ids", list: true }, { key: "rationale", label: "Rationale" }], d.functions, save),
        h("h3", { text: "CAN messages (code allocates the ids)" }), editTable([{ key: "name", label: "Name", ph: "PREFIX_Name" }, { key: "sender", label: "Sender" }, { key: "receivers", label: "Receivers", list: true }, { key: "dlc", label: "DLC", num: true }, { key: "cycle_ms", label: "Cycle ms", num: true }, { key: "purpose", label: "Purpose" }, { key: "functions", label: "For functions", list: true }], d.messages, save, { blank: { dlc: 8 } }),
        h("h3", { text: "Flash added per board (estimate)" }), editTable([{ key: "node", label: "Board" }, { key: "low", label: "Low KiB", num: true }, { key: "high", label: "High KiB", num: true }, { key: "what", label: "What" }], d.flash_add_kib, save),
        h("div", { class: "row mt" }, btn("Recompute with my edits", async () => {
          const meta = a.meta, out = E.computeArchitecture(req, Object.assign({}, d, { functions: d.functions.map(f => Object.assign({}, f, { origin: "person" })) }), "person");
          out.meta = Object.assign({}, meta, out.meta, { generated: PL.nowIso(), run_id: PL.runId(), upstream: await E.upstreamHashes(req, "architecture"), edited_by_person: true });
          req.architecture = out; PL.audit(req, "architecture edited by hand"); PL.saveRequests(); PL.route();
        }, "btn-primary")));
    }
    await frame(req, "architecture", [gen, metaLine(a.meta),
      !req.sample && a.meta && a.meta.banner ? h("p", { class: "banner", text: a.meta.banner }) : null,
      PL.section("Nodes", PL.table([{ key: "id", label: "Id" }, { key: "board", label: "Board" }, { key: "role", label: "Role", cls: "t" }], a.nodes || [])),
      PL.section("Functions (" + a.functions.length + ")", PL.table([{ key: "id", label: "Id" }, { key: "name", label: "Function" }, { key: "node", label: "Board" }, { label: "Gaps", render: f => (f.gaps || []).join(", ") }, { label: "Messages", render: f => (f.messages || []).join(", ") }, { key: "rationale", label: "Why", cls: "t" }], a.functions)),
      PL.section("CAN messages", PL.table([{ key: "id", label: "Id" }, { key: "name", label: "Name" }, { key: "sender", label: "Sender" }, { label: "To", render: m => (m.receivers || []).join(", ") }, { key: "dlc", label: "DLC" }, { label: "Cycle", render: m => m.cycle_ms == null ? "event" : m.cycle_ms + " ms" }, { key: "status", label: "Status" }, { key: "purpose", label: "Purpose", cls: "t" }], a.can_messages || []),
        (a.proposed_can_ids || []).length ? h("div", {}, h("h3", { class: "mt", text: "New ids proposed (registered by you, never by the tool)" }), h("ul", { class: "small" }, a.proposed_can_ids.map(m => h("li", {}, h("strong", { text: m.id + " " + m.name + ": " }), (m.checks_passed || []).join("; "))))) : null),
      h("div", { class: "grid2" },
        PL.section("Budgets", per.length ? PL.objTable(per) : muted("none"), bus.length ? PL.objTable(bus) : null),
        PL.section("Risks (" + (a.risks || []).length + ")", h("ul", { class: "risks" }, (a.risks || []).map(r => h("li", {}, PL.sev(r.severity), " ", h("strong", { text: r.id + " " }), r.text, h("span", { class: "small muted", text: " (" + (r.basis || "") + ", " + (r.origin || "") + ")" })))))),
      PL.section("Computations (code only)", h("div", { class: "comps" }, (a.computations || []).map(c => h("details", { class: "comp" }, h("summary", {}, h("span", { class: "mono", text: c.id + " " }), c.title, " ", PL.badge(c.kind === "estimate" ? "reopened" : "complete", c.kind)),
        c.method ? muted(c.method) : null, h("ol", { class: "small" }, (c.steps || []).map(s => h("li", { text: s }))))))),
      a.sequence ? PL.section("Update sequence", PL.table([{ key: "n", label: "#" }, { key: "phase", label: "Phase" }, { key: "node", label: "Board" }, { key: "action", label: "Action", cls: "t" }, { key: "on_failure", label: "On failure", cls: "t" }], a.sequence)) : null,
      PL.section("Gap coverage", PL.table([{ key: "gap_id", label: "Gap" }, { label: "Functions", render: r => (r.functions || []).join(", ") || "NONE" }, { label: "Messages", render: r => (r.messages || []).join(", ") }], a.gap_coverage || [])),
      PL.section("Owner decisions", h("ul", {}, (a.owner_decisions || []).map(o => h("li", {}, h("strong", { text: o.id + " " }), o.text)))),
      editor,
      req.sample ? PL.section("AI use in this stage", muted(PL.usageLine(req.usage.by_stage.architecture) + " · API-equivalent $" + req.usage.by_stage.architecture.api_equivalent_usd)) : null,
      await gatePanel(req, "architecture")]);
  }
  /* A table for rows of plain objects with mixed keys (budgets of the sample and of your project). */
  PL.objTable = rows => {
    const keys = PL.uniq([].concat(...rows.map(r => Object.keys(r)))).filter(k => rows.some(r => r[k] != null && typeof r[k] !== "object"));
    return PL.table(keys.map(k => ({ label: k.replace(/_/g, " "), render: r => r[k] == null ? "" : String(r[k]), cls: k === "basis" ? "t" : "" })), rows);
  };
  /* Nested object as definition lists (for the sample's richer electrical sections). */
  PL.objView = (o, depth) => {
    depth = depth || 0;
    if (o == null || typeof o !== "object") return h("span", { text: String(o) });
    if (Array.isArray(o)) return o.every(x => x == null || typeof x !== "object") ? h("span", { text: o.join(", ") }) : (depth > 2 ? h("span", { text: o.length + " item(s)" }) : h("ul", { class: "small" }, o.map(x => h("li", {}, PL.objView(x, depth + 1)))));
    return h("dl", { class: "kv" }, Object.entries(o).filter(([, v]) => v != null && v !== "").map(([k, v]) => [h("dt", { text: k.replace(/_/g, " ") }), h("dd", {}, depth > 2 && typeof v === "object" ? h("span", { text: "…" }) : PL.objView(typeof v === "number" ? PL.round(v, 5) : v, depth + 1))]));
  };

  // ------------------------------------------------------------------ stage 4: electrical
  async function viewElectrical(req) {
    const e = req.electrical;
    const needs = !req.architecture ? "Needs an architecture (stage 3)." : null;
    let inputsPanel = null;
    if (!req.sample) {
      req.elecInputs = req.elecInputs || { requests: [], rails: [], risks: [] };
      const inp = req.elecInputs, save = rerender => { PL.saveRequests(); if (rerender) PL.route(); };
      inp.rails.forEach(r => { if (r.loads_text == null) r.loads_text = (r.loads || []).map(l => l.name + ":" + (l.current_ma == null ? "?" : l.current_ma)).join("; "); });
      const railRows = inp.rails;
      inputsPanel = PL.section("Inputs: signals to wire and supply rails",
        muted("The AI can list them from the architecture; you correct them; then code allocates pins and does every calculation. Loads as 'name:mA; name:?' (? = unknown, never guessed)."),
        h("div", { class: "row" }, btn(isBusy(req.id, "elec-in") ? "Working…" : "List them from the architecture with AI", () => work(req, "elec-in", async () => {
          markStart(req, "electrical");
          const r = await E.draftElectricalInputs(req, true); req.elecInputs = r.inputs; req.elecInputsUsage = r.usage; PL.audit(req, "electrical inputs drafted");
        }), "", { disabled: !PL.aiReady() || !!needs || isBusy(req.id, "elec-in") })),
        h("h3", { text: "Signals" }), editTable([{ key: "board", label: "Board", options: (req.inventory.boards || []).map(b => b.id) }, { key: "function", label: "Function" }, { key: "kind", label: "Kind", options: ["adc", "digital_in", "digital_out", "pwm"] },
          { key: "pin", label: "Pin (optional)", num: true }, { key: "v_min", label: "Sense V min", num: true }, { key: "v_max", label: "Sense V max", num: true }, { key: "load_ma", label: "Load mA", num: true }], inp.requests, save, { blank: { kind: "digital_in" } }),
        h("h3", { text: "Supply rails" }), editTable([{ key: "name", label: "Rail" }, { key: "source", label: "Source" }, { key: "rating_ma", label: "Rating mA", num: true }, { key: "loads_text", label: "Loads (name:mA; name:?)" }], railRows, save),
        h("div", { class: "row mt" }, btn("Run the electrical checks", async () => {
          inp.rails.forEach(r => { r.loads = String(r.loads_text || "").split(";").map(x => x.trim()).filter(Boolean).map(x => { const [n, v] = x.split(":"); return { name: (n || "").trim(), current_ma: v == null || v.trim() === "?" || v.trim() === "" ? null : Number(v) }; }); });
          markStart(req, "electrical");
          req.electrical = await E.computeElectrical(req, PL.clone(inp), { llm: req.elecInputsUsage || { calls: 0 }, notes: [] });
          PL.audit(req, "electrical checks run"); PL.saveRequests(); PL.route();
        }, "btn-primary", { disabled: !!needs }), h("span", { class: "muted small", text: needs || "Board facts (free pins, ADC pins, limits) come from the project inventory." })));
    }
    if (!e) return frame(req, "electrical", [inputsPanel]);
    const pinRows = (e.pin_allocation || {}).rows || [];
    const dividers = req.sample ? (e.supply_divider && e.supply_divider.applies ? [{ id: "supply", function: "supply-voltage divider (" + ((e.supply_divider.profile || {}).label || "") + ")", divider: e.supply_divider }] : []) : pinRows.filter(r => r.divider && r.divider.needed);
    await frame(req, "electrical", [inputsPanel, metaLine(e.meta),
      !req.sample && e.meta && e.meta.banner ? h("p", { class: "banner", text: e.meta.banner }) : null,
      PL.section("Findings (" + e.findings.length + ")", h("ul", { class: "risks" }, e.findings.map(f => h("li", {}, PL.sev(f.severity), " ", h("strong", { text: f.id + " " }), f.text, h("span", { class: "small muted", text: " (" + f.basis + ")" }))))),
      PL.section("Pin allocation", PL.table([{ key: "id", label: "Id" }, { key: "board", label: "Board" }, { key: "function", label: "Function", cls: "t" }, { label: "Kind", render: r => (r.needs || []).join(", ") }, { label: "Pin", render: r => r.pin == null ? "-" : "GPIO" + r.pin }, { key: "result", label: "Result" },
        { label: "Checks", render: r => h("ul", { class: "small checks" }, (r.checks || []).map(c => h("li", { class: c.ok ? "ok" : "err", text: (c.ok ? "✓ " : "✗ ") + c.name + (c.detail ? ": " + String(c.detail).slice(0, 120) : "") }))) }], pinRows)),
      dividers.map(r => PL.section("Divider: " + r.function, PL.objView({ range: r.divider.range, design: r.divider.design, ranges_at_pin: r.divider.ranges_at_pin, dissipation: r.divider.dissipation, filter: r.divider.filter, protection: r.divider.protection }))),
      req.sample && e.relay ? PL.section("Relay power-cut drive", h("p", { text: e.relay.verdict }), PL.objView({ drive_cases: e.relay.drive_cases, fallback_driver: e.relay.fallback_driver })) : null,
      req.sample ? null : pinRows.filter(r => r.drive && r.drive.driver_needed).map(r => PL.section("Load driver: " + r.function, PL.objView(r.drive))),
      PL.section("Power budget", h("div", {}, ((e.power_budget || {}).rails || []).map(r => h("div", { class: "rail" }, h("h3", { text: r.id + " " + r.name }),
        muted("Source: " + (r.source ? r.source.name + " (" + r.source.rating + ")" : "") + (r.verdict ? " · verdict: " + r.verdict : "")),
        PL.table([{ key: "name", label: "Load" }, { label: "Current mA", render: l => String(l.current_ma) }, { key: "basis", label: "Basis", cls: "t" }], r.loads || []))))),
      PL.section("Wiring", PL.table([{ key: "id", label: "Id" }, { key: "from", label: "From" }, { key: "to", label: "To" }, { key: "kind", label: "Kind" }, { key: "note", label: "Note", cls: "t" }], (e.wiring || {}).connections || [])),
      PL.section("Computations", h("div", { class: "comps" }, (e.computations || []).map(c => h("details", { class: "comp" }, h("summary", {}, h("span", { class: "mono", text: c.id + " " }), c.title), c.method ? muted(c.method) : null, h("ol", { class: "small" }, (c.steps || []).map(s => h("li", { text: s }))))))),
      PL.section("Assumptions (verify against datasheets)", PL.table([{ key: "id", label: "Id" }, { key: "text", label: "What", cls: "t" }, { label: "Value", render: a => a.value + " " + (a.unit || "") }, { key: "source", label: "Source", cls: "t" }], e.assumptions || [])),
      PL.section("Owner decisions", h("ul", {}, (e.owner_decisions || []).map(o => h("li", {}, h("strong", { text: o.id + " " }), o.text)))),
      muted("ngspice: " + ((e.meta || {}).tool || {}).ngspice),
      req.sample ? PL.section("AI use in this stage", muted(PL.usageLine(req.usage.by_stage.electrical) + " · API-equivalent $" + req.usage.by_stage.electrical.api_equivalent_usd)) : null,
      await gatePanel(req, "electrical")]);
  }

  // ------------------------------------------------------------------ stage 5: integration guides
  async function viewGuides(req) {
    const G = req.guides;
    let gen = null;
    if (!req.sample) {
      const dividers = req.electrical ? req.electrical.pin_allocation.rows.filter(r => r.divider && r.divider.needed) : [];
      req.guidesParts = req.guidesParts || {};
      gen = h("div", {}, genBar(req, "guides", G ? "Make the guides again" : "Make the guides", async ai => { req.guides = await E.generateGuides(req, ai); PL.audit(req, "guides made"); }, !req.electrical ? "Needs electrical checks (stage 4)." : null),
        dividers.length ? h("div", { class: "card panel" }, h("strong", { text: "Parts arrived? " }), dividers.map((r, k) => h("label", { class: "inline" }, h("input", { type: "checkbox", checked: !!req.guidesParts["divider-parts-" + (k + 1)], onchange: e => { req.guidesParts["divider-parts-" + (k + 1)] = e.target.checked; PL.saveRequests(); } }), "divider parts for " + r.function.slice(0, 50))),
          muted("Steps that need parts stay blocked until they arrive. Making the guides again picks this up (and voids an earlier approval).")) : null);
    }
    if (!G) return frame(req, "guides", [gen]);
    const blocks = [];
    for (const g of G.guides) {
      const gh = await PL.hashOf(g);
      blocks.push(h("details", { class: "card panel guide", open: G.guides.length < 3 },
        h("summary", {}, h("strong", { text: g.title }), " ", muted(g.steps.length + " steps · " + (g.blocked_steps || []).length + " blocked · " + (g.owner_only_steps || []).length + " owner only")),
        g.purpose ? h("p", { text: g.purpose }) : null,
        g.equipment ? muted("Equipment: " + g.equipment.join("; ")) : null,
        h("ol", { class: "gsteps" }, g.steps.map(s => {
          const st = E.stepStatus(req.guideLog, gh, g.id, s), val = h("input", { placeholder: s.check.kind === "confirm" ? "yes when done" : (s.check.expect || {}).unit || "value", "aria-label": "Result of " + s.id });
          return h("li", { class: "gstep st-" + st.key },
            h("div", { class: "row" }, h("span", { class: "mono", text: s.id }), h("strong", { text: s.title }), PL.badge({ confirmed: "approved", checked: "approved", failed: "rejected", blocked: "reopened", pending: "drafting" }[st.key] || "drafting", st.label), s.owner_only ? PL.badge("in-review", "owner only") : null),
            h("p", { text: s.action }), s.safety ? h("p", { class: "small warn", text: "Safety: " + s.safety }) : null,
            h("p", { class: "small" }, h("strong", { text: "Check: " }), (s.check.expect || {}).text || "", (s.check.expect || {}).min != null ? " (" + s.check.expect.min + " to " + s.check.expect.max + " " + (s.check.expect.unit || "") + ")" : ""),
            s.model_tip ? h("p", { class: "small tip", text: "Tip: " + s.model_tip }) : null,
            (s.blocked_by || []).length ? h("p", { class: "small blockers", text: "Blocked: " + s.blocked_by.map(b => b.reason).join("; ") }) : null,
            st.entry ? muted("Recorded " + st.entry.value + " by " + st.entry.by + " · " + st.entry.at.replace("T", " ")) : null,
            req.sample || s.blocked ? null : h("div", { class: "row" }, val, small("Record", () => {
              if (!String(val.value).trim()) return PL.toast("Type the result first.");
              const verdict = E.evaluateStep(s, val.value);
              req.guideLog.push({ at: PL.nowIso(), by: PL.settings.name || "(no name)", guide_hash: gh, guide: g.id, step: s.id, value: String(val.value).slice(0, 200), verdict, kind: "result" });
              PL.saveRequests(); PL.route();
            }), st.entry ? small("Retract", () => { req.guideLog.push({ at: PL.nowIso(), by: PL.settings.name || "(no name)", guide_hash: gh, guide: g.id, step: s.id, kind: "retract", value: "", verdict: "" }); PL.saveRequests(); PL.route(); }) : null));
        }))));
    }
    await frame(req, "guides", [gen, metaLine(G.index.meta),
      muted("The tool never runs a command or touches a board. You do each step and record the result; code checks it against the expectation. The log is append-only and bound to each guide's hash, so recording a result never voids the review, and a regenerated guide starts a fresh log."),
      blocks,
      req.sample ? PL.section("AI use in this stage", muted(PL.usageLine(req.usage.by_stage.guides) + " · API-equivalent $" + req.usage.by_stage.guides.api_equivalent_usd)) : null,
      await gatePanel(req, "guides")]);
  }

  // ------------------------------------------------------------------ stage 6: firmware requirements
  async function viewFirmware(req) {
    const F = req.firmware;
    const gen = req.sample ? null : genBar(req, "firmware", F ? "Draft the SWDs again" : "Draft the firmware design notes (SWDs)", async ai => {
      const old = req.firmware; req.firmware = await E.generateFirmware(req, ai);
      if (old && old.od_decisions) req.firmware.od_decisions = null;
      PL.audit(req, "SWDs drafted");
    }, !req.architecture ? "Needs an architecture (stage 3)." : null);
    if (!F) return frame(req, "firmware", [gen]);
    const blocks = [];
    if (req.sample) {
      blocks.push(PL.section("Firmware maturity ladder (real results of the pilot)", PL.table([{ key: "module", label: "Module" }, { key: "title", label: "What", cls: "t" }, { key: "level_reached", label: "Level" }, { label: "Checks", render: m => Object.entries(m.checks_by_level || {}).map(([l, c]) => l + " " + c.pass + "✓" + (c.fail ? " " + c.fail + "✗" : "") + (c.pending ? " " + c.pending + "…" : "")).join(" · ") }], F.ladderSample || []),
        muted("F1-F3 ran on the PC in the local tool: host build with warnings as errors, unit tests written blind from the SWDs, mutation tests. F4 (real boards) was not attempted.")));
      const od = F.od_decisions || {};
      blocks.push(PL.section("Owner decisions recorded (" + Object.keys(od.od || {}).length + ")", PL.table([{ key: "id", label: "Id" }, { key: "choice", label: "Choice" }, { key: "extra", label: "Detail" }],
        Object.entries(od.od || {}).map(([id, v]) => ({ id, choice: v.choice, extra: Object.entries(v).filter(([k]) => !["choice", "note"].includes(k)).map(([k, x]) => k + " " + x).join(", ") }))), muted("Recorded by " + od.by + " on " + od.at + ", bound to the hashes of the approved scope, plan and architecture.")));
      F.swd.forEach(m => blocks.push(h("details", { class: "card panel" }, h("summary", {}, h("strong", { text: m.file })), PL.md(m.text))));
    } else {
      const cov = E.firmwareCoverage(req);
      if (cov.fnUnmapped.length || cov.needUnmapped.length) blocks.push(h("p", { class: "blockers", text: (cov.fnUnmapped.length ? "Functions in no module: " + cov.fnUnmapped.join(", ") + ". " : "") + (cov.needUnmapped.length ? "Needs with a software or test gap in no module: " + cov.needUnmapped.join(", ") + "." : "") }));
      F.ladder = F.ladder || {};
      F.swd.forEach(m => {
        const f0 = E.f0Checks(req, m), lad = F.ladder[m.module] = F.ladder[m.module] || {};
        const ta = h("textarea", { class: "swd-edit", value: m.text, rows: 14 });
        const levels = E.LADDER.map((L, i) => {
          const lowerOk = i === 0 || E.LADDER.slice(1, i).every(x => lad[x.level] && lad[x.level].done) && f0.every(c => c.ok);
          if (L.level === "F0") return h("li", {}, h("strong", { text: "F0 " }), L.what, " ", f0.every(c => c.ok) ? PL.badge("approved", "checks pass") : PL.badge("open_decision", "not yet"), h("ul", { class: "small checks" }, f0.map(c => h("li", { class: c.ok ? "ok" : "err", text: (c.ok ? "✓ " : "✗ ") + c.check + ": " + c.evidence }))));
          const rec = lad[L.level] || {}, note = h("input", { placeholder: "evidence (log, report, commit)", value: rec.note || "" });
          return h("li", {}, h("strong", { text: L.level + " " }), L.what, " ", h("span", { class: "muted small", text: "(" + L.by + ")" }), " ",
            rec.done ? PL.badge("approved", "recorded by " + rec.by) : PL.badge("drafting", "not recorded"),
            L.by === "you record" ? h("div", { class: "row" }, note, small(rec.done ? "Withdraw" : "Record as reached", () => {
              if (!rec.done && !lowerOk) return PL.toast("A level counts only when every level below it is reached.");
              if (!rec.done && !note.value.trim()) return PL.toast("Say what proves it.");
              lad[L.level] = rec.done ? {} : { done: true, note: note.value.trim(), by: PL.settings.name || "(no name)", at: PL.nowIso() };
              PL.audit(req, m.module + " " + L.level + (rec.done ? " withdrawn" : " recorded")); PL.saveRequests(); PL.route();
            })) : muted("Not recorded here: done on the real boards by the owner."));
        });
        blocks.push(h("details", { class: "card panel", open: F.swd.length < 3 }, h("summary", {}, h("strong", { text: m.module }), " ", muted(m.title + " · board " + m.node + " · functions " + m.functions.join(", ") + " · needs " + m.needs.join(", "))),
          h("div", { class: "grid2" }, h("div", {}, h("h3", { text: "SWD (Markdown)" }), ta, h("div", { class: "row mt" }, small("Save the SWD", () => { m.text = ta.value; PL.audit(req, m.module + " SWD edited"); PL.saveRequests(); PL.route(); }))),
            h("div", {}, h("h3", { text: "Maturity ladder" }), h("ol", { class: "ladder" }, levels), h("h3", { text: "Preview" }), PL.md(m.text)))));
      });
      // the owner's decision record
      const ods = E.collectODs(req), rec = F.od_decisions, inputs = {};
      blocks.push(PL.section("Owner decisions (" + ods.length + ")", muted("Every decision the earlier stages left open. The record can be saved only when each has a choice; it is part of what the swd_review gate approves."),
        rec ? h("p", {}, PL.badge("approved", "saved"), " by " + rec.by + " on " + rec.at.replace("T", " ")) : null,
        h("div", { class: "ods" }, ods.map(o => { inputs[o.id] = h("input", { value: rec && rec.od[o.id] ? rec.od[o.id].choice : "", placeholder: "your decision", "aria-label": "Decision " + o.id }); return h("div", { class: "od-row" }, h("p", {}, h("strong", { text: o.id + " (" + o.from + ") " }), o.text), inputs[o.id]); })),
        h("div", { class: "row mt" }, btn("Save the decision record", async () => {
          const n = PL.needName(); if (!n) return;
          const od = {}; let miss = 0;
          ods.forEach(o => { const v = inputs[o.id].value.trim(); if (!v) miss++; od[o.id] = { choice: v, note: "" }; });
          if (miss) return PL.toast(miss + " decision(s) still empty.");
          F.od_decisions = { by: n, at: PL.nowIso(), od, basis: { requirements: await E.stageHash(req, "requirements"), plan: await E.stageHash(req, "plan"), architecture: await E.stageHash(req, "architecture") } };
          PL.audit(req, "owner decisions saved (" + ods.length + ")"); PL.saveRequests(); PL.route();
        }, "btn-primary", { disabled: !ods.length && !!rec }), ods.length ? null : muted("No open decision: save an empty record to continue."))));
    }
    await frame(req, "firmware", [gen, metaLine(F.meta), blocks, await gatePanel(req, "firmware")]);
  }

  // ------------------------------------------------------------------ sample overview with the totals
  async function viewSampleIntro(req) {
    const u = req.usage, t = u.total;
    const rows = Object.entries(u.by_stage).map(([k, v]) => ({ stage: (E.BY_KEY[k] || { name: k }).name, calls: v.calls, tokens: (v.in || 0) + (v.out || 0), seconds: v.seconds, usd: "$" + PL.fmt(v.api_equivalent_usd, 3) }));
    const first = req.sampleAudit[0], last = req.sampleAudit.filter(a => a.action === "approved").pop();
    return [PL.section("The pilot in numbers",
      h("ul", { class: "stats-row" },
        h("li", {}, h("strong", { text: String(req.plan.gap_report.summary.needs) }), h("span", { text: "needs found" })),
        h("li", {}, h("strong", { text: String(req.plan.gap_report.gaps.length) }), h("span", { text: "gaps, each with an owner" })),
        h("li", {}, h("strong", { text: String((req.architecture.proposed_can_ids || []).length) }), h("span", { text: "new CAN ids, checked" })),
        h("li", {}, h("strong", { text: String(req.electrical.findings.length) }), h("span", { text: "electrical findings" })),
        h("li", {}, h("strong", { text: PL.fmt(t.seconds / 60, 1) + " min" }), h("span", { text: "of AI time, all stages" })),
        h("li", {}, h("strong", { text: "$" + PL.fmt(t.api_equivalent_usd, 2) }), h("span", { text: "API-equivalent AI cost" }))),
      PL.table([{ key: "stage", label: "Stage" }, { key: "calls", label: "AI calls" }, { key: "tokens", label: "Tokens" }, { key: "seconds", label: "Seconds" }, { key: "usd", label: "API-equivalent" }], rows),
      muted("First gate opened " + first.at.replace("T", " ").replace("Z", "") + " UTC; last approval " + last.at.replace("T", " ").replace("Z", "") + " UTC. The costs are what the same calls would cost on the API; the pilot ran on the owner's Claude plan."))];
  }

  // ------------------------------------------------------------------ timing page
  async function viewTiming(req) {
    const rows = [];
    let totActive = 0, totAi = 0, totEst = 0, estCount = 0, approvedCount = 0;
    for (const s of E.STAGES) {
      const t = timing(req, s.key), stt = await E.stageState(req, s.key), g = req.gates[s.gate];
      const started = s.key === "requirements" ? (t.started || ((req.audit || [])[0] || {}).at || null) : t.started;
      const done = stt.key === "approved" && g ? g.at : null;
      const cal = started ? ((done ? Date.parse(done) : Date.now()) - Date.parse(started)) / 1000 : null;
      const ai = aiSecondsOf(req, s.key);
      totActive += t.active_s || 0; totAi += ai;
      if (t.estimate_h != null && t.estimate_h !== "") { totEst += Number(t.estimate_h); estCount++; }
      if (done) approvedCount++;
      rows.push({ s, t, started, done, cal, ai });
    }
    const est = key => {
      const t = timing(req, key);
      return h("input", { type: "number", min: "0", step: "0.5", value: t.estimate_h == null ? "" : t.estimate_h, placeholder: "hours", "aria-label": "Your estimate by hand for " + E.BY_KEY[key].name, class: "est",
        onchange: e => { t.estimate_h = e.target.value === "" ? null : Number(e.target.value); PL.saveRequests(); PL.route(); } });
    };
    const table = PL.table([
      { label: "Stage", render: r => h("a", { href: base(req) + (r.s.path ? "/" + r.s.path : ""), text: r.s.n + " · " + r.s.name }) },
      { label: "Hands-on", render: r => dur(r.t.active_s || 0) }, { label: "AI", render: r => dur(r.ai) },
      { label: "Calendar", render: r => r.cal == null ? "not started" : dur(r.cal) + (r.done ? "" : " (still open)") },
      { label: "Your estimate by hand", render: r => est(r.s.key) }], rows);
    const sh = req.timingShare = req.timingShare || { role: "", note: "", title: false };
    const role = h("input", { placeholder: "optional: your role or team size", maxlength: 120, value: sh.role }), note = h("textarea", { placeholder: "optional: anything worth knowing (what was faster, what was in the way)", maxlength: 1500, value: sh.note });
    const withTitle = h("input", { type: "checkbox", checked: sh.title });
    role.addEventListener("input", () => { sh.role = role.value; PL.saveRequests(); });
    note.addEventListener("input", () => { sh.note = note.value; PL.saveRequests(); });
    withTitle.addEventListener("change", () => { sh.title = withTitle.checked; PL.saveRequests(); });
    const report = () => {
      const lines = ["Proofline timing (browser edition)", ""];
      if (withTitle.checked) lines.push("Feature: " + req.title, "");
      rows.forEach(r => lines.push(r.s.n + ". " + r.s.name + ": hands-on " + dur(r.t.active_s || 0) + ", AI " + dur(r.ai) + ", calendar " + (r.cal == null ? "not started" : dur(r.cal) + (r.done ? "" : " (open)")) + ", my estimate by hand " + (r.t.estimate_h == null ? "-" : r.t.estimate_h + " h")));
      lines.push("", "Total hands-on: " + dur(totActive) + " · AI: " + dur(totAi) + " · my estimate by hand: " + (estCount ? totEst + " h (" + estCount + " stage(s))" : "-") + " · stages approved: " + approvedCount + "/6");
      lines.push("AI: " + (PL.aiReady() ? PL.settings.model : "off"));
      if (role.value.trim()) lines.push("Role / team: " + role.value.trim());
      if (note.value.trim()) lines.push("", "Note: " + note.value.trim());
      return lines.join("\n");
    };
    // the ratio counts only stages that are approved (finished) and estimated, so a half-done stage cannot inflate it
    const fin = rows.filter(r => r.done && r.t.estimate_h != null && r.t.estimate_h !== "" && (r.t.active_s || 0) >= 60);
    const ratio = fin.length ? fin.reduce((a, r) => a + Number(r.t.estimate_h) * 3600, 0) / fin.reduce((a, r) => a + r.t.active_s, 0) : null;
    await frame(req, "timing", [
      h("ul", { class: "stats-row" },
        h("li", {}, h("strong", { text: dur(totActive) }), h("span", { text: "hands-on, all stages" })),
        h("li", {}, h("strong", { text: dur(totAi) }), h("span", { text: "AI time" })),
        h("li", {}, h("strong", { text: approvedCount + "/6" }), h("span", { text: "stages approved" })),
        h("li", {}, h("strong", { text: estCount ? totEst + " h" : "–" }), h("span", { text: "your estimate by hand" })),
        h("li", {}, h("strong", { text: ratio ? PL.fmt(ratio, 1) + "×" : "–" }), h("span", { text: "your estimate ÷ hands-on, approved stages only" }))),
      PL.section("Per stage", table,
        muted("Hands-on counts only while this tab is visible and you typed, clicked or scrolled in the last 2 minutes. Calendar runs from the first work on a stage to its approval. AI is the model time of the latest run.")),
      PL.section("Share your result (optional)",
        h("p", { text: "Proofline's page has no measured before-and-after yet. If you send yours, it can become the first one (only with your permission, and without naming you unless you say so)." }),
        role, note, h("label", { class: "inline" }, withTitle, "Include the feature title"),
        h("div", { class: "row mt" },
          btn("Copy as text", async () => { try { await navigator.clipboard.writeText(report()); PL.toast("Copied."); } catch (e) { PL.toast("Copy failed: select the preview below and copy it."); } }),
          btn("Email it to Ketan", () => { location.href = "mailto:ketan01bakshi@gmail.com?subject=" + encodeURIComponent("Proofline timing") + "&body=" + encodeURIComponent(report()); }, "btn-primary")),
        muted("The email opens in your own mail app with the text below; nothing is sent until you press send there."),
        h("details", {}, h("summary", { text: "Preview what would be shared" }), h("pre", { class: "share-pre", text: report() })))]);
  }

  // ------------------------------------------------------------------ router
  const VIEWS = { "": viewRequirements, plan: viewPlan, architecture: viewArchitecture, electrical: viewElectrical, guides: viewGuides, firmware: viewFirmware, inventory: viewInventory, timing: viewTiming };
  let routing = Promise.resolve();
  PL.route = function () {
    routing = routing.then(async () => {
      const m = (location.hash || "#/").slice(1).split("/").filter(Boolean).map(decodeURIComponent);
      track = m[0] === "r" && m[1] && E.BY_KEY[m[2] === undefined ? "requirements" : m[2]] ? { id: m[1], key: m[2] === undefined ? "requirements" : m[2] } : null;
      if (m[0] === "new") return viewNew();
      if (m[0] === "help") return viewHelp();
      if (m[0] === "sample") {
        const req = await loadSample(), key = m[1] || "";
        if (!key) { const intro = await viewSampleIntro(req); await viewRequirements(req); PL.app().insertBefore(h("div", {}, intro), PL.app().querySelector(".strip").nextSibling); return; }
        return (VIEWS[key] || viewRequirements)(req);
      }
      if (m[0] === "r" && m[1]) {
        const req = PL.findReq(m[1]);
        if (!req) return PL.mount(h("h1", { text: "Not found" }), h("p", {}, "No request with that id in this browser. ", h("a", { href: "#/", text: "Back to the list" })));
        migrate(req);
        const v = VIEWS[m[2] || ""];
        return v ? v(req) : viewRequirements(req);
      }
      return viewHome();
    }).catch(e => { console.error(e); PL.mount(h("p", { class: "err", text: "Something went wrong: " + e.message })); });
  };
})();
