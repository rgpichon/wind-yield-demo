/* WindGen projection panel — displays precomputed arrays only (no browser generator). */
(function () {
  "use strict";

  var BASE = "data/windgen/";
  var cache = Object.create(null);
  var index = null;
  var place = null;
  var cellsData = null;
  var countriesMeta = null;
  var mode = { kind: "place" }; // place | cell | percent
  var state = {
    placeId: "UK",
    vol: 1.0,
    pers: 1.0,
    drift: 0.0,
    steadiness: 1.0,
    seedIndex: 0,
    calendarMonth: 0, // 0..11 for within-month
  };
  var lastDrawMs = 0;
  var hoverIdx = -1;

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "className") n.className = attrs[k];
        else if (k === "text") n.textContent = attrs[k];
        else if (k === "html") n.innerHTML = attrs[k];
        else if (k.slice(0, 2) === "on" && typeof attrs[k] === "function") n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        else n.setAttribute(k, attrs[k]);
      });
    }
    (kids || []).forEach(function (c) {
      if (c) n.appendChild(c);
    });
    return n;
  }

  function idxOf(arr, v) {
    for (var i = 0; i < arr.length; i++) if (Number(arr[i]) === Number(v)) return i;
    return 0;
  }

  function decode(xs) {
    var out = new Array(xs.length);
    for (var i = 0; i < xs.length; i++) out[i] = xs[i] / 100;
    return out;
  }

  function decodeShare(x) {
    return x / 100; // → percent
  }

  function decodeK(x) {
    return x / 100;
  }

  function decodeKCell(x) {
    return x / 1000;
  }

  function countryOutsidePilot(id) {
    if (!countriesMeta || !countriesMeta.features) return false;
    var f = countriesMeta.features.find(function (x) {
      return x.windgen_id === id;
    });
    if (!f || !f.centroid) return false;
    var lon = f.centroid[0];
    var lat = f.centroid[1];
    var box = (window.CellPath && window.CellPath.PILOT) || {
      lat0: 47,
      lat1: 59,
      lon0: -4,
      lon1: 15,
    };
    return lat < box.lat0 || lat > box.lat1 || lon < box.lon0 || lon > box.lon1;
  }

  function fetchJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
      return r.json();
    });
  }

  function loadIndex() {
    return fetchJson(BASE + "index.json").then(function (j) {
      index = j;
      if (j.defaults) {
        state.placeId = j.defaults.place_id || "UK";
        state.vol = j.defaults.volatility;
        state.pers = j.defaults.persistence;
        state.drift = j.defaults.drift_pct_per_decade;
        state.steadiness = j.defaults.steadiness;
        state.seedIndex = j.defaults.seed_index || 0;
      }
      return j;
    });
  }

  function loadPlace(id) {
    if (cache[id]) return Promise.resolve(cache[id]);
    var meta = index.places.find(function (p) {
      return p.id === id;
    });
    if (!meta) return Promise.reject(new Error("Unknown place " + id));
    return fetchJson(BASE + meta.file).then(function (j) {
      cache[id] = j;
      return j;
    });
  }

  function seriesBundle() {
    if (!place || !index) return null;
    var g = index.grid;
    var di = idxOf(g.drift_pct_per_decade, state.drift);
    var vi = idxOf(g.volatility, state.vol);
    var pi = idxOf(g.persistence, state.pers);
    var base = {
      median: decode(place.median[di]),
      lo: decode(place.band_lo[di][vi]),
      hi: decode(place.band_hi[di][vi]),
      path: decode(place.path[di][vi][pi][state.seedIndex]),
      normal: decode(place.normal_year),
      unit: "m/s",
    };
    if (mode.kind === "cell" && mode.cell && cellsData && window.CellPath) {
      var flat = mode.cell.flat;
      var clim = [];
      for (var i = 0; i < 12; i++) clim.push(cellsData.clim[flat * 12 + i] / 100);
      var beta = cellsData.beta[flat] / 1000;
      var sigmaEps = cellsData.sigma_eps[flat] / 1000;
      var bundle = window.CellPath.transformCell({
        clim: clim,
        beta: beta,
        sigmaEps: sigmaEps,
        vol: state.vol,
        seedIndex: state.seedIndex,
        cellFlat: flat,
        countryMedian: base.median,
        countryPath: base.path,
        countryLo: base.lo,
        countryHi: base.hi,
        countryNormal: base.normal,
      });
      bundle.unit = "m/s";
      return bundle;
    }
    if (mode.kind === "percent" && window.CellPath) {
      return window.CellPath.toPercentBundle(base);
    }
    return base;
  }

  function monthLabels(n) {
    var start = (index && index.start) || "2027-01";
    var y = parseInt(start.slice(0, 4), 10);
    var m = parseInt(start.slice(5, 7), 10);
    var out = [];
    for (var i = 0; i < n; i++) {
      out.push({ y: y, m: m, label: y + "-" + (m < 10 ? "0" : "") + m });
      m += 1;
      if (m === 13) {
        m = 1;
        y += 1;
      }
    }
    return out;
  }

  function drawPathChart(canvas, bundle) {
    var t0 = performance.now();
    var ctx = canvas.getContext("2d");
    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || 640;
    var cssH = canvas.clientHeight || 280;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    var pad = { l: 44, r: 12, t: 16, b: 28 };
    var w = cssW - pad.l - pad.r;
    var h = cssH - pad.t - pad.b;
    var n = bundle.median.length;
    var labels = monthLabels(n);
    var ymin = Math.min.apply(null, bundle.lo.concat(bundle.path, bundle.median));
    var ymax = Math.max.apply(null, bundle.hi.concat(bundle.path, bundle.median));
    var padY = (ymax - ymin) * 0.08 || 0.5;
    var isPct = bundle.unit === "percent";
    ymin = isPct ? ymin - padY : Math.max(0, ymin - padY);
    ymax = ymax + padY;

    function xAt(i) {
      return pad.l + (w * i) / (n - 1);
    }
    function yAt(v) {
      return pad.t + h * (1 - (v - ymin) / (ymax - ymin));
    }

    // band
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var x = xAt(i);
      var y = yAt(bundle.hi[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (var j = n - 1; j >= 0; j--) {
      ctx.lineTo(xAt(j), yAt(bundle.lo[j]));
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(29, 78, 216, 0.12)";
    ctx.fill();

    // median dashed
    ctx.beginPath();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = "#6b7280";
    ctx.lineWidth = 1.25;
    for (var k = 0; k < n; k++) {
      var xm = xAt(k);
      var ym = yAt(bundle.median[k]);
      if (k === 0) ctx.moveTo(xm, ym);
      else ctx.lineTo(xm, ym);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // path solid
    ctx.beginPath();
    ctx.strokeStyle = "#1d4ed8";
    ctx.lineWidth = 1.75;
    for (var p = 0; p < n; p++) {
      var xp = xAt(p);
      var yp = yAt(bundle.path[p]);
      if (p === 0) ctx.moveTo(xp, yp);
      else ctx.lineTo(xp, yp);
    }
    ctx.stroke();

    // axes / year ticks
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t);
    ctx.lineTo(pad.l, pad.t + h);
    ctx.lineTo(pad.l + w, pad.t + h);
    ctx.stroke();

    ctx.fillStyle = "#6b7280";
    ctx.font = "10px Inter, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (var t = 0; t < 5; t++) {
      var vv = ymin + ((ymax - ymin) * t) / 4;
      var yy = yAt(vv);
      ctx.fillText(
        isPct ? vv.toFixed(0) + "%" : vv.toFixed(1),
        pad.l - 6,
        yy
      );
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    var lastY = -1;
    for (var yi = 0; yi < n; yi++) {
      if (labels[yi].m === 1) {
        ctx.fillText(String(labels[yi].y), xAt(yi), pad.t + h + 6);
        lastY = labels[yi].y;
      }
    }
    if (lastY < 0) ctx.fillText(labels[0].label, xAt(0), pad.t + h + 6);

    // hover
    if (hoverIdx >= 0 && hoverIdx < n) {
      var hx = xAt(hoverIdx);
      ctx.strokeStyle = "#9ca3af";
      ctx.beginPath();
      ctx.moveTo(hx, pad.t);
      ctx.lineTo(hx, pad.t + h);
      ctx.stroke();
      var u = isPct ? "%" : " m/s";
      var tip =
        labels[hoverIdx].label +
        "  path " +
        bundle.path[hoverIdx].toFixed(isPct ? 1 : 2) +
        "  med " +
        bundle.median[hoverIdx].toFixed(isPct ? 1 : 2) +
        "  band " +
        bundle.lo[hoverIdx].toFixed(isPct ? 1 : 2) +
        "–" +
        bundle.hi[hoverIdx].toFixed(isPct ? 1 : 2) +
        u;
      ctx.fillStyle = "#111827";
      ctx.font = "11px Inter, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(tip, pad.l + 4, 4);
    }

    lastDrawMs = performance.now() - t0;
    var msEl = document.getElementById("windgen-draw-ms");
    if (msEl) msEl.textContent = lastDrawMs.toFixed(1) + " ms/frame";
  }

  function drawNormalChart(canvas, bundle) {
    var ctx = canvas.getContext("2d");
    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || 320;
    var cssH = canvas.clientHeight || 200;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    var pad = { l: 36, r: 10, t: 12, b: 24 };
    var w = cssW - pad.l - pad.r;
    var h = cssH - pad.t - pad.b;
    // first-year band slice for calendar months
    var lo12 = bundle.lo.slice(0, 12);
    var hi12 = bundle.hi.slice(0, 12);
    var med12 = bundle.normal;
    var ymin = Math.min.apply(null, lo12.concat(med12));
    var ymax = Math.max.apply(null, hi12.concat(med12));
    var padY = (ymax - ymin) * 0.1 || 0.4;
    ymin = Math.max(0, ymin - padY);
    ymax = ymax + padY;
    function xAt(i) {
      return pad.l + (w * i) / 11;
    }
    function yAt(v) {
      return pad.t + h * (1 - (v - ymin) / (ymax - ymin));
    }
    ctx.beginPath();
    for (var i = 0; i < 12; i++) {
      if (i === 0) ctx.moveTo(xAt(i), yAt(hi12[i]));
      else ctx.lineTo(xAt(i), yAt(hi12[i]));
    }
    for (var j = 11; j >= 0; j--) ctx.lineTo(xAt(j), yAt(lo12[j]));
    ctx.closePath();
    ctx.fillStyle = "rgba(29, 78, 216, 0.12)";
    ctx.fill();
    ctx.beginPath();
    ctx.strokeStyle = "#1d4ed8";
    ctx.lineWidth = 1.5;
    for (var k = 0; k < 12; k++) {
      if (k === 0) ctx.moveTo(xAt(k), yAt(med12[k]));
      else ctx.lineTo(xAt(k), yAt(med12[k]));
    }
    ctx.stroke();
    ctx.fillStyle = "#6b7280";
    ctx.font = "10px Inter, sans-serif";
    ctx.textAlign = "center";
    var months = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
    for (var m = 0; m < 12; m++) ctx.fillText(months[m], xAt(m), pad.t + h + 6);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(ymin.toFixed(1), pad.l - 4, yAt(ymin));
    ctx.fillText(ymax.toFixed(1), pad.l - 4, yAt(ymax));
  }

  function weibullPdf(v, mean, k) {
    if (mean <= 0 || k <= 0) return 0;
    // λ from mean
    var g = gamma1p1overK(k);
    var lam = mean / g;
    if (lam <= 0) return 0;
    var x = v / lam;
    return (k / lam) * Math.pow(x, k - 1) * Math.exp(-Math.pow(x, k));
  }

  function gamma1p1overK(k) {
    // Γ(1+1/k) via Lanczos-ish for typical wind k 1–4; use simple Stirling-ish for display
    var z = 1 + 1 / k;
    // use built-in via series for 1..2 range
    return gammaApprox(z);
  }

  function gammaApprox(z) {
    // Lanczos approximation (g=7)
    var p = [
      0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843696540789e-6,
      1.5056327351493116e-7,
    ];
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gammaApprox(1 - z));
    z -= 1;
    var x = p[0];
    for (var i = 1; i < p.length; i++) x += p[i] / (z + i);
    var t = z + 7.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
  }

  function drawWeibull(canvas, mean, k, mean0, k0) {
    var ctx = canvas.getContext("2d");
    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || 320;
    var cssH = canvas.clientHeight || 160;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    var pad = { l: 28, r: 8, t: 8, b: 20 };
    var w = cssW - pad.l - pad.r;
    var h = cssH - pad.t - pad.b;
    var vmax = 25;
    var n = 80;
    var ys = [];
    var ys0 = [];
    var ymax = 0;
    for (var i = 0; i <= n; i++) {
      var v = (vmax * i) / n;
      var y = weibullPdf(v, mean, k);
      var y0 = weibullPdf(v, mean0, k0);
      ys.push(y);
      ys0.push(y0);
      if (y > ymax) ymax = y;
      if (y0 > ymax) ymax = y0;
    }
    if (ymax <= 0) ymax = 1;
    function xAt(i) {
      return pad.l + (w * i) / n;
    }
    function yAt(val) {
      return pad.t + h * (1 - val / ymax);
    }
    ctx.beginPath();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = "#9ca3af";
    for (var a = 0; a <= n; a++) {
      if (a === 0) ctx.moveTo(xAt(a), yAt(ys0[a]));
      else ctx.lineTo(xAt(a), yAt(ys0[a]));
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.strokeStyle = "#1d4ed8";
    ctx.lineWidth = 1.5;
    for (var b = 0; b <= n; b++) {
      if (b === 0) ctx.moveTo(xAt(b), yAt(ys[b]));
      else ctx.lineTo(xAt(b), yAt(ys[b]));
    }
    ctx.stroke();
    ctx.fillStyle = "#6b7280";
    ctx.font = "10px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("0", xAt(0), pad.t + h + 4);
    ctx.fillText("12", xAt((12 / vmax) * n), pad.t + h + 4);
    ctx.fillText("25 m/s", xAt(n), pad.t + h + 4);
  }

  function setStatus(msg, isErr) {
    var s = document.getElementById("windgen-status");
    if (!s) return;
    s.textContent = msg || "";
    s.className = "windgen-status" + (isErr ? " windgen-status--err" : "");
  }

  function renderNotes() {
    var host = document.getElementById("windgen-notes");
    if (!host || !index) return;
    host.innerHTML = "";
    host.appendChild(el("span", { className: "badge badge--estimate", text: "WindGen v0.1, exploratory" }));
    var caveats = (index.open_caveats || []).join(" · ");
    host.appendChild(el("p", { className: "body-text windgen-caveats", text: caveats }));
    host.appendChild(
      el("p", {
        className: "body-text windgen-caveats",
        text: index.era5_level_note || "",
      })
    );
    var meta = index.places.find(function (p) {
      return p.id === state.placeId;
    });
    if (meta && meta.caveat) {
      host.appendChild(el("p", { className: "body-text windgen-caveats", text: meta.name + ": " + meta.caveat }));
    }
    host.appendChild(
      el("p", {
        className: "card-meta",
        text:
          "Data as of " +
          (index.built_utc || "—") +
          " · Source: " +
          (index.sources || "ERA5-derived, project-computed"),
      })
    );
  }

  function weibullTiles(body, mean, k, mean0, k0, below, above) {
    var g1 = gammaApprox(1 + 1 / k);
    var g2 = gammaApprox(1 + 2 / k);
    var lam = mean / g1;
    var sd = lam * Math.sqrt(Math.max(g2 - g1 * g1, 0));
    var m = state.calendarMonth;
    var row = el("div", { className: "windgen-within-controls" });
    var sel = el("select", { id: "windgen-cal-month", className: "windgen-select" });
    var names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    names.forEach(function (nm, i) {
      var o = el("option", { value: String(i), text: nm });
      if (i === m) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () {
      state.calendarMonth = Number(sel.value);
      renderWithin();
    });
    row.appendChild(el("label", { className: "windgen-label", text: "Calendar month" }));
    row.appendChild(sel);
    body.appendChild(row);
    var canvas = el("canvas", { className: "windgen-weibull-canvas", id: "windgen-weibull" });
    body.appendChild(canvas);
    requestAnimationFrame(function () {
      drawWeibull(canvas, mean, k, mean0, k0);
    });
    var tiles = el("div", { className: "windgen-tiles" });
    [
      ["Mean speed", mean.toFixed(2) + " m/s"],
      ["Spread (σ)", sd.toFixed(2) + " m/s"],
      ["Hours < 4 m/s", below != null ? below.toFixed(1) + "%" : "—"],
      ["Hours > 12 m/s", above != null ? above.toFixed(1) + "%" : "—"],
    ].forEach(function (pair) {
      var t = el("div", { className: "windgen-tile" });
      t.appendChild(el("div", { className: "windgen-tile-label", text: pair[0] }));
      t.appendChild(el("div", { className: "windgen-tile-value", text: pair[1] }));
      tiles.appendChild(t);
    });
    body.appendChild(tiles);
  }

  function renderWithin() {
    var body = document.getElementById("windgen-within-body");
    if (!body) return;
    body.innerHTML = "";

    if (mode.kind === "cell" && mode.cell && cellsData) {
      var flat = mode.cell.flat;
      var m = state.calendarMonth;
      var mean = cellsData.clim[flat * 12 + m] / 100;
      var k = decodeKCell(cellsData.k_month[flat * 12 + m]);
      var mean0 = mean;
      var k0 = k;
      // approximate shares from Weibull with steadiness scaling k
      var st = state.steadiness;
      k = k * st;
      var g1 = gammaApprox(1 + 1 / k);
      var lam = mean / g1;
      function cdf(x) {
        return 1 - Math.exp(-Math.pow(x / lam, k));
      }
      weibullTiles(body, mean, k, mean0, k0, 100 * cdf(4), 100 * (1 - cdf(12)));
      return;
    }

    if (!place || place.type !== "point") {
      body.appendChild(
        el("div", { className: "empty-state", text: "Select a point or cell" })
      );
      return;
    }
    var wm = place.within_month[String(state.steadiness)];
    if (!wm) {
      body.appendChild(el("div", { className: "empty-state", text: "No within-month table" }));
      return;
    }
    var mm = state.calendarMonth;
    var meanP = decode(wm.mean)[mm];
    var kP = decodeK(wm.k[mm]);
    var base = place.within_month["1.0"] || wm;
    var mean0p = decode(base.mean)[mm];
    var k0p = decodeK(base.k[mm]);
    weibullTiles(
      body,
      meanP,
      kP,
      mean0p,
      k0p,
      decodeShare(wm.share_below_4[mm]),
      decodeShare(wm.share_above_12[mm])
    );
  }

  function syncModeNotes() {
    var cellNote = document.getElementById("windgen-cell-note");
    var levelsNote = document.getElementById("windgen-levels-note");
    if (cellNote) cellNote.hidden = mode.kind !== "cell";
    if (levelsNote) levelsNote.hidden = mode.kind !== "percent";
    var title = document.querySelector("#windgen-projection .card-title");
    // chart main title
    var titles = document.querySelectorAll("#windgen-projection .windgen-chart-main .card-title");
    if (titles && titles[0]) {
      titles[0].textContent =
        mode.kind === "percent"
          ? "Monthly change vs normal (%)"
          : "Monthly mean speed at 100 m";
    }
  }

  function redraw() {
    var bundle = seriesBundle();
    if (!bundle) return;
    var c1 = document.getElementById("windgen-chart-path");
    var c2 = document.getElementById("windgen-chart-normal");
    if (c1) drawPathChart(c1, bundle);
    if (c2) drawNormalChart(c2, bundle);
    syncModeNotes();
    renderWithin();
    renderNotes();
  }

  function setSteadinessEnabled(on) {
    var st = document.getElementById("windgen-steadiness");
    var hint = document.getElementById("windgen-steadiness-hint");
    if (st) st.disabled = !on;
    if (hint) hint.hidden = !!on;
  }

  function onSelectionChange(sel) {
    if (!sel || !sel.id) {
      place = null;
      mode = { kind: "place" };
      state.placeId = null;
      setStatus("");
      setSteadinessEnabled(false);
      var c1 = document.getElementById("windgen-chart-path");
      var c2 = document.getElementById("windgen-chart-normal");
      if (c1) c1.getContext("2d").clearRect(0, 0, c1.width, c1.height);
      if (c2) c2.getContext("2d").clearRect(0, 0, c2.width, c2.height);
      syncModeNotes();
      renderWithin();
      renderNotes();
      setStatus("Select a country, point or cell to load a projection.");
      return Promise.resolve();
    }

    if (sel.type === "cell" && sel.cell && cellsData) {
      var flat = sel.cell.flat;
      var drv = cellsData.countries[cellsData.driver[flat]];
      mode = { kind: "cell", cell: sel.cell, driver: drv };
      setStatus("Loading driver " + drv + "…");
      return loadPlace(drv)
        .then(function (p) {
          place = p;
          state.placeId = drv;
          setStatus("");
          setSteadinessEnabled(true);
          redraw();
        })
        .catch(function (err) {
          setStatus("Could not load driver: " + err.message, true);
        });
    }

    var id = sel.id;
    setStatus("Loading " + id + "…");
    return loadPlace(id)
      .then(function (p) {
        place = p;
        state.placeId = id;
        if (p.type === "country" && countryOutsidePilot(id)) {
          mode = { kind: "percent" };
        } else {
          mode = { kind: "place" };
        }
        setStatus("");
        setSteadinessEnabled(p.type === "point");
        redraw();
      })
      .catch(function (err) {
        setStatus("Could not load place data: " + err.message, true);
      });
  }

  function onPlaceChange(id) {
    return onSelectionChange({ id: id, type: id && id.charAt(0) === "P" ? "point" : "country" });
  }

  function bindControls(root) {
    function bindSlider(id, key, gridKey) {
      var input = root.querySelector("#" + id);
      var out = root.querySelector("#" + id + "-val");
      input.addEventListener("input", function () {
        var vals = index.grid[gridKey];
        var i = Number(input.value);
        state[key] = vals[i];
        if (out) out.textContent = String(state[key]);
        redraw();
      });
    }
    bindSlider("windgen-vol", "vol", "volatility");
    bindSlider("windgen-drift", "drift", "drift_pct_per_decade");
    bindSlider("windgen-steadiness", "steadiness", "steadiness");

    var pers = root.querySelector("#windgen-pers");
    pers.addEventListener("change", function () {
      state.pers = pers.checked ? 1.0 : 0.0;
      redraw();
    });

    root.querySelector("#windgen-next-path").addEventListener("click", function () {
      var n = (index.path_seeds || []).length || 3;
      state.seedIndex = (state.seedIndex + 1) % n;
      redraw();
    });
    root.querySelector("#windgen-reset").addEventListener("click", function () {
      var d = index.defaults || {};
      state.vol = d.volatility != null ? d.volatility : 1;
      state.pers = d.persistence != null ? d.persistence : 1;
      state.drift = d.drift_pct_per_decade != null ? d.drift_pct_per_decade : 0;
      state.steadiness = d.steadiness != null ? d.steadiness : 1;
      state.seedIndex = d.seed_index || 0;
      syncControls();
      redraw();
    });

    var pathCanvas = root.querySelector("#windgen-chart-path");
    pathCanvas.addEventListener("mousemove", function (ev) {
      var rect = pathCanvas.getBoundingClientRect();
      var x = ev.clientX - rect.left;
      var padL = 44;
      var padR = 12;
      var w = rect.width - padL - padR;
      var n = place ? place.n_months : 120;
      var i = Math.round(((x - padL) / w) * (n - 1));
      hoverIdx = Math.max(0, Math.min(n - 1, i));
      redraw();
    });
    pathCanvas.addEventListener("mouseleave", function () {
      hoverIdx = -1;
      redraw();
    });
  }

  function syncControls() {
    if (!index) return;
    var g = index.grid;
    var vol = document.getElementById("windgen-vol");
    var drift = document.getElementById("windgen-drift");
    var st = document.getElementById("windgen-steadiness");
    var pers = document.getElementById("windgen-pers");
    if (vol) {
      vol.value = String(idxOf(g.volatility, state.vol));
      var vo = document.getElementById("windgen-vol-val");
      if (vo) vo.textContent = String(state.vol);
    }
    if (drift) {
      drift.value = String(idxOf(g.drift_pct_per_decade, state.drift));
      var dvo = document.getElementById("windgen-drift-val");
      if (dvo) dvo.textContent = String(state.drift);
    }
    if (st) {
      st.value = String(idxOf(g.steadiness, state.steadiness));
      var svo = document.getElementById("windgen-steadiness-val");
      if (svo) svo.textContent = String(state.steadiness);
    }
    if (pers) pers.checked = Number(state.pers) === 1;
  }

  function placesList() {
    return index ? index.places : [];
  }

  function init() {
    var root = document.getElementById("windgen-projection");
    if (!root) return;
    setStatus("Loading index…");
    Promise.all([
      loadIndex(),
      fetchJson(BASE + "cells.json").then(function (j) {
        cellsData = j;
        return j;
      }),
      fetchJson("data/countries.json").then(function (j) {
        countriesMeta = j;
        return j;
      }),
    ])
      .then(function () {
        syncControls();
        bindControls(root);
        setStatus("");
        if (window.PlaceSelection) {
          window.PlaceSelection.onChange(function (sel, source) {
            if (source === "windgen") return;
            onSelectionChange(sel);
          });
          var cur = window.PlaceSelection.get();
          if (cur.id) return onSelectionChange(cur);
          window.PlaceSelection.set("UK", "country", "windgen-init");
          return onSelectionChange({ id: "UK", type: "country" });
        }
        return onPlaceChange(state.placeId || "UK");
      })
      .catch(function (err) {
        setStatus("Could not load WindGen index: " + err.message, true);
      });

    window.addEventListener("resize", function () {
      if (place) redraw();
    });
  }

  window.WindGenPanel = {
    init: init,
    lastDrawMs: function () {
      return lastDrawMs;
    },
    places: placesList,
    getIndex: function () {
      return index;
    },
    getCells: function () {
      return cellsData;
    },
    seriesBundleForTest: seriesBundle,
    getState: function () {
      return state;
    },
  };
})();
