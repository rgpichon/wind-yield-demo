/* Cell projection transform (browser). Deterministic hash noise; matches Python ref. */
(function (global) {
  "use strict";

  function mulberry32(a) {
    return function () {
      var t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashU32(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /** Box-Muller normal from deterministic seed string. */
  function zNormal(cellFlat, seedIndex, t) {
    var key = "cell|" + cellFlat + "|" + seedIndex + "|" + t;
    var rnd = mulberry32(hashU32(key));
    var u1 = Math.max(1e-12, rnd());
    var u2 = rnd();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /**
   * Build cell path bundle from country series + cell params.
   * country*: arrays length nMonths in m/s (already decoded).
   * clim: length-12 m/s; beta, sigmaEps scalars; vol scalar; seedIndex int.
   */
  function transformCell(opts) {
    var clim = opts.clim;
    var beta = opts.beta;
    var sigmaEps = opts.sigmaEps;
    var vol = opts.vol;
    var seedIndex = opts.seedIndex | 0;
    var cellFlat = opts.cellFlat | 0;
    var cMed = opts.countryMedian;
    var cPath = opts.countryPath;
    var cLo = opts.countryLo;
    var cHi = opts.countryHi;
    var cNorm = opts.countryNormal;
    var n = cMed.length;
    var median = new Array(n);
    var path = new Array(n);
    var lo = new Array(n);
    var hi = new Array(n);
    var normal = clim.slice();

    for (var t = 0; t < n; t++) {
      var m = t % 12;
      var cn = cNorm[m];
      if (!(cn > 0)) cn = 1e-6;
      var med = clim[m] * (cMed[t] / cn);
      median[t] = med;
      var sigmaC = 0;
      if (cMed[t] > 1e-9) {
        sigmaC = (cHi[t] - cLo[t]) / (2 * cMed[t]);
      }
      var relBand = Math.sqrt(
        Math.pow(beta * sigmaC, 2) + Math.pow(sigmaEps, 2)
      );
      lo[t] = Math.max(0, med * (1 - relBand));
      hi[t] = med * (1 + relBand);
      var z = zNormal(cellFlat, seedIndex, t);
      var noise = sigmaEps * vol * z;
      // path = clim[m] * (country_path / country_normal) + clim[m] * noise
      // equivalent to med * (cPath/cMed) when cMed tracks drift
      path[t] = clim[m] * (cPath[t] / cn) + clim[m] * noise;
      if (path[t] < 0) path[t] = 0;
    }
    return { median: median, path: path, lo: lo, hi: hi, normal: normal };
  }

  /** Percent change vs calendar-month normal (for countries outside pilot). */
  function toPercentBundle(bundle) {
    var n = bundle.median.length;
    var out = {
      median: new Array(n),
      path: new Array(n),
      lo: new Array(n),
      hi: new Array(n),
      normal: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      unit: "percent",
    };
    for (var t = 0; t < n; t++) {
      var base = bundle.normal[t % 12];
      if (!(base > 0)) base = 1e-6;
      out.median[t] = (100 * (bundle.median[t] - base)) / base;
      out.path[t] = (100 * (bundle.path[t] - base)) / base;
      out.lo[t] = (100 * (bundle.lo[t] - base)) / base;
      out.hi[t] = (100 * (bundle.hi[t] - base)) / base;
    }
    return out;
  }

  function countryInPilotBox(bboxes, id, box) {
    var b = bboxes && bboxes[id];
    if (!b) return false;
    // b: [lon0, lat0, lon1, lat1] or {lon0,...}
    var lon0, lat0, lon1, lat1;
    if (Array.isArray(b)) {
      lon0 = b[0];
      lat0 = b[1];
      lon1 = b[2];
      lat1 = b[3];
    } else {
      lon0 = b.lon0;
      lat0 = b.lat0;
      lon1 = b.lon1;
      lat1 = b.lat1;
    }
    return !(lon1 < box.lon0 || lon0 > box.lon1 || lat1 < box.lat0 || lat0 > box.lat1);
  }

  global.CellPath = {
    transformCell: transformCell,
    toPercentBundle: toPercentBundle,
    zNormal: zNormal,
    countryInPilotBox: countryInPilotBox,
    PILOT: { lat0: 47, lat1: 59, lon0: -4, lon1: 15 },
  };
})(window);
