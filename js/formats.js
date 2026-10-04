/* formats.js — subtitle file decoding (text encodings), format detection,
   WebVTT and ASS/SSA parsing, and export to every supported format */
const Formats = (function () {
  const LIST = [
    { id: "srt", label: "SubRip (.srt)", ext: "srt", mime: "text/plain" },
    { id: "vtt", label: "WebVTT (.vtt)", ext: "vtt", mime: "text/vtt" },
    { id: "ass", label: "Advanced SubStation Alpha (.ass)", ext: "ass", mime: "text/plain" },
  ];

  // [value, label]; "auto" sniffs BOMs and falls back from UTF-8 to Windows-1252
  const ENCODINGS = [
    ["auto", "Auto-detect"],
    ["utf-8", "UTF-8"],
    ["utf-16le", "UTF-16 LE"],
    ["utf-16be", "UTF-16 BE"],
    ["windows-1252", "Western (Windows-1252)"],
    ["iso-8859-15", "Western (ISO-8859-15)"],
    ["windows-1250", "Central European (Windows-1250)"],
    ["iso-8859-2", "Central European (ISO-8859-2)"],
    ["windows-1251", "Cyrillic (Windows-1251)"],
    ["koi8-r", "Cyrillic (KOI8-R)"],
    ["windows-1253", "Greek (Windows-1253)"],
    ["windows-1254", "Turkish (Windows-1254)"],
    ["windows-1255", "Hebrew (Windows-1255)"],
    ["windows-1256", "Arabic (Windows-1256)"],
    ["windows-1257", "Baltic (Windows-1257)"],
    ["windows-874", "Thai (Windows-874)"],
    ["shift_jis", "Japanese (Shift_JIS)"],
    ["euc-kr", "Korean (EUC-KR)"],
    ["gb18030", "Chinese Simplified (GB18030)"],
    ["big5", "Chinese Traditional (Big5)"],
  ];

  // ArrayBuffer -> { text, encoding, guessed }
  function decode(buffer, encoding) {
    const bytes = new Uint8Array(buffer);
    if (encoding && encoding !== "auto") {
      return { text: new TextDecoder(encoding).decode(bytes), encoding, guessed: false };
    }
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return { text: new TextDecoder("utf-8").decode(bytes), encoding: "utf-8", guessed: false };
    }
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return { text: new TextDecoder("utf-16le").decode(bytes), encoding: "utf-16le", guessed: false };
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return { text: new TextDecoder("utf-16be").decode(bytes), encoding: "utf-16be", guessed: false };
    }
    // UTF-16 without a BOM: ASCII text leaves every other byte zero
    const sample = bytes.subarray(0, 2000);
    let evenZeros = 0, oddZeros = 0;
    for (let i = 0; i < sample.length; i++) if (sample[i] === 0) i % 2 ? oddZeros++ : evenZeros++;
    if (sample.length > 20 && oddZeros > sample.length / 4) {
      return { text: new TextDecoder("utf-16le").decode(bytes), encoding: "utf-16le", guessed: true };
    }
    if (sample.length > 20 && evenZeros > sample.length / 4) {
      return { text: new TextDecoder("utf-16be").decode(bytes), encoding: "utf-16be", guessed: true };
    }
    try {
      return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8", guessed: false };
    } catch (err) {
      // not valid UTF-8: most older subtitle files are Windows-1252
      return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252", guessed: true };
    }
  }

  function encodingLabel(value) {
    const hit = ENCODINGS.find((e) => e[0] === value);
    return hit ? hit[1] : value;
  }

  function extOf(filename) {
    const m = /\.([^.]+)$/.exec(filename || "");
    return m ? m[1].toLowerCase() : "";
  }

  function detect(text, filename) {
    const head = text.replace(/^﻿/, "").slice(0, 2000);
    if (/^\s*WEBVTT/.test(head)) return "vtt";
    if (/^\s*\[Script Info\]/im.test(head) || /^\s*Dialogue:/im.test(text.slice(0, 20000))) return "ass";
    const ext = extOf(filename);
    if (ext === "vtt") return "vtt";
    if (ext === "ass" || ext === "ssa") return "ass";
    return "srt";
  }

  function isSubtitleFile(filename) {
    return ["srt", "vtt", "ass", "ssa", "txt"].includes(extOf(filename));
  }

  // ---------- WebVTT ----------
  const VTT_TIME_RE = /((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})/;

  function decodeEntities(s) {
    return s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/&lrm;/g, "‎")
      .replace(/&rlm;/g, "‏")
      .replace(/&amp;/g, "&");
  }

  function parseVtt(text) {
    const cues = [];
    const blocks = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/);
    for (const block of blocks) {
      const lines = block.split("\n");
      const first = lines[0].trim();
      if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(first)) continue;
      const ti = lines.findIndex((l) => VTT_TIME_RE.test(l));
      if (ti === -1) continue;
      const m = lines[ti].match(VTT_TIME_RE);
      const start = Utils.timecodeToMs(m[1]);
      const end = Utils.timecodeToMs(m[2]);
      if (start === null || end === null) continue;
      const body = lines
        .slice(ti + 1)
        .join("\n")
        .replace(/<\d{1,2}:\d{2}(?::\d{2})?\.\d{3}>/g, "") // karaoke timestamps
        .replace(/<\/?c(?:\.[^>]*)?>/g, "") // class spans
        .trim();
      cues.push({ id: Utils.uid(), start, end, text: decodeEntities(body) });
    }
    return cues.sort((a, b) => a.start - b.start);
  }

  // ---------- ASS / SSA ----------
  const ASS_DEFAULT_FORMAT = ["layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"];

  // "{\i1\b1}" override blocks -> <i>/<b>/<u>; everything else in braces is dropped
  function assToText(s) {
    return s
      .replace(/\{([^}]*)\}/g, (all, inner) => {
        let out = "";
        inner.split("\\").forEach((tag) => {
          const m = /^([ibu])([01])$/.exec(tag.trim());
          if (m) out += m[2] === "1" ? `<${m[1]}>` : `</${m[1]}>`;
        });
        return out;
      })
      .replace(/\\N/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\h/g, " ");
  }

  function parseAss(text) {
    const cues = [];
    let section = "";
    let format = ASS_DEFAULT_FORMAT;
    for (const raw of text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n")) {
      const line = raw.trim();
      const sec = /^\[(.+)\]$/.exec(line);
      if (sec) {
        section = sec[1].toLowerCase();
        continue;
      }
      if (section !== "events") continue;
      if (/^format\s*:/i.test(line)) {
        format = line.slice(line.indexOf(":") + 1).split(",").map((f) => f.trim().toLowerCase());
        continue;
      }
      if (!/^dialogue\s*:/i.test(line)) continue;
      let rest = line.slice(line.indexOf(":") + 1).trimStart();
      const fields = [];
      for (let i = 0; i < format.length - 1; i++) {
        const comma = rest.indexOf(",");
        if (comma === -1) break;
        fields.push(rest.slice(0, comma));
        rest = rest.slice(comma + 1);
      }
      fields.push(rest);
      const get = (name) => fields[format.indexOf(name)];
      const start = Utils.timecodeToMs((get("start") || "").trim());
      const end = Utils.timecodeToMs((get("end") || "").trim());
      if (start === null || end === null) continue;
      cues.push({ id: Utils.uid(), start, end, text: assToText(get("text") || "").trim() });
    }
    return cues.sort((a, b) => a.start - b.start);
  }

  function assTime(ms) {
    const cs = Math.round(Math.max(0, ms) / 10);
    const h = Math.floor(cs / 360000);
    const m = Math.floor((cs % 360000) / 6000);
    const s = Math.floor((cs % 6000) / 100);
    return `${h}:${Utils.pad(m)}:${Utils.pad(s)}.${Utils.pad(cs % 100)}`;
  }

  function textToAss(t) {
    return String(t || "")
      .replace(/<(\/?)([ibu])>/gi, (all, close, tag) => `{\\${tag.toLowerCase()}${close ? 0 : 1}}`)
      .replace(/<[^>]+>/g, "")
      .replace(/\n/g, "\\N");
  }

  function toAss(cues) {
    const sorted = [...cues].sort((a, b) => a.start - b.start);
    const head = [
      "[Script Info]",
      "; Script generated by Caption",
      "ScriptType: v4.00+",
      "PlayResX: 384",
      "PlayResY: 288",
      "WrapStyle: 0",
      "ScaledBorderAndShadow: yes",
      "",
      "[V4+ Styles]",
      "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
      "Style: Default,Arial,16,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1",
      "",
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ];
    const body = sorted.map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${textToAss(c.text)}`);
    return head.concat(body).join("\n") + "\n";
  }

  // ---------- dispatch ----------
  function parse(text, filename) {
    const format = detect(text, filename);
    const cues = format === "vtt" ? parseVtt(text) : format === "ass" ? parseAss(text) : SRT.parse(text);
    return { format, cues };
  }

  function serialize(cues, format) {
    if (format === "vtt") return SRT.toVtt(cues);
    if (format === "ass") return toAss(cues);
    return SRT.toSrt(cues);
  }

  function info(format) {
    return LIST.find((f) => f.id === format) || LIST[0];
  }

  return { LIST, ENCODINGS, decode, encodingLabel, detect, isSubtitleFile, parse, serialize, info, extOf };
})();
