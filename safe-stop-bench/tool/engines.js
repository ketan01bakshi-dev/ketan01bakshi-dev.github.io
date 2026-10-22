/* Proofline stages 2-6, browser edition: the engines. Pure functions + optional model drafts; the views store the results.
 *
 * The same contract as the local tool (Safe-Stop Bench, tsp/):
 *   - rules decide: every status, number, id and verdict is computed here by code; the model only PROPOSES, and every proposal is checked;
 *   - the person approves: each stage has a gate bound to the SHA-256 of its artifact; a stage can be submitted only while every
 *     earlier gate is approved by a person for the current version, and it was made from those versions ("stale" otherwise);
 *   - the tool never orders parts, never touches hardware and never runs a command.
 * What a browser cannot do (scan a repo, run ngspice, compile and mutation-test firmware) is replaced by stated hand calculations
 * and by checklists the person records; every page says so. AI-assisted, synthetic, illustrative. No compliance claim.
 */
(function () {
  "use strict";
  const PL = window.PL, S = PL.scope, norm = PL.norm, round = PL.round;

  // =================================================================== stages and gates
  const STAGES = [
    { n: 1, key: "requirements", name: "Feature Requirements", gate: "scope_review", path: "", up: [],
      desc: "Turns a vague feature request into agreed requirements: answers, accepted assumptions and open decisions, reviewed by a person." },
    { n: 2, key: "plan", name: "Gap Analysis & Overall Plan", gate: "plan_review", path: "plan", up: ["requirements"],
      desc: "Compares the approved requirements with what the project already has, on six axes, and lists the gaps, the action plan and the parts." },
    { n: 3, key: "architecture", name: "Network & Node Architecture", gate: "architecture_review", path: "architecture", up: ["requirements", "plan"],
      desc: "Decides which board does what, which CAN messages carry it, and the bus-load and memory budgets." },
    { n: 4, key: "electrical", name: "Electrical Design Checks", gate: "electrical_review", path: "electrical", up: ["requirements", "plan", "architecture"],
      desc: "Checks pins, the voltage divider, load drive and the power budget by calculation, board level only." },
    { n: 5, key: "guides", name: "Integration Guides", gate: "guide_review", path: "guides", up: ["requirements", "plan", "architecture", "electrical"],
      desc: "Step-by-step wiring and measuring guides with a check for every step; you record each result." },
    { n: 6, key: "firmware", name: "Firmware Requirements", gate: "swd_review", path: "firmware", up: ["requirements", "plan", "architecture"],
      desc: "Firmware design notes (SWDs) per module, your record of the owner decisions, and the F0-F5 maturity ladder." },
  ];
  const BY_KEY = Object.fromEntries(STAGES.map(s => [s.key, s]));

  function artifact(req, key) {
    if (key === "requirements") return req.scope ? S.scopeArtifact(req.scope) : null;
    if (key === "plan") return req.plan || null;
    if (key === "architecture") return req.architecture || null;
    if (key === "electrical") return req.electrical || null;
    if (key === "guides") return req.guides ? { index: req.guides.index, guides: req.guides.guides } : null;
    if (key === "firmware") return req.firmware && req.firmware.swd ? { swd: req.firmware.swd, od_decisions: req.firmware.od_decisions || null } : null;
    return null;
  }
  const stageHash = async (req, key) => { const a = artifact(req, key); return a ? PL.hashOf(a) : null; };
  async function upstreamHashes(req, key) {
    const out = {};
    for (const k of BY_KEY[key].up) out[k] = await stageHash(req, k);
    return out;
  }
  /* The state of a stage, computed every time (never stored): none | stale | draft | in review | approved | rejected | reopened
     (requirements also: drafting | complete). `blockers` says why it cannot be submitted. */
  async function stageState(req, key) {
    const st = BY_KEY[key], h = await stageHash(req, key);
    const g = (req.gates || {})[st.gate];
    if (req.sample) {
      const last = (req.sampleGates || {})[st.gate];
      return { key: last ? last.action : "none", label: last ? (last.action === "approved" ? "approved by " + last.actor : last.action) : "not reached", h, blockers: [] };
    }
    if (!h) return { key: "none", label: "not started", h, blockers: ["not generated yet"] };
    const blockers = [];
    let stale = false;
    const metaOf = { plan: () => req.plan.meta, architecture: () => req.architecture.meta, electrical: () => req.electrical.meta, guides: () => req.guides.index.meta, firmware: () => req.firmware.meta };
    const made = (key === "requirements") ? {} : (((metaOf[key] || (() => null))() || {}).upstream || {});
    for (const k of st.up) {
      const uh = await stageHash(req, k);
      if (made[k] && made[k] !== uh) stale = true;
      const us = await stageState(req, k);
      if (us.key !== "approved") blockers.push(BY_KEY[k].name + " is not approved");
    }
    if (stale) blockers.unshift("made from an older version of an earlier stage: generate it again");
    if (key === "requirements") {
      const c = S.completeness(req.scope);
      if (!c.complete) blockers.push(...c.blockers);
    }
    if (key === "firmware") {
      if (!(req.firmware && req.firmware.od_decisions)) blockers.push("the owner-decision record is not saved yet");
      if (req.architecture && req.plan) {
        const cov = firmwareCoverage(req);
        if (cov.fnUnmapped.length) blockers.push("functions in no module: " + cov.fnUnmapped.join(", "));
        if (cov.needUnmapped.length) blockers.push("needs with a software or test gap in no module: " + cov.needUnmapped.join(", "));
      }
      if (req.firmware.swd.some(m => !f0Checks(req, m).every(c => c.ok))) blockers.push("an SWD fails its F0 checks");
    }
    let state;
    if (g && g.hash === h && !stale) {
      state = g.state === "approved" ? { key: "approved", label: "approved by " + g.by } : g.state === "rejected" ? { key: "rejected", label: "rejected" } : { key: "in-review", label: "in review" };
    } else if (g && g.state === "approved" && g.hash !== h) state = { key: "reopened", label: "reopened (changed after approval)" };
    else if (stale) state = { key: "stale", label: "stale" };
    else if (key === "requirements") state = blockers.length ? { key: "drafting", label: "drafting" } : { key: "complete", label: "complete" };
    else state = { key: "draft", label: "draft" };
    return Object.assign(state, { h, blockers, stale });
  }
  const upstreamApproved = async (req, key) => { for (const k of BY_KEY[key].up) if ((await stageState(req, k)).key !== "approved") return false; return true; };

  // =================================================================== the project inventory (what the project already has)
  const AXES = ["requirements", "architecture", "software", "tests", "hardware", "plant"];
  const CAP_STATUSES = {
    requirements: ["exists", "known failure"], architecture: ["exists", "reserved"], software: ["exists", "not found"],
    tests: ["pass", "known failure", "no result", "fail"], hardware: ["proven", "fitted", "owned", "ordered", "wishlist"], plant: ["verified", "exists", "not modelled"],
  };
  function blankInventory() {
    return { caps: [], parts: [], boards: [], can: { bitrate_kbps: 500, baseline_load_pct: null, load_limit_pct: 50, ids: [] } };
  }
  function capStatus(axis, cap) {
    const s = cap.status;
    if (axis === "hardware") {
      if (["proven", "fitted", "owned"].includes(s)) return ["covered", "part is " + s];
      if (s === "ordered") return ["partial", "ordered, not arrived"];
      return ["missing", "wishlist only, not ordered"];
    }
    if (axis === "tests") return { pass: ["covered", "last result PASS"], "known failure": ["partial", "last result is a known failure"], fail: ["missing", "last result FAIL"] }[s] || ["partial", "defined, no result"];
    if (axis === "requirements") return s === "known failure" ? ["partial", "requirement exists, last result is a known failure"] : ["covered", "requirement exists"];
    if (axis === "architecture") return s === "reserved" ? ["partial", "exists but reserved for another use: reusable, not designed for this need"] : ["covered", "exists"];
    if (axis === "software") return s === "not found" ? ["missing", "listed as not found / not implemented"] : ["covered", "exists"];
    if (axis === "plant") return s === "verified" ? ["covered", "model exists and is verified"] : s === "exists" ? ["partial", "model exists, not verified"] : ["missing", "listed as not modelled"];
    return ["covered", "exists"];
  }
  function invIndex(inv) {
    const caps = {}, df = {};
    (inv.caps || []).forEach(c => { caps[c.id] = c; PL.tokens(c.name + " " + (c.notes || "")).forEach(t => { df[t] = (df[t] || 0) + 1; }); });
    const n = Math.max(1, (inv.caps || []).length);
    return { caps, idf: t => Math.log(1 + n / (df[t] || 1)), tok: c => PL.tokens(c.name + " " + (c.notes || "")) };
  }
  function assessAxis(ix, axis, needText, cited) {
    const ids = PL.uniq(cited || []).filter(i => ix.caps[i] && ix.caps[i].axis === axis);
    const reasons = [], results = [];
    ids.forEach(cid => { const [st, why] = capStatus(axis, ix.caps[cid]); results.push([cid, st]); reasons.push(cid + ": " + why); });
    // software override (rule): an entry listed as "not found" that the need runs into makes the axis missing
    const t = PL.tokens(needText);
    const override = axis === "software" ? Object.values(ix.caps).filter(c => c.axis === "software" && c.status === "not found" &&
      (needText.toLowerCase().includes(String(c.name).toLowerCase()) || [...PL.tokens(c.name)].filter(x => t.has(x)).length >= 2)) : [];
    let status, used = [];
    if (override.length) { status = "missing"; reasons.push("the inventory lists as not found: " + override.map(c => c.name + " (" + c.id + ")").join("; ")); }
    else if (!results.length) { status = "missing"; reasons.push("no capability counted for this need"); }
    else if (results.every(r => r[1] === "covered")) { status = "covered"; used = results.map(r => r[0]); }
    else if (results.some(r => r[1] !== "missing")) { status = "partial"; used = results.filter(r => r[1] !== "missing").map(r => r[0]); }
    else status = "missing";
    const hints = Object.values(ix.caps).filter(c => c.axis === axis && !ids.includes(c.id)).map(c => {
      const shared = [...ix.tok(c)].filter(x => t.has(x));
      return { id: c.id, shared, score: shared.reduce((a, x) => a + ix.idf(x), 0) };
    }).filter(x => x.shared.length >= 2).sort((a, b) => b.score - a.score).slice(0, 3).map(x => ({ id: x.id, why: "shared words: " + x.shared.slice(0, 6).join(", ") }));
    return { axis, status, inventory_ids: used, cited: ids, rule: reasons.join("; "), hints };
  }

  // =================================================================== stage 2: gap analysis, plan, BOM
  const KEY_AXES = {
    function_boundary: ["requirements", "architecture", "software"], target_hardware_toolchain: ["hardware", "software"], coding_rules: ["software"],
    test_levels: ["tests", "plant"], operating_range: ["requirements", "tests"], acceptance_criteria: ["requirements", "tests"], budgets: ["architecture", "software"],
    criticality: ["requirements"], interfaces_signals: ["architecture"], fault_cases: ["tests", "software"], update_field: ["software"], evidence: ["tests"], constraints: ["hardware"],
  };
  const PLAN_STAGES = ["requirements", "architecture", "plant", "electrical", "firmware", "hardware guide", "tests", "release"];
  const AXIS_STAGE = { requirements: "requirements", architecture: "architecture", plant: "plant", software: "firmware", hardware: "hardware guide", tests: "tests" };
  const OWNER_RANK = { buy: 3, person: 2, agent: 1 };
  const gapOwner = (axis, status) => axis === "hardware" ? "buy" : (axis === "requirements" || axis === "architecture") ? "person" : "agent";
  const NO_NEW_PARTS = /\bno new (board|part|hardware|component)s?\b|\bnothing (new )?(is |will be )?(bought|purchased)\b|\bno purchases?\b|\bwithout buying\b/i;
  const BUDGET = /budget[^.\n]{0,40}?(?:₹|rs\.?|inr|rupees?)\s*([\d][\d,]*(?:\.\d+)?)|budget[^.\n]{0,20}?([\d][\d,]*)\s*(?:₹|rs\.?|inr|rupees?)/i;

  function scopeTexts(req) { const out = {}; S.canonicalItems(req.scope).forEach(it => { out[it.key] = S.itemText(it); }); return out; }
  function scopeNeeds(req) {
    const texts = scopeTexts(req);
    return S.KEYS.map((k, i) => ({ id: "N" + String(i + 1).padStart(2, "0"), text: S.LABEL[k] + ": " + texts[k].slice(0, 400), source: { kind: "scope", scope_key: k, quote: texts[k].slice(0, 200) }, axes: KEY_AXES[k].slice(), evidence: {} }));
  }
  const PLAN_SYSTEM = `You are the gap-analysis assistant of an embedded product development and test tool. Code decides every status; you only propose.
Given the approved scope, the needs code already made (one per scope item) and the project's capability inventory, answer with ONE JSON object:
{"extra_needs":[{"scope_key":"...","quote":"...","text":"...","axes":["..."]}],"evidence":[{"need_id":"N01","axis":"software","ids":["..."]}]}
Rules: an extra need must quote words that appear in that scope item's text (code drops it otherwise) and say what must exist. Axes are requirements, architecture, software, tests, hardware, plant. Evidence ids must be copied from the inventory and live on that axis; propose only capabilities that really meet the need. At most 8 extra needs. No prose outside the JSON.`;
  const PLAN2_SYSTEM = `You are the planning assistant of an embedded product development and test tool. Code decides owners, dependencies and coverage; you write the plan prose.
Given the gaps (each with gap_id, need, axis, status) answer with ONE JSON object:
{"items":[{"stage":"...","title":"...","detail":"...","gap_ids":["..."]}],"parts":[{"gap_id":"...","part":"...","qty":1}]}
Stages are: requirements, architecture, plant, electrical, firmware, hardware guide, tests, release. Group gaps that one piece of work closes. Titles short and imperative; detail one or two plain sentences. "parts": only for hardware gaps, the part to buy in plain words. No prose outside the JSON.`;

  async function generatePlan(req, useAI) {
    const inv = req.inventory || blankInventory(), ix = invIndex(inv), texts = scopeTexts(req), notes = [], usage = { calls: 0, in: 0, out: 0, seconds: 0 };
    const add = u => { if (u) { usage.calls += u.calls; usage.in += u.in; usage.out += u.out; usage.seconds = round(usage.seconds + u.seconds, 1); } };
    let needs = scopeNeeds(req), rejected = [];
    if (useAI) {
      const prompt = "SCOPE (approved)\n" + JSON.stringify(texts, null, 1) + "\n\nNEEDS MADE BY CODE\n" + JSON.stringify(needs.map(n => ({ id: n.id, text: n.text, axes: n.axes })), null, 1) +
        "\n\nINVENTORY\n" + JSON.stringify((inv.caps || []).map(c => ({ id: c.id, axis: c.axis, name: c.name, status: c.status })), null, 1) + "\n\nAnswer with the JSON object only.";
      const r = await PL.askJSON(PLAN_SYSTEM, prompt, d => { if (d.extra_needs && !Array.isArray(d.extra_needs)) throw new Error('"extra_needs" must be a list'); });
      add(r.usage); notes.push(...r.notes);
      if (r.data) {
        (r.data.extra_needs || []).slice(0, 8).forEach(e => {
          const k = e && e.scope_key, q = e && typeof e.quote === "string" ? norm(e.quote) : "";
          if (!S.KEYS.includes(k)) return rejected.push({ need: e && e.text, reason: "unknown scope key" });
          if (!q || !norm(texts[k]).toLowerCase().includes(q.toLowerCase())) return rejected.push({ need: e.text, reason: "quote is not in the scope item" });
          if (!e.text || !String(e.text).trim()) return rejected.push({ need: e.text, reason: "empty need" });
          const axes = PL.uniq((e.axes || []).filter(a => AXES.includes(a)));
          needs.push({ id: "N" + String(needs.length + 1).padStart(2, "0"), text: norm(e.text).slice(0, 400), source: { kind: "model", scope_key: k, quote: q }, axes: axes.length ? axes : KEY_AXES[k].slice(), evidence: {} });
        });
        (r.data.evidence || []).forEach(ev => {
          const n = needs.find(x => x.id === (ev && ev.need_id));
          if (!n || !AXES.includes(ev.axis)) return;
          const ok = (ev.ids || []).filter(i => ix.caps[i] && ix.caps[i].axis === ev.axis);
          (ev.ids || []).filter(i => !ok.includes(i)).forEach(i => rejected.push({ need: n.id, reason: "evidence " + i + " does not exist on the " + ev.axis + " axis" }));
          if (ok.length) { if (!n.axes.includes(ev.axis)) n.axes.push(ev.axis); n.evidence[ev.axis] = PL.uniq((n.evidence[ev.axis] || []).concat(ok)).map(id => ({ id, by: "model" })).map(x => x.id); n.evidence_by = Object.assign(n.evidence_by || {}, Object.fromEntries(ok.map(i => [ev.axis + ":" + i, "model"]))); }
        });
      }
    }
    const plan = assemblePlan(req, needs, null, null);
    let items = null, parts = null;
    if (useAI && plan.gap_report.gaps.length) {
      const prompt = "GAPS\n" + JSON.stringify(plan.gap_report.gaps.map(g => ({ gap_id: g.gap_id, axis: g.axis, status: g.status, need: (needs.find(n => n.id === g.need_id) || {}).text })), null, 1) +
        "\n\nPARTS CATALOGUE\n" + JSON.stringify((inv.parts || []).map(p => p.part)) + "\n\nAnswer with the JSON object only.";
      const r = await PL.askJSON(PLAN2_SYSTEM, prompt, d => { if (!Array.isArray(d.items)) throw new Error('"items" must be a list'); });
      add(r.usage); notes.push(...r.notes);
      if (r.data) { items = r.data.items; parts = r.data.parts || []; }
    }
    const out = assemblePlan(req, needs, items, parts);
    out.meta = { generated: PL.nowIso(), run_id: PL.runId(), upstream: await upstreamHashes(req, "plan"), llm: usage, notes, rejected_model_needs: rejected, by: useAI ? "model+code" : "code" };
    return out;
  }
  /* Re-run the rules on the current needs (also after the person adds or removes evidence by hand). */
  function assemblePlan(req, needs, modelItems, modelParts) {
    const inv = req.inventory || blankInventory(), ix = invIndex(inv), texts = scopeTexts(req);
    needs.forEach(n => { n.assessments = n.axes.map(a => assessAxis(ix, a, n.text, (n.evidence || {})[a])); });
    const gaps = [], byAxis = {};
    AXES.forEach(a => { byAxis[a] = { covered: 0, partial: 0, missing: 0, deferred: 0 }; });
    needs.forEach(n => n.assessments.forEach(as => {
      byAxis[as.axis][as.status]++;
      if (as.status !== "covered") gaps.push({ gap_id: "G-" + n.id + "-" + as.axis, need_id: n.id, axis: as.axis, status: as.status, owner: gapOwner(as.axis, as.status), stage: AXIS_STAGE[as.axis] });
    }));
    const total = { covered: 0, partial: 0, missing: 0, deferred: 0 };
    AXES.forEach(a => Object.keys(total).forEach(k => { total[k] += byAxis[a][k]; }));
    // open decisions: from the scope, and conflicts with the scope's own constraints
    const open = [];
    S.canonicalItems(req.scope).forEach(it => S.openSentences(it).forEach(sn => open.push({ id: "D-" + String(open.length + 1).padStart(2, "0"), kind: "open_decision", scope_key: it.key, text: S.LABEL[it.key] + " is still open: " + sn })));
    const nnp = (texts.constraints + " " + texts.target_hardware_toolchain).match(NO_NEW_PARTS);
    const bm = texts.constraints.match(BUDGET), budget = bm ? parseFloat((bm[1] || bm[2]).replace(/,/g, "")) : null;
    // BOM: only for hardware gaps; lines come from the parts catalogue or say "needs a quote"; always "proposed"
    const lines = [];
    gaps.filter(g => g.axis === "hardware").forEach(g => {
      const mp = (modelParts || []).filter(p => p && p.gap_id === g.gap_id && p.part);
      const want = mp.length ? mp.map(p => ({ part: norm(p.part).slice(0, 120), qty: Math.max(1, parseInt(p.qty, 10) || 1) }))
        : [{ part: "part(s) for " + g.need_id + ": " + ((needs.find(n => n.id === g.need_id) || {}).text || "").slice(0, 70), qty: 1 }];
      want.forEach(w => {
        const owned = (inv.caps || []).find(c => c.axis === "hardware" && ["owned", "fitted", "proven"].includes(c.status) && norm(c.name).toLowerCase() === w.part.toLowerCase());
        if (owned) return;
        const wt = PL.tokens(w.part);
        const cat = (inv.parts || []).map(p => ({ p, n: [...PL.tokens(p.part)].filter(x => wt.has(x)).length })).filter(x => x.n >= 2 || (x.n >= 1 && PL.tokens(x.p.part).size === 1)).sort((a, b) => b.n - a.n)[0];
        lines.push({ part: cat ? cat.p.part : w.part, qty: w.qty, vendor: cat ? (cat.p.vendor || "unknown") : "unknown", price_inr: cat && cat.p.price_inr != null && cat.p.price_inr !== "" ? Number(cat.p.price_inr) : null,
          status: "proposed", reason: (cat ? "from your parts catalogue" : "not in catalogue: needs a quote") + "; closes " + g.gap_id, gap_ids: [g.gap_id], conflict: nnp ? "scope constraint: " + nnp[0] : "" });
      });
    });
    const known = lines.filter(l => l.price_inr != null).reduce((a, l) => a + l.price_inr * l.qty, 0);
    const bom = { currency: "INR", lines, total_known_inr: lines.some(l => l.price_inr != null) ? round(known, 2) : null, unpriced_lines: lines.filter(l => l.price_inr == null).length,
      note: "Proposed only. Proofline never orders anything." };
    if (nnp && lines.length) open.push({ id: "D-" + String(open.length + 1).padStart(2, "0"), kind: "constraint_conflict", scope_key: "constraints", text: "The scope says \"" + nnp[0] + "\", but " + lines.length + " BOM line(s) are proposed. Decide: buy, or change the scope." });
    if (budget != null && bom.total_known_inr != null && bom.total_known_inr > budget) open.push({ id: "D-" + String(open.length + 1).padStart(2, "0"), kind: "budget", scope_key: "constraints", text: "Known BOM total ₹" + bom.total_known_inr + " is over the stated budget ₹" + budget + "." });
    // fit checks (code)
    const fit = [];
    const boards = inv.boards || [];
    fit.push({ id: "F-01", kind: "boards", status: boards.length ? "ok" : "unknown", text: boards.length ? boards.length + " board(s) listed: " + boards.map(b => b.id).join(", ") : "No boards listed in the inventory: the architecture stage needs at least one." });
    const freePins = boards.reduce((a, b) => a + listOf(b.free_pins).length, 0);
    fit.push({ id: "F-02", kind: "pins", status: freePins ? "ok" : "unknown", text: freePins ? freePins + " free pin(s) listed across the boards" : "No free pins listed: pin checks will say unknown." });
    const can = inv.can || {}, ids = (can.ids || []).map(e => parseInt(e.id, 16)).filter(x => !Number.isNaN(x));
    fit.push({ id: "F-03", kind: "can_ids", status: "ok", text: ids.length ? ids.length + " CAN id(s) in the registry; new ids will be allocated above the highest active one" : "No CAN registry given: new ids start at 0x100." });
    if (budget != null) fit.push({ id: "F-04", kind: "budget", status: bom.total_known_inr == null || bom.total_known_inr <= budget ? "ok" : "conflict", text: "budget ₹" + budget + " vs known BOM total " + (bom.total_known_inr == null ? "unknown (" + bom.unpriced_lines + " unpriced line(s))" : "₹" + bom.total_known_inr) });
    // action plan: the model may write the prose; code checks ids, adds what was left out, computes owners and dependencies
    const gapIds = new Set(gaps.map(g => g.gap_id)), items = [], placed = new Set();
    (modelItems || []).forEach(m => {
      if (!m || !PLAN_STAGES.includes(m.stage)) return;
      const ids2 = PL.uniq((m.gap_ids || []).filter(i => gapIds.has(i) && !placed.has(i)));
      if (!ids2.length || !m.title) return;
      ids2.forEach(i => placed.add(i));
      items.push({ stage: m.stage, title: norm(m.title).slice(0, 140), detail: norm(m.detail || "").slice(0, 500), gap_ids: ids2, by: "model" });
    });
    gaps.filter(g => !placed.has(g.gap_id)).forEach(g => {
      const n = needs.find(x => x.id === g.need_id) || {};
      items.push({ stage: g.stage, title: (g.status === "missing" ? "Close" : "Complete") + " the " + g.axis + " gap of " + g.need_id, detail: (n.text || "").slice(0, 300), gap_ids: [g.gap_id], by: modelItems ? "code (left out by the model)" : "code" });
    });
    items.sort((a, b) => PLAN_STAGES.indexOf(a.stage) - PLAN_STAGES.indexOf(b.stage));
    items.forEach((it, i) => {
      it.id = "W" + String(i + 1).padStart(2, "0");
      it.owner = it.gap_ids.map(id => (gaps.find(g => g.gap_id === id) || {}).owner).sort((a, b) => OWNER_RANK[b] - OWNER_RANK[a])[0] || "agent";
    });
    items.forEach(it => {
      const si = PLAN_STAGES.indexOf(it.stage);
      let prev = null;
      for (let j = si - 1; j >= 0 && !prev; j--) { const ps = items.filter(x => x.stage === PLAN_STAGES[j]); if (ps.length) prev = ps; }
      it.depends_on = prev ? prev.map(x => x.id) : [];
    });
    return {
      gap_report: { feature_id: req.id, needs, open_decisions: open, fit_checks: fit, gaps, summary: { by_axis: byAxis, total, needs: needs.length } },
      action_plan: { stages: PLAN_STAGES, items, owner_decisions: open.map(o => o.id + ": " + o.text) },
      bom,
    };
  }
  function replanWithEvidence(req, needId, axis, capId, addIt) {
    const p = PL.clone(req.plan), n = p.gap_report.needs.find(x => x.id === needId);
    n.evidence = n.evidence || {};
    const cur = n.evidence[axis] || [];
    n.evidence[axis] = addIt ? PL.uniq(cur.concat(capId)) : cur.filter(x => x !== capId);
    const meta = p.meta;
    const items = p.action_plan.items.filter(i => i.by === "model").map(i => ({ stage: i.stage, title: i.title, detail: i.detail, gap_ids: i.gap_ids }));
    const parts = p.bom.lines.filter(l => !/^part\(s\) for /.test(l.part)).map(l => ({ gap_id: l.gap_ids[0], part: l.part, qty: l.qty }));
    const out = assemblePlan(req, p.gap_report.needs, items.length ? items : null, parts);
    out.meta = Object.assign({}, meta, { edited_by_person: true, run_id: PL.runId() });
    return out;
  }

  // =================================================================== stage 3: architecture
  const listOf = v => Array.isArray(v) ? v : String(v == null ? "" : v).split(/[\s,;]+/).filter(Boolean);
  const numList = v => listOf(v).map(x => parseInt(x, 10)).filter(x => !Number.isNaN(x));
  const NAME_RE = /^[A-Z][A-Za-z0-9]*_[A-Za-z0-9_]+$/;
  const DIAG_LO = 0x7DF, DIAG_HI = 0x7EF;
  const hexId = i => "0x" + i.toString(16).toUpperCase().padStart(3, "0");
  const frameBits = n => { const nominal = 47 + 8 * n, stuff = Math.floor((34 + 8 * n - 1) / 4); return { nominal, stuffing: stuff, worst: nominal + stuff }; };
  function registry(inv) {
    const ids = ((inv.can || {}).ids || []).filter(e => /^0x[0-9a-f]{1,3}$/i.test(String(e.id).trim()));
    const used = {}; ids.forEach(e => { used[parseInt(e.id, 16)] = e; });
    const active = ids.filter(e => (e.status || "active") === "active").map(e => parseInt(e.id, 16));
    return { used, names: new Set(ids.map(e => e.name)), safetyMax: active.length ? Math.max(...active) : 0, senders: new Set(ids.map(e => e.sender).filter(Boolean)) };
  }
  function allocateId(reg, taken) {
    for (let i = Math.max(0x100, reg.safetyMax + 1); i < DIAG_LO; i++) if (!reg.used[i] && !taken.has(i)) return hexId(i);
    throw new Error("no free CAN id left below the diagnostic block");
  }
  const ARCH_SYSTEM = `You are the architecture assistant of an embedded product development and test tool. Code allocates CAN ids, computes every budget and checks everything; you draft.
Given the approved gaps, the boards and the CAN registry, answer with ONE JSON object:
{"functions":[{"name":"...","node":"<board id>","gap_ids":["..."],"rationale":"..."}],
 "messages":[{"name":"PREFIX_Name","sender":"<board id>","receivers":["<board id>"],"dlc":8,"cycle_ms":100,"purpose":"...","functions":["<function name>"]}],
 "flash_add_kib":[{"node":"<board id>","low":0,"high":0,"what":"..."}],
 "risks":[{"severity":"high|medium|low","text":"...","basis":"..."}],
 "owner_decisions":["..."]}
Rules: every architecture and software gap should be addressed by a function. Only use board ids given. Do NOT give CAN ids: code allocates them. Use cycle_ms null for event-driven messages. flash_add_kib is an ESTIMATE range of added code per board. At most 6 risks and 5 owner decisions. No prose outside the JSON.`;

  async function generateArchitecture(req, useAI) {
    const inv = req.inventory || blankInventory(), plan = req.plan, notes = [];
    let draft = null, usage = { calls: 0, in: 0, out: 0, seconds: 0 };
    const gaps = plan.gap_report.gaps, needs = plan.gap_report.needs;
    if (useAI) {
      const prompt = "GAPS\n" + JSON.stringify(gaps.map(g => ({ gap_id: g.gap_id, axis: g.axis, status: g.status, need: (needs.find(n => n.id === g.need_id) || {}).text })), null, 1) +
        "\n\nBOARDS\n" + JSON.stringify((inv.boards || []).map(b => ({ id: b.id, name: b.name, role: b.role, mcu: b.mcu })), null, 1) +
        "\n\nCAN REGISTRY\n" + JSON.stringify((inv.can || {}).ids || []) + "\n\nAnswer with the JSON object only.";
      const r = await PL.askJSON(ARCH_SYSTEM, prompt, d => { if (!Array.isArray(d.functions)) throw new Error('"functions" must be a list'); });
      usage = r.usage; notes.push(...r.notes); draft = r.data;
    }
    if (!draft) {
      const first = (inv.boards || [])[0];
      draft = { functions: gaps.filter(g => g.axis === "architecture" || g.axis === "software").map(g => ({ name: "Close " + g.gap_id + ": " + ((needs.find(n => n.id === g.need_id) || {}).text || "").slice(0, 60), node: first ? first.id : "", gap_ids: [g.gap_id], rationale: "one function per gap (no model): group and rename them by hand" })),
        messages: [], flash_add_kib: [], risks: [], owner_decisions: [] };
      if (useAI) notes.push("the model answer was unusable: the code draft is used");
    }
    const arch = computeArchitecture(req, draft, useAI && draft !== null ? "model" : "code");
    arch.meta = Object.assign(arch.meta, { generated: PL.nowIso(), run_id: PL.runId(), upstream: await upstreamHashes(req, "architecture"), llm: usage, notes: notes.concat(arch.meta.notes) });
    return arch;
  }
  /* Rules on a draft (from the model, the code or the person's edits): returns architecture.json. */
  function computeArchitecture(req, draft, origin) {
    const inv = req.inventory || blankInventory(), plan = req.plan, gaps = plan.gap_report.gaps, gapSet = new Set(gaps.map(g => g.gap_id));
    const boards = inv.boards || [], nodeIds = new Set(boards.map(b => b.id)), notes = [], risks = [], ods = [];
    const nodes = boards.map(b => ({ id: b.id, board: b.name || b.id, role: b.role || "", existing: true }));
    const functions = [];
    (draft.functions || []).forEach(f => {
      if (!f || !f.name) return;
      if (!nodeIds.has(f.node)) { notes.push("function '" + f.name + "' names an unknown board '" + f.node + "': dropped"); return; }
      functions.push({ id: "AF-" + String(functions.length + 1).padStart(2, "0"), name: norm(f.name).slice(0, 140), node: f.node, gaps: PL.uniq((f.gap_ids || f.gaps || []).filter(g => gapSet.has(g))), messages: [], rationale: norm(f.rationale || "").slice(0, 600), origin: f.origin || origin });
    });
    const reg = registry(inv), taken = new Set(), names = new Set(), can = [], proposed = [];
    const senders = new Set([...nodeIds, ...reg.senders]);
    (draft.messages || []).forEach(m => {
      if (!m || !m.name) return;
      const existing = Object.entries(reg.used).find(([, e]) => e.name === m.name);
      const probs = [];
      if (!NAME_RE.test(m.name)) probs.push("name does not follow PREFIX_Name");
      if (names.has(m.name)) probs.push("name used twice");
      const dlc = parseInt(m.dlc, 10);
      if (Number.isNaN(dlc) || dlc < 0 || dlc > 8) probs.push("DLC must be 0..8 on classic CAN");
      if (!senders.has(m.sender)) probs.push("unknown sender '" + m.sender + "'");
      const cyc = m.cycle_ms == null || m.cycle_ms === "" ? null : Number(m.cycle_ms);
      if (cyc != null && !(cyc > 0)) probs.push("cycle must be positive or empty");
      if (probs.length) { risks.push({ severity: "medium", text: "Message " + m.name + " was not accepted: " + probs.join("; ") + ".", basis: "CAN rules", origin: "rules" }); return; }
      names.add(m.name);
      let id, status, checks;
      if (existing) { id = hexId(parseInt(existing[0], 10)); status = existing[1].status || "active"; checks = ["exists in your registry"]; }
      else {
        id = allocateId(reg, taken); taken.add(parseInt(id, 16)); status = "proposed";
        checks = ["free in the registry", "outside the diagnostic block 0x7DF-0x7EF", "above every active id " + hexId(reg.safetyMax) + " (a lower id wins arbitration)", "DLC <= 8", "known sender", "name unused"];
      }
      const msg = { id, name: m.name, sender: m.sender, receivers: listOf(m.receivers).filter(x => senders.has(x)), dlc, cycle_ms: cyc, status, purpose: norm(m.purpose || "").slice(0, 300), origin: m.origin || origin };
      can.push(msg);
      if (status === "proposed") proposed.push(Object.assign({ checks_passed: checks, kind: "new_id" }, msg));
      listOf(m.functions).forEach(fn => { const f = functions.find(x => x.name === fn || x.id === fn); if (f) f.messages.push(id); });
    });
    // computations (code only)
    const comp = [], bitrate = Number((inv.can || {}).bitrate_kbps) || 500, base = (inv.can || {}).baseline_load_pct, limit = Number((inv.can || {}).load_limit_pct) || null;
    const dlcs = PL.uniq(can.map(m => m.dlc)).sort((a, b) => a - b);
    dlcs.forEach(n => {
      const fb = frameBits(n);
      comp.push({ id: "C" + (comp.length + 1), title: "Length of one classic CAN frame with " + n + " data byte(s)", kind: "calculation", method: "47 + 8N bits, worst-case stuffing floor((34 + 8N - 1) / 4) more",
        steps: ["nominal = 47 + 8 x " + n + " = " + fb.nominal + " bits", "stuffing = floor((34 + 8 x " + n + " - 1) / 4) = " + fb.stuffing + " bits", "worst case = " + fb.worst + " bits = " + round(fb.worst / bitrate * 1000, 1) + " us at " + bitrate + " kbit/s"], result: fb });
    });
    const cyclic = can.filter(m => m.cycle_ms && m.status === "proposed");
    const addBps = cyclic.reduce((a, m) => a + frameBits(m.dlc).worst * 1000 / m.cycle_ms, 0);
    const addPct = addBps / (bitrate * 1000) * 100;
    const maxPct = base == null || base === "" ? null : Number(base) + addPct;
    comp.push({ id: "C" + (comp.length + 1), title: "Bus load added by the new cyclic messages", kind: "calculation", method: "sum of worst-case frame bits x frames per second, over the bit rate",
      steps: cyclic.length ? cyclic.map(m => m.name + ": " + frameBits(m.dlc).worst + " bits x " + round(1000 / m.cycle_ms, 2) + "/s = " + round(frameBits(m.dlc).worst * 1000 / m.cycle_ms, 0) + " bit/s")
        .concat(["added = " + round(addBps, 0) + " bit/s / " + bitrate * 1000 + " bit/s = " + round(addPct, 2) + " %", base == null || base === "" ? "baseline load not given: the total is unknown" : "total = baseline " + base + " % + " + round(addPct, 2) + " % = " + round(maxPct, 2) + " %"])
        : ["no new cyclic message: the added load is 0 %"], result: { added_pct: round(addPct, 3), total_pct: maxPct == null ? null : round(maxPct, 3) } });
    if (maxPct != null && limit && maxPct > limit) risks.push({ severity: "high", text: "Bus load " + round(maxPct, 2) + " % is over your limit " + limit + " %.", basis: "computation " + comp[comp.length - 1].id, origin: "rules" });
    if (base == null || base === "") ods.push("Measure or state the current bus load of the " + bitrate + " kbit/s bus: the total load cannot be checked without it.");
    // flash per node
    const per = boards.map(b => {
      const est = (draft.flash_add_kib || []).filter(x => x && x.node === b.id);
      const lo = est.reduce((a, x) => a + (Number(x.low) || 0), 0), hi = est.reduce((a, x) => a + (Number(x.high) || 0), 0);
      const size = Number(b.flash_kib) || null, used = Number(b.flash_used_kib) || null;
      let verdict = "unknown", head = null;
      if (size && used != null) {
        head = size - used;
        const hiM = hi * 1.25;
        verdict = !est.length ? "unknown" : hiM > head ? "does_not_fit" : hiM > 0.75 * head ? "tight" : "fits_by_estimate";
      }
      if (est.length) comp.push({ id: "C" + (comp.length + 1), title: "Flash fit of " + b.id, kind: "estimate", method: "headroom = flash size - used; additions are the model's ESTIMATE, plus a 25 % margin; tight when that uses more than 75 % of the headroom",
        steps: [size && used != null ? "headroom = " + size + " - " + used + " = " + head + " KiB" : "flash size or use not given: headroom unknown", "added (estimate) " + lo + " to " + hi + " KiB: " + est.map(x => x.what || "").filter(Boolean).join("; "), "with margin " + round(hi * 1.25, 1) + " KiB -> " + verdict], result: { headroom_kib: head, verdict } });
      if (verdict === "does_not_fit") risks.push({ severity: "high", text: b.id + " may NOT fit the added code (estimate). Measure with a build before deciding.", basis: "flash estimate", origin: "rules" });
      if (verdict === "tight") risks.push({ severity: "medium", text: b.id + " is tight on flash by estimate.", basis: "flash estimate", origin: "rules" });
      return { node: b.id, flash_kb: size, flash_used_kb: used, ram_kb: Number(b.ram_kib) || null, add_low_kib: est.length ? lo : null, add_high_kib: est.length ? hi : null, verdict, basis: est.length ? "additions are an estimate, not a measurement" : "no estimate" };
    });
    // coverage of the architecture and software gaps
    const covRows = gaps.filter(g => g.axis === "architecture" || g.axis === "software").map(g => {
      const fs = functions.filter(f => f.gaps.includes(g.gap_id));
      return { gap_id: g.gap_id, axis: g.axis, status: g.status, functions: fs.map(f => f.id), messages: PL.uniq([].concat(...fs.map(f => f.messages))) };
    });
    const uncovered = covRows.filter(r => !r.functions.length);
    if (uncovered.length) risks.push({ severity: "medium", text: uncovered.length + " architecture/software gap(s) are not addressed by any function: " + uncovered.map(r => r.gap_id).join(", ") + ".", basis: "coverage rule", origin: "rules" });
    if (proposed.length) ods.push("Register the proposed CAN ids " + proposed.map(m => m.id + " " + m.name).join(", ") + " in your own registry (Proofline only proposes them).");
    (draft.risks || []).slice(0, 6).forEach(r => { if (r && r.text && ["high", "medium", "low"].includes(r.severity) && r.basis) risks.push({ severity: r.severity, text: norm(r.text).slice(0, 500), basis: norm(r.basis).slice(0, 200), origin: "model" }); });
    (draft.owner_decisions || []).slice(0, 5).forEach(t => { if (t && String(t).trim()) ods.push(norm(t).slice(0, 400)); });
    return {
      feature_id: req.id, meta: { notes, origin }, nodes, functions, can_messages: can, proposed_can_ids: proposed,
      budgets: { per_node: per, bus: [{ name: "CAN bus", bitrate_kbps: bitrate, load_pct_current: base == null || base === "" ? null : Number(base), load_pct_max: maxPct == null ? null : round(maxPct, 2), limit_pct: limit, basis: "max = current + new cyclic messages (computation)" }] },
      computations: comp, risks: risks.map((r, i) => Object.assign({ id: "R" + (i + 1) }, r)), gap_coverage: covRows, owner_decisions: ods.map((t, i) => ({ id: "OD-A" + (i + 1), text: t })),
      draft: { functions: (draft.functions || []), messages: (draft.messages || []), flash_add_kib: draft.flash_add_kib || [], risks: (draft.risks || []).filter(r => r && r.origin !== "rules"), owner_decisions: draft.owner_decisions || [] },
    };
  }

  // =================================================================== stage 4: electrical checks
  const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];
  const E96 = [1.00, 1.02, 1.05, 1.07, 1.10, 1.13, 1.15, 1.18, 1.21, 1.24, 1.27, 1.30, 1.33, 1.37, 1.40, 1.43, 1.47, 1.50, 1.54, 1.58, 1.62, 1.65, 1.69, 1.74, 1.78, 1.82, 1.87, 1.91, 1.96, 2.00, 2.05, 2.10, 2.15, 2.21, 2.26, 2.32, 2.37, 2.43, 2.49, 2.55, 2.61, 2.67, 2.74, 2.80, 2.87, 2.94, 3.01, 3.09, 3.16, 3.24, 3.32, 3.40, 3.48, 3.57, 3.65, 3.74, 3.83, 3.92, 4.02, 4.12, 4.22, 4.32, 4.42, 4.53, 4.64, 4.75, 4.87, 4.99, 5.11, 5.23, 5.36, 5.49, 5.62, 5.76, 5.90, 6.04, 6.19, 6.34, 6.49, 6.65, 6.81, 6.98, 7.15, 7.32, 7.50, 7.68, 7.87, 8.06, 8.25, 8.45, 8.66, 8.87, 9.09, 9.31, 9.53, 9.76];
  const SERIES = { E24: [E24, 0.05], E96: [E96, 0.01] };
  function seriesValues(series, lo, hi) {
    const out = [];
    for (let dec = Math.pow(10, Math.floor(Math.log10(lo))); dec <= hi * 10; dec *= 10) SERIES[series][0].forEach(m => { const v = round(m * dec, 6); if (v >= lo && v <= hi) out.push(v); });
    return PL.uniq(out).sort((a, b) => a - b);
  }
  function ratios(r1, r2, tol) {
    return { k_nom: r2 / (r1 + r2), k_hi: r2 * (1 + tol) / (r2 * (1 + tol) + r1 * (1 - tol)), k_lo: r2 * (1 - tol) / (r2 * (1 - tol) + r1 * (1 + tol)),
      rth_nom: r1 * r2 / (r1 + r2), rth_hi: (r1 * (1 + tol)) * (r2 * (1 + tol)) / (r1 * (1 + tol) + r2 * (1 + tol)) };
  }
  function chooseDivider(series, vMax, adcLimit, rthMax) {
    const tol = SERIES[series][1], r1s = seriesValues(series, 1e3, 1e6), r2s = seriesValues(series, 1e3, 100e3);
    let best = null, tried = 0;
    r1s.forEach(r1 => r2s.forEach(r2 => {
      if (r1 + r2 < 20e3 || r1 + r2 > 200e3) return;
      tried++;
      const q = ratios(r1, r2, tol);
      if (vMax * q.k_hi > 0.95 * adcLimit || q.rth_hi > rthMax) return;
      const key = [round(q.k_lo, 9), r1 + r2, r1];
      if (!best || key[0] > best.key[0] || (key[0] === best.key[0] && (key[1] > best.key[1] || (key[1] === best.key[1] && key[2] > best.key[2])))) best = { key, r1, r2, q };
    }));
    if (!best) return null;
    return Object.assign({ series, tolerance: tol, r1_ohm: best.r1, r2_ohm: best.r2, candidates_tried: tried, headroom: 0.95 }, best.q);
  }
  const ELEC_SYSTEM = `You are the electrical assistant of an embedded product development and test tool. Code does every calculation and allocates every pin; you list what must be wired.
Given the approved architecture and the boards, answer with ONE JSON object:
{"requests":[{"board":"<board id>","function":"...","kind":"adc|digital_in|digital_out|pwm","pin":null,"v_min":null,"v_max":null,"load_ma":null}],
 "rails":[{"name":"...","source":"...","rating_ma":null,"loads":[{"name":"...","current_ma":null}]}],
 "risks":[{"severity":"high|medium|low","text":"...","basis":"..."}]}
Rules: one request per signal a board must sense or drive for this feature. For an analog input give the voltage range it senses (v_min, v_max in volts). For an output that drives a load give load_ma. Leave pin null unless the architecture fixes it. Never invent a current: use null when unknown. At most 4 risks. No prose outside the JSON.`;

  function boardDefaults(b) {
    const logic = Number(b.logic_v) || 3.3;
    return { logic, adcLimit: Number(b.adc_limit_v) || round(logic * 0.9, 2), adcBits: Number(b.adc_bits) || 12, pinLimit: Number(b.pin_limit_ma) || 20, rthMax: 10000 };
  }
  async function draftElectricalInputs(req, useAI) {
    const inv = req.inventory || blankInventory(), arch = req.architecture;
    if (useAI) {
      const prompt = "ARCHITECTURE\n" + JSON.stringify({ functions: arch.functions.map(f => ({ name: f.name, node: f.node, rationale: f.rationale })), messages: arch.can_messages.map(m => m.name) }, null, 1) +
        "\n\nBOARDS\n" + JSON.stringify((inv.boards || []).map(b => ({ id: b.id, name: b.name, logic_v: b.logic_v })), null, 1) + "\n\nAnswer with the JSON object only.";
      const r = await PL.askJSON(ELEC_SYSTEM, prompt, d => { if (!Array.isArray(d.requests)) throw new Error('"requests" must be a list'); });
      if (r.data) return { inputs: { requests: (r.data.requests || []).slice(0, 24), rails: (r.data.rails || []).slice(0, 8), risks: (r.data.risks || []).slice(0, 4) }, usage: r.usage, notes: r.notes };
      return { inputs: { requests: [], rails: [], risks: [] }, usage: r.usage, notes: r.notes.concat("fill the table by hand") };
    }
    return { inputs: { requests: [], rails: [], risks: [] }, usage: null, notes: ["no model: add the signals and rails by hand"] };
  }
  async function computeElectrical(req, inputs, meta) {
    const inv = req.inventory || blankInventory(), boards = Object.fromEntries((inv.boards || []).map(b => [b.id, b]));
    const findings = [], comps = [], ods = [], assumptions = [], wiring = [], rows = [], usedPins = {};
    const asm = (id, text, value, unit, source) => { if (!assumptions.find(a => a.id === id)) assumptions.push({ id, text, value, unit, kind: "assumed", source }); };
    (inputs.requests || []).forEach((r, i) => {
      const b = boards[r.board], checks = [], kind = ["adc", "digital_in", "digital_out", "pwm"].includes(r.kind) ? r.kind : "digital_in";
      const row = { id: "PIN-" + (i + 1), board: r.board, function: norm(r.function || "").slice(0, 160), needs: [kind], requested_pin: r.pin === "" || r.pin == null ? null : Number(r.pin), pin: null, result: "refused", checks, alternatives: [] };
      rows.push(row);
      if (!b) { checks.push({ name: "board exists", ok: false, detail: "unknown board '" + r.board + "'" }); findings.push({ severity: "high", text: row.id + ": unknown board '" + r.board + "'.", basis: "pin rules", origin: "rules" }); return; }
      const free = numList(b.free_pins), adc = numList(b.adc_pins), avoid = numList(b.avoid_pins);
      usedPins[b.id] = usedPins[b.id] || new Set();
      const ok = p => !avoid.includes(p) && !usedPins[b.id].has(p) && (!free.length || free.includes(p)) && (kind !== "adc" || !adc.length || adc.includes(p));
      const candidates = (free.length ? free : []).filter(ok);
      let pin = row.requested_pin;
      if (pin == null) pin = candidates[0] == null ? null : candidates[0];
      if (pin == null) { checks.push({ name: "a pin is available", ok: false, detail: free.length ? "no free pin passes the rules" : "no free-pin list for this board" }); findings.push({ severity: "high", text: row.id + " (" + row.function + "): no pin could be allocated on " + b.id + ".", basis: "pin rules", origin: "rules" }); return; }
      checks.push({ name: "in your free-pin list", ok: !free.length || free.includes(pin), detail: free.length ? "free: " + free.join(", ") : "no list given: UNVERIFIED" });
      checks.push({ name: "not on your avoid list (strapping, flash, USB, debug)", ok: !avoid.includes(pin), detail: avoid.length ? "avoid: " + avoid.join(", ") : "no list given" });
      checks.push({ name: "not used twice", ok: !usedPins[b.id].has(pin), detail: "" });
      if (kind === "adc") checks.push({ name: "ADC-capable", ok: !adc.length || adc.includes(pin), detail: adc.length ? "ADC pins: " + adc.join(", ") : "no ADC list given: UNVERIFIED" });
      row.alternatives = candidates.filter(p => p !== pin).slice(0, 5);
      if (checks.every(c => c.ok)) { row.pin = pin; row.result = "allocated"; usedPins[b.id].add(pin); wiring.push({ id: "W" + (wiring.length + 1), from: b.id + " GPIO" + pin, to: row.function, kind: kind.replace("_", " "), note: "" }); }
      else findings.push({ severity: "high", text: row.id + ": pin " + pin + " on " + b.id + " was refused (" + checks.filter(c => !c.ok).map(c => c.name).join(", ") + ").", basis: "pin rules", origin: "rules" });
      const d = boardDefaults(b);
      // analog sensing above the ADC range: a divider, chosen by code
      if (kind === "adc" && r.v_max != null && r.v_max !== "") {
        const vMax = Number(r.v_max), vMin = Number(r.v_min) || 0;
        asm("A-ADC-LIMIT-" + b.id, "ADC design limit of " + b.id, d.adcLimit, "V", b.adc_limit_v ? "your board entry" : "90 % of the logic voltage: VERIFY against the datasheet and the attenuation you use");
        asm("A-ADC-RTH", "Highest source impedance the ADC tolerates", d.rthMax, "ohm", "common guidance for SAR ADCs: VERIFY against the datasheet");
        if (vMax <= 0.95 * d.adcLimit) { row.divider = { needed: false, text: "the range " + vMin + " to " + vMax + " V fits the ADC directly" }; }
        else {
          const des = chooseDivider("E96", vMax, d.adcLimit, d.rthMax), alt = chooseDivider("E24", vMax, d.adcLimit, d.rthMax);
          if (!des) { findings.push({ severity: "high", text: row.id + ": no E96 divider keeps " + vMax + " V under the ADC limit with the impedance rule.", basis: "divider search", origin: "rules" }); }
          else {
            const i = vMax / (des.r1_ohm + des.r2_ohm), p1 = i * i * des.r1_ohm, p2 = i * i * des.r2_ohm, tau = des.rth_nom * 100e-9, lsb = d.adcLimit / (Math.pow(2, d.adcBits) - 1);
            asm("A-RES-W", "Resistor power rating", 0.25, "W", "0805 / through-hole 1/4 W: VERIFY on the part");
            row.divider = { needed: true, range: { v_min: vMin, v_max: vMax }, design: des, what_if_5pct: alt,
              ranges_at_pin: { v_at_vmax_worst: round(vMax * des.k_hi, 4), v_at_vmax_nominal: round(vMax * des.k_nom, 4), v_at_vmin_worst: round(vMin * des.k_lo, 4), adc_limit: d.adcLimit },
              dissipation: { i_ma: round(i * 1e3, 4), p_r1_mw: round(p1 * 1e3, 3), p_r2_mw: round(p2 * 1e3, 3), rating_mw: 250, ok: Math.max(p1, p2) <= 0.125 },
              filter: { c_f: 100e-9, tau_s: tau, corner_hz: round(1 / (2 * Math.PI * tau), 1), settle_1lsb_s: round(tau * Math.log(Math.max(2, (vMax - vMin) * des.k_nom / lsb)), 5) },
              protection: { series_resistor_ohm: 1000, clamp: "two small-signal Schottky diodes at the pin (to GND and to the logic rail)", reverse_current_ma: round((vMax - 0.3) / des.r1_ohm * 1e3, 3) } };
            comps.push({ id: "E" + (comps.length + 1), title: "Divider for " + row.function, kind: "calculation",
              method: "search E96 (1 %) for R1, R2 with R1 + R2 in 20-200 kohm; keep pairs whose worst-case high ratio keeps " + vMax + " V under 95 % of the ADC limit and whose worst-case source impedance is under " + d.rthMax + " ohm; take the highest worst-case low ratio",
              steps: [des.candidates_tried + " pairs tried -> R1 = " + des.r1_ohm + " ohm, R2 = " + des.r2_ohm + " ohm (k = " + round(des.k_nom, 5) + ", worst " + round(des.k_lo, 5) + " to " + round(des.k_hi, 5) + ")",
                "pin at " + vMax + " V worst case = " + round(vMax * des.k_hi, 3) + " V (limit " + d.adcLimit + " V)", "pin at " + vMin + " V worst case = " + round(vMin * des.k_lo, 3) + " V",
                "divider current at " + vMax + " V = " + round(i * 1e3, 3) + " mA; R1 dissipates " + round(p1 * 1e3, 2) + " mW", "100 nF filter: tau = " + round(tau * 1e3, 3) + " ms, corner " + round(1 / (2 * Math.PI * tau), 1) + " Hz"] });
            wiring.push({ id: "W" + (wiring.length + 1), from: "sensed voltage (" + vMin + "-" + vMax + " V)", to: "R1 " + des.r1_ohm + " ohm", kind: "analog", note: "" },
              { id: "W" + (wiring.length + 2), from: "R1/R2 node", to: "1 kohm series -> " + b.id + " GPIO" + (row.pin == null ? "?" : row.pin), kind: "analog", note: "100 nF from the pin to GND" },
              { id: "W" + (wiring.length + 3), from: "R2 " + des.r2_ohm + " ohm", to: "GND of " + b.id, kind: "analog", note: "" });
            findings.push({ severity: "medium", text: row.id + ": a divider is needed (" + vMax + " V into a " + d.adcLimit + " V ADC). R1 " + des.r1_ohm + " ohm, R2 " + des.r2_ohm + " ohm (1 %). Calibrate two points before trusting a threshold.", basis: "computation " + comps[comps.length - 1].id, origin: "rules" });
            if (!row.divider.dissipation.ok) findings.push({ severity: "high", text: row.id + ": divider resistor dissipation is over half its rating.", basis: "dissipation", origin: "rules" });
          }
        }
      }
      // an output driving a load: pin current vs limit, NPN low-side driver when needed
      if ((kind === "digital_out" || kind === "pwm") && r.load_ma != null && r.load_ma !== "") {
        const load = Number(r.load_ma), voh = round(d.logic * 0.8, 2);
        asm("A-PIN-LIMIT-" + b.id, "Safe pin current of " + b.id, d.pinLimit, "mA", b.pin_limit_ma ? "your board entry" : "a conservative default: VERIFY against the datasheet");
        if (load <= d.pinLimit) row.drive = { driver_needed: false, text: load + " mA is within the pin limit " + d.pinLimit + " mA" };
        else {
          const ibNeed = load / 100 * 10, rbMax = (voh - 0.7) / (ibNeed / 1000), rb = Math.max(...seriesValues("E24", 100, 100e3).filter(v => v <= rbMax)), ib = (d.logic - 0.7) / rb * 1000;
          asm("A-NPN-HFE", "Minimum gain of a small-signal NPN", 100, "", "BC547 / 2N2222 class: VERIFY on the part bought");
          row.drive = { driver_needed: true, ic_ma: load, ib_needed_ma: round(ibNeed, 3), rb_max_ohm: Math.round(rbMax), rb_ohm: rb, ib_ma: round(ib, 3), pin_ok: ib <= d.pinLimit, flyback: "a diode across an inductive load (relay coil, motor)" };
          comps.push({ id: "E" + (comps.length + 1), title: "Low-side driver for " + row.function, kind: "calculation", method: "Ib = Ic / hFE_min x overdrive 10; Rb <= (VOH_min - 0.7 V) / Ib, next lower E24",
            steps: ["Ic = " + load + " mA > pin limit " + d.pinLimit + " mA: a driver is needed", "Ib = " + load + " / 100 x 10 = " + round(ibNeed, 2) + " mA", "Rb <= (" + voh + " - 0.7) / " + round(ibNeed, 2) + " mA = " + Math.round(rbMax) + " ohm -> E24 " + rb + " ohm", "pin current at " + d.logic + " V = " + round(ib, 2) + " mA"] });
          findings.push({ severity: "medium", text: row.id + ": " + load + " mA is over the pin limit; use an NPN low-side driver with Rb " + rb + " ohm" + (row.drive.pin_ok ? "" : " (the base current is still over the pin limit: use a logic-level MOSFET)") + ".", basis: "computation " + comps[comps.length - 1].id, origin: "rules" });
        }
      }
    });
    // power budget per rail: known currents add up; unknown currents stay unknown and get a measurement step
    const rails = (inputs.rails || []).map((r, i) => {
      const loads = (r.loads || []).map(l => ({ name: norm(l.name || ""), current_ma: l.current_ma == null || l.current_ma === "" ? "unknown" : Number(l.current_ma), basis: l.current_ma == null || l.current_ma === "" ? "not measured: a measurement step is added" : "your figure" }));
      const known = loads.filter(l => l.current_ma !== "unknown").reduce((a, l) => a + l.current_ma, 0), unknown = loads.filter(l => l.current_ma === "unknown").length;
      const rating = r.rating_ma == null || r.rating_ma === "" ? null : Number(r.rating_ma);
      const verdict = rating == null ? "rating unknown" : known > rating ? "over the rating" : known > 0.8 * rating ? "over 80 % of the rating" : unknown ? "known part fits; " + unknown + " load(s) unmeasured" : "fits";
      if (rating != null && known > rating) findings.push({ severity: "high", text: "Rail '" + r.name + "': known loads " + known + " mA exceed the source rating " + rating + " mA.", basis: "power budget", origin: "rules" });
      else if (rating != null && known > 0.8 * rating) findings.push({ severity: "medium", text: "Rail '" + r.name + "': known loads use over 80 % of the rating.", basis: "power budget", origin: "rules" });
      if (unknown) findings.push({ severity: "medium", text: "Rail '" + r.name + "': " + unknown + " load current(s) unknown. Measure before trusting the budget.", basis: "power budget", origin: "rules" });
      return { id: "P" + (i + 1), name: norm(r.name || "rail " + (i + 1)), source: { name: norm(r.source || ""), rating: rating == null ? "unknown" : rating + " mA" }, loads, known_ma: known, unknown, verdict };
    });
    rows.filter(r => r.result === "allocated").forEach(r => { if (!numList((boards[r.board] || {}).free_pins).length) findings.push({ severity: "low", text: r.id + ": the pin is UNVERIFIED (no free-pin list for " + r.board + "). Check the real header.", basis: "pin rules", origin: "rules" }); });
    (inputs.risks || []).slice(0, 4).forEach(x => { if (x && x.text && ["high", "medium", "low"].includes(x.severity) && x.basis) findings.push({ severity: x.severity, text: norm(x.text).slice(0, 400), basis: norm(x.basis).slice(0, 200), origin: "model" }); });
    if (rails.some(r => r.unknown)) ods.push("Who measures the unknown load currents, and with which supply (guide 'Measure what is unknown')?");
    rows.filter(r => r.drive && r.drive.driver_needed).forEach(r => ods.push(r.id + ": confirm the driver choice (NPN with Rb " + r.drive.rb_ohm + " ohm) or pick a logic-level MOSFET."));
    rows.filter(r => r.divider && r.divider.needed).forEach(r => ods.push(r.id + ": confirm the thresholds the firmware will compare against this divider reading, and the two calibration points."));
    const order = { high: 0, medium: 1, low: 2 };
    findings.sort((a, b) => order[a.severity] - order[b.severity]);
    return {
      feature_id: req.id, meta: Object.assign({ generated: PL.nowIso(), run_id: PL.runId(), upstream: await upstreamHashes(req, "electrical"), tool: { ngspice: "not run in the browser: the same corners are checked by hand calculation; the local tool also runs ngspice" } }, meta || {}),
      inputs, findings: findings.map((f, i) => Object.assign({ id: "F-" + (i + 1) }, f)), assumptions, pin_allocation: { rows }, power_budget: { rails }, wiring: { connections: wiring },
      computations: comps, owner_decisions: ods.map((t, i) => ({ id: "OD-E" + (i + 1), text: t })),
    };
  }

  // =================================================================== stage 5: integration guides
  const GUIDE_TIP_SYSTEM = `You add one plain-words tip per step to hardware integration guides. Code wrote the steps and their checks; you never change them.
Answer with ONE JSON object: {"tips":[{"step_id":"...","tip":"..."}]}. A tip is at most 200 characters, practical, and must not contradict the step. No prose outside the JSON.`;
  async function generateGuides(req, useAI) {
    const e = req.electrical, guides = [], blocked = (req.guidesParts || {});
    const step = (g, o) => { o.n = g.steps.length + 1; o.id = g.prefix + o.n; g.steps.push(Object.assign({ actor: "person", owner_only: false, safety: "", traps: [], requires: [], blocked: false, blocked_by: [], model_tip: "", origin: "template" }, o)); };
    // 1. wiring
    const wired = e.pin_allocation.rows.filter(r => r.result === "allocated");
    if (wired.length) {
      const g = { id: "wire-pins", prefix: "P", title: "Wire the allocated pins", purpose: "Connect every signal of this feature to the pin code allocated, and prove each connection.", equipment: ["multimeter (continuity)", "jumper wires"], rollback: ["Disconnect the new wires; the boards are as before."], steps: [] };
      step(g, { title: "Check the pins on the real header", action: "Look at your board's pin-out and confirm each allocated pin is broken out: " + wired.map(r => r.board + " GPIO" + r.pin).join(", ") + ".", check: { kind: "confirm", hardware: false, expect: { text: "every pin is on the header" } }, safety: "No power needed." });
      wired.forEach(r => step(g, { title: "Connect " + r.function.slice(0, 60), action: "Power off. Wire '" + r.function + "' to " + r.board + " GPIO" + r.pin + ".", safety: "Power off while wiring.", check: { kind: "confirm", hardware: true, expect: { text: "continuity beeps between the signal and GPIO" + r.pin + "; no continuity to the neighbouring pins" } } }));
      guides.push(g);
    }
    // 2. dividers
    e.pin_allocation.rows.filter(r => r.divider && r.divider.needed).forEach((r, k) => {
      const d = r.divider, des = d.design, tolM = des.tolerance + 0.01, vMid = round((d.range.v_min + d.range.v_max) / 2, 2);
      const g = { id: "divider-" + (k + 1), prefix: "D" + (k + 1) + ".", title: "Voltage divider for " + r.function.slice(0, 50), purpose: "Build and prove the divider into " + r.board + " GPIO" + (r.pin == null ? "?" : r.pin) + ".", equipment: ["multimeter", "adjustable bench supply"], rollback: ["Remove the divider; the pin is unused again."], steps: [], parts: [{ id: "divider-parts-" + (k + 1), name: "R1 " + des.r1_ohm + " ohm, R2 " + des.r2_ohm + " ohm (1 %), 1 kohm, 100 nF" }] };
      const partsBlocked = !blocked["divider-parts-" + (k + 1)];
      const bl = partsBlocked ? [{ kind: "part", reason: "the divider parts are not marked as arrived" }] : [];
      step(g, { title: "Measure R1", action: "Measure R1 loose, before building.", check: { kind: "measure", hardware: false, expect: { text: "R1 in ohm", min: round(des.r1_ohm * (1 - tolM), 1), max: round(des.r1_ohm * (1 + tolM), 1), unit: "ohm" } }, blocked: partsBlocked, blocked_by: bl });
      step(g, { title: "Measure R2", action: "Measure R2 loose, before building.", check: { kind: "measure", hardware: false, expect: { text: "R2 in ohm", min: round(des.r2_ohm * (1 - tolM), 1), max: round(des.r2_ohm * (1 + tolM), 1), unit: "ohm" } }, blocked: partsBlocked, blocked_by: bl });
      step(g, { title: "Build the divider", action: "Fit R1 from the sensed voltage to the node, R2 from the node to GND, 1 kohm from the node to the pin, 100 nF from the pin to GND. Do not connect the pin yet.", check: { kind: "confirm", hardware: true, expect: { text: "built as drawn, pin not connected" } }, blocked: partsBlocked, blocked_by: bl });
      [[vMid, "middle"], [d.range.v_max, "top"]].forEach(([v, w]) => step(g, { title: "Node voltage at the " + w + " of the range", action: "Apply " + v + " V from the bench supply. Measure the node voltage.", safety: "Current-limit the supply to 50 mA.",
        check: { kind: "measure", hardware: true, expect: { text: "node voltage in V", min: round(v * des.k_lo * 0.995, 4), max: round(v * des.k_hi * 1.005, 4), unit: "V" } }, blocked: partsBlocked, blocked_by: bl }));
      step(g, { title: "Connect the pin and read the ADC", action: "Connect the pin. Read the raw ADC value at " + vMid + " V and at " + d.range.v_max + " V. Record both as the two-point calibration.", owner_only: true, check: { kind: "record", hardware: true, expect: { text: "two raw readings" } }, blocked: partsBlocked, blocked_by: bl });
      guides.push(g);
    });
    // 3. drivers
    e.pin_allocation.rows.filter(r => r.drive && r.drive.driver_needed).forEach((r, k) => {
      const dv = r.drive, g = { id: "driver-" + (k + 1), prefix: "L" + (k + 1) + ".", title: "Load driver for " + r.function.slice(0, 50), purpose: "Drive " + dv.ic_ma + " mA without overloading the pin.", equipment: ["multimeter (mA)"], rollback: ["Remove the transistor; drive nothing from the pin."], steps: [] };
      step(g, { title: "Fit the NPN and Rb", action: "Collector to the load's low side, emitter to GND, base through Rb " + dv.rb_ohm + " ohm to " + r.board + " GPIO" + r.pin + ". " + (dv.flyback ? "Fit " + dv.flyback + "." : ""), check: { kind: "confirm", hardware: true, expect: { text: "fitted as drawn" } } });
      step(g, { title: "Measure the base current", action: "Drive the pin high; measure the current into the base.", check: { kind: "measure", hardware: true, expect: { text: "base current in mA", min: 0, max: Number(((req.inventory.boards || []).find(b => b.id === r.board) || {}).pin_limit_ma) || 20, unit: "mA" } } });
      step(g, { title: "Switch the load", action: "Toggle the pin; the load must switch on and off.", check: { kind: "confirm", hardware: true, expect: { text: "the load follows the pin" } } });
      guides.push(g);
    });
    // 4. measurements of what is unknown
    const unknown = [];
    e.power_budget.rails.forEach(r => r.loads.filter(l => l.current_ma === "unknown").forEach(l => unknown.push([r, l])));
    if (unknown.length) {
      const g = { id: "measure-unknowns", prefix: "M", title: "Measure what is unknown", purpose: "Replace every unknown current of the power budget by a measurement.", equipment: ["multimeter (mA) in series, or a USB power meter"], rollback: ["None: measuring only."], steps: [] };
      unknown.forEach(([r, l]) => step(g, { title: "Current of " + l.name.slice(0, 60), action: "Measure the current of '" + l.name + "' on rail '" + r.name + "', idle and at its busiest.", check: { kind: "record", hardware: true, expect: { text: "peak current in mA", unit: "mA" } } }));
      guides.push(g);
    }
    // 5. firmware on the board (owner)
    const g5 = { id: "flash-first-boot", prefix: "B", title: "Flash and first boot", purpose: "Load firmware with the new code switched OFF, prove nothing changed, then switch it on.", equipment: ["USB cable (data)"], rollback: ["Flash the previous image."], steps: [] };
    step(g5, { title: "Flash with the new flags OFF", action: "Build and flash with every new feature flag OFF.", owner_only: true, check: { kind: "confirm", hardware: true, expect: { text: "flashed; the board boots" } } });
    step(g5, { title: "Prove the old behaviour", action: "Run your existing regression on the board.", owner_only: true, check: { kind: "confirm", hardware: true, expect: { text: "same results as before the change" } } });
    step(g5, { title: "Switch the feature on", action: "Rebuild with the flags ON and run the new tests.", owner_only: true, check: { kind: "confirm", hardware: true, expect: { text: "the new tests pass on the board" } } });
    guides.push(g5);
    let usage = null, notes = [];
    if (useAI) {
      const all = [].concat(...guides.map(g => g.steps.map(s => ({ step_id: g.id + ":" + s.id, title: s.title, action: s.action }))));
      const r = await PL.askJSON(GUIDE_TIP_SYSTEM, "STEPS\n" + JSON.stringify(all, null, 1) + "\n\nAnswer with the JSON object only.", d => { if (!Array.isArray(d.tips)) throw new Error('"tips" must be a list'); });
      usage = r.usage; notes = r.notes;
      ((r.data || {}).tips || []).forEach(t => {
        const [gid, sid] = String(t.step_id || "").split(":"), g = guides.find(x => x.id === gid), s = g && g.steps.find(x => x.id === sid);
        if (s && t.tip) { s.model_tip = norm(t.tip).slice(0, 200); }
      });
    }
    guides.forEach(g => { g.blocked_steps = g.steps.filter(s => s.blocked).map(s => s.id); g.owner_only_steps = g.steps.filter(s => s.owner_only).map(s => s.id); g.hardware_steps = g.steps.filter(s => s.check.hardware).map(s => s.id); delete g.prefix; });
    return { index: { feature_id: req.id, meta: { generated: PL.nowIso(), run_id: PL.runId(), upstream: await upstreamHashes(req, "guides"), llm: usage || { calls: 0 }, notes },
      guides: guides.map(g => ({ id: g.id, title: g.title, steps: g.steps.length, blocked: g.blocked_steps.length, hardware: g.hardware_steps.length, owner_only: g.owner_only_steps.length })) }, guides };
  }
  function evaluateStep(s, value) {
    const ex = s.check.expect || {};
    if (s.check.kind === "confirm") return /^(y|yes|ok|done|confirmed|true|pass)/i.test(String(value).trim()) ? "confirmed" : "failed";
    if (s.check.kind === "record") return String(value).trim() ? "checked" : "failed";
    const m = String(value).replace(",", ".").match(/(-?\d+(?:\.\d+)?)\s*(k|K|M|m|u|µ)?/);
    if (!m) return "failed";
    const mult = { k: 1e3, K: 1e3, M: 1e6, m: 1e-3, u: 1e-6, "µ": 1e-6 }[m[2]] || 1;
    const x = parseFloat(m[1]) * (ex.unit === "ohm" || mult >= 1e3 ? mult : 1);
    if (ex.min != null && x < ex.min) return "failed";
    if (ex.max != null && x > ex.max) return "failed";
    return "confirmed";
  }
  /* Step status, derived from the append-only log entries written for the CURRENT guide hash. */
  function stepStatus(log, guideHash, guideId, s) {
    if (s.blocked) return { key: "blocked", label: "blocked" };
    const es = (log || []).filter(x => x.guide_hash === guideHash && x.guide === guideId && x.step === s.id);
    const last = es[es.length - 1];
    if (!last || last.kind === "retract") return { key: "pending", label: "to do" };
    return { key: last.verdict, label: last.verdict, entry: last };
  }

  // =================================================================== stage 6: firmware requirements (SWD, OD record, ladder)
  const SWD_SECTIONS = ["Responsibility", "Interface", "States and rules", "Timing", "Errors", "Configuration", "Tests"];
  const SWD_SYSTEM = `You write firmware software design descriptions (SWDs) for an embedded product development and test tool. Code checks every SWD; a person approves.
Group the architecture functions into firmware modules (usually one module per board responsibility) and write one SWD per module in Markdown with exactly these headings: ${SWD_SECTIONS.map(s => "## " + s).join(", ")}.
In each SWD tag every need it serves as [need Nxx] (ids given). Under Configuration name the feature flag(s); every new behaviour must sit behind a flag that defaults OFF. Under Tests list the tests to write, each naming the need it proves.
Answer with ONE JSON object: {"modules":[{"module":"snake_case_name","title":"...","node":"<board id>","functions":["AF-01"],"needs":["N01"],"swd":"<markdown>"}]}. No prose outside the JSON.`;
  async function generateFirmware(req, useAI) {
    const arch = req.architecture, plan = req.plan, notes = [];
    const swNeeds = PL.uniq(plan.gap_report.gaps.filter(g => g.axis === "software" || g.axis === "tests").map(g => g.need_id));
    let mods = null, usage = null;
    if (useAI) {
      const prompt = "FUNCTIONS\n" + JSON.stringify(arch.functions.map(f => ({ id: f.id, name: f.name, node: f.node, gaps: f.gaps, messages: f.messages })), null, 1) +
        "\n\nMESSAGES\n" + JSON.stringify(arch.can_messages.map(m => ({ id: m.id, name: m.name, sender: m.sender, dlc: m.dlc, cycle_ms: m.cycle_ms })), null, 1) +
        "\n\nNEEDS WITH A SOFTWARE OR TEST GAP\n" + JSON.stringify(plan.gap_report.needs.filter(n => swNeeds.includes(n.id)).map(n => ({ id: n.id, text: n.text })), null, 1) + "\n\nAnswer with the JSON object only.";
      const r = await PL.askJSON(SWD_SYSTEM, prompt, d => { if (!Array.isArray(d.modules) || !d.modules.length) throw new Error('"modules" must be a non-empty list'); });
      usage = r.usage; notes.push(...r.notes); mods = r.data && r.data.modules;
    }
    if (!mods) {
      const byNode = {};
      arch.functions.forEach(f => { (byNode[f.node] = byNode[f.node] || []).push(f); });
      mods = Object.entries(byNode).map(([node, fs]) => ({ module: node.replace(/[^a-z0-9]+/gi, "_").toLowerCase() + "_feature", title: "Feature code on " + node, node, functions: fs.map(f => f.id),
        needs: PL.uniq([].concat(...fs.map(f => f.gaps.map(g => (plan.gap_report.gaps.find(x => x.gap_id === g) || {}).need_id)))).filter(Boolean),
        swd: "# " + node + " feature module\n\n" + SWD_SECTIONS.map(s => "## " + s + "\n\n(write this)\n").join("\n") }));
    }
    const swd = mods.map(m => ({ file: String(m.module || "module").replace(/[^a-z0-9_]+/gi, "_").toLowerCase() + ".md", module: String(m.module || "module").replace(/[^a-z0-9_]+/gi, "_").toLowerCase(), title: norm(m.title || "").slice(0, 140),
      node: m.node || "", functions: (m.functions || []).filter(id => arch.functions.some(f => f.id === id)), needs: (m.needs || []).filter(n => plan.gap_report.needs.some(x => x.id === n)), text: String(m.swd || "").slice(0, 20000) }));
    return { swd, od_decisions: null, ladder: {}, meta: { generated: PL.nowIso(), run_id: PL.runId(), upstream: await upstreamHashes(req, "firmware"), llm: usage || { calls: 0 }, notes } };
  }
  /* F0 is decided by code from the SWD text; F1-F5 are the person's records (a browser cannot build or flash). */
  function f0Checks(req, m) {
    const arch = req.architecture, plan = req.plan, out = [];
    const heads = SWD_SECTIONS.filter(s => !new RegExp("^#{1,4}\\s*" + s.replace(/ /g, "\\s+") + "\\b", "im").test(m.text));
    out.push({ check: "SWD has the sections " + SWD_SECTIONS.join(", "), ok: !heads.length, evidence: heads.length ? "missing: " + heads.join(", ") : "all present" });
    out.push({ check: "no placeholder text left", ok: !/\(write this\)/i.test(m.text), evidence: /\(write this\)/i.test(m.text) ? "'(write this)' still in the text" : "none" });
    const tags = (m.text.match(/\[need (N\d+)\]/g) || []).map(t => t.slice(6, -1));
    const missing = m.needs.filter(n => !tags.includes(n));
    out.push({ check: "a [need Nxx] tag for every need of the module", ok: m.needs.length > 0 && !missing.length, evidence: m.needs.length ? (missing.length ? "untagged: " + missing.join(", ") : "tags " + PL.uniq(tags).join(", ")) : "the module claims no need" });
    out.push({ check: "new behaviour behind a flag that defaults OFF", ok: /default(s)?\s+off|off\s+by\s+default/i.test(m.text), evidence: "looked for 'defaults OFF' in the text" });
    out.push({ check: "every function it claims exists in the architecture", ok: m.functions.length > 0 && m.functions.every(id => arch.functions.some(f => f.id === id)), evidence: m.functions.join(", ") || "none" });
    return out;
  }
  function firmwareCoverage(req) {
    const fw = req.firmware, arch = req.architecture, plan = req.plan;
    const fnUnmapped = arch.functions.filter(f => !fw.swd.some(m => m.functions.includes(f.id))).map(f => f.id);
    const swNeeds = PL.uniq(plan.gap_report.gaps.filter(g => g.axis === "software" || g.axis === "tests").map(g => g.need_id));
    const needUnmapped = swNeeds.filter(n => !fw.swd.some(m => m.needs.includes(n)));
    return { fnUnmapped, needUnmapped };
  }
  function collectODs(req) {
    const out = [];
    ((req.plan || {}).gap_report || { open_decisions: [] }).open_decisions.forEach(o => out.push({ id: o.id, from: "plan", text: o.text }));
    ((req.architecture || {}).owner_decisions || []).forEach(o => out.push({ id: o.id, from: "architecture", text: o.text }));
    ((req.electrical || {}).owner_decisions || []).forEach(o => out.push({ id: o.id, from: "electrical", text: o.text }));
    return out;
  }
  const LADDER = [
    { level: "F0", what: "Design complete: the SWD passes the code checks (the swd_review gate then approves it)", by: "code" },
    { level: "F1", what: "Builds with warnings as errors; static analysis clean", by: "you record" },
    { level: "F2", what: "Unit tests written from the SWD pass", by: "you record" },
    { level: "F3", what: "Mutation test: the tests kill seeded and generated faults", by: "you record" },
    { level: "F4", what: "Runs on the real boards (owner flashes)", by: "owner only" },
    { level: "F5", what: "Released", by: "owner only" },
  ];

  PL.engines = { STAGES, BY_KEY, artifact, stageHash, stageState, upstreamApproved, upstreamHashes, AXES, CAP_STATUSES, blankInventory, capStatus, KEY_AXES,
    generatePlan, assemblePlan, replanWithEvidence, generateArchitecture, computeArchitecture, draftElectricalInputs, computeElectrical, generateGuides, evaluateStep, stepStatus,
    generateFirmware, f0Checks, firmwareCoverage, collectODs, LADDER, SWD_SECTIONS, frameBits, listOf };
})();
