/* Proofline, browser edition: shared core.
 * Storage (this browser only), the visitor's own AI key and calls, SHA-256 gates, DOM helpers.
 * Nothing here talks to any server of ours; there is none. User and model text is always rendered as text, never as HTML.
 * AI-assisted, synthetic, illustrative. Makes no claim of compliance with any standard.
 */
(function () {
  "use strict";
  const PL = window.PL = window.PL || {};

  // ------------------------------------------------------------------ safe storage (private windows can throw)
  const store = PL.store = {
    get(area, k) { try { return window[area].getItem(k); } catch (e) { return null; } },
    set(area, k, v) { try { window[area].setItem(k, v); return true; } catch (e) { return false; } },
    del(area, k) { try { window[area].removeItem(k); } catch (e) { /* ignore */ } },
  };
  const LS = PL.LS = "localStorage", SS = PL.SS = "sessionStorage";
  const K = PL.K = { req: "proofline.requests.v1", set: "proofline.settings.v1", key: "proofline.apikey.v1", theme: "proofline.theme" };

  // ------------------------------------------------------------------ small utilities
  PL.norm = s => String(s == null ? "" : s).split(/\s+/).filter(Boolean).join(" ");
  PL.clone = o => JSON.parse(JSON.stringify(o));
  PL.today = () => new Date().toISOString().slice(0, 10);
  PL.nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
  PL.runId = () => Math.random().toString(16).slice(2, 10) + Date.now().toString(16).slice(-6);
  PL.round = (x, d) => { const f = Math.pow(10, d == null ? 2 : d); return Math.round(x * f) / f; };
  PL.uniq = a => Array.from(new Set(a));
  PL.fmt = (x, d) => (x == null || Number.isNaN(x)) ? "unknown" : String(PL.round(x, d == null ? 2 : d));
  PL.STOP = new Set("a an and are as at be by can for from has have if in into is it its of on or that the this to was we will with must should when which while each every any all not no only than then there their them they our your you more most other some such what who also over under per via may one two three new use used uses using".split(" "));
  PL.tokens = s => new Set(String(s || "").toLowerCase().split(/[^a-z0-9_]+/).filter(w => w.length > 2 && !PL.STOP.has(w)));

  function canonicalJson(v) {
    if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
    if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ":" + canonicalJson(v[k])).join(",") + "}";
    return JSON.stringify(v === undefined ? null : v);
  }
  PL.canonicalJson = canonicalJson;
  PL.sha256 = async text => {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  };
  PL.hashOf = obj => PL.sha256(canonicalJson(obj));

  // ------------------------------------------------------------------ settings and the visitor's own key
  PL.PROVIDERS = {
    anthropic: { label: "Claude", models: ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"], def: "claude-sonnet-5-5" },
    openai: { label: "OpenAI", models: [], def: "" },
    compatible: { label: "Custom", models: [], def: "" },
    off: { label: "off", models: [], def: "" },
  };
  PL.loadSettings = () => {
    let s = {};
    try { s = JSON.parse(store.get(LS, K.set) || "{}") || {}; } catch (e) { s = {}; }
    return Object.assign({ name: "", provider: "off", model: "", base: "", effort: "medium", keyStore: "session" }, s);
  };
  PL.settings = PL.loadSettings();
  PL.saveSettings = () => store.set(LS, K.set, JSON.stringify(PL.settings));   // never contains the key
  PL.getKey = () => store.get(SS, K.key) || store.get(LS, K.key) || "";
  PL.setKey = (k, where) => { store.del(SS, K.key); store.del(LS, K.key); if (k) store.set(where === "local" ? LS : SS, K.key, k); };
  PL.aiReady = () => {
    const s = PL.settings;
    if (s.provider === "off" || !s.model) return false;
    if (s.provider === "compatible") return !!s.base;   // a local endpoint may need no key
    return !!PL.getKey();
  };
  PL.aiLabel = () => PL.aiReady() ? PL.PROVIDERS[PL.settings.provider].label + " · " + PL.settings.model : "off";
  const supportsEffort = m => /^claude-(opus|sonnet|haiku|fable)-([5-9]|4-[5-8])/.test(m);

  /* One model call with the visitor's key. Returns {text, usage:{in,out,seconds}}. */
  PL.askModel = async function (system, prompt, opts) {
    opts = opts || {};
    const s = PL.settings, p = s.provider, key = PL.getKey(), t0 = performance.now();
    let res, data;
    try {
      if (p === "anthropic") {
        const body = { model: s.model, max_tokens: opts.maxTokens || 12000, system, messages: [{ role: "user", content: prompt }] };
        if (supportsEffort(s.model)) body.output_config = { effort: opts.effort || s.effort || "medium" };
        res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST", referrerPolicy: "no-referrer", credentials: "omit",
          headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
          body: JSON.stringify(body),
        });
      } else {
        const base = (p === "openai" ? "https://api.openai.com/v1" : s.base).replace(/\/+$/, "");
        const headers = { "content-type": "application/json" };
        if (key) headers.authorization = "Bearer " + key;
        res = await fetch(base + "/chat/completions", {
          method: "POST", referrerPolicy: "no-referrer", credentials: "omit", headers,
          body: JSON.stringify({ model: s.model, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }),
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
  };

  PL.jsonText = raw => {
    raw = String(raw || "").trim();
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) raw = m[1].trim();
    const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
    return a !== -1 && b > a ? raw.slice(a, b + 1) : raw;
  };
  /* A model call that must return a JSON object. `check(data)` throws when the shape is unusable. One repair retry, then null. */
  PL.askJSON = async function (system, prompt, check) {
    const usage = { calls: 0, in: 0, out: 0, seconds: 0, model: PL.settings.model }, notes = [];
    const call = async p => { const r = await PL.askModel(system, p); usage.calls++; usage.in += r.usage.in; usage.out += r.usage.out; usage.seconds = PL.round(usage.seconds + r.usage.seconds, 1); return r.text; };
    let raw = await call(prompt);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const data = JSON.parse(PL.jsonText(raw));
        if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("the answer is not a JSON object");
        if (check) check(data);
        return { data, usage, notes };
      } catch (e) {
        notes.push("model answer unusable: " + e.message);
        if (attempt === 1) break;
        raw = await call(prompt + "\n\nYour previous answer was unusable: " + e.message + ". Answer again with the JSON object only, in the required shape.");
      }
    }
    notes.push("repair failed; the rule-based path is used");
    return { data: null, usage, notes };
  };
  PL.usageLine = u => u && u.calls ? ((u.model || "claude-sonnet-5-5 (owner's Claude plan)") + " · " + u.calls + " call(s) · " + u.in + " in / " + u.out + " out tokens · " + PL.fmt(u.seconds, 1) + " s") : "no AI call";

  // ------------------------------------------------------------------ requests in this browser
  PL.loadRequests = () => { try { const v = JSON.parse(store.get(LS, K.req) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  PL.requests = PL.loadRequests();
  let storageWarned = false;
  PL.saveRequests = () => {
    if (!store.set(LS, K.req, JSON.stringify(PL.requests)) && !storageWarned) {
      storageWarned = true;
      PL.toast("This browser is not saving data (private mode, storage blocked or full). Export your work before closing the tab.");
    }
  };
  PL.findReq = id => PL.requests.find(r => r.id === id);
  PL.slug = t => (String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "request") + "-" + Math.random().toString(16).slice(2, 6);
  PL.audit = (req, what) => { req.audit = req.audit || []; req.audit.push({ at: PL.nowIso(), by: PL.settings.name || "(no name)", what }); };

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
  PL.h = h;
  PL.app = () => document.getElementById("app");
  PL.mount = (...nodes) => PL.app().replaceChildren(...nodes.flat(Infinity).filter(Boolean));
  PL.append = (el, ...nodes) => el.append(...nodes.flat(Infinity).filter(Boolean));
  PL.badge = (key, label) => h("span", { class: "badge b-" + String(key).replace(/[^a-z0-9_-]/gi, "_"), text: label });
  let toastTimer;
  PL.toast = msg => {
    let t = document.querySelector(".toast");
    if (!t) { t = h("div", { class: "toast", role: "status" }); document.body.appendChild(t); }
    t.textContent = msg; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 4500);
  };
  PL.download = (name, text, type) => {
    const a = h("a", { href: URL.createObjectURL(new Blob([text], { type: type || "application/json" })), download: name });
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
  PL.needName = () => {
    if (PL.settings.name) return PL.settings.name;
    const n = (window.prompt("Your name (recorded on accepts and approvals):") || "").trim().slice(0, 60);
    if (n) { PL.settings.name = n; PL.saveSettings(); }
    return n;
  };
  /* A simple table: rows of objects, columns [{key,label}|{label, render(row)}]. */
  PL.table = (cols, rows, cls) => h("div", { class: "table-scroll" }, h("table", { class: "grid " + (cls || "") },
    h("thead", {}, h("tr", {}, cols.map(c => h("th", { text: c.label })))),
    h("tbody", {}, rows.map(r => h("tr", {}, cols.map(c => {
      const v = c.render ? c.render(r) : r[c.key];
      return h("td", { class: c.cls || "" }, v == null ? "" : (typeof v === "object" && v.nodeType ? v : (Array.isArray(v) ? v.join(", ") : String(v))));
    }))))));
  PL.kv = pairs => h("dl", { class: "kv" }, pairs.filter(p => p && p[1] != null && p[1] !== "").map(p => [h("dt", { text: p[0] }), h("dd", {}, typeof p[1] === "object" && p[1].nodeType ? p[1] : String(p[1]))]));
  PL.section = (title, ...kids) => h("section", { class: "card panel" }, h("h2", { class: "sec-title", text: title }), ...kids);
  PL.sev = s => PL.badge({ high: "rejected", medium: "reopened", low: "complete" }[s] || "drafting", s || "info");

  /* A tiny Markdown reader for the SWD files: headings, lists, tables, code, paragraphs. Text only. */
  PL.md = function (text) {
    const out = h("div", { class: "md" }), lines = String(text || "").split(/\r?\n/);
    let i = 0;
    const inline = s => {
      const frag = document.createDocumentFragment();
      String(s).split(/(`[^`]+`|\*\*[^*]+\*\*)/).forEach(part => {
        if (/^`[^`]+`$/.test(part)) frag.appendChild(h("code", { text: part.slice(1, -1) }));
        else if (/^\*\*[^*]+\*\*$/.test(part)) frag.appendChild(h("strong", { text: part.slice(2, -2) }));
        else if (part) frag.appendChild(document.createTextNode(part));
      });
      return frag;
    };
    while (i < lines.length) {
      const l = lines[i];
      if (/^```/.test(l)) { const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; out.appendChild(h("pre", { text: buf.join("\n") })); continue; }
      const hm = l.match(/^(#{1,4})\s+(.*)/);
      if (hm) { out.appendChild(h("h" + Math.min(6, hm[1].length + 2), {}, inline(hm[2]))); i++; continue; }
      if (/^\|/.test(l)) {
        const rows = []; while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
        const cells = r => r.replace(/^\||\|$/g, "").split("|").map(c => c.trim());
        const body = rows.filter((r, k) => k !== 1 || !/^\|[\s:|-]+\|?$/.test(r));
        out.appendChild(h("div", { class: "table-scroll" }, h("table", { class: "grid" },
          h("thead", {}, h("tr", {}, cells(body[0]).map(c => h("th", {}, inline(c))))),
          h("tbody", {}, body.slice(1).map(r => h("tr", {}, cells(r).map(c => h("td", {}, inline(c)))))))));
        continue;
      }
      if (/^\s*[-*]\s+/.test(l)) { const ul = h("ul"); while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) ul.appendChild(h("li", {}, inline(lines[i++].replace(/^\s*[-*]\s+/, "")))); out.appendChild(ul); continue; }
      if (/^\s*\d+\.\s+/.test(l)) { const ol = h("ol"); while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) ol.appendChild(h("li", {}, inline(lines[i++].replace(/^\s*\d+\.\s+/, "")))); out.appendChild(ol); continue; }
      if (!l.trim()) { i++; continue; }
      const buf = []; while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\||```|\s*[-*]\s|\s*\d+\.\s)/.test(lines[i])) buf.push(lines[i++]);
      out.appendChild(h("p", {}, inline(buf.join(" "))));
    }
    return out;
  };
})();
