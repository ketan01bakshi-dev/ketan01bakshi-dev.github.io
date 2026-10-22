/* Proofline stage 1, Feature Requirements: the 13-item scope checklist and its rules (port of tsp/scope.py).
 * Rules decide, the model drafts, the person approves. AI-assisted, synthetic, illustrative.
 */
(function () {
  "use strict";
  const PL = window.PL, norm = PL.norm, clone = PL.clone;

  const CHECKLIST = [
    ["function_boundary", "Function and boundary", "What exactly is built, what is real hardware and what is simulated?"],
    ["target_hardware_toolchain", "Target hardware and toolchain", "Which board or boards and which toolchain carry this, and is any new hardware needed?"],
    ["coding_rules", "Coding rules", "Which coding rules apply (warnings as errors, static analysis, a rule subset)?"],
    ["test_levels", "Test levels wanted", "Which test levels do you want: MiL, SiL, PiL, HiL, vehicle or chassis?"],
    ["operating_range", "Operating range", "In which conditions and ranges must it work (states, speeds, voltages, temperature)?"],
    ["acceptance_criteria", "Measurable acceptance criteria", "Which measurable criteria (times, errors, counts) decide that it works?"],
    ["budgets", "Timing and resource budgets", "What are the budgets: cycle time, WCET share, flash and RAM, bus load, flash time?"],
    ["criticality", "Criticality / integrity", "How critical is it: quality-managed only, or safety related, and what must never happen?"],
    ["interfaces_signals", "Interfaces and signals", "Which inputs, outputs, bus messages and signals does it use or add?"],
    ["fault_cases", "Fault and robustness cases", "Which faults and robustness cases must be handled and tested?"],
    ["update_field", "Update and field needs", "Must it be updatable over the air, and which events go to telemetry?"],
    ["evidence", "Evidence needed", "Which evidence do you need (reports, logs, video, manifest, standards as a reference only)?"],
    ["constraints", "Constraints", "What are the constraints: budget, date, parts you already own?"],
  ];
  const KEYS = CHECKLIST.map(c => c[0]);
  const LABEL = Object.fromEntries(CHECKLIST.map(c => [c[0], c[1]]));
  const QUESTION = Object.fromEntries(CHECKLIST.map(c => [c[0], c[2]]));
  const frId = k => "FR-" + String(KEYS.indexOf(k) + 1).padStart(2, "0");
  const MAX_ASKS = 3, MAX_ASSUMPTIONS = 4, MIN_QUOTE_WORDS = 3, MIN_QUOTE_CHARS = 10;
  const OPEN_MARKERS = [
    ["still to decide", /still\s+to\s+decide/i], ["to be decided", /to\s+be\s+decided/i], ["TBD", /\btbd\b/i],
    ["undecided", /\bundecided\b/i], ["not decided yet", /not\s+decided(\s+yet)?/i], ["open:", /\bopen\s*:/i],
    ["open question", /open\s+question/i], ["? at the end of a sentence", /\?(\s|$)/],
  ];
  const BASIS_RE = /\s*\[basis:[\s\S]*?\]\s*/g;

  function blankScope(id) { return { feature_id: id, version: 1, items: KEYS.map(k => ({ key: k, status: "missing" })) }; }
  function itemMap(scope) { const m = {}; (scope.items || []).forEach(i => { m[i.key] = i; }); return m; }
  function canonicalItems(scope) {
    const by = itemMap(scope);
    return KEYS.map(k => {
      const it = by[k] || { key: k, status: "missing" };
      const c = { key: k, status: it.status };
      if (it.status === "answered") c.answer = it.answer;
      if (it.status === "assumed") {
        c.assumption = { text: it.assumption.text, accepted: !!it.assumption.accepted };
        if (it.assumption.accepted_by) c.assumption.accepted_by = it.assumption.accepted_by;
      }
      return c;
    });
  }
  const scopeArtifact = scope => ({ feature_id: scope.feature_id, items: canonicalItems(scope) });
  const scopeHash = scope => PL.hashOf(scopeArtifact(scope));
  function itemText(it) {
    if (it.status === "answered") return it.answer || "";
    if (it.status === "assumed") return it.assumption.text.replace(BASIS_RE, " ").trim();
    return "";
  }
  const fullText = it => it.status === "answered" ? (it.answer || "") : it.status === "assumed" ? it.assumption.text : "";
  const openMarkers = it => { const t = itemText(it); return OPEN_MARKERS.filter(m => m[1].test(t)).map(m => m[0]); };
  function openSentences(it) {
    const t = itemText(it);
    const found = t.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(s => s && OPEN_MARKERS.some(m => m[1].test(s)));
    return found.length ? found : (t && openMarkers(it).length ? [t] : []);
  }
  function validateShape(scope) {
    const errs = [];
    if (!scope || typeof scope.feature_id !== "string") errs.push("feature_id missing");
    if (!Array.isArray(scope.items) || scope.items.length !== 13) errs.push("items must hold 13 entries");
    (scope.items || []).forEach(it => {
      if (!KEYS.includes(it.key)) errs.push("unknown key " + it.key);
      if (it.status === "answered" && !(it.answer && it.answer.length)) errs.push(it.key + ": answered without an answer");
      if (it.status === "assumed" && !(it.assumption && it.assumption.text)) errs.push(it.key + ": assumed without text");
    });
    return errs;
  }
  function completeness(scope) {
    const c = { answered: 0, assumed_accepted: 0, assumed_open: 0, missing: 0 };
    const missing = [], openAsm = [], openKeys = [];
    canonicalItems(scope).forEach(it => {
      if (it.status !== "missing" && openMarkers(it).length) openKeys.push(it.key);
      if (it.status === "answered") c.answered++;
      else if (it.status === "assumed") { if (it.assumption.accepted) c.assumed_accepted++; else { c.assumed_open++; openAsm.push(it.key); } }
      else { c.missing++; missing.push(it.key); }
    });
    const errors = validateShape(scope), blockers = [];
    if (missing.length) blockers.push(missing.length + " item(s) missing");
    if (openAsm.length) blockers.push(openAsm.length + " assumption(s) not accepted");
    if (openKeys.length) blockers.push(openKeys.length + " item(s) with an open decision");
    if (errors.length) blockers.push("the scope is not well formed");
    return Object.assign(c, { assumed: c.assumed_accepted + c.assumed_open, missingKeys: missing, openAsmKeys: openAsm, openKeys, errors, blockers, complete: !blockers.length });
  }
  const progressLine = c => c.answered + " answered, " + c.assumed + " assumed (" + c.assumed_accepted + " accepted), " + c.missing + " missing" +
    (c.openKeys.length ? ", " + c.openKeys.length + " open decision(s)" : "");
  function itemState(it) {
    if (it.status !== "missing" && openMarkers(it).length) return "open_decision";
    if (it.status === "assumed") return it.assumption.accepted ? "assumed_accepted" : "assumed_open";
    return it.status;
  }
  const STATE_LABEL = { answered: "answered", assumed_accepted: "assumed, accepted", assumed_open: "assumed, not accepted", missing: "missing", open_decision: "open decision" };

  function editItem(scope, key, action, text, by) {
    const s = clone(scope), it = itemMap(s)[key];
    text = (text || "").trim();
    if (action === "answer") { if (!text) throw new Error("The answer is empty."); delete it.assumption; it.status = "answered"; it.answer = text; }
    else if (action === "assume") { if (!text) throw new Error("The assumption is empty."); delete it.answer; it.status = "assumed"; it.assumption = { text, accepted: false }; }
    else if (action === "accept") { if (it.status !== "assumed") throw new Error("Only an assumption can be accepted."); if (!by) throw new Error("Accepting needs your name."); it.assumption.accepted = true; it.assumption.accepted_by = by; }
    else if (action === "unaccept") { it.assumption.accepted = false; delete it.assumption.accepted_by; }
    else if (action === "clear") { delete it.answer; delete it.assumption; it.status = "missing"; }
    return s;
  }
  function ruleQuestion(scope) {
    const c = completeness(scope);
    if (c.missingKeys.length) {
      const asks = c.missingKeys.slice(0, MAX_ASKS), more = c.missingKeys.length - asks.length;
      return "These items are still missing:\n" + asks.map(k => "- " + LABEL[k] + ": " + QUESTION[k]).join("\n") + (more ? "\n(" + more + " more item(s) after these.)" : "");
    }
    if (c.openAsmKeys.length) return "Every item has an answer or an assumption. " + c.openAsmKeys.length + " assumption(s) are not accepted yet: accept, edit or replace each in the checklist.";
    if (c.openKeys.length) return "Every item has an answer, but " + c.openKeys.length + " still hold an open decision (" + c.openKeys.map(k => LABEL[k]).join(", ") + "). Decide each one and edit the item; the checklist is complete only when none is left.";
    if (c.errors.length) return "The checklist is filled but the scope is not well formed: " + c.errors.slice(0, 3).join("; ");
    return "The checklist is complete. You can submit it for scope review.";
  }
  function quoteTooThin(q) {
    q = norm(q);
    const words = q.split(" ").filter(w => /[\p{L}\p{N}]/u.test(w));
    return (words.length < MIN_QUOTE_WORDS || q.length < MIN_QUOTE_CHARS) ? "quote too thin (needs at least 3 words and 10 characters)" : null;
  }
  const newAddition = (it, quote) => ({ id: Math.random().toString(16).slice(2, 14), key: it.key, quote, base: fullText(it) });

  const SYSTEM_PROMPT = `You are the scope-brainstorm assistant of an embedded product development and test tool. A person describes a feature for their own project; together you fill a 13-item scope checklist.

Rules you must follow:
- Rules decide, you draft, the person approves. You never say the scope is complete and you never accept anything.
- extractions: copy answers from the person's LATEST message only. Each needs the checklist key and a "quote" copied character for character from that message (the person's own words). A quote that is not in the message is thrown away by code. Do not paraphrase inside the quote. A quote needs at least 3 words and 10 characters. If an item already has an answer or an assumption your extraction is NOT applied: it is shown to the person as an addition that they accept or reject, so extract the person's exact words and nothing the item already says.
- assumptions: for items that are still missing you may propose a sensible assumption. Ground it in the PROJECT CONTEXT the person wrote; if that says nothing relevant, use a common engineering default and say so in "basis". Give "text" (the assumption) and "basis" (the fact or default it rests on). The person decides whether to accept it. Never propose an assumption for an item the person already answered. Propose at most 4 per turn and only when it is a reasonable default.
- reply: the next message to the person. Short, plain English. Ask about at most 3 still-missing items, by name. If you extracted something, say in one line what you took from their message. Do not invent facts about their project.
- asks: the checklist keys your reply asks about (at most 3, all still missing after your extractions).

Answer with ONE JSON object and nothing else:
{"extractions":[{"key":"...","quote":"..."}],"assumptions":[{"key":"...","text":"...","basis":"..."}],"reply":"...","asks":["..."]}`;

  function buildPrompt(req, personText) {
    const items = canonicalItems(req.scope).map(it => {
      const row = { key: it.key, label: LABEL[it.key], state: itemState(it) };
      if (it.status === "answered") row.answer = it.answer;
      if (it.status === "assumed") row.assumption = it.assumption.text;
      return row;
    });
    const hist = (req.chat || []).filter(m => m.role === "person" || m.role === "assistant").slice(-6).map(m => ({ role: m.role, text: String(m.text).slice(0, 1200) }));
    const fr = {};
    ["title", "description", "motivation", "constraints", "notes"].forEach(k => { if (req[k]) fr[k] = req[k]; });
    return "FEATURE REQUEST\n" + JSON.stringify(fr, null, 1) + "\n\nCHECKLIST NOW\n" + JSON.stringify(items, null, 1) +
      "\n\nPROJECT CONTEXT (written by the person; may be empty)\n" + (req.context || "(none given)").slice(0, 12000) +
      "\n\nLAST TURNS\n" + JSON.stringify(hist, null, 1) + "\n\nTHE PERSON'S LATEST MESSAGE\n<<<\n" + personText + "\n>>>\n\nAnswer with the JSON object only.";
  }
  function checkTurn(data) {
    if (typeof data.reply !== "string" || !data.reply.trim()) throw new Error('missing "reply" text');
    ["extractions", "assumptions", "asks"].forEach(f => { if (data[f] != null && !Array.isArray(data[f])) throw new Error('"' + f + '" must be a list'); });
  }
  function parseTurn(data, personText, scope) {
    const items = itemMap({ items: canonicalItems(scope) });
    const said = norm(personText), rejected = [], ext = [], add = [], asm = [], seen = new Set();
    (data.extractions || []).forEach(e => {
      const key = e && e.key, quote = e && typeof e.quote === "string" ? e.quote : null, rec = { kind: "extraction", key, quote };
      if (!KEYS.includes(key)) return rejected.push(Object.assign(rec, { reason: "unknown checklist key" }));
      if (seen.has(key)) return rejected.push(Object.assign(rec, { reason: "duplicate key" }));
      if (quote == null) return rejected.push(Object.assign(rec, { reason: "no usable quote" }));
      if (!said.includes(norm(quote))) return rejected.push(Object.assign(rec, { reason: "quote is not in your message" }));
      const thin = quoteTooThin(quote);
      if (thin) return rejected.push(Object.assign(rec, { reason: thin }));
      if (items[key].status === "missing") { seen.add(key); ext.push({ key, quote: norm(quote) }); return; }
      if (norm(fullText(items[key])).toLowerCase().includes(norm(quote).toLowerCase())) return rejected.push(Object.assign(rec, { reason: "the item already says this" }));
      seen.add(key); add.push(newAddition(items[key], norm(quote)));
    });
    (data.assumptions || []).forEach(a => {
      if (!a || typeof a !== "object") return;
      const key = a.key, text = typeof a.text === "string" ? a.text : "", rec = { kind: "assumption", key, text };
      if (!KEYS.includes(key)) return rejected.push(Object.assign(rec, { reason: "unknown checklist key" }));
      if (!text.trim()) return rejected.push(Object.assign(rec, { reason: "empty assumption" }));
      if (items[key].status !== "missing" || seen.has(key)) return rejected.push(Object.assign(rec, { reason: "item is not missing" }));
      if (asm.length >= MAX_ASSUMPTIONS) return rejected.push(Object.assign(rec, { reason: "too many assumptions in one turn" }));
      if (asm.some(x => x.key === key)) return rejected.push(Object.assign(rec, { reason: "duplicate key" }));
      asm.push({ key, text: norm(text), basis: typeof a.basis === "string" && a.basis.trim() ? norm(a.basis) : "none given" });
    });
    const asks = (data.asks || []).filter(k => KEYS.includes(k)).slice(0, MAX_ASKS);
    return { proposals: { extractions: ext, additions: add, assumptions: asm, reply: data.reply.trim().slice(0, 1800), asks }, rejected };
  }
  function applyProposals(scope, p) {
    const s = clone(scope), by = itemMap(s), outcomes = [], pending = [];
    p.extractions.forEach(e => {
      const it = by[e.key];
      if (it.status !== "missing") {
        if (!norm(fullText(it)).toLowerCase().includes(e.quote.toLowerCase())) { pending.push(newAddition(it, e.quote)); outcomes.push("addition proposed for " + frId(e.key)); }
        return;
      }
      it.status = "answered"; it.answer = e.quote; outcomes.push("answered " + frId(e.key));
    });
    p.additions.forEach(a => {
      const it = by[a.key];
      if (it.status === "missing") { it.status = "answered"; it.answer = a.quote; outcomes.push("answered " + frId(a.key)); }
      else if (fullText(it) === a.base) { pending.push(a); outcomes.push("addition proposed for " + frId(a.key)); }
    });
    p.assumptions.forEach(a => {
      const it = by[a.key];
      if (it.status !== "missing") return;
      it.status = "assumed"; it.assumption = { text: a.text + " [basis: " + a.basis + "]", accepted: false };
      outcomes.push("assumed " + frId(a.key) + " (not accepted)");
    });
    return { scope: s, outcomes, pending };
  }
  function chooseReply(scope, p) {
    const c = completeness(scope);
    if (p && c.missingKeys.length && p.asks.length >= 1 && p.asks.length <= MAX_ASKS && p.asks.every(k => c.missingKeys.includes(k))) return [p.reply, "model"];
    return [ruleQuestion(scope), "rules"];
  }
  async function runTurn(req, personText) {
    const r = await PL.askJSON(SYSTEM_PROMPT, buildPrompt(req, personText), checkTurn);
    if (!r.data) return { proposals: null, rejected: [], usage: r.usage, notes: r.notes };
    return Object.assign(parseTurn(r.data, personText, req.scope), { usage: r.usage, notes: r.notes });
  }

  PL.scope = { CHECKLIST, KEYS, LABEL, QUESTION, frId, blankScope, itemMap, canonicalItems, scopeArtifact, scopeHash, itemText, fullText, openMarkers, openSentences,
    validateShape, completeness, progressLine, itemState, STATE_LABEL, editItem, ruleQuestion, applyProposals, chooseReply, runTurn };
})();
