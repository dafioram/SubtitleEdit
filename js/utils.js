/* utils.js — small stateless helpers shared across the app */
const Utils = (function () {
  function pad(n, len) {
    len = len || 2;
    return String(Math.trunc(n)).padStart(len, "0");
  }

  // ms (number) -> "HH:MM:SS,mmm" (sep=',') or "HH:MM:SS.mmm" (sep='.')
  function msToTimecode(ms, sep) {
    sep = sep || ",";
    if (!isFinite(ms) || ms < 0) ms = 0;
    ms = Math.round(ms);
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const msPart = ms % 1000;
    return pad(h) + ":" + pad(m) + ":" + pad(s) + sep + pad(msPart, 3);
  }

  // Accepts "HH:MM:SS,mmm" / "HH:MM:SS.mmm" / "MM:SS.mmm" / "SS.mmm" -> ms or null
  function timecodeToMs(str) {
    if (typeof str !== "string") return null;
    str = str.trim();

    let m = str.match(/^(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})$/);
    if (m) {
      const h = +m[1], mi = +m[2], s = +m[3], msv = +m[4].padEnd(3, "0");
      return ((h * 60 + mi) * 60 + s) * 1000 + msv;
    }
    m = str.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (m) {
      const h = +m[1], mi = +m[2], s = +m[3];
      return ((h * 60 + mi) * 60 + s) * 1000;
    }
    m = str.match(/^(\d{1,3}):(\d{2})[.,](\d{1,3})$/);
    if (m) {
      const mi = +m[1], s = +m[2], msv = +m[3].padEnd(3, "0");
      return (mi * 60 + s) * 1000 + msv;
    }
    m = str.match(/^(\d{1,3}):(\d{2})$/);
    if (m) {
      const mi = +m[1], s = +m[2];
      return (mi * 60 + s) * 1000;
    }
    m = str.match(/^(\d+)[.,](\d{1,3})$/);
    if (m) {
      return (+m[1]) * 1000 + +(m[2].padEnd(3, "0"));
    }
    m = str.match(/^(\d+)$/);
    if (m) return (+m[1]) * 1000;
    return null;
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function uid() {
    return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function debounce(fn, wait) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // Splits cue text into its visual lines (SRT/VTT use \n for line breaks)
  function lines(text) {
    return String(text || "").split("\n");
  }

  function readableDuration(ms) {
    const s = ms / 1000;
    return (Math.round(s * 100) / 100).toFixed(2) + "s";
  }

  return { pad, msToTimecode, timecodeToMs, clamp, uid, debounce, escapeHtml, lines, readableDuration };
})();
