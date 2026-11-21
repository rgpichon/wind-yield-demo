/* Wind-yield site shell — full-bleed maps, floating controls, shared state */

(function () {
  "use strict";

  var UI = window.WindUI;
  var WindMap = window.WindMap;

  var DRAFT_THESIS =
    "Open weather data reproduces the timing of offshore wind output, but overstates the level by about a fifth until calibrated.";

  var MONTH_LABELS = [
    "All year",
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  var viewState = {
    turbine: "offshore_reference",
    layer: "raw",
    month: "all",
    metric: "cf",
    selectedCell: null,
  };

  var maps = [];
  var modelMap = null;
  var dashMap = null;
  var outputFactor = null;
  var outputRange = null;
  var dataReady = false;
  var activeTab = "dashboard";

  function initTabs() {
    var tabs = document.querySelectorAll(".nav-tab");
    var panels = document.querySelectorAll(".tab-panel");
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var id = tab.getAttribute("data-tab");
        activeTab = id;
        tabs.forEach(function (t) {
          t.setAttribute("aria-selected", t === tab ? "true" : "false");
        });
        panels.forEach(function (p) {
          p.setAttribute("data-active", p.id === "panel-" + id ? "true" : "false");
        });
        requestAnimationFrame(function () {
          maps.forEach(function (m) {
            m.resize();
            m.draw();
          });
        });
      });
    });
  }

  function monthSliderValue() {
    if (viewState.month === "all" || viewState.month == null) return 0;
    return Number(viewState.month);
  }

  function setMonthFromSlider(v) {
    viewState.month = Number(v) === 0 ? "all" : String(Number(v));
  }

  function activeMap() {
    return activeTab === "wind-model" ? modelMap : dashMap;
  }

  function onControlsChange() {
    maps.forEach(function (m) {
      m.invalidateCells();
      if (m === modelMap) m.setMetric(viewState.metric);
      else m.refresh();
    });
    renderSelectedPoint();
    var hoverHost = document.getElementById("dash-hover-readout");
    if (hoverHost && viewState.selectedCell && dashMap && dashMap.grid) {
      renderHoverReadout(
        dashMap.hoverPayload(viewState.selectedCell.lon, viewState.selectedCell.lat)
      );
    }
  }

  function segmentBlock(label, key, options) {
    var blk = UI.el("div", { className: "ctrl-block" });
    blk.appendChild(UI.el("span", { className: "ctrl-label", text: label }));
    var opts = UI.el("div", { className: "ctrl-segments", role: "group" });
    options.forEach(function (opt) {
      var btn = UI.el("button", {
        type: "button",
        className: "ctrl-seg",
        text: opt.label,
      });
      btn.setAttribute("aria-pressed", viewState[key] === opt.value ? "true" : "false");
      btn.addEventListener("click", function () {
        viewState[key] = opt.value;
        remountControls();
        onControlsChange();
      });
      opts.appendChild(btn);
    });
    blk.appendChild(opts);
    return blk;
  }

  function monthBlock() {
    var blk = UI.el("div", { className: "ctrl-block ctrl-block--month" });
    blk.appendChild(UI.el("span", { className: "ctrl-label", text: "Month" }));
    var row = UI.el("div", { className: "ctrl-month-row" });
    var slider = UI.el("input", {
      type: "range",
      min: "0",
      max: "12",
      step: "1",
      className: "ctrl-month-slider",
      value: String(monthSliderValue()),
    });
    var lab = UI.el("span", {
      className: "ctrl-month-label",
      text: MONTH_LABELS[monthSliderValue()],
    });
    slider.addEventListener("input", function () {
      setMonthFromSlider(slider.value);
      lab.textContent = MONTH_LABELS[monthSliderValue()];
      document.querySelectorAll(".ctrl-month-slider").forEach(function (el) {
        if (el !== slider) el.value = slider.value;
      });
      document.querySelectorAll(".ctrl-month-label").forEach(function (el) {
        el.textContent = MONTH_LABELS[monthSliderValue()];
      });
      onControlsChange();
    });
    row.appendChild(slider);
    row.appendChild(lab);
    blk.appendChild(row);
    return blk;
  }

  function toolButton(label, className, onClick) {
    var btn = UI.el("button", {
      type: "button",
      className: className || "ctrl-reset",
      text: label,
    });
    btn.addEventListener("click", onClick);
    return btn;
  }

  function buildControls(opts) {
    var includeMetric = !!opts.includeMetric;
    var includeExpand = !!opts.includeExpand;
    var short = !!opts.short;
    var modelMode = !!opts.modelMode;
    var wrap = UI.el("div", { className: "map-controls-inner" });

    if (modelMode) {
      var layerWrap = UI.el("div", { className: "map-layer-toggle" });
      layerWrap.appendChild(
        UI.el("span", { className: "ctrl-label", text: "Map" })
      );
      var segs = UI.el("div", { className: "ctrl-segments", role: "group" });
      [
        { value: "cells", label: "Cells (pilot box)" },
        { value: "countries", label: "Countries" },
      ].forEach(function (opt) {
        var active =
          (modelMap && modelMap.mapLayer === opt.value) ||
          (!modelMap && opt.value === "cells");
        var btn = UI.el("button", {
          type: "button",
          className: "ctrl-seg",
          text: opt.label,
        });
        btn.setAttribute("aria-pressed", active ? "true" : "false");
        btn.setAttribute("data-map-layer", opt.value);
        btn.addEventListener("click", function () {
          if (!modelMap) return;
          modelMap.setMapLayer(opt.value);
          remountControls();
        });
        segs.appendChild(btn);
      });
      layerWrap.appendChild(segs);
      wrap.appendChild(layerWrap);
      wrap.appendChild(monthBlock());
    } else {
      var gridGroup = UI.el("div", { className: "map-grid-toggles" });
      gridGroup.appendChild(
        segmentBlock(short ? "Turb." : "Turbine", "turbine", [
          { value: "onshore_reference", label: short ? "On" : "Onshore" },
          { value: "offshore_reference", label: short ? "Off" : "Offshore" },
        ])
      );
      gridGroup.appendChild(
        segmentBlock("Layer", "layer", [
          { value: "raw", label: "Raw" },
          { value: "calibrated", label: short ? "Cal." : "Calibrated" },
        ])
      );
      if (includeMetric) {
        gridGroup.appendChild(
          segmentBlock("Metric", "metric", [
            { value: "cf", label: "CF" },
            { value: "hub_speed", label: short ? "Speed" : "Hub speed" },
          ])
        );
      }
      wrap.appendChild(gridGroup);
      wrap.appendChild(monthBlock());
    }
    wrap.appendChild(
      toolButton("−", "ctrl-reset ctrl-zoom", function () {
        var m = activeMap();
        if (m) m.zoomBy(1 / 1.15);
      })
    );
    wrap.appendChild(
      toolButton("+", "ctrl-reset ctrl-zoom", function () {
        var m = activeMap();
        if (m) m.zoomBy(1.15);
      })
    );
    wrap.appendChild(
      toolButton(short ? "Reset" : "Reset view", "ctrl-reset", function () {
        var m = activeMap();
        if (m) {
          if (m.role === "model" && window.PlaceSelection) {
            window.PlaceSelection.clear("reset-view");
          }
          m.resetView();
        }
      })
    );
    if (includeExpand) {
      wrap.appendChild(
        toolButton("Expand", "ctrl-reset ctrl-expand", function () {
          toggleExpand();
        })
      );
    }
    return wrap;
  }

  function remountControls() {
    var dash = document.getElementById("dash-controls");
    var model = document.getElementById("model-controls");
    if (dash) {
      dash.innerHTML = "";
      dash.appendChild(buildControls({ includeMetric: false, includeExpand: true, short: false }));
    }
    if (model) {
      model.innerHTML = "";
      model.appendChild(
        buildControls({
          includeMetric: false,
          includeExpand: false,
          short: true,
          modelMode: true,
        })
      );
    }
    syncExpandButtons();
  }

  function toggleExpand() {
    document.querySelectorAll(".map-bleed").forEach(function (el) {
      el.classList.toggle("map-bleed--expanded");
    });
    syncExpandButtons();
    requestAnimationFrame(function () {
      maps.forEach(function (m) {
        m.resize();
        m.draw();
      });
    });
  }

  function collapseExpand() {
    var any = false;
    document.querySelectorAll(".map-bleed.map-bleed--expanded").forEach(function (el) {
      el.classList.remove("map-bleed--expanded");
      any = true;
    });
    if (!any) return;
    syncExpandButtons();
    requestAnimationFrame(function () {
      maps.forEach(function (m) {
        m.resize();
        m.draw();
      });
    });
  }

  function syncExpandButtons() {
    var expanded = !!document.querySelector(".map-bleed--expanded");
    document.querySelectorAll(".ctrl-expand").forEach(function (btn) {
      btn.textContent = expanded ? "Collapse" : "Expand";
    });
  }

  function bindPanelToggles() {
    document.querySelectorAll(".map-panel-toggle").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var panel = btn.closest(".map-panel");
        if (!panel) return;
        panel.classList.toggle("is-open");
        var open = panel.classList.contains("is-open");
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        btn.textContent = open ? "▾" : "▸";
      });
    });
  }

  function updateLegend(el, info) {
    if (!el || !info) return;
    var vmin = Number(info.vmin);
    var vmax = Number(info.vmax);
    var mid = (vmin + vmax) / 2;
    var titleEl = el.querySelector("[data-legend-title]");
    var minEl = el.querySelector("[data-legend-min]");
    var midEl = el.querySelector("[data-legend-mid]");
    var maxEl = el.querySelector("[data-legend-max]");
    var scaleEl = el.querySelector("[data-legend-scale]");
    var isCountries = info.layer === "countries";
    var isCells = info.layer === "cells";
    var isSpeed = info.metric === "hub_speed";
    var title = info.title
      ? info.title
      : isSpeed
        ? "Hub speed (m/s)"
        : "Capacity factor";
    if (!info.title) {
      if (info.layer === "calibrated" && info.turbine === "onshore_reference") {
        title += " · Calibrated (offshore factor)";
      } else {
        title += " · " + (info.layer === "calibrated" ? "calibrated" : "raw");
      }
    }
    if (titleEl) titleEl.textContent = title;
    if (info.hideScale) {
      if (minEl) minEl.textContent = "";
      if (midEl) midEl.textContent = "";
      if (maxEl) maxEl.textContent = "";
    } else {
      if (minEl) minEl.textContent = vmin.toFixed(2);
      if (midEl) midEl.textContent = mid.toFixed(2);
      if (maxEl) maxEl.textContent = vmax.toFixed(2);
    }
    if (scaleEl) {
      if (isCountries || isCells) {
        scaleEl.textContent =
          info.note ||
          "ERA5 reads low at tall masts; cell normals corrected for period only if the test says so";
      } else {
        scaleEl.textContent =
          "Scale " +
          vmin.toFixed(2) +
          "–" +
          vmax.toFixed(2) +
          (isSpeed ? " m/s" : " CF") +
          " (fixed raw range; calibrated values map lower)";
      }
    }
    var swatches = el.querySelector(".map-legend-swatches");
    if (swatches) swatches.hidden = !!(isCountries || isCells);
  }

  function renderHoverReadout(payload) {
    var host = document.getElementById("dash-hover-readout");
    if (!host) return;
    var body = host.querySelector(".map-panel-body");
    if (!body) return;
    body.innerHTML = "";

    if (!dataReady && !(dashMap && dashMap.grid)) {
      body.appendChild(UI.emptyState("Data not loaded"));
      return;
    }
    if (!payload) {
      body.appendChild(
        UI.el("p", {
          className: "caption",
          text: "Move over the map for cell values.",
        })
      );
      return;
    }

    var lines = [
      "lat " + payload.lat.toFixed(2) + ", lon " + payload.lon.toFixed(2),
    ];
    var label = payload.metric === "hub_speed" ? "Hub speed" : "CF";
    var valTxt =
      payload.value == null
        ? "—"
        : Number(payload.value).toFixed(payload.metric === "hub_speed" ? 2 : 3);
    lines.push(label + ": " + valTxt);
    if (payload.range) {
      lines.push(
        "Range: [" +
          payload.range.low.toFixed(3) +
          ", " +
          payload.range.high.toFixed(3) +
          "]"
      );
    }
    if (payload.metric !== "hub_speed") {
      lines.push(
        "Hub speed: " +
          (payload.hubSpeed == null ? "—" : Number(payload.hubSpeed).toFixed(2) + " m/s")
      );
    }
    if (payload.farm) {
      lines.push(
        "Nearest farm: " + payload.farm.name + " (" + payload.farmKm.toFixed(1) + " km)"
      );
    }
    lines.forEach(function (line) {
      body.appendChild(UI.el("p", { className: "body-text readout-line", text: line }));
    });
    body.appendChild(
      UI.el("p", {
        className: "caption readout-note",
        text: "ERA5 2015–2021 climatology; calibrated = raw × kpis.json output factor.",
      })
    );
  }

  function mountThesis() {
    var host = document.getElementById("dash-thesis");
    if (!host) return;
    host.appendChild(UI.badge("draft", "DRAFT"));
    var p = UI.el("p", { className: "body-text", text: DRAFT_THESIS });
    p.style.marginTop = "8px";
    host.appendChild(p);
  }

  function fillBadgeLegend(host) {
    if (!host) return;
    host.innerHTML = "";
    var wrap = UI.el("div", { className: "badge-legend badge-legend--compact" });
    [
      ["validated", "Validated: UK offshore, 2020-21"],
      ["indicative", "Indicative: onshore and Germany, not validated"],
      ["estimate", "Model estimate"],
    ].forEach(function (pair) {
      var item = UI.el("div", { className: "badge-legend-item" });
      item.appendChild(UI.badge(pair[0], pair[1]));
      wrap.appendChild(item);
    });
    host.appendChild(wrap);
  }

  function mountBadgeLegend() {
    fillBadgeLegend(document.querySelector("[data-badge-legend-dash]"));
    fillBadgeLegend(document.querySelector("[data-badge-legend-model]"));
  }

  function setPageAsof(text) {
    document.querySelectorAll("[data-page-asof]").forEach(function (el) {
      el.textContent = "Data as of " + (text || "—");
    });
  }

  function kpiNote(kpi) {
    var parts = [];
    if (kpi.range && kpi.range.low != null && kpi.range.high != null) {
      parts.push(kpi.range.note || "95% bootstrap interval");
    }
    if (kpi.sublabel) parts.push(kpi.sublabel);
    if (kpi.unit) parts.push(kpi.unit);
    return parts.join(" · ");
  }

  function loadKpis() {
    var strip = document.getElementById("kpi-strip");
    if (!strip) return;
    fetch("data/kpis.json")
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (doc) {
        strip.innerHTML = "";
        (doc.kpis || []).forEach(function (kpi) {
          strip.appendChild(UI.kpiTile(kpi.label, UI.formatKpiValue(kpi), kpiNote(kpi)));
          if (kpi.id === "output_factor") {
            outputFactor = kpi.value != null ? Number(kpi.value) : null;
            outputRange =
              kpi.range && kpi.range.low != null
                ? { low: Number(kpi.range.low), high: Number(kpi.range.high) }
                : null;
          }
        });
        var meta = document.getElementById("kpi-source-line");
        if (meta) {
          meta.replaceWith(
            UI.sourceLine(
              doc.data_as_of_utc || "—",
              "calibration v1/v2 outputs (see site/data/kpis.json citations)"
            )
          );
        }
        if (doc.data_as_of_utc) setPageAsof(doc.data_as_of_utc);
        renderSelectionPanel();
      })
      .catch(function () {
        strip.innerHTML = "";
        strip.appendChild(UI.emptyState("Data not loaded"));
      });
  }

  function afterMapReady() {
    dataReady = !!(dashMap && dashMap.grid) || !!(modelMap && modelMap.grid);
    var grid = (dashMap && dashMap.grid) || (modelMap && modelMap.grid);
    if (grid && grid.built_utc) setPageAsof(grid.built_utc);
    renderSelectionPanel();
    if (viewState.selectedCell && dashMap && dashMap.grid) {
      renderHoverReadout(
        dashMap.hoverPayload(viewState.selectedCell.lon, viewState.selectedCell.lat)
      );
    } else {
      renderHoverReadout(null);
    }
    maps.forEach(function (m) {
      m.resize();
      m.draw();
    });
  }

  function mountMaps() {
    var dashCanvas = document.getElementById("dash-map-canvas");
    var modelCanvas = document.getElementById("model-map-canvas");
    if (!WindMap || !dashCanvas || !modelCanvas) return;

    var readyCount = 0;
    function onOneReady() {
      readyCount += 1;
      if (readyCount >= 2) afterMapReady();
    }

    dashMap = new WindMap({
      canvas: dashCanvas,
      state: viewState,
      role: "dashboard",
      onSelect: function () {
        renderSelectedPoint();
        maps.forEach(function (m) {
          m.draw();
        });
        if (viewState.selectedCell) {
          renderHoverReadout(
            dashMap.hoverPayload(viewState.selectedCell.lon, viewState.selectedCell.lat)
          );
        }
      },
      onHover: function (payload) {
        renderHoverReadout(payload);
      },
      onLegend: function (info) {
        updateLegend(document.getElementById("dash-legend"), info);
      },
      onReady: onOneReady,
    });
    modelMap = new WindMap({
      canvas: modelCanvas,
      state: viewState,
      role: "model",
      mapLayer: "cells",
      metric: viewState.metric,
      onSelect: function () {
        renderSelectionPanel();
        maps.forEach(function (m) {
          m.draw();
        });
      },
      onPlaceSelect: function (id, type, cell) {
        if (window.PlaceSelection) {
          window.PlaceSelection.set(id, type, "map", cell || null);
        }
      },
      onHover: function () {},
      onLegend: function (info) {
        updateLegend(document.getElementById("model-legend"), info);
      },
      onReady: function () {
        remountControls();
        onOneReady();
      },
    });
    maps = [dashMap, modelMap];
    maps.forEach(function (m) {
      m.load();
    });
  }

  function fillWindPlaceSelect() {
    var sel = document.getElementById("wind-place-select");
    if (!sel) return;
    var places =
      (window.WindGenPanel && window.WindGenPanel.places && window.WindGenPanel.places()) ||
      [];
    if (!places.length) {
      // try index from fetch once
      fetch("data/windgen/index.json")
        .then(function (r) {
          return r.json();
        })
        .then(function (idx) {
          places = idx.places || [];
          populatePlaceSelect(sel, places);
        })
        .catch(function () {});
      return;
    }
    populatePlaceSelect(sel, places);
  }

  function populatePlaceSelect(sel, places) {
    sel.innerHTML = "";
    var europe = document.createElement("option");
    europe.value = "";
    europe.textContent = "Europe (overview)";
    sel.appendChild(europe);
    var cg = document.createElement("optgroup");
    cg.label = "Countries";
    var pg = document.createElement("optgroup");
    pg.label = "Points";
    places.forEach(function (p) {
      var o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.name + " (" + p.id + ")";
      if (p.type === "point") pg.appendChild(o);
      else cg.appendChild(o);
    });
    sel.appendChild(cg);
    sel.appendChild(pg);
    var cur = window.PlaceSelection ? window.PlaceSelection.get() : { id: null };
    sel.value = cur.id || "";
  }

  function initPlaceSelector() {
    var sel = document.getElementById("wind-place-select");
    var eur = document.getElementById("wind-place-europe");
    if (!sel) return;
    fillWindPlaceSelect();
    sel.addEventListener("change", function () {
      var id = sel.value;
      if (!id) {
        if (window.PlaceSelection) window.PlaceSelection.clear("dropdown");
        return;
      }
      var places =
        (window.WindGenPanel && window.WindGenPanel.places && window.WindGenPanel.places()) ||
        [];
      var meta = places.find(function (p) {
        return p.id === id;
      });
      var type = meta ? meta.type : id.charAt(0) === "P" ? "point" : "country";
      if (window.PlaceSelection) window.PlaceSelection.set(id, type, "dropdown");
    });
    if (eur) {
      eur.addEventListener("click", function () {
        sel.value = "";
        if (window.PlaceSelection) window.PlaceSelection.clear("europe-btn");
      });
    }
    if (window.PlaceSelection) {
      window.PlaceSelection.onChange(function (s, source) {
        if (source !== "dropdown") {
          if (s.type === "cell") {
            var lab =
              s.cell &&
              "Cell " +
                Number(s.cell.lat).toFixed(2) +
                " N, " +
                Number(s.cell.lon).toFixed(2) +
                " E";
            var opt = sel.querySelector('option[data-cell-label="1"]');
            if (lab) {
              if (!opt) {
                opt = document.createElement("option");
                opt.setAttribute("data-cell-label", "1");
                sel.insertBefore(opt, sel.firstChild.nextSibling);
              }
              opt.value = s.id;
              opt.textContent = lab;
              sel.value = s.id;
            }
          } else {
            var stale = sel.querySelector('option[data-cell-label="1"]');
            if (stale) stale.remove();
            sel.value = s.id || "";
          }
        }
        if (modelMap) {
          if (s.type === "cell" && s.cell) {
            viewState.selectedCell = s.cell;
            modelMap.fitBounds(
              s.cell.lat - 1.5,
              s.cell.lat + 1.5,
              s.cell.lon - 2,
              s.cell.lon + 2,
              0
            );
          } else if (s.type === "country" || s.type === "point") {
            viewState.selectedCell = null;
            modelMap.zoomToPlace(s.id, s.type);
          } else {
            viewState.selectedCell = null;
            modelMap.resetView();
          }
          modelMap.draw();
        }
        renderSelectionPanel();
      });
    }
  }

  function renderSelectionPanel() {
    var host = document.getElementById("selected-point-panel");
    if (!host) return;
    host.innerHTML = "";
    var meta = document.getElementById("selected-point-meta");
    var place = window.PlaceSelection
      ? window.PlaceSelection.get()
      : { type: null };
    var cells = modelMap && modelMap.cells;

    if (place.type === "cell" && place.cell && cells) {
      var cell = place.cell;
      var flat = cell.flat;
      var surf = cells.surface_codes[String(cells.surface[flat])] || "—";
      var drv = cells.countries[cells.driver[flat]] || "—";
      var clim = [];
      for (var i = 0; i < 12; i++) clim.push(cells.clim[flat * 12 + i] / 100);
      var ann =
        clim.reduce(function (a, b) {
          return a + b;
        }, 0) / 12;
      host.appendChild(
        UI.el("p", {
          className: "caption",
          text:
            "Cell " +
            Number(cell.lat).toFixed(2) +
            " N, " +
            Number(cell.lon).toFixed(2) +
            " E",
        })
      );
      var ul = UI.el("ul", { className: "body-text point-metrics" });
      [
        "Surface: " + surf,
        "Driver country: " + drv,
        "Annual normal 100 m: " + ann.toFixed(2) + " m/s",
      ].forEach(function (line) {
        ul.appendChild(UI.el("li", { text: line }));
      });
      host.appendChild(ul);
      host.appendChild(
        UI.el("h4", { className: "map-side-title", text: "Normal year" })
      );
      var bars = UI.el("div", { className: "month-bars" });
      var maxS = Math.max.apply(null, clim) || 1;
      clim.forEach(function (v, idx) {
        var col = UI.el("div", { className: "month-bar-col" });
        var bar = UI.el("div", { className: "month-bar" });
        bar.style.height = Math.round((100 * v) / maxS) + "%";
        col.appendChild(bar);
        col.appendChild(
          UI.el("span", { className: "caption", text: String(idx + 1) })
        );
        bars.appendChild(col);
      });
      host.appendChild(bars);
      if (meta) {
        meta.textContent =
          "Data as of " +
          ((cells.meta && cells.meta.built_utc) || "—") +
          " · " +
          ((cells.meta && cells.meta.label) || "cells");
      }
      return;
    }

    if (place.type === "country" || place.type === "point") {
      var name = place.id;
      if (modelMap && modelMap.countries) {
        if (place.type === "point") {
          var pt = (modelMap.countries.points || []).find(function (p) {
            return p.id === place.id;
          });
          if (pt) name = pt.name + " (" + pt.id + ")";
        } else {
          var ft = (modelMap.countries.features || []).find(function (f) {
            return f.windgen_id === place.id;
          });
          if (ft) name = ft.name + " (" + place.id + ")";
        }
      }
      host.appendChild(
        UI.el("p", {
          className: "caption",
          text: (place.type === "point" ? "Point · " : "Country · ") + name,
        })
      );
      host.appendChild(
        UI.el("p", {
          className: "body-text",
          text: "Projection panel below shows the WindGen path for this place.",
        })
      );
      if (meta) {
        meta.textContent =
          "Data as of " +
          ((modelMap &&
            modelMap.countries &&
            modelMap.countries.built_utc) ||
            "—") +
          " · WindGen place series";
      }
      return;
    }

    host.appendChild(UI.emptyState("Select a country, point or cell"));
    if (meta) meta.textContent = "Data as of — · Source: —";
  }

  function renderSelectedPoint() {
    renderSelectionPanel();
  }

  document.addEventListener("DOMContentLoaded", function () {
    initTabs();
    mountThesis();
    mountBadgeLegend();
    remountControls();
    bindPanelToggles();
    loadKpis();
    renderHoverReadout(null);
    setPageAsof("—");
    mountMaps();
    if (window.WindGenPanel) {
      window.WindGenPanel.init();
      setTimeout(fillWindPlaceSelect, 200);
      setTimeout(fillWindPlaceSelect, 800);
    }
    initPlaceSelector();
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") collapseExpand();
    });
  });
})();
