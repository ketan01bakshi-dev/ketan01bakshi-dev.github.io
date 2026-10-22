/* Proofline scope tool, browser edition.
 * Stage 1 of Proofline (Feature Requirements) running fully in the visitor's browser:
 *   - requests, chat and approvals live in this browser's localStorage only;
 *   - AI is optional and uses the visitor's OWN key, sent straight from the browser to the provider they pick;
 *   - rules decide, the model drafts, the person approves (ported from tsp/scope.py of the Safe-Stop Bench).
 * Every piece of user or model text is rendered with textContent, never as HTML.
 * AI-assisted, synthetic, illustrative. Makes no claim of compliance with any standard.
 */
(function () {
  "use strict";

  // ------------------------------------------------------------------ safe storage (private windows can throw)
  const store = {
    get(area, k) { try { return window[area].getItem(k); } catch (e) { return null; } },
    set(area, k, v) { try { window[area].setItem(k, v); return true; } catch (e) { return false; } },
    del(area, k) { try { window[area].removeItem(k); } catch (e) { /* ignore */ } },
  };
  const LS = "localStorage", SS = "sessionStorage";
  const K_REQ = "proofline.requests.v1", K_SET = "proofline.settings.v1", K_KEY = "proofline.apikey.v1", K_THEME = "proofline.theme";

  // ------------------------------------------------------------------ checklist (same 13 items and order as the local tool)
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
  const norm = s => String(s == null ? "" : s).split(/\s+/).filter(Boolean).join(" ");
  const clone = o => JSON.parse(JSON.stringify(o));
  const today = () => new Date().toISOString().slice(0, 10);
  const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

  // ------------------------------------------------------------------ scope rules (port of tsp/scope.py)
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
  function canonicalJson(v) {
    if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
    if (v && typeof v === "object") return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canonicalJson(v[k])).join(",") + "}";
    return JSON.stringify(v);
  }
  async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  const scopeHash = scope => sha256(canonicalJson({ feature_id: scope.feature_id, items: canonicalItems(scope) }));

  function itemText(it) {
    if (it.status === "answered") return it.answer || "";
    if (it.status === "assumed") return it.assumption.text.replace(BASIS_RE, " ").trim();
    return "";
  }
  function fullText(it) { return it.status === "answered" ? (it.answer || "") : it.status === "assumed" ? it.assumption.text : ""; }
  function openMarkers(it) { const t = itemText(it); return OPEN_MARKERS.filter(m => m[1].test(t)).map(m => m[0]); }
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
  function progressLine(c) {
    return c.answered + " answered, " + c.assumed + " assumed (" + c.assumed_accepted + " accepted), " + c.missing + " missing" +
      (c.openKeys.length ? ", " + c.openKeys.length + " open decision(s)" : "");
  }
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
      const asks = c.missingKeys.slice(0, MAX_ASKS);
      const more = c.missingKeys.length - asks.length;
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
  function newAddition(it, quote) { return { id: Math.random().toString(16).slice(2, 14), key: it.key, quote, base: fullText(it) }; }

  // ------------------------------------------------------------------ the model turn
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
    return "FEATURE REQUEST\n" + JSON.stringify(fr, null, 1) +
      "\n\nCHECKLIST NOW\n" + JSON.stringify(items, null, 1) +
      "\n\nPROJECT CONTEXT (written by the person; may be empty)\n" + (req.context || "(none given)").slice(0, 12000) +
      "\n\nLAST TURNS\n" + JSON.stringify(hist, null, 1) +
      "\n\nTHE PERSON'S LATEST MESSAGE\n<<<\n" + personText + "\n>>>\n\nAnswer with the JSON object only.";
  }
  function jsonText(raw) {
    raw = String(raw || "").trim();
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) raw = m[1].trim();
    const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
    return a !== -1 && b > a ? raw.slice(a, b + 1) : raw;
  }
  function parseModelOutput(raw, personText, scope) {
    let data;
    try { data = JSON.parse(jsonText(raw)); } catch (e) { throw new Error("not valid JSON"); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("the answer is not a JSON object");
    if (typeof data.reply !== "string" || !data.reply.trim()) throw new Error('missing "reply" text');
    ["extractions", "assumptions", "asks"].forEach(f => { if (data[f] != null && !Array.isArray(data[f])) throw new Error('"' + f + '" must be a list'); });
    const items = itemMap({ items: canonicalItems(scope) });
    const said = norm(personText), rejected = [], ext = [], add = [], asm = [], seen = new Set();
    (data.extractions || []).forEach(e => {
      const key = e && e.key, quote = e && typeof e.quote === "string" ? e.quote : null;
      const rec = { kind: "extraction", key, quote };
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
      const key = a.key, text = typeof a.text === "string" ? a.text : "";
      const rec = { kind: "assumption", key, text };
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

  // ------------------------------------------------------------------ settings and the visitor's own key
  const PROVIDERS = {
    anthropic: { label: "Claude", models: ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"], def: "claude-sonnet-5-5" },
    openai: { label: "OpenAI", models: [], def: "" },
    compatible: { label: "Custom", models: [], def: "" },
    off: { label: "off", models: [], def: "" },
  };
  function loadSettings() {
    let s = {};
    try { s = JSON.parse(store.get(LS, K_SET) || "{}") || {}; } catch (e) { s = {}; }
    return Object.assign({ name: "", provider: "off", model: "", base: "", effort: "medium", keyStore: "session" }, s);
  }
  let settings = loadSettings();
  function saveSettings() { store.set(LS, K_SET, JSON.stringify(settings)); }   // never contains the key
  function getKey() { return store.get(SS, K_KEY) || store.get(LS, K_KEY) || ""; }
  function setKey(k, where) {
    store.del(SS, K_KEY); store.del(LS, K_KEY);
    if (k) store.set(where === "local" ? LS : SS, K_KEY, k);
  }
  function aiReady() {
    if (settings.provider === "off") return false;
    if (!settings.model) return false;
    if (settings.provider === "compatible") return !!settings.base;   // a local endpoint may need no key
    return !!getKey();
  }
  function aiLabel() { return aiReady() ? PROVIDERS[settings.provider].label + " · " + settings.model : "off"; }

  function supportsEffort(model) { return /^claude-(opus|sonnet|haiku|fable)-([5-9]|4-[5-8])/.test(model); }

  async function askModel(system, prompt, opts) {
    opts = opts || {};
    const p = settings.provider, key = getKey(), t0 = performance.now();
    let res, data;
    try {
      if (p === "anthropic") {
        const body = { model: settings.model, max_tokens: opts.maxTokens || 8000, system, messages: [{ role: "user", content: prompt }] };
        if (supportsEffort(settings.model)) body.output_config = { effort: opts.effort || settings.effort || "medium" };
        res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST", referrerPolicy: "no-referrer", credentials: "omit",
          headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
          body: JSON.stringify(body),
        });
      } else {
        const base = (p === "openai" ? "https://api.openai.com/v1" : settings.base).replace(/\/+$/, "");
        const headers = { "content-type": "application/json" };
        if (key) headers.authorization = "Bearer " + key;
        res = await fetch(base + "/chat/completions", {
          method: "POST", referrerPolicy: "no-referrer", credentials: "omit", headers,
          body: JSON.stringify({ model: settings.model, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }),
        });
      }
    } catch (e) {
      throw new Error("Could not reach the AI endpoint. Check your connection, the URL, or whether the endpoint allows calls from a browser (CORS).");
    }
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      const detail = data && data.error ? (data.error.message || data.error.type || "") : "";
      const why = { 400: "the request was refused", 401: "the key was rejected", 403: "the key has no access to this", 404: "model or endpoint not found", 429: "rate limit or no credit left", 529: "the provider is overloaded" }[res.status] || "provider error";
      throw new Error("AI call failed (" + res.status + ", " + why + ")" + (detail ? ": " + String(detail).slice(0, 200) : ""));
    }
    let text = "", usage = { in: 0, out: 0 };
    if (p === "anthropic") {
      if (data.stop_reason === "refusal") throw new Error("The model declined this request.");
      text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
      usage = { in: (data.usage && data.usage.input_tokens) || 0, out: (data.usage && data.usage.output_tokens) || 0 };
    } else {
      text = data && data.choices && data.choices[0] && data.choices[0].message ? (data.choices[0].message.content || "") : "";
      usage = { in: (data.usage && data.usage.prompt_tokens) || 0, out: (data.usage && data.usage.completion_tokens) || 0 };
    }
    usage.seconds = Math.round((performance.now() - t0) / 100) / 10;
    return { text, usage };
  }
  async function runModel(req, personText) {
    const prompt = buildPrompt(req, personText), usage = { in: 0, out: 0, seconds: 0, calls: 0 }, notes = [];
    const call = async p => { const r = await askModel(SYSTEM_PROMPT, p); usage.calls++; usage.in += r.usage.in; usage.out += r.usage.out; usage.seconds += r.usage.seconds; return r.text; };
    let raw = await call(prompt);
    for (let attempt = 0; attempt < 2; attempt++) {
      try { const r = parseModelOutput(raw, personText, req.scope); return Object.assign(r, { usage, notes }); }
      catch (e) {
        notes.push("model answer unusable: " + e.message);
        if (attempt === 1) break;
        raw = await call(prompt + "\n\nYour previous answer was unusable: " + e.message + ". Answer again with the JSON object only, in the required shape.");
      }
    }
    notes.push("repair failed; the rule-based question is used");
    return { proposals: null, rejected: [], usage, notes };
  }

  // ------------------------------------------------------------------ requests in this browser
  function loadRequests() { try { const v = JSON.parse(store.get(LS, K_REQ) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  let requests = loadRequests();
  let storageWarned = false;
  function saveRequests() {
    if (!store.set(LS, K_REQ, JSON.stringify(requests)) && !storageWarned) { storageWarned = true; toast("This browser is not saving data (private mode or storage blocked). Export your work before closing the tab."); }
  }
  const findReq = id => requests.find(r => r.id === id);
  function slug(t) { return (String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "request") + "-" + Math.random().toString(16).slice(2, 6); }
  function newRequest(f) {
    const id = slug(f.title);
    return { id, title: f.title, description: f.description, motivation: f.motivation || "", constraints: f.constraints || "", notes: f.notes || "",
      requester: settings.name || "", created: today(), context: f.context || "", scope: blankScope(id), chat: [], additions: [], review: null, audit: [] };
  }
  function audit(req, what) { req.audit = req.audit || []; req.audit.push({ at: nowIso(), by: settings.name || "(no name)", what }); }

  async function statusOf(req) {
    const c = completeness(req.scope), h = await scopeHash(req.scope), r = req.review;
    if (r && r.hash === h) {
      if (r.state === "approved") return { key: "approved", label: c.openKeys.length ? "approved, " + c.openKeys.length + " open decision(s)" : "approved", c, h };
      if (r.state === "rejected") return { key: "rejected", label: "rejected", c, h };
      if (r.state === "submitted") return { key: "in-review", label: "in review", c, h };
    }
    if (r && r.state === "approved" && r.hash !== h) return { key: "reopened", label: "reopened (edited after approval)", c, h };
    return c.complete ? { key: "complete", label: "complete", c, h } : { key: "drafting", label: "drafting", c, h };
  }

  // ------------------------------------------------------------------ OTA example (Proofline pilot 1, as published with the bench)
  const OTA_EXAMPLE = {
    title: "OTA software updates, the way production vehicles do them",
    description: "I want the bench's ECUs to take software updates over the air the way a production vehicle does: signed images, safe to interrupt, only when the vehicle is in a fit state, with a record of what was installed. Find what the bench already does and what is missing.",
    motivation: "Pilot 1 of Proofline. The bench already has a large part of this, so the tool can be checked against a feature whose real state is known.",
    constraints: "Parts already owned: two ESP32-S3 boards, MCP2515 CAN modules. Relay and sniffer parts ordered.",
    notes: "AI-assisted, synthetic, illustrative example.",
    context: "Bench: two ESP32-S3 boards (board A = bus node, board B = safety controller) on a 500 kbit/s CAN bus with MCP2515 + TJA1050, a PC running Python scenarios, a vehicle plant model and an oracle. Board B already has A/B slots, SHA-256 + HMAC image check, trial boot with 3 s health window, rollback and Wi-Fi with TLS. Arduino core via arduino-cli, C++17 core shared with the PC.",
    items: {
      function_boundary: ["answered", "Updating the software of the bench's ECUs over the air. Real: boards A and B, the CAN bus, the Wi-Fi/MQTT path, the signing tools on the PC. Simulated: the rest of the fleet (emulated vECUs), the vehicle state and the 12 V supply."],
      target_hardware_toolchain: ["assumed", "ESP32-S3 class boards (EdgeHex), Arduino core built with arduino-cli, C++17 core shared with the PC. No new board.", false],
      test_levels: ["answered", "Emulated board, then real board B over USB, MQTT gateway and Wi-Fi with TLS; staged rollout on a mixed fleet."],
      criticality: ["assumed", "The update path protects a safety controller, so a failed or interrupted update must never leave unverified code running. No standard integrity level is claimed.", false],
      fault_cases: ["answered", "Tampered image, wrong key, corrupted chunk, reset at 1/50/99 % of the download, lost and repeated chunks, unhealthy image, reset during trial boot, older version, power lost at each write of the commit. Still to decide: supply sag, one ECU failing after another committed."],
      evidence: ["assumed", "Test reports, manifest and the release verdict. UNECE R156 and ISO 24089 are used as a reference only; no compliance is claimed.", true],
    },
  };
  function loadExample() {
    const req = newRequest(OTA_EXAMPLE);
    req.requester = "Example";
    Object.entries(OTA_EXAMPLE.items).forEach(([k, v]) => {
      const it = itemMap(req.scope)[k];
      if (v[0] === "answered") { it.status = "answered"; it.answer = v[1]; }
      else { it.status = "assumed"; it.assumption = { text: v[1], accepted: v[2] }; if (v[2]) it.assumption.accepted_by = "Example"; }
    });
    req.chat.push({ role: "assistant", text: "This is the OTA example, partly filled. " + ruleQuestion(req.scope), at: nowIso(), meta: "rules" });
    audit(req, "loaded the OTA example");
    requests.unshift(req); saveRequests();
    location.hash = "#/r/" + req.id;
  }

  // ------------------------------------------------------------------ DOM helpers (text only, never innerHTML)
  function h(tag, props) {
    const el = document.createElement(tag);
    const kids = Array.prototype.slice.call(arguments, 2);
    if (props) Object.keys(props).forEach(k => {
      const v = props[k];
      if (v == null || v === false) return;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else if (k === "value") el.value = v;
      else el.setAttribute(k, v === true ? "" : v);
    });
    kids.flat(Infinity).forEach(c => { if (c == null || c === false) return; el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c); });
    return el;
  }
  const app = document.getElementById("app");
  function mount(...nodes) { app.replaceChildren(...nodes.filter(Boolean)); }
  function append(el, ...nodes) { el.append(...nodes.filter(Boolean)); }
  function badge(key, label) { return h("span", { class: "badge b-" + key, text: label }); }
  let toastTimer;
  function toast(msg) {
    let t = document.querySelector(".toast");
    if (!t) { t = h("div", { class: "toast", role: "status" }); document.body.appendChild(t); }
    t.textContent = msg; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 4200);
  }
  function download(name, text, type) {
    const a = h("a", { href: URL.createObjectURL(new Blob([text], { type: type || "application/json" })), download: name });
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function needName() {
    if (settings.name) return settings.name;
    const n = (window.prompt("Your name (recorded on accepts and approvals):") || "").trim().slice(0, 60);
    if (n) { settings.name = n; saveSettings(); }
    return n;
  }

  // ------------------------------------------------------------------ exports
  async function scopeJson(req) {
    const out = { feature_id: req.scope.feature_id, version: req.scope.version || 1, items: canonicalItems(req.scope) };
    const h0 = await scopeHash(req.scope);
    if (req.review && req.review.state === "approved" && req.review.hash === h0) out.approval = { approved: true, scope_hash: h0, by: req.review.by, date: req.review.at.slice(0, 10) };
    return JSON.stringify(out, null, 2);
  }
  async function scopeMarkdown(req) {
    const st = await statusOf(req), lines = [];
    lines.push("# " + req.title, "", "Feature id: `" + req.id + "` · status: " + st.label + " · scope SHA-256: `" + st.h + "`", "", req.description, "");
    lines.push("| Id | Item | State | Text |", "|---|---|---|---|");
    canonicalItems(req.scope).forEach(it => {
      lines.push("| " + frId(it.key) + " | " + LABEL[it.key] + " | " + STATE_LABEL[itemState(it)] + " | " + (fullText(it) || "-").replace(/\|/g, "\\|").replace(/\n/g, " ") + " |");
    });
    lines.push("", "Made with Proofline (browser edition). AI-assisted, synthetic, illustrative; no claim of compliance with any standard.");
    return lines.join("\n");
  }

  // ------------------------------------------------------------------ views
  async function viewHome() {
    const list = h("ul", { class: "req-list" });
    for (const r of requests) {
      const st = await statusOf(r);
      list.appendChild(h("li", { class: "card" },
        h("a", { class: "title", href: "#/r/" + encodeURIComponent(r.id), text: r.title }),
        badge(st.key, st.label),
        h("span", { class: "muted small", text: progressLine(st.c) }),
        h("span", { class: "grow" }),
        h("button", { class: "btn-small", type: "button", text: "Export", onclick: () => download(r.id + ".proofline.json", JSON.stringify(r, null, 2)) }),
        h("button", { class: "btn-small btn-danger", type: "button", text: "Delete", onclick: () => {
          if ((window.prompt("Type the id to delete this request from this browser:\n" + r.id) || "").trim() !== r.id) return toast("Not deleted.");
          requests = requests.filter(x => x !== r); saveRequests(); route();
        } })));
    }
    const file = h("input", { type: "file", accept: ".json,application/json", class: "visually-hidden", hidden: true, onchange: e => importFile(e.target.files[0]) });
    mount(
      h("h1", { text: "Turn a feature idea into a reviewed scope" }),
      h("p", { class: "muted", text: "Describe a feature for an embedded or vehicle project. The tool agrees a 13-item scope with you (FR-01 to FR-13), shows what is missing or still open, and binds your approval to a SHA-256 of exactly what you approved. This is stage 1 of Proofline, the product development and test tool behind the Safe-Stop Bench." }),
      h("div", { class: "row" },
        h("a", { class: "btn btn-primary", href: "#/new", text: "New request" }),
        h("button", { class: "btn", type: "button", text: "Load the OTA example", onclick: loadExample }),
        h("button", { class: "btn", type: "button", text: "Import a request (.json)", onclick: () => file.click() }), file,
        h("button", { class: "btn", type: "button", text: aiReady() ? "AI: " + aiLabel() : "Add your AI key (optional)", onclick: openSettings })),
      h("h2", { text: "Your requests (saved in this browser)" }),
      requests.length ? list : h("p", { class: "empty", text: "None yet. Start a new request or load the OTA example." }));
  }
  function importFile(f) {
    if (!f) return;
    f.text().then(t => {
      const r = JSON.parse(t);
      if (!r || typeof r.title !== "string" || !r.scope || validateShape(r.scope).length) throw new Error("not a Proofline request file");
      r.id = findReq(r.id) ? slug(r.title) : String(r.id || slug(r.title));
      r.scope.feature_id = r.id; r.chat = Array.isArray(r.chat) ? r.chat : []; r.additions = Array.isArray(r.additions) ? r.additions : []; r.audit = Array.isArray(r.audit) ? r.audit : [];
      audit(r, "imported from a file"); requests.unshift(r); saveRequests(); location.hash = "#/r/" + r.id;
    }).catch(e => toast("Import failed: " + e.message));
  }

  function viewNew() {
    const f = {};
    const field = (k, label, opts) => { const el = h(opts && opts.area ? "textarea" : "input", Object.assign({ id: "f-" + k, maxlength: opts && opts.max || 4000 }, opts && opts.req ? { required: true } : {})); f[k] = el; return h("label", { for: "f-" + k }, label, el); };
    const form = h("form", { class: "card", onsubmit: e => {
      e.preventDefault();
      const v = k => f[k].value.trim();
      if (!v("title") || !v("description")) return toast("Title and description are needed.");
      const req = newRequest({ title: v("title"), description: v("description"), motivation: v("motivation"), constraints: v("constraints"), notes: v("notes"), context: v("context") });
      req.chat.push({ role: "assistant", text: "Tell me about the feature in your own words. " + ruleQuestion(req.scope), at: nowIso(), meta: "rules" });
      audit(req, "created the request");
      requests.unshift(req); saveRequests(); location.hash = "#/r/" + req.id;
    } },
      field("title", "Title", { req: true, max: 140 }),
      field("description", "What should it do?", { area: true, req: true }),
      field("motivation", "Why (optional)", { area: true }),
      field("constraints", "Constraints: budget, date, parts you own (optional)", { area: true }),
      field("context", "Project context (optional): what your project already has. The AI grounds its assumptions in this.", { area: true, max: 12000 }),
      field("notes", "Notes (optional)", { area: true }),
      h("div", { class: "row", style: "margin-top:1rem" }, h("button", { class: "btn btn-primary", type: "submit", text: "Create request" }), h("a", { class: "btn", href: "#/", text: "Cancel" })));
    mount(h("h1", { text: "New feature request" }), form);
    f.title.focus();
  }

  const busy = new Set();
  async function viewRequest(id) {
    const req = findReq(id);
    if (!req) return mount(h("h1", { text: "Not found" }), h("p", {}, "No request with that id in this browser. ", h("a", { href: "#/", text: "Back to the list" })));
    const st = await statusOf(req);
    const save = (what) => { if (what) audit(req, what); saveRequests(); route(); };

    // chat
    const log = h("div", { class: "chat-log", "aria-live": "polite" });
    (req.chat || []).forEach(m => log.appendChild(h("div", { class: "msg " + m.role },
      h("span", { class: "who", text: m.role === "person" ? (m.by || "you") : "assistant" }), m.text,
      m.meta ? h("span", { class: "meta", text: m.meta }) : null)));
    const input = h("textarea", { id: "chat-in", placeholder: aiReady() ? "Describe the feature, answer the questions…" : "Notes for the log. Without AI, fill the checklist by hand on the right.", maxlength: 6000 });
    const sendBtn = h("button", { class: "btn btn-primary", type: "submit", text: "Send", disabled: busy.has(id) });
    const chat = h("section", { class: "card chat", "aria-label": "Chat" },
      h("div", { class: "row" }, h("h2", { text: "Scope chat", style: "margin:0" }), h("span", { class: "grow" }),
        h("button", { class: "chip-btn " + (aiReady() ? "on" : ""), style: "color:var(--ink);border-color:var(--line)", type: "button", text: "AI: " + aiLabel(), onclick: openSettings })),
      log,
      busy.has(id) ? h("p", { class: "thinking", text: "Thinking… (an AI call usually takes 10 to 40 s)" }) : null,
      h("form", { class: "chat-form", onsubmit: e => { e.preventDefault(); send(req, input.value); } },
        h("label", { for: "chat-in", class: "visually-hidden", text: "Message", style: "display:none" }), input,
        h("div", { class: "row", style: "margin-top:.4rem" }, sendBtn, h("span", { class: "muted small", text: aiReady() ? "Sent to " + PROVIDERS[settings.provider].label + " with your key." : "No AI: rule-based questions." }))));
    setTimeout(() => { log.scrollTop = log.scrollHeight; }, 0);

    // checklist
    const items = itemMap(req.scope), cards = h("div", { class: "checklist" });
    KEYS.forEach(k => {
      const it = items[k], state = itemState(it), card = h("article", { class: "item s-" + state, id: "item-" + k });
      const editor = h("div", { class: "editor", hidden: true });
      const openEditor = (mode) => {
        const ta = h("textarea", { value: mode === "answer" ? (it.answer || "") : (it.assumption ? it.assumption.text : ""), maxlength: 6000 });
        editor.replaceChildren(ta, h("div", { class: "row", style: "margin-top:.3rem" },
          h("button", { class: "btn-small", type: "button", text: mode === "answer" ? "Save answer" : "Save assumption (not accepted)", onclick: () => {
            try { req.scope = editItem(req.scope, k, mode, ta.value); req.additions = (req.additions || []).filter(a => a.key !== k); save(frId(k) + ": " + mode + " edited by hand"); } catch (e) { toast(e.message); }
          } }),
          h("button", { class: "btn-small", type: "button", text: "Cancel", onclick: () => { editor.hidden = true; } })));
        editor.hidden = false; ta.focus();
      };
      const act = (label, fn) => h("button", { class: "btn-small", type: "button", text: label, onclick: fn });
      const actions = h("div", { class: "actions" });
      if (it.status === "missing") actions.append(act("Answer", () => openEditor("answer")), act("Add an assumption", () => openEditor("assume")));
      if (it.status === "answered") actions.append(act("Edit", () => openEditor("answer")), act("Clear", () => { req.scope = editItem(req.scope, k, "clear"); save(frId(k) + " cleared"); }));
      if (it.status === "assumed") {
        if (!it.assumption.accepted) actions.append(act("Accept", () => { const n = needName(); if (!n) return; req.scope = editItem(req.scope, k, "accept", "", n); save(frId(k) + " assumption accepted"); }));
        else actions.append(act("Un-accept", () => { req.scope = editItem(req.scope, k, "unaccept"); save(frId(k) + " assumption un-accepted"); }));
        actions.append(act("Edit", () => openEditor("assume")), act("Replace with an answer", () => openEditor("answer")), act("Clear", () => { req.scope = editItem(req.scope, k, "clear"); save(frId(k) + " cleared"); }));
      }
      const od = state === "open_decision" ? openSentences(it) : [];
      append(card,
        h("div", { class: "item-head" }, h("span", { class: "fr", text: frId(k) }), h("h3", { text: LABEL[k] }), badge(state, STATE_LABEL[state])),
        it.status === "missing" ? h("p", { class: "q", text: QUESTION[k] }) : h("p", { class: "text", text: fullText(it) }),
        it.status === "assumed" && it.assumption.accepted_by ? h("p", { class: "by", text: "Accepted by " + it.assumption.accepted_by }) : null,
        od.length ? h("p", { class: "od", text: "To decide: " + od.join(" ") }) : null,
        actions, editor);
      (req.additions || []).filter(a => a.key === k).forEach(a => {
        const stale = fullText(it) !== a.base;
        card.appendChild(h("div", { class: "addition" },
          h("strong", { text: "Proposed addition from your chat: " }), "“" + a.quote + "”",
          stale ? h("p", { class: "small muted", text: "The item changed after this was proposed; reject it and say it again." }) : null,
          h("div", { class: "row", style: "margin-top:.3rem" },
            stale ? null : act("Add to this item", () => {
              const n = needName(); if (!n) return;
              const s = clone(req.scope), x = itemMap(s)[k], merged = a.base + " [Added by " + n + ": " + a.quote + "]";
              if (x.status === "answered") x.answer = merged; else x.assumption.text = merged;
              req.scope = s; req.additions = req.additions.filter(y => y.id !== a.id); save(frId(k) + ": addition accepted");
            }),
            act("Reject", () => { req.additions = req.additions.filter(y => y.id !== a.id); save(frId(k) + ": addition rejected"); }))));
      });
      cards.appendChild(card);
    });

    const ctx = h("textarea", { value: req.context || "", maxlength: 12000, placeholder: "e.g. boards, buses, toolchain, what already works, what you own" });
    ctx.addEventListener("change", () => { req.context = ctx.value; saveRequests(); toast("Project context saved."); });
    const canSubmit = st.c.complete && st.key !== "in-review" && st.key !== "approved";

    mount(
      h("p", { class: "small", style: "margin:1rem 0 0" }, h("a", { href: "#/", text: "← All requests" })),
      h("div", { class: "req-head" },
        h("div", {}, h("h1", { text: "Feature Requirements: " + req.title }),
          h("div", { class: "row" }, badge(st.key, st.label), h("span", { class: "mono small muted", text: req.id })),
          h("p", { class: "progress", text: progressLine(st.c) }),
          st.c.blockers.length ? h("p", { class: "blockers", text: "Not complete yet: " + st.c.blockers.join(", ") + "." }) : null),
        h("div", { class: "row" },
          h("button", { class: "btn btn-primary", type: "button", text: "Submit for scope review", disabled: !canSubmit, title: canSubmit ? "" : "Possible when the rules say complete", onclick: async () => {
            req.review = { state: "submitted", hash: await scopeHash(req.scope), by: needName() || "(no name)", at: nowIso() }; audit(req, "submitted for scope review"); saveRequests(); location.hash = "#/r/" + req.id + "/review";
          } }),
          h("a", { class: "btn", href: "#/r/" + encodeURIComponent(req.id) + "/review", text: "Review page" }),
          h("button", { class: "btn", type: "button", text: "scope.json", onclick: async () => download(req.id + ".scope.json", await scopeJson(req)) }),
          h("button", { class: "btn", type: "button", text: "Markdown", onclick: async () => download(req.id + ".scope.md", await scopeMarkdown(req), "text/markdown") }),
          h("button", { class: "btn", type: "button", text: "Rename", onclick: () => { const t = (window.prompt("New title (id, hash and approvals stay the same):", req.title) || "").trim(); if (t) { req.title = t.slice(0, 140); save("renamed"); } } }))),
      h("div", { class: "work" }, chat, h("section", { "aria-label": "Checklist" }, cards)),
      h("details", { class: "card panel ctx" }, h("summary", { text: "Project context (used by the AI for its assumptions)" }), ctx),
      h("details", { class: "card panel" }, h("summary", { text: "The feature request" }),
        ...["description", "motivation", "constraints", "notes"].filter(k => req[k]).map(k => h("p", {}, h("strong", { text: k[0].toUpperCase() + k.slice(1) + ": " }), req[k])),
        h("p", { class: "muted small", text: "Created " + req.created + (req.requester ? " by " + req.requester : "") })));
  }

  async function send(req, text) {
    text = String(text || "").trim();
    if (!text || busy.has(req.id)) return;
    req.chat.push({ role: "person", by: settings.name || "you", text, at: nowIso() });
    saveRequests();
    if (!aiReady()) {
      req.chat.push({ role: "assistant", text: ruleQuestion(req.scope), at: nowIso(), meta: "rules (no AI configured)" });
      saveRequests(); return route();
    }
    busy.add(req.id); route();
    try {
      const r = await runModel(req, text);
      const fresh = findReq(req.id) || req;          // the person may have edited the checklist while the model thought
      let outcomes = [], reply, source;
      if (r.proposals) {
        const applied = applyProposals(fresh.scope, r.proposals);
        fresh.scope = applied.scope; outcomes = applied.outcomes;
        fresh.additions = (fresh.additions || []).concat(applied.pending);
        [reply, source] = chooseReply(fresh.scope, r.proposals);
      } else { [reply, source] = [ruleQuestion(fresh.scope), "rules"]; }
      const meta = [settings.model + " · " + r.usage.in + " in / " + r.usage.out + " out tokens · " + r.usage.seconds.toFixed(1) + " s",
        outcomes.length ? "applied: " + outcomes.join("; ") : "nothing applied",
        r.rejected.length ? r.rejected.length + " proposal(s) dropped by the rules (" + r.rejected.map(x => (x.key || "?") + ": " + x.reason).slice(0, 4).join("; ") + ")" : null,
        source === "rules" ? "reply written by the rules" : null].concat(r.notes).filter(Boolean).join(" · ");
      fresh.chat.push({ role: "assistant", text: reply, at: nowIso(), meta });
      if (outcomes.length) audit(fresh, "chat turn: " + outcomes.join("; "));
    } catch (e) {
      const fresh = findReq(req.id) || req;
      fresh.chat.push({ role: "assistant", text: ruleQuestion(fresh.scope), at: nowIso(), meta: e.message + " · the rule-based question is used" });
    } finally {
      busy.delete(req.id); saveRequests();
      if (location.hash.indexOf("#/r/" + req.id) === 0) route();
    }
  }

  async function viewReview(id) {
    const req = findReq(id);
    if (!req) return viewRequest(id);
    const st = await statusOf(req), r = req.review, current = r && r.hash === st.h;
    const rows = canonicalItems(req.scope).map(it => h("tr", {},
      h("td", { class: "mono", text: frId(it.key) }), h("td", { text: LABEL[it.key] }), h("td", {}, badge(itemState(it), STATE_LABEL[itemState(it)])), h("td", { class: "t", text: fullText(it) || "-" })));
    const reason = h("textarea", { id: "rev-reason", placeholder: "Reason (required to reject, optional to approve)", maxlength: 2000 });
    const decide = async (state) => {
      const n = needName(); if (!n) return;
      if (state === "rejected" && !reason.value.trim()) return toast("Rejecting needs a reason.");
      if ((await scopeHash(req.scope)) !== r.hash) return toast("The scope changed since it was submitted. Submit it again.");
      req.review = { state, hash: r.hash, by: n, at: nowIso(), reason: reason.value.trim() };
      audit(req, (state === "approved" ? "approved" : "rejected") + " the scope " + r.hash.slice(0, 12) + (reason.value.trim() ? ": " + reason.value.trim() : ""));
      saveRequests(); route();
    };
    let gate;
    if (current && r.state === "submitted") gate = h("div", { class: "card panel" }, h("h2", { text: "Your decision", style: "margin-top:0" }), reason,
      h("div", { class: "row", style: "margin-top:.5rem" }, h("button", { class: "btn btn-primary", type: "button", text: "Approve this exact scope", onclick: () => decide("approved") }),
        h("button", { class: "btn btn-danger", type: "button", text: "Reject", onclick: () => decide("rejected") })));
    else if (current) gate = h("div", { class: "card panel" }, h("p", { style: "margin:0" }, badge(st.key, st.label), " by " + r.by + " on " + r.at.replace("T", " ").replace("Z", " UTC") + (r.reason ? ". Reason: " + r.reason : ".")));
    else if (r && r.state === "approved") gate = h("div", { class: "card panel" }, h("p", { class: "blockers", style: "margin:0", text: "The scope was edited after it was approved (approved hash " + r.hash.slice(0, 12) + "…). The old approval no longer counts; submit it again." }));
    else gate = h("div", { class: "card panel" }, h("p", { style: "margin:0", text: st.c.complete ? "Complete but not submitted. Submit it from the request page." : "Not complete: " + st.c.blockers.join(", ") + "." }));

    mount(
      h("p", { class: "small", style: "margin:1rem 0 0" }, h("a", { href: "#/r/" + encodeURIComponent(req.id), text: "← Back to the request" })),
      h("h1", { text: "Scope review: " + req.title }),
      h("p", { class: "muted", text: "An approval is bound to the SHA-256 of the 13 items below. Any later edit changes the hash, and the approval stops counting." }),
      h("p", { class: "hash", text: "SHA-256 " + st.h }),
      gate,
      h("div", { class: "card panel table-scroll" }, h("table", { class: "frozen" }, h("thead", {}, h("tr", {}, h("th", { text: "Id" }), h("th", { text: "Item" }), h("th", { text: "State" }), h("th", { text: "Text" }))), h("tbody", {}, rows))),
      h("div", { class: "card panel" }, h("h2", { text: "Audit log (this browser)", style: "margin-top:0" }),
        h("ul", { class: "audit" }, (req.audit || []).slice().reverse().map(a => h("li", { text: a.at.replace("T", " ").replace("Z", " UTC") + " · " + a.by + " · " + a.what })))));
  }

  function viewHelp() {
    const li = t => h("li", { text: t });
    mount(
      h("h1", { text: "How the scope tool works" }),
      h("div", { class: "grid2" },
        h("section", { class: "card" }, h("h2", { text: "Rules decide, the model drafts, you approve", style: "margin-top:0" }),
          h("ol", { class: "steps" },
            li("Write the feature in your own words. With AI on, each chat turn may copy your words into checklist items (a quote must really be in your message, at least 3 words), propose assumptions for missing items, and ask about up to 3 missing items."),
            li("An assumption lands as \"not accepted\". Only your click accepts it, with your name."),
            li("A chat turn never overwrites an item. New words for a filled item become a proposed addition you add or reject."),
            li("\"TBD\", \"still to decide\", \"open question\" or a sentence ending in \"?\" marks an open decision. It blocks completeness."),
            li("Code, not the model, decides when the scope is complete. Then you submit it, and approve or reject it. The approval is bound to a SHA-256 of the items."),
            li("Export scope.json or a Markdown table to share with your team."))),
        h("section", { class: "card" }, h("h2", { text: "Your keys and your data", style: "margin-top:0" }),
          h("ul", { class: "facts" },
            li("This page is static: no server, no account, no analytics, no third-party scripts."),
            li("Requests are saved in this browser's storage only. Clearing site data deletes them; export what you want to keep."),
            li("AI is optional. Add your own key in AI settings: Anthropic (Claude), OpenAI, or any OpenAI-compatible endpoint, including a local model such as Ollama or LM Studio."),
            li("Your key is sent only to the provider you choose, straight from your browser. By default it is kept for this tab only."),
            li("The owner's own keys and subscription are not used by this page in any way. You pay your provider for your own usage.")),
          h("div", { class: "row", style: "margin-top:.8rem" },
            h("button", { class: "btn", type: "button", text: "AI settings", onclick: openSettings }),
            h("button", { class: "btn btn-danger", type: "button", text: "Delete all my data here", onclick: () => {
              if (!window.confirm("Delete every request, your settings and any saved key from this browser?")) return;
              [K_REQ, K_SET, K_KEY, K_THEME].forEach(k => { store.del(LS, k); store.del(SS, k); });
              requests = []; settings = loadSettings(); applyTheme(); updateChip(); toast("Deleted."); location.hash = "#/";
            } })))),
      h("section", { class: "card panel" }, h("h2", { text: "Where this fits in Proofline", style: "margin-top:0" }),
        h("p", { text: "Proofline is the product development and test tool built on the Safe-Stop Bench. It runs six stages, each closed by a person's approval: Feature Requirements → Gap Analysis & Overall Plan → Network & Node Architecture → Electrical Design Checks → Integration Guides → Firmware Requirements. This page is stage 1. The later stages read the bench's own repository (its tests, hardware list, CAN ids and plant model), so they run in the local tool, not in a browser." }),
        h("p", {}, h("a", { href: "../", text: "See the Safe-Stop Bench and where it stands" }))));
  }

  // ------------------------------------------------------------------ settings dialog
  const dlg = document.getElementById("settings");
  const $ = id => document.getElementById(id);
  function fillModels(p) {
    const dl = $("s-models"); dl.replaceChildren(...PROVIDERS[p].models.map(m => h("option", { value: m })));
    $("s-model").placeholder = p === "anthropic" ? "claude-sonnet-5-5" : "the model id your provider gives";
  }
  function syncDialog() {
    const p = $("s-provider").value;
    $("s-ai-fields").hidden = p === "off";
    $("s-base-wrap").hidden = p !== "compatible";
    $("s-effort-wrap").hidden = p !== "anthropic";
    fillModels(p);
  }
  function openSettings() {
    $("s-name").value = settings.name; $("s-provider").value = settings.provider; $("s-base").value = settings.base;
    $("s-model").value = settings.model || PROVIDERS[settings.provider].def; $("s-effort").value = settings.effort;
    $("s-key").value = getKey(); $("s-key").type = "password"; $("s-show").textContent = "Show";
    document.querySelectorAll('input[name="s-store"]').forEach(r => { r.checked = r.value === (store.get(LS, K_KEY) ? "local" : settings.keyStore); });
    $("s-test-out").textContent = ""; syncDialog();
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
  }
  function readDialog() {
    const where = (document.querySelector('input[name="s-store"]:checked') || {}).value || "session";
    return { name: $("s-name").value.trim().slice(0, 60), provider: $("s-provider").value, base: $("s-base").value.trim(),
      model: $("s-model").value.trim(), effort: $("s-effort").value, keyStore: where, key: $("s-key").value.trim() };
  }
  function applyDialog() {
    const d = readDialog();
    if (d.provider === "compatible" && d.base && !/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(d.base)) { toast("Use an https:// URL, or http://localhost for a local model."); return false; }
    if (d.provider !== "off" && !d.model) d.model = PROVIDERS[d.provider].def;
    settings = { name: d.name, provider: d.provider, base: d.base, model: d.model, effort: d.effort, keyStore: d.keyStore };
    saveSettings(); setKey(d.provider === "off" ? getKey() : d.key, d.keyStore);
    return true;
  }
  $("s-provider").addEventListener("change", () => { const p = $("s-provider").value; if (!$("s-model").value || !PROVIDERS[p].models.includes($("s-model").value)) $("s-model").value = PROVIDERS[p].def; syncDialog(); });
  $("s-show").addEventListener("click", () => { const k = $("s-key"); k.type = k.type === "password" ? "text" : "password"; $("s-show").textContent = k.type === "password" ? "Show" : "Hide"; });
  $("s-cancel").addEventListener("click", () => dlg.close());
  $("s-forget").addEventListener("click", () => { setKey("", "session"); $("s-key").value = ""; $("s-test-out").textContent = "Key removed from this browser."; updateChip(); });
  $("s-test").addEventListener("click", async () => {
    const before = { settings: Object.assign({}, settings), key: getKey(), where: store.get(LS, K_KEY) ? "local" : "session" };
    if (!applyDialog()) return;
    const out = $("s-test-out");
    if (!aiReady()) { out.className = "small err"; out.textContent = "Pick a provider, a model and a key first."; return; }
    out.className = "small"; out.textContent = "Testing…";
    try {
      const r = await askModel("Reply with the single word OK.", "Say OK.", { maxTokens: 400, effort: "low" });
      out.className = "small ok"; out.textContent = "Connected: " + settings.model + " answered in " + r.usage.seconds.toFixed(1) + " s (" + (r.usage.in + r.usage.out) + " tokens).";
    } catch (e) { out.className = "small err"; out.textContent = e.message; }
    if (!dlg.open) return;
    settings = before.settings; saveSettings(); setKey(before.key, before.where);   // Test does not save; Save does
  });
  $("settings-form").addEventListener("submit", e => { e.preventDefault(); if (applyDialog()) { dlg.close(); updateChip(); route(); toast(aiReady() ? "AI on: " + aiLabel() : "Saved. AI is off."); } });
  $("ai-chip").addEventListener("click", openSettings);
  $("notice-settings").addEventListener("click", openSettings);
  function updateChip() { const c = $("ai-chip"); c.textContent = "AI: " + aiLabel(); c.classList.toggle("on", aiReady()); }

  // ------------------------------------------------------------------ theme
  function applyTheme() { const t = store.get(LS, K_THEME); if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t); else document.documentElement.removeAttribute("data-theme"); }
  $("theme-btn").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    store.set(LS, K_THEME, cur === "dark" ? "light" : "dark"); applyTheme();
  });

  // ------------------------------------------------------------------ router
  let routing = Promise.resolve();
  function route() {
    routing = routing.then(async () => {
      const m = (location.hash || "#/").slice(1).split("/").filter(Boolean).map(decodeURIComponent);
      if (m[0] === "new") viewNew();
      else if (m[0] === "help") viewHelp();
      else if (m[0] === "r" && m[1] && m[2] === "review") await viewReview(m[1]);
      else if (m[0] === "r" && m[1]) await viewRequest(m[1]);
      else await viewHome();
    }).catch(e => { mount(h("p", { class: "err", text: "Something went wrong: " + e.message })); });
  }
  let lastHash = location.hash;
  window.addEventListener("hashchange", () => { lastHash = location.hash; route(); window.scrollTo(0, 0); });
  window.addEventListener("storage", e => { if (e.key === K_REQ) { requests = loadRequests(); route(); } if (e.key === K_SET) { settings = loadSettings(); updateChip(); } });
  applyTheme(); updateChip(); route();
})();
