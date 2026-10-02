(function () {
  "use strict";

  var STAGE_MAP = {
    design: ["Parse", "Design"],
    derive: ["Functional", "FuSa"],
    execute: ["Execute"],
    observe: ["Observe"],
    closeloop: ["Agent"],
  };

  function initScrollSpy() {
    var nav = document.querySelector(".page-nav");
    if (!nav) return;
    var links = Array.prototype.slice.call(nav.querySelectorAll('a[href^="#"]'));
    var sections = links
      .map(function (a) {
        return document.querySelector(a.getAttribute("href"));
      })
      .filter(Boolean);

    if (!sections.length) return;

    function setActive(id) {
      links.forEach(function (a) {
        var on = a.getAttribute("href") === "#" + id;
        a.classList.toggle("is-active", on);
        if (on) a.setAttribute("aria-current", "location");
        else a.removeAttribute("aria-current");
      });
    }

    var observer = new IntersectionObserver(
      function (entries) {
        var visible = entries
          .filter(function (e) {
            return e.isIntersecting;
          })
          .sort(function (a, b) {
            return b.intersectionRatio - a.intersectionRatio;
          });
        if (visible[0] && visible[0].target.id) {
          setActive(visible[0].target.id);
        }
      },
      { rootMargin: "-20% 0px -55% 0px", threshold: [0.1, 0.25, 0.5] }
    );

    sections.forEach(function (s) {
      observer.observe(s);
    });
  }

  function runtimeKind(text) {
    var t = (text || "").toLowerCase();
    if (t.indexOf("hil") !== -1 && t.indexOf("python") === -1) return "hil";
    if (t.indexOf("ollama") !== -1) return "ollama";
    if (t.indexOf("rule") !== -1 || t.indexOf("vs code") !== -1) return "rule";
    if (t.indexOf("api") !== -1 || t.indexOf("azure") !== -1 || t.indexOf("openai") !== -1)
      return "api";
    if (t.indexOf("hil") !== -1) return "hil";
    return "rule";
  }

  function decorateRuntimeCells() {
    var cells = document.querySelectorAll("table.data tbody tr td:last-child");
    cells.forEach(function (td) {
      if (td.querySelector(".rt-cell")) return;
      var raw = td.textContent.trim();
      var kind = runtimeKind(raw);
      var wrap = document.createElement("span");
      wrap.className = "rt-cell mono";
      var dot = document.createElement("span");
      dot.className = "dot dot-" + kind;
      dot.setAttribute("aria-hidden", "true");
      var label = document.createElement("span");
      label.textContent = raw;
      wrap.appendChild(dot);
      wrap.appendChild(label);
      td.textContent = "";
      td.appendChild(wrap);
    });
  }

  function initPipelineFilter() {
    var strip = document.querySelector(".pipeline-strip");
    var table = document.querySelector("table.data");
    var hint = document.getElementById("table-filter-hint");
    if (!strip || !table) return;

    var buttons = Array.prototype.slice.call(strip.querySelectorAll(".stage-btn"));
    var rows = Array.prototype.slice.call(table.querySelectorAll("tbody tr"));
    var activeKey = null;

    function applyFilter(key) {
      activeKey = key;
      buttons.forEach(function (btn) {
        var on = btn.getAttribute("data-stage") === key;
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
      });

      if (!key) {
        rows.forEach(function (row) {
          row.classList.remove("is-dimmed", "is-focus");
        });
        if (hint) hint.textContent = "";
        return;
      }

      var match = STAGE_MAP[key] || [];
      var labels = match.join(", ");
      rows.forEach(function (row) {
        var stage = row.getAttribute("data-stage") || "";
        var on = match.indexOf(stage) !== -1;
        row.classList.toggle("is-focus", on);
        row.classList.toggle("is-dimmed", !on);
      });
      if (hint) {
        hint.textContent =
          "Showing stages: " + labels + " — click the same step again to clear.";
      }
    }

    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var key = btn.getAttribute("data-stage");
        if (activeKey === key) applyFilter(null);
        else applyFilter(key);
      });
    });
  }

  function setPrintUrl() {
    var el = document.querySelector(".print-url");
    if (el) el.textContent = location.href;
  }

  document.addEventListener("DOMContentLoaded", function () {
    initScrollSpy();
    decorateRuntimeCells();
    initPipelineFilter();
    setPrintUrl();
  });
})();
