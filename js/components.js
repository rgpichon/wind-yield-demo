/* Small reusable UI pieces. No data hard-coding. */

(function (global) {
  "use strict";

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "className") node.className = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function badge(kind, text) {
    var map = {
      validated: "badge--validated",
      indicative: "badge--indicative",
      estimate: "badge--estimate",
      draft: "badge--draft",
    };
    return el("span", { className: "badge " + (map[kind] || "badge--estimate"), text: text });
  }

  function card(title, bodyNodes, metaText) {
    var c = el("div", { className: "card" });
    if (title) c.appendChild(el("h3", { className: "card-title", text: title }));
    (bodyNodes || []).forEach(function (n) {
      c.appendChild(n);
    });
    if (metaText) c.appendChild(el("p", { className: "card-meta", text: metaText }));
    return c;
  }

  function kpiTile(label, valueText, note) {
    var t = el("div", { className: "kpi-tile" });
    t.appendChild(el("div", { className: "stat-label", text: label }));
    t.appendChild(el("div", { className: "stat-value", text: valueText }));
    if (note) t.appendChild(el("div", { className: "stat-note", text: note }));
    return t;
  }

  function sourceLine(asOf, source) {
    return el("p", {
      className: "card-meta",
      text: "Data as of " + asOf + " · Source: " + source,
    });
  }

  function emptyState(msg) {
    return el("div", { className: "empty-state", text: msg || "Data not loaded" });
  }

  function toggleGroup(config, state, onChange) {
    /* config: [{key, label, options:[{value,label}]}] */
    var wrap = el("div", { className: "toggle-group", role: "group" });
    config.forEach(function (block) {
      var blk = el("div", { className: "toggle-block" });
      blk.appendChild(el("label", { text: block.label }));
      var opts = el("div", { className: "toggle-options" });
      block.options.forEach(function (opt) {
        var btn = el("button", {
          type: "button",
          className: "toggle-btn",
          "data-key": block.key,
          "data-value": opt.value,
          text: opt.label,
        });
        btn.setAttribute("aria-pressed", state[block.key] === opt.value ? "true" : "false");
        btn.addEventListener("click", function () {
          state[block.key] = opt.value;
          opts.querySelectorAll(".toggle-btn").forEach(function (b) {
            b.setAttribute(
              "aria-pressed",
              b.getAttribute("data-value") === state[block.key] ? "true" : "false"
            );
          });
          if (onChange) onChange(Object.assign({}, state));
        });
        opts.appendChild(btn);
      });
      blk.appendChild(opts);
      wrap.appendChild(blk);
    });
    return wrap;
  }

  function formatKpiValue(kpi) {
    if (kpi.value == null || Number.isNaN(kpi.value)) return "Data not loaded";
    if (kpi.id === "farms_validated") return String(kpi.value);
    if (kpi.id === "farm_mean_hourly_r") return Number(kpi.value).toFixed(3);
    if (kpi.id === "raw_model_obs_ratio") return Number(kpi.value).toFixed(3);
    if (kpi.id === "output_factor") {
      var s = Number(kpi.value).toFixed(4);
      if (kpi.range && kpi.range.low != null && kpi.range.high != null) {
        s += " [" + Number(kpi.range.low).toFixed(4) + "–" + Number(kpi.range.high).toFixed(4) + "]";
      }
      return s;
    }
    if (kpi.id === "calibrated_2021_bias") {
      var b = Number(kpi.value).toFixed(4);
      if (kpi.range && kpi.range.low != null && kpi.range.high != null) {
        b += " [" + Number(kpi.range.low).toFixed(4) + ", " + Number(kpi.range.high).toFixed(4) + "]";
      }
      return b;
    }
    return String(kpi.value);
  }

  global.WindUI = {
    el: el,
    badge: badge,
    card: card,
    kpiTile: kpiTile,
    sourceLine: sourceLine,
    emptyState: emptyState,
    toggleGroup: toggleGroup,
    formatKpiValue: formatKpiValue,
  };
})(window);
