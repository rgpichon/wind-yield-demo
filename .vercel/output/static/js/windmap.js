/* Plain canvas wind map — full-bleed context coast + ERA5 cells. No tiles. */

(function (global) {
  "use strict";

  var SCALES = {
    onshore_reference: { vmin: 0.15, vmax: 0.55 },
    offshore_reference: { vmin: 0.25, vmax: 0.65 },
  };
  var MAX_ZOOM = 12;
  var CONTEXT = { lat0: 34, lat1: 72, lon0: -25, lon1: 45 };
  var EUROPE = { lat0: 34, lat1: 72, lon0: -25, lon1: 45 };
  var MODEL = { lat0: 47, lat1: 59, lon0: -4, lon1: 15 };
  var DASH_VIEW = { lat0: 50, lat1: 59, lon0: -4, lon1: 11 };
  var HINT_MS = 1200;
  var HINT_COOLDOWN_MS = 2500;
  var SPEED_SCALE = { vmin: 3.0, vmax: 11.0 }; // fixed cell normal 100 m scale
  var CELL_SPEED_SCALE = { vmin: 3.0, vmax: 11.0 };

  function lerpColor(t) {
    t = Math.max(0, Math.min(1, t));
    var stops = [
      [247, 252, 240],
      [127, 205, 187],
      [29, 145, 192],
      [8, 48, 107],
    ];
    var x = t * (stops.length - 1);
    var i = Math.min(stops.length - 2, Math.floor(x));
    var f = x - i;
    var a = stops[i];
    var b = stops[i + 1];
    return [
      Math.round(a[0] + (b[0] - a[0]) * f),
      Math.round(a[1] + (b[1] - a[1]) * f),
      Math.round(a[2] + (b[2] - a[2]) * f),
    ];
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    var r = 6371;
    var p1 = (lat1 * Math.PI) / 180;
    var p2 = (lat2 * Math.PI) / 180;
    var dp = ((lat2 - lat1) * Math.PI) / 180;
    var dl = ((lon2 - lon1) * Math.PI) / 180;
    var a =
      Math.sin(dp / 2) * Math.sin(dp / 2) +
      Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function WindMap(opts) {
    this.canvas = opts.canvas;
    this.ctx = this.canvas.getContext("2d");
    this.state = opts.state;
    this.onSelect = opts.onSelect || function () {};
    this.onHover = opts.onHover || function () {};
    this.onReady = opts.onReady || function () {};
    this.onLegend = opts.onLegend || function () {};
    this.metric = opts.metric || "cf";
    this.role = opts.role || "dashboard"; // dashboard | model
    this.grid = null;
    this.coast = null;
    this.coastContext = null;
    this.farms = null;
    this.kpis = null;
    this.countries = null;
    this.countryNormals = null;
    this.cells = null;
    this.mapLayer =
      opts.mapLayer || (opts.role === "model" ? "cells" : "grid");
    this.outputFactor = null;
    this.outputRange = null;
    this.onPlaceSelect = opts.onPlaceSelect || function () {};
    this._bound = false;
    this._hoverCell = null;
    this.pad = { t: 0, r: 0, b: 0, l: 0 };
    this.zoom = 1;
    this.centerLon = null;
    this.centerLat = null;
    this._dragging = false;
    this._dragLast = null;
    this._didDrag = false;
    this._cellLayer = document.createElement("canvas");
    this._cellLayerKey = "";
    this._cellLayerBox = null;
    this._lastDrawMs = 0;
    this._minZoom = 1;
    this._hintTimer = null;
    this._hintLast = 0;
    this._anim = null;
    this._hoverCountry = null;
    this._hoverPoint = null;
    this._lastPointer = { x: 0, y: 0 };
  }

  WindMap.prototype.setMetric = function (m) {
    this.metric = m;
    this._cellLayerKey = "";
    this.draw();
  };

  WindMap.prototype.setRole = function (role) {
    this.role = role;
  };

  WindMap.prototype.resetView = function () {
    this.applyDefaultView();
    this.draw();
  };

  WindMap.prototype.applyDefaultView = function () {
    if (this.role === "model") {
      if (this.mapLayer === "cells") {
        this.fitBounds(MODEL.lat0, MODEL.lat1, MODEL.lon0, MODEL.lon1, 0.04);
      } else {
        this.fitBounds(EUROPE.lat0, EUROPE.lat1, EUROPE.lon0, EUROPE.lon1, 0);
      }
    } else {
      this.fitBounds(DASH_VIEW.lat0, DASH_VIEW.lat1, DASH_VIEW.lon0, DASH_VIEW.lon1, 0);
    }
  };

  WindMap.prototype.setMapLayer = function (layer) {
    if (layer === "cells" || layer === "countries") this.mapLayer = layer;
    else if (layer === "grid") this.mapLayer = "grid";
    else this.mapLayer = "cells";
    this._cellLayerKey = "";
    this.applyDefaultView();
    this.draw();
  };

  WindMap.prototype._zoomForBounds = function (lat0, lat1, lon0, lon1) {
    if (!this.cssW || !this.cssH) return 1;
    var midLat = ((lat0 + lat1) / 2) * (Math.PI / 180);
    var cos = Math.cos(midLat);
    var dataW = (lon1 - lon0) * cos;
    var dataH = lat1 - lat0;
    var fit = Math.min(this.cssW / dataW, this.cssH / dataH);
    var cMid = ((CONTEXT.lat0 + CONTEXT.lat1) / 2) * (Math.PI / 180);
    var cCos = Math.cos(cMid);
    var cW = (CONTEXT.lon1 - CONTEXT.lon0) * cCos;
    var cH = CONTEXT.lat1 - CONTEXT.lat0;
    var contextFit = Math.min(this.cssW / cW, this.cssH / cH);
    return Math.min(MAX_ZOOM, Math.max(0.05, fit / contextFit));
  };

  WindMap.prototype._defaultBounds = function () {
    if (this.role === "model") {
      if (this.mapLayer === "cells" || this.mapLayer === "grid") {
        var dlat = (MODEL.lat1 - MODEL.lat0) * 0.04;
        var dlon = (MODEL.lon1 - MODEL.lon0) * 0.04;
        return {
          lat0: MODEL.lat0 - dlat,
          lat1: MODEL.lat1 + dlat,
          lon0: MODEL.lon0 - dlon,
          lon1: MODEL.lon1 + dlon,
        };
      }
      return {
        lat0: EUROPE.lat0,
        lat1: EUROPE.lat1,
        lon0: EUROPE.lon0,
        lon1: EUROPE.lon1,
      };
    }
    return {
      lat0: DASH_VIEW.lat0,
      lat1: DASH_VIEW.lat1,
      lon0: DASH_VIEW.lon0,
      lon1: DASH_VIEW.lon1,
    };
  };

  WindMap.prototype.fitBounds = function (lat0, lat1, lon0, lon1, padFrac, opts) {
    opts = opts || {};
    padFrac = padFrac || 0;
    var dlat = (lat1 - lat0) * padFrac;
    var dlon = (lon1 - lon0) * padFrac;
    lat0 -= dlat;
    lat1 += dlat;
    lon0 -= dlon;
    lon1 += dlon;
    this.centerLon = (lon0 + lon1) / 2;
    this.centerLat = (lat0 + lat1) / 2;
    if (!this.cssW || !this.cssH) {
      this._pendingFit = {
        lat0: lat0,
        lat1: lat1,
        lon0: lon0,
        lon1: lon1,
        keepMinZoom: !!opts.keepMinZoom,
      };
      return;
    }
    var z = this._zoomForBounds(lat0, lat1, lon0, lon1);
    if (opts.keepMinZoom) {
      this.zoom = Math.min(MAX_ZOOM, Math.max(this._minZoom, z));
    } else {
      this.zoom = z;
      this._minZoom = this.zoom;
    }
    this._cellLayerKey = "";
    this._pendingFit = null;
    this._syncCursor();
  };

  WindMap.prototype.animateFitBounds = function (lat0, lat1, lon0, lon1, padFrac, ms) {
    ms = ms || 300;
    padFrac = padFrac == null ? 0.12 : padFrac;
    var dlat = (lat1 - lat0) * padFrac;
    var dlon = (lon1 - lon0) * padFrac;
    var tLat0 = lat0 - dlat;
    var tLat1 = lat1 + dlat;
    var tLon0 = lon0 - dlon;
    var tLon1 = lon1 + dlon;
    var toLon = (tLon0 + tLon1) / 2;
    var toLat = (tLat0 + tLat1) / 2;
    var toZoom = this._zoomForBounds(tLat0, tLat1, tLon0, tLon1);
    toZoom = Math.min(MAX_ZOOM, Math.max(this._minZoom, toZoom));
    var fromLon = this.centerLon;
    var fromLat = this.centerLat;
    var fromZoom = this.zoom;
    if (this._anim) cancelAnimationFrame(this._anim);
    var self = this;
    var t0 = performance.now();
    function step(now) {
      var u = Math.min(1, (now - t0) / ms);
      var e = u < 0.5 ? 2 * u * u : -1 + (4 - 2 * u) * u; // ease in-out
      self.centerLon = fromLon + (toLon - fromLon) * e;
      self.centerLat = fromLat + (toLat - fromLat) * e;
      self.zoom = fromZoom + (toZoom - fromZoom) * e;
      self._cellLayerKey = "";
      self.draw();
      if (u < 1) self._anim = requestAnimationFrame(step);
      else self._anim = null;
    }
    this._anim = requestAnimationFrame(step);
  };

  WindMap.prototype.zoomToPlace = function (id, type) {
    if (!id) {
      this.animateFitBounds(EUROPE.lat0, EUROPE.lat1, EUROPE.lon0, EUROPE.lon1, 0, 300);
      return;
    }
    if (type === "point" && this.countries && this.countries.points) {
      var pt = this.countries.points.find(function (p) {
        return p.id === id;
      });
      if (pt) {
        this.animateFitBounds(pt.lat - 1.5, pt.lat + 1.5, pt.lon - 1.5, pt.lon + 1.5, 0, 300);
      }
      return;
    }
    if (this.countries && this.countries.bboxes && this.countries.bboxes[id]) {
      var b = this.countries.bboxes[id];
      this.animateFitBounds(b.lat_min, b.lat_max, b.lon_min, b.lon_max, 0.12, 300);
    }
  };

  WindMap.prototype.isAtMinZoom = function () {
    return this.zoom <= this._minZoom + 1e-4;
  };

  WindMap.prototype._syncCursor = function () {
    if (!this.canvas) return;
    this.canvas.classList.toggle("is-min-zoom", this.isAtMinZoom());
  };

  WindMap.prototype.zoomBy = function (factor) {
    if (!this.cssW) return;
    this._zoomAt(this.cssW / 2, this.cssH / 2, factor);
  };

  WindMap.prototype._showZoomHint = function () {
    var root = this._chromeRoot();
    var hint = root.querySelector(".map-zoom-hint");
    if (!hint) return;
    var now = Date.now();
    if (now - this._hintLast < HINT_COOLDOWN_MS) return;
    this._hintLast = now;
    var isMac = /Mac|iPhone|iPad/.test(navigator.platform || "");
    hint.textContent = isMac
      ? "Use ⌘ + scroll to zoom"
      : "Use Ctrl + scroll to zoom";
    hint.hidden = false;
    clearTimeout(this._hintTimer);
    var self = this;
    this._hintTimer = setTimeout(function () {
      hint.hidden = true;
    }, HINT_MS);
  };

  WindMap.prototype.load = function () {
    var self = this;
    var jobs = [
      fetch("data/grid_v0.json").then(function (r) {
        if (!r.ok) throw new Error("grid");
        return r.json();
      }),
      fetch("data/coast.json").then(function (r) {
        if (!r.ok) throw new Error("coast");
        return r.json();
      }),
      fetch("data/coast_context.json").then(function (r) {
        if (!r.ok) throw new Error("coast_context");
        return r.json();
      }),
      fetch("data/farms.json").then(function (r) {
        if (!r.ok) throw new Error("farms");
        return r.json();
      }),
      fetch("data/kpis.json").then(function (r) {
        if (!r.ok) throw new Error("kpis");
        return r.json();
      }),
    ];
    if (this.role === "model") {
      jobs.push(
        fetch("data/countries.json").then(function (r) {
          if (!r.ok) throw new Error("countries");
          return r.json();
        }),
        fetch("data/windgen/country_normals.json").then(function (r) {
          if (!r.ok) throw new Error("normals");
          return r.json();
        }),
        fetch("data/windgen/cells.json").then(function (r) {
          if (!r.ok) throw new Error("cells");
          return r.json();
        })
      );
    }
    return Promise.all(jobs)
      .then(function (arr) {
        self.grid = arr[0];
        self.coast = arr[1];
        self.coastContext = arr[2];
        self.farms = arr[3];
        self.kpis = arr[4];
        if (arr[5]) self.countries = arr[5];
        if (arr[6]) self.countryNormals = arr[6];
        if (arr[7]) self.cells = arr[7];
        var of = (self.kpis.kpis || []).find(function (k) {
          return k.id === "output_factor";
        });
        self.outputFactor = of && of.value != null ? Number(of.value) : null;
        self.outputRange =
          of && of.range ? { low: of.range.low, high: of.range.high } : null;
        if (!self._bound) {
          self._bind();
          self._bound = true;
        }
        if (self.mapLayer === "grid") self._selectDefaultFarm();
        self.resize();
        self.applyDefaultView();
        self.draw();
        self._updateChrome();
        self.onReady(self);
      })
      .catch(function () {
        self.grid = null;
        self._showEmpty();
      });
  };

  WindMap.prototype._selectDefaultFarm = function () {
    if (this.state.selectedCell || !this.farms || !this.farms.farms) return;
    var hornsea = null;
    this.farms.farms.forEach(function (f) {
      if (/hornsea\s*one/i.test(f.name) || f.name === "HornseaOne") hornsea = f;
    });
    if (!hornsea) hornsea = this.farms.farms[0];
    if (!hornsea) return;
    var cell = this._nearestCell(hornsea.lon, hornsea.lat);
    if (!cell) return;
    this.state.selectedCell = {
      iy: cell.iy,
      ix: cell.ix,
      lat: cell.lat,
      lon: cell.lon,
      flat: cell.flat,
    };
  };

  WindMap.prototype._showEmpty = function () {
    var host = this.canvas.parentElement;
    if (!host) return;
    var msg = host.querySelector(".map-empty");
    if (!msg) {
      msg = document.createElement("div");
      msg.className = "map-empty empty-state";
      host.appendChild(msg);
    }
    msg.textContent = "Data not loaded";
  };

  WindMap.prototype._chromeRoot = function () {
    return this.canvas.closest(".map-bleed") || this.canvas.parentElement;
  };

  WindMap.prototype.badgeInfo = function () {
    if (this.state.turbine === "onshore_reference") {
      if (this.state.layer === "calibrated") {
        return {
          kind: "indicative",
          text: "Calibrated (offshore factor)",
        };
      }
      return { kind: "indicative", text: "Indicative: onshore not validated" };
    }
    if (this.state.layer === "calibrated") {
      return {
        kind: "validated",
        text:
          "Calibrated on UK offshore farms, 2020-21; cells away from those farms are extrapolations",
      };
    }
    return { kind: "estimate", text: "Model estimate (uncalibrated)" };
  };

  WindMap.prototype._updateChrome = function () {
    var root = this._chromeRoot();
    var srcEl = root.querySelector("[data-map-source]");
    var badgeEl = root.querySelector("[data-map-badge]");
    if (srcEl && this.grid) {
      var ys = this.grid.years || [];
      if (this.role === "model" && this.mapLayer === "cells") {
        srcEl.textContent =
          "WindGen cells (pilot box, 100 m) · Data as of " +
          ((this.cells && this.cells.meta && this.cells.meta.built_utc) ||
            this.grid.built_utc ||
            "—") +
          " · " +
          ((this.cells && this.cells.meta && this.cells.meta.label) ||
            "ERA5-derived") +
          " · git " +
          String(
            (this.cells && this.cells.meta && this.cells.meta.git_hash) ||
              this.grid.git_hash ||
              ""
          ).slice(0, 7);
      } else if (this.role === "model" && this.mapLayer === "countries") {
        srcEl.textContent =
          "WindGen countries (outlines) · Data as of " +
          ((this.countries && this.countries.built_utc) || this.grid.built_utc || "—") +
          " · Natural Earth · git " +
          String((this.countries && this.countries.git_hash) || this.grid.git_hash || "").slice(0, 7);
      } else if (this.role === "model") {
        srcEl.textContent =
          "v0 ERA5 climatology (2015-2021, capacity factor) · Data as of " +
          (this.grid.built_utc || "—") +
          " · Natural Earth · git " +
          String(this.grid.git_hash || "").slice(0, 7);
      } else {
        srcEl.textContent =
          "Data as of " +
          (this.grid.built_utc || "—") +
          " · ERA5 " +
          (ys.length ? ys[0] + "–" + ys[ys.length - 1] : "—") +
          " · Grid data are raw; the calibration factor is applied in your browser" +
          " · Natural Earth · git " +
          String(this.grid.git_hash || "").slice(0, 7);
      }
    }
    if (badgeEl) {
      badgeEl.innerHTML = "";
      var info = this.badgeInfo();
      var span = document.createElement("span");
      span.className =
        "badge " +
        (info.kind === "validated"
          ? "badge--validated"
          : info.kind === "indicative"
            ? "badge--indicative"
            : "badge--estimate");
      span.textContent = info.text;
      badgeEl.appendChild(span);
    }
  };

  WindMap.prototype.resize = function () {
    var parent = this.canvas.parentElement;
    var w = parent.clientWidth || 640;
    var h = parent.clientHeight || 520;
    var dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssW = w;
    this.cssH = h;
    this._cellLayerKey = "";
    if (this._pendingFit) {
      var p = this._pendingFit;
      this.fitBounds(p.lat0, p.lat1, p.lon0, p.lon1, 0);
    } else {
      var b = this._defaultBounds();
      this._minZoom = this._zoomForBounds(b.lat0, b.lat1, b.lon0, b.lon1);
      if (this.zoom < this._minZoom) this.zoom = this._minZoom;
      this._syncCursor();
    }
  };

  WindMap.prototype._modelBounds = function () {
    if (!this.grid) {
      return {
        lat0: MODEL.lat0,
        lat1: MODEL.lat1,
        lon0: MODEL.lon0,
        lon1: MODEL.lon1,
      };
    }
    var g = this.grid;
    var h = (g.cell_spacing_deg || 0.25) / 2;
    return {
      lat0: Math.min.apply(null, g.lat) - h,
      lat1: Math.max.apply(null, g.lat) + h,
      lon0: Math.min.apply(null, g.lon) - h,
      lon1: Math.max.apply(null, g.lon) + h,
    };
  };

  WindMap.prototype._projectSetup = function () {
    var b = CONTEXT;
    var midLat = ((b.lat0 + b.lat1) / 2) * (Math.PI / 180);
    var cos = Math.cos(midLat);
    var dataW = (b.lon1 - b.lon0) * cos;
    var dataH = b.lat1 - b.lat0;
    var fit = Math.min(this.cssW / dataW, this.cssH / dataH);
    var scale = fit * this.zoom;
    var cx = this.centerLon != null ? this.centerLon : (b.lon0 + b.lon1) / 2;
    var cy = this.centerLat != null ? this.centerLat : (b.lat0 + b.lat1) / 2;

    var visW = this.cssW / (cos * scale);
    var visH = this.cssH / scale;
    var halfLon = Math.min(visW / 2, (b.lon1 - b.lon0) / 2);
    var halfLat = Math.min(visH / 2, (b.lat1 - b.lat0) / 2);
    cx = Math.min(b.lon1 - halfLon, Math.max(b.lon0 + halfLon, cx));
    cy = Math.min(b.lat1 - halfLat, Math.max(b.lat0 + halfLat, cy));
    this.centerLon = cx;
    this.centerLat = cy;

    var ox = this.cssW / 2 - (cx - b.lon0) * cos * scale;
    var oy = this.cssH / 2 - (b.lat1 - cy) * scale;
    this._proj = { b: b, cos: cos, scale: scale, ox: ox, oy: oy, fit: fit };
  };

  WindMap.prototype.lonLatToXY = function (lon, lat) {
    var p = this._proj;
    return {
      x: p.ox + (lon - p.b.lon0) * p.cos * p.scale,
      y: p.oy + (p.b.lat1 - lat) * p.scale,
    };
  };

  WindMap.prototype.xyToLonLat = function (x, y) {
    var p = this._proj;
    return {
      lon: p.b.lon0 + (x - p.ox) / (p.cos * p.scale),
      lat: p.b.lat1 - (y - p.oy) / p.scale,
    };
  };

  WindMap.prototype._monthKey = function () {
    var m = this.state.month;
    if (m === "all" || m == null || m === "0") return "0";
    return String(m);
  };

  WindMap.prototype._scaleRange = function () {
    /* Fixed raw scale per turbine + metric (not remapped for calibrated). */
    var scale = SCALES[this.state.turbine] || SCALES.offshore_reference;
    if (this.metric === "hub_speed") {
      return { vmin: 5, vmax: 12 };
    }
    return { vmin: scale.vmin, vmax: scale.vmax };
  };

  WindMap.prototype._cellValue = function (flatIdx) {
    var g = this.grid;
    var t = g.turbines[this.state.turbine];
    if (!t) return null;
    var month = t.months[this._monthKey()];
    if (!month) return null;
    if (this.metric === "hub_speed") return month.hub_speed_m_s[flatIdx];
    var raw = month.cf[flatIdx];
    if (raw == null) return null;
    if (this.state.layer === "calibrated") {
      if (this.outputFactor == null) return null;
      return raw * this.outputFactor;
    }
    return raw;
  };

  WindMap.prototype._hubSpeed = function (flatIdx) {
    var t = this.grid.turbines[this.state.turbine];
    if (!t) return null;
    var month = t.months[this._monthKey()];
    return month ? month.hub_speed_m_s[flatIdx] : null;
  };

  WindMap.prototype._fadeCell = function (flatIdx) {
    var lf = this.grid.land_fraction[flatIdx];
    if (lf == null) return false;
    if (this.state.turbine === "offshore_reference" && lf > 0.5) return true;
    if (this.state.turbine === "onshore_reference" && lf < 0.5) return true;
    return false;
  };

  WindMap.prototype._cellCacheKey = function () {
    return [
      this.state.turbine,
      this.state.layer,
      this._monthKey(),
      this.metric,
      this.zoom.toFixed(4),
      this._proj.scale.toFixed(4),
      this.cssW,
      this.cssH,
    ].join("|");
  };

  WindMap.prototype._ensureCellLayer = function (vmin, vmax) {
    var key = this._cellCacheKey();
    if (this._cellLayerKey === key && this._cellLayerBox) return;
    var mb = this._modelBounds();
    var spacing = (this.grid && this.grid.cell_spacing_deg) || 0.25;
    var p = this._proj;
    var w = Math.max(1, Math.ceil((mb.lon1 - mb.lon0) * p.cos * p.scale) + 2);
    var h = Math.max(1, Math.ceil((mb.lat1 - mb.lat0) * p.scale) + 2);
    var c = this._cellLayer;
    c.width = w;
    c.height = h;
    var ctx = c.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    var g = this.grid;
    var nlat = g.shape[0];
    var nlon = g.shape[1];
    for (var iy = 0; iy < nlat; iy++) {
      for (var ix = 0; ix < nlon; ix++) {
        var fi = iy * nlon + ix;
        var val = this._cellValue(fi);
        if (val == null || !isFinite(val)) continue;
        var lat = g.lat[iy];
        var lon = g.lon[ix];
        var x0 = (lon - spacing / 2 - mb.lon0) * p.cos * p.scale;
        var y0 = (mb.lat1 - (lat + spacing / 2)) * p.scale;
        var x1 = (lon + spacing / 2 - mb.lon0) * p.cos * p.scale;
        var y1 = (mb.lat1 - (lat - spacing / 2)) * p.scale;
        var t = (val - vmin) / (vmax - vmin);
        var rgb = lerpColor(t);
        ctx.globalAlpha = this._fadeCell(fi) ? 0.28 : 0.92;
        ctx.fillStyle = "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")";
        ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
      }
    }
    ctx.globalAlpha = 1;
    this._cellLayerKey = key;
    this._cellLayerBox = mb;
  };

  WindMap.prototype._monthSpeed = function (wgId) {
    if (!this.countryNormals || !this.countryNormals.countries[wgId]) return null;
    var row = this.countryNormals.countries[wgId];
    var m = this.state.month;
    if (m === "all" || m == null || m === "0" || Number(m) === 0) {
      return row.annual / 100;
    }
    var mi = Number(m) - 1;
    if (mi < 0 || mi > 11) return row.annual / 100;
    return row.monthly[mi] / 100;
  };

  WindMap.prototype._pointInRing = function (lon, lat, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0],
        yi = ring[i][1];
      var xj = ring[j][0],
        yj = ring[j][1];
      var intersect =
        yi > lat !== yj > lat &&
        lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-15) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  };

  WindMap.prototype._hitPilotCell = function (lon, lat) {
    if (!this.cells || !this.cells.grid) return null;
    var g = this.cells.grid;
    if (lat < MODEL.lat0 || lat > MODEL.lat1 || lon < MODEL.lon0 || lon > MODEL.lon1) {
      return null;
    }
    var iy = Math.round((g.lat0 - lat) / g.step);
    var ix = Math.round((lon - g.lon0) / g.step);
    if (iy < 0 || iy >= g.rows || ix < 0 || ix >= g.columns) return null;
    var flat = iy * g.columns + ix;
    var clat = g.lat0 - iy * g.step;
    var clon = g.lon0 + ix * g.step;
    return {
      iy: iy,
      ix: ix,
      flat: flat,
      lat: clat,
      lon: clon,
      speed: this._cellMonthSpeed(flat),
    };
  };

  WindMap.prototype._hitCountry = function (lon, lat) {
    if (!this.countries || !this.countries.features) return null;
    var feats = this.countries.features;
    for (var i = feats.length - 1; i >= 0; i--) {
      var f = feats[i];
      if (!f.windgen) continue;
      for (var p = 0; p < f.polygons.length; p++) {
        if (this._pointInRing(lon, lat, f.polygons[p])) return f;
      }
    }
    return null;
  };

  WindMap.prototype._hitPoint = function (lon, lat, pxTol) {
    if (!this.countries || !this.countries.points) return null;
    var tol = pxTol || 10;
    var best = null;
    var bestD = tol;
    for (var i = 0; i < this.countries.points.length; i++) {
      var pt = this.countries.points[i];
      var xy = this.lonLatToXY(pt.lon, pt.lat);
      var d = Math.hypot(xy.x - this._lastPointer.x, xy.y - this._lastPointer.y);
      if (d < bestD) {
        bestD = d;
        best = pt;
      }
    }
    return best;
  };

  WindMap.prototype._drawCountryOutlines = function (opts) {
    opts = opts || {};
    var place = window.PlaceSelection ? window.PlaceSelection.get() : { id: null };
    var selId = place && place.type === "country" ? place.id : null;
    var feats = (this.countries && this.countries.features) || [];
    var fadeOthers = !!selId;

    feats.forEach(function (f) {
      if (f.windgen) return;
      this._fillCountry(
        f,
        "rgba(229,231,235,0.35)",
        fadeOthers ? 0.35 : 0.7,
        "#9ca3af",
        0.5
      );
    }, this);

    feats.forEach(function (f) {
      if (!f.windgen) return;
      var selected = selId && f.windgen_id === selId;
      var stroke = selected ? "#ea580c" : "rgba(17,24,39,0.55)";
      var lw = selected ? 2 : 0.9;
      var fill = selected
        ? "rgba(234,88,12,0.12)"
        : fadeOthers
          ? "rgba(255,255,255,0.08)"
          : "rgba(255,255,255,0.2)";
      var alpha = selected ? 1 : fadeOthers ? 0.35 : 0.95;
      this._fillCountry(f, fill, alpha, stroke, lw);
      if (selected) {
        var xy = this.lonLatToXY(f.centroid[0], f.centroid[1]);
        var ctx = this.ctx;
        ctx.fillStyle = "#111827";
        ctx.font = "12px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(f.name, xy.x, xy.y);
      }
    }, this);
  };

  WindMap.prototype._drawPoints = function () {
    var place = window.PlaceSelection ? window.PlaceSelection.get() : { id: null };
    var selPt = place && place.type === "point" ? place.id : null;
    var ctx = this.ctx;
    (this.countries.points || []).forEach(function (pt) {
      var xy = this.lonLatToXY(pt.lon, pt.lat);
      ctx.beginPath();
      ctx.fillStyle = selPt === pt.id ? "#ea580c" : "#111827";
      ctx.arc(xy.x, xy.y, selPt === pt.id ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.25;
      ctx.stroke();
    }, this);
  };

  WindMap.prototype._drawTooltip = function (tip) {
    if (!tip || !this._lastPointer) return;
    var ctx = this.ctx;
    ctx.fillStyle = "rgba(17,24,39,0.88)";
    ctx.font = "11px Inter, sans-serif";
    var tw = ctx.measureText(tip).width;
    var tx = Math.min(this.cssW - tw - 16, this._lastPointer.x + 12);
    var ty = Math.max(18, this._lastPointer.y - 10);
    ctx.fillRect(tx - 4, ty - 12, tw + 8, 18);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.fillText(tip, tx, ty);
  };

  WindMap.prototype._cellMonthSpeed = function (flat) {
    if (!this.cells || !this.cells.clim) return null;
    var m = this.state.month;
    var base = flat * 12;
    if (m === "all" || m == null || m === "0" || Number(m) === 0) {
      var s = 0;
      for (var i = 0; i < 12; i++) s += this.cells.clim[base + i];
      return s / 1200; // ints are 0.01 m/s
    }
    var mi = Number(m) - 1;
    if (mi < 0 || mi > 11) mi = 0;
    return this.cells.clim[base + mi] / 100;
  };

  WindMap.prototype._drawCountriesLayer = function () {
    var ctx = this.ctx;
    this._drawCountryOutlines({});
    this._drawPoints();

    var tip = null;
    if (this._hoverPoint) {
      tip = this._hoverPoint.name + " (" + this._hoverPoint.id + ")";
    } else if (this._hoverCountry) {
      tip = this._hoverCountry.name;
    }
    this._drawTooltip(tip);

    this.onLegend({
      vmin: 0,
      vmax: 1,
      metric: "outline",
      layer: "countries",
      turbine: null,
      title: "Countries · outlines",
      note: "ERA5 reads low at tall masts; cell normals corrected for period only if the test says so",
      hideScale: true,
    });
  };

  WindMap.prototype._drawCellsLayer = function () {
    var ctx = this.ctx;
    var cells = this.cells;
    if (!cells) return;
    var g = cells.grid;
    var rows = g.rows;
    var cols = g.columns;
    var step = g.step;
    var vmin = CELL_SPEED_SCALE.vmin;
    var vmax = CELL_SPEED_SCALE.vmax;
    var place = window.PlaceSelection ? window.PlaceSelection.get() : {};
    var selFlat = place && place.type === "cell" && place.cell ? place.cell.flat : -1;

    // country outlines under / around box
    this._drawCountryOutlines({});

    for (var iy = 0; iy < rows; iy++) {
      var lat = g.lat0 - iy * step;
      for (var ix = 0; ix < cols; ix++) {
        var lon = g.lon0 + ix * step;
        var flat = iy * cols + ix;
        var spd = this._cellMonthSpeed(flat);
        if (spd == null || !isFinite(spd)) continue;
        var t = (spd - vmin) / (vmax - vmin);
        var rgb = lerpColor(t);
        var a = this.lonLatToXY(lon - step / 2, lat + step / 2);
        var b = this.lonLatToXY(lon + step / 2, lat - step / 2);
        ctx.globalAlpha = flat === selFlat ? 1 : 0.88;
        ctx.fillStyle = "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")";
        ctx.fillRect(a.x, a.y, Math.max(1, b.x - a.x), Math.max(1, b.y - a.y));
        if (flat === selFlat) {
          ctx.strokeStyle = "#ea580c";
          ctx.lineWidth = 2;
          ctx.strokeRect(a.x, a.y, Math.max(1, b.x - a.x), Math.max(1, b.y - a.y));
        }
      }
    }
    ctx.globalAlpha = 1;

    // dashed pilot box + label
    var a0 = this.lonLatToXY(MODEL.lon0, MODEL.lat1);
    var a1 = this.lonLatToXY(MODEL.lon1, MODEL.lat0);
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(a0.x, a0.y, a1.x - a0.x, a1.y - a0.y);
    ctx.setLineDash([]);
    ctx.fillStyle = "#111827";
    ctx.font = "11px Inter, sans-serif";
    var label = "Cell data: pilot box";
    var tw = ctx.measureText(label).width;
    ctx.fillText(label, a1.x - tw - 4, a0.y - 5);
    ctx.restore();

    this._drawPoints();

    var tip = null;
    if (this._hoverPoint) {
      tip = this._hoverPoint.name + " (" + this._hoverPoint.id + ")";
    } else if (this._hoverCell) {
      var hc = this._hoverCell;
      var drv =
        cells.countries[cells.driver[hc.flat]] || "?";
      tip =
        hc.lat.toFixed(2) +
        " N, " +
        hc.lon.toFixed(2) +
        " E · " +
        (hc.speed != null ? hc.speed.toFixed(2) + " m/s · " : "") +
        drv;
    } else if (this._hoverCountry) {
      tip = this._hoverCountry.name;
    }
    this._drawTooltip(tip);

    this.onLegend({
      vmin: vmin,
      vmax: vmax,
      metric: "hub_speed",
      layer: "cells",
      turbine: null,
      title: "100 m speed · cell normal",
      note: "ERA5 reads low at tall masts; cell normals corrected for period only if the test says so",
    });
  };

  WindMap.prototype._fillCountry = function (f, fill, alpha, stroke, lw) {
    var ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    (f.polygons || []).forEach(function (ring) {
      if (!ring || ring.length < 3) return;
      ctx.beginPath();
      for (var i = 0; i < ring.length; i++) {
        var xy = this.lonLatToXY(ring[i][0], ring[i][1]);
        if (i === 0) ctx.moveTo(xy.x, xy.y);
        else ctx.lineTo(xy.x, xy.y);
      }
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      if (lw > 0) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lw;
        ctx.stroke();
      }
    }, this);
    ctx.restore();
  };

  WindMap.prototype.draw = function () {
    if (!this.grid || !this.cssW) return;
    var t0 =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    this._updateChrome();
    this._projectSetup();
    var ctx = this.ctx;

    ctx.clearRect(0, 0, this.cssW, this.cssH);
    ctx.fillStyle = "#dbe4ee";
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    this._strokeFeatures(this.coastContext, "#6b7280", 1);

    if (this.role === "model" && this.mapLayer === "countries") {
      this._drawCountriesLayer();
      this._syncCursor();
      var tC =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      this._lastDrawMs = tC - t0;
      return;
    }
    if (this.role === "model" && this.mapLayer === "cells") {
      this._drawCellsLayer();
      this._syncCursor();
      var tCells =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      this._lastDrawMs = tCells - t0;
      return;
    }

    var range = this._scaleRange();
    var vmin = range.vmin;
    var vmax = range.vmax;

    // Light mask outside model box
    var mb = this._modelBounds();
    var a = this.lonLatToXY(mb.lon0, mb.lat1);
    var c = this.lonLatToXY(mb.lon1, mb.lat0);
    ctx.fillStyle = "rgba(243, 244, 246, 0.72)";
    ctx.beginPath();
    ctx.rect(0, 0, this.cssW, this.cssH);
    ctx.rect(a.x, a.y, c.x - a.x, c.y - a.y);
    ctx.fill("evenodd");

    this._ensureCellLayer(vmin, vmax);
    var origin = this.lonLatToXY(this._cellLayerBox.lon0, this._cellLayerBox.lat1);
    ctx.drawImage(this._cellLayer, origin.x, origin.y);

    this._strokeFeatures(this.coast, "#111827", 1.25);

    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(a.x, a.y, c.x - a.x, c.y - a.y);
    ctx.setLineDash([]);
    ctx.fillStyle = "#111827";
    ctx.font = "11px Inter, sans-serif";
    var boxLabel = "Model area (ERA5 box)";
    var tw = ctx.measureText(boxLabel).width;
    ctx.fillText(boxLabel, c.x - tw - 4, a.y - 5);
    ctx.restore();

    this._syncCursor();

    if (this.farms && this.farms.farms) {
      this.farms.farms.forEach(function (farm) {
        var xy = this.lonLatToXY(farm.lon, farm.lat);
        ctx.beginPath();
        ctx.fillStyle = "#111827";
        ctx.arc(xy.x, xy.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1;
        ctx.stroke();
      }, this);
    }

    if (this.state.selectedCell) {
      var sc = this.state.selectedCell;
      var spacing = this.grid.cell_spacing_deg || 0.25;
      var xy0 = this.lonLatToXY(sc.lon - spacing / 2, sc.lat + spacing / 2);
      var xy1 = this.lonLatToXY(sc.lon + spacing / 2, sc.lat - spacing / 2);
      ctx.strokeStyle = "#ea580c";
      ctx.lineWidth = 2;
      ctx.strokeRect(xy0.x, xy0.y, xy1.x - xy0.x, xy1.y - xy0.y);
    }

    this.onLegend({
      vmin: vmin,
      vmax: vmax,
      metric: this.metric,
      layer: this.state.layer,
      turbine: this.state.turbine,
    });
    var t1 =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    this._lastDrawMs = t1 - t0;
  };

  WindMap.prototype._strokeFeatures = function (fc, color, width) {
    if (!fc || !fc.features) return;
    var ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    fc.features.forEach(function (f) {
      var coords = f.geometry && f.geometry.coordinates;
      if (!coords || coords.length < 2) return;
      ctx.beginPath();
      for (var i = 0; i < coords.length; i++) {
        var xy = this.lonLatToXY(coords[i][0], coords[i][1]);
        if (i === 0) ctx.moveTo(xy.x, xy.y);
        else ctx.lineTo(xy.x, xy.y);
      }
      ctx.stroke();
    }, this);
  };

  WindMap.prototype._nearestCell = function (lon, lat) {
    var g = this.grid;
    var best = null;
    var bestD = Infinity;
    for (var iy = 0; iy < g.shape[0]; iy++) {
      for (var ix = 0; ix < g.shape[1]; ix++) {
        var dlat = g.lat[iy] - lat;
        var dlon = g.lon[ix] - lon;
        var d = dlat * dlat + dlon * dlon;
        if (d < bestD) {
          bestD = d;
          best = {
            iy: iy,
            ix: ix,
            lat: g.lat[iy],
            lon: g.lon[ix],
            flat: iy * g.shape[1] + ix,
          };
        }
      }
    }
    return best;
  };

  WindMap.prototype.farmWithinKm = function (lon, lat, km) {
    if (!this.farms || !this.farms.farms) return null;
    var best = null;
    var bestD = km;
    this.farms.farms.forEach(function (f) {
      var d = haversineKm(lat, lon, f.lat, f.lon);
      if (d < bestD) {
        bestD = d;
        best = { farm: f, km: d };
      }
    });
    return best;
  };

  WindMap.prototype.hoverPayload = function (lon, lat) {
    var cell = this._nearestCell(lon, lat);
    if (!cell) return null;
    var val = this._cellValue(cell.flat);
    var hub = this._hubSpeed(cell.flat);
    var near = this.farmWithinKm(cell.lon, cell.lat, 25);
    var range = null;
    if (this.metric === "cf" && this.state.layer === "calibrated" && this.outputRange) {
      var t = this.grid.turbines[this.state.turbine];
      var rawCf = t.months[this._monthKey()].cf[cell.flat];
      if (rawCf != null) {
        range = {
          low: rawCf * this.outputRange.low,
          high: rawCf * this.outputRange.high,
        };
      }
    }
    return {
      lat: cell.lat,
      lon: cell.lon,
      flat: cell.flat,
      value: val,
      hubSpeed: hub,
      metric: this.metric,
      layer: this.state.layer,
      range: range,
      farm: near ? near.farm : null,
      farmKm: near ? near.km : null,
      badge: this.badgeInfo(),
    };
  };

  WindMap.prototype._zoomAt = function (x, y, factor) {
    var before = this.xyToLonLat(x, y);
    var next = Math.min(MAX_ZOOM, Math.max(this._minZoom, this.zoom * factor));
    if (Math.abs(next - this.zoom) < 1e-6) {
      this._syncCursor();
      return;
    }
    this.zoom = next;
    this._cellLayerKey = "";
    this._projectSetup();
    var after = this.xyToLonLat(x, y);
    this.centerLon += before.lon - after.lon;
    this.centerLat += before.lat - after.lat;
    this.draw();
  };

  WindMap.prototype.invalidateCells = function () {
    this._cellLayerKey = "";
  };

  WindMap.prototype._bind = function () {
    var self = this;
    this.canvas.addEventListener(
      "wheel",
      function (ev) {
        if (!self.grid) return;
        if (!(ev.ctrlKey || ev.metaKey)) {
          self._showZoomHint();
          return;
        }
        ev.preventDefault();
        var rect = self.canvas.getBoundingClientRect();
        self._zoomAt(
          ev.clientX - rect.left,
          ev.clientY - rect.top,
          ev.deltaY < 0 ? 1.12 : 1 / 1.12
        );
      },
      { passive: false }
    );

    this.canvas.addEventListener("mousedown", function (ev) {
      if (!self.grid || ev.button !== 0) return;
      if (self.isAtMinZoom()) return;
      self._dragging = true;
      self._didDrag = false;
      self._dragLast = { x: ev.clientX, y: ev.clientY };
    });
    window.addEventListener("mousemove", function (ev) {
      if (!self._dragging) return;
      if (self.isAtMinZoom()) {
        self._dragging = false;
        return;
      }
      var dx = ev.clientX - self._dragLast.x;
      var dy = ev.clientY - self._dragLast.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) self._didDrag = true;
      self._dragLast = { x: ev.clientX, y: ev.clientY };
      if (!self._proj) return;
      self.centerLon -= dx / (self._proj.cos * self._proj.scale);
      self.centerLat += dy / self._proj.scale;
      self.draw();
    });
    window.addEventListener("mouseup", function () {
      self._dragging = false;
    });

    this.canvas.addEventListener("mousemove", function (ev) {
      if (!self.grid || self._dragging) return;
      var rect = self.canvas.getBoundingClientRect();
      var x = ev.clientX - rect.left;
      var y = ev.clientY - rect.top;
      self._lastPointer = { x: x, y: y };
      var ll = self.xyToLonLat(x, y);
      if (self.role === "model" && (self.mapLayer === "countries" || self.mapLayer === "cells")) {
        self._hoverPoint = self._hitPoint(ll.lon, ll.lat, 12);
        self._hoverCell = null;
        self._hoverCountry = null;
        if (!self._hoverPoint && self.mapLayer === "cells") {
          self._hoverCell = self._hitPilotCell(ll.lon, ll.lat);
        }
        if (!self._hoverPoint && !self._hoverCell) {
          self._hoverCountry = self._hitCountry(ll.lon, ll.lat);
        }
        self.draw();
        return;
      }
      self.onHover(self.hoverPayload(ll.lon, ll.lat));
    });
    this.canvas.addEventListener("mouseleave", function () {
      if (!self._dragging) {
        self._hoverCountry = null;
        self._hoverPoint = null;
        self._hoverCell = null;
        self.onHover(null);
        if (self.mapLayer === "countries" || self.mapLayer === "cells") self.draw();
      }
    });
    this.canvas.addEventListener("click", function (ev) {
      if (!self.grid || self._didDrag) return;
      var rect = self.canvas.getBoundingClientRect();
      var x = ev.clientX - rect.left;
      var y = ev.clientY - rect.top;
      self._lastPointer = { x: x, y: y };
      var ll = self.xyToLonLat(x, y);
      if (self.role === "model" && (self.mapLayer === "countries" || self.mapLayer === "cells")) {
        var pt = self._hitPoint(ll.lon, ll.lat, 12);
        if (pt) {
          self.state.selectedCell = null;
          self.onPlaceSelect(pt.id, "point");
          return;
        }
        if (self.mapLayer === "cells") {
          var pc = self._hitPilotCell(ll.lon, ll.lat);
          if (pc) {
            self.state.selectedCell = {
              iy: pc.iy,
              ix: pc.ix,
              lat: pc.lat,
              lon: pc.lon,
              flat: pc.flat,
            };
            self.onPlaceSelect(
              "cell:" + pc.flat,
              "cell",
              self.state.selectedCell
            );
            self.draw();
            self.onSelect(self.state.selectedCell);
            return;
          }
        }
        var cty = self._hitCountry(ll.lon, ll.lat);
        if (cty && cty.windgen_id) {
          self.state.selectedCell = null;
          self.onPlaceSelect(cty.windgen_id, "country");
          return;
        }
        return;
      }
      var cell = self._nearestCell(ll.lon, ll.lat);
      if (!cell) return;
      self.state.selectedCell = {
        iy: cell.iy,
        ix: cell.ix,
        lat: cell.lat,
        lon: cell.lon,
        flat: cell.flat,
      };
      self.draw();
      self.onSelect(self.state.selectedCell);
    });

    var root = this._chromeRoot();
    if (root && !root._zoomKeysBound) {
      root._zoomKeysBound = true;
      root.addEventListener("keydown", function (ev) {
        if (ev.key === "+" || ev.key === "=") {
          ev.preventDefault();
          self.zoomBy(1.15);
        } else if (ev.key === "-" || ev.key === "_") {
          ev.preventDefault();
          self.zoomBy(1 / 1.15);
        }
      });
    }

    window.addEventListener("resize", function () {
      self.resize();
      self.draw();
    });
  };

  WindMap.prototype.refresh = function () {
    this._cellLayerKey = "";
    this.draw();
  };

  global.WindMap = WindMap;
})(window);
