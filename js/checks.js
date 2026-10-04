/* checks.js — "questionable text" detection (odd characters, likely OCR and
   typing slips) and the automatic fixes offered by "Fix common errors" */
const Checks = (function () {
  const DEFAULT_CHARS = "/|\\_~^*#@{}<>=";

  const RULES = [
    { id: "chars", label: "Unusual characters (listed above)" },
    { id: "doubleSpace", label: "Double spaces" },
    { id: "edgeSpace", label: "Spaces at the start or end of a line" },
    { id: "spaceBeforePunct", label: "Space before punctuation" },
    { id: "repeatedWord", label: "Repeated words (“the the”)" },
    { id: "ocr", label: "Likely OCR errors (lone “l” for “I”, digits inside words)" },
    { id: "unbalanced", label: "Unbalanced quotes, brackets or italic tags" },
    { id: "emptyLine", label: "Empty lines inside a cue" },
  ];

  const DEFAULTS = {
    chars: DEFAULT_CHARS,
    rules: Object.fromEntries(RULES.map((r) => [r.id, true])),
  };

  const TAG_RE = /<\/?(?:i|b|u|s|font)\b[^>]*>|\{\\[^}]*\}/gi;
  const DOUBLE_SPACE_RE = /(?<=\S)[ \t]{2,}(?=\S)/g;
  const EDGE_SPACE_RE = /^[ \t]+|[ \t]+$/gm;
  // "." only counts when it ends a sentence — not "...", ".srt" or ".5"
  const SPACE_BEFORE_PUNCT_RE = /(?<=\S)[ \t]+(?=[,;:!?]|\.(?![.\p{L}\p{N}]))/gu;
  const REPEATED_WORD_RE = /(?<![\p{L}\p{N}])(\p{L}+)[ \t]+\1(?![\p{L}\p{N}])/giu;
  const LONE_L_RE = /(?<![\p{L}\p{N}'’])l(?=['’](?:m|ll|ve|d|s)(?![\p{L}])|(?![\p{L}\p{N}'’]))/gu;
  const DIGIT_IN_WORD_RE = /(?<=\p{L})[015](?=\p{L})/gu;

  function opts(o) {
    o = o || {};
    return { chars: typeof o.chars === "string" ? o.chars : DEFAULT_CHARS, rules: { ...DEFAULTS.rules, ...(o.rules || {}) } };
  }

  function each(re, text, fn) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      fn(m);
      if (m[0].length === 0) re.lastIndex++;
    }
  }

  // text -> [{ start, end, label }] sorted by position
  function find(text, options) {
    text = String(text || "");
    if (!text) return [];
    const o = opts(options);
    const r = o.rules;
    const out = [];
    const add = (start, end, label) => out.push({ start, end, label });

    const tags = [];
    each(TAG_RE, text, (m) => tags.push([m.index, m.index + m[0].length]));
    const inTag = (i) => tags.some(([a, b]) => i >= a && i < b);

    if (r.chars && o.chars) {
      const set = new Set([...o.chars].filter((c) => c.trim()));
      for (let i = 0; i < text.length; i++) {
        if (set.has(text[i]) && !inTag(i)) add(i, i + 1, `Unusual character “${text[i]}”`);
      }
    }
    if (r.doubleSpace) each(DOUBLE_SPACE_RE, text, (m) => add(m.index, m.index + m[0].length, "Double space"));
    if (r.edgeSpace) each(EDGE_SPACE_RE, text, (m) => m[0] && add(m.index, m.index + m[0].length, "Space at start/end of line"));
    if (r.spaceBeforePunct) each(SPACE_BEFORE_PUNCT_RE, text, (m) => add(m.index, m.index + m[0].length, "Space before punctuation"));
    if (r.repeatedWord) each(REPEATED_WORD_RE, text, (m) => add(m.index, m.index + m[0].length, `Repeated word “${m[1]}”`));
    if (r.ocr) {
      each(LONE_L_RE, text, (m) => add(m.index, m.index + 1, "Lone “l” — should it be “I”?"));
      each(DIGIT_IN_WORD_RE, text, (m) => add(m.index, m.index + 1, `Digit “${m[0]}” inside a word`));
    }
    if (r.unbalanced) {
      const flagAll = (re, label) => each(re, text, (m) => add(m.index, m.index + m[0].length, label));
      const count = (re) => (text.match(re) || []).length;
      if (count(/<i>/gi) !== count(/<\/i>/gi)) flagAll(/<\/?i>/gi, "Unbalanced italic tag");
      if (count(/"/g) % 2) flagAll(/"/g, "Unbalanced quote");
      if (count(/\(/g) !== count(/\)/g)) flagAll(/[()]/g, "Unbalanced parenthesis");
      if (count(/\[/g) !== count(/\]/g)) flagAll(/[[\]]/g, "Unbalanced bracket");
    }
    if (r.emptyLine && text.includes("\n")) {
      let pos = 0;
      text.split("\n").forEach((line) => {
        if (!line.trim()) add(Math.max(0, pos - 1), Math.max(1, pos), "Empty line");
        pos += line.length + 1;
      });
    }
    return out.sort((a, b) => a.start - b.start || a.end - b.end);
  }

  // ---------- fixes ----------
  const FIXES = [
    { id: "trimLines", label: "Trim spaces at the start and end of lines", on: true,
      text: (t) => t.split("\n").map((l) => l.replace(/^[ \t]+|[ \t]+$/g, "")).join("\n") },
    { id: "doubleSpaces", label: "Collapse double spaces", on: true,
      text: (t) => t.replace(DOUBLE_SPACE_RE, " ") },
    { id: "spaceBeforePunct", label: "Remove spaces before punctuation", on: true,
      text: (t) => t.replace(SPACE_BEFORE_PUNCT_RE, "") },
    { id: "emptyLines", label: "Remove empty lines inside cues", on: true,
      text: (t) => t.split("\n").filter((l) => l.trim() !== "").join("\n") },
    { id: "pipeToI", label: "Replace “|” with “I” (common OCR error)", on: true,
      text: (t) => t.replace(/\|/g, "I") },
    { id: "loneL", label: "Replace a lone “l” with “I” (English OCR error)", on: false,
      text: (t) => t.replace(LONE_L_RE, "I") },
    { id: "repeatedWords", label: "Remove repeated words (“the the” → “the”)", on: false,
      text: (t) => t.replace(REPEATED_WORD_RE, "$1") },
    { id: "removeEmpty", label: "Delete cues that have no text", on: true, list: true },
    { id: "overlaps", label: "Fix overlaps (end each cue where the next one starts)", on: false, list: true },
  ];

  function applyFix(fix, cues) {
    let changed = 0;
    if (fix.id === "removeEmpty") {
      const kept = cues.filter((c) => (c.text || "").trim());
      return { cues: kept, changed: cues.length - kept.length };
    }
    if (fix.id === "overlaps") {
      const out = cues.map((c, i) => {
        const next = cues[i + 1];
        if (next && c.end > next.start) {
          changed++;
          return { ...c, end: Math.max(c.start + 100, next.start) };
        }
        return c;
      });
      return { cues: out, changed };
    }
    const out = cues.map((c) => {
      const t = fix.text(c.text || "");
      if (t === (c.text || "")) return c;
      changed++;
      return { ...c, text: t };
    });
    return { cues: out, changed };
  }

  // counts per fix, each measured on its own against the current cues
  function previewFixes(cues) {
    return Object.fromEntries(FIXES.map((f) => [f.id, applyFix(f, cues).changed]));
  }

  // applies the enabled fixes in order; returns { cues, changed: total cues touched }
  function applyFixes(cues, enabled) {
    const before = new Map(cues.map((c) => [c.id, c]));
    let cur = cues;
    FIXES.forEach((f) => {
      if (enabled[f.id]) cur = applyFix(f, cur).cues;
    });
    const touched = cues.length - cur.length + cur.filter((c) => before.get(c.id) !== c).length;
    return { cues: cur, changed: touched };
  }

  return { DEFAULT_CHARS, RULES, DEFAULTS, FIXES, find, previewFixes, applyFixes };
})();
