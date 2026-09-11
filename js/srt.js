/* srt.js — SRT parsing/export, plus VTT export */
const SRT = (function () {
  const TIME_PAIR_RE = /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})\s*-{2,3}>\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})/;

  // text -> [{id, start, end, text}], sorted by start time
  function parse(text) {
    const cues = [];
    if (!text) return cues;

    const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const blocks = normalized.split(/\n\s*\n/);

    for (const block of blocks) {
      const rawLines = block.split("\n").map((l) => l.trim());
      const timeLineIndex = rawLines.findIndex((l) => TIME_PAIR_RE.test(l));
      if (timeLineIndex === -1) continue;

      const match = rawLines[timeLineIndex].match(TIME_PAIR_RE);
      const start = Utils.timecodeToMs(match[1]);
      const end = Utils.timecodeToMs(match[2]);
      if (start === null || end === null) continue;

      const textLines = rawLines.slice(timeLineIndex + 1);
      // trim trailing/leading blank lines but keep internal ones
      while (textLines.length && textLines[0] === "") textLines.shift();
      while (textLines.length && textLines[textLines.length - 1] === "") textLines.pop();

      cues.push({
        id: Utils.uid(),
        start: Math.max(0, start),
        end: Math.max(0, end),
        text: textLines.join("\n"),
      });
    }

    cues.sort((a, b) => a.start - b.start);
    return cues;
  }

  function toSrt(cues) {
    const sorted = [...cues].sort((a, b) => a.start - b.start);
    return sorted
      .map((c, i) => `${i + 1}\n${Utils.msToTimecode(c.start, ",")} --> ${Utils.msToTimecode(c.end, ",")}\n${c.text || ""}\n`)
      .join("\n")
      .trim() + "\n";
  }

  function toVtt(cues) {
    const sorted = [...cues].sort((a, b) => a.start - b.start);
    const body = sorted
      .map((c, i) => `${i + 1}\n${Utils.msToTimecode(c.start, ".")} --> ${Utils.msToTimecode(c.end, ".")}\n${c.text || ""}\n`)
      .join("\n")
      .trim();
    return "WEBVTT\n\n" + body + "\n";
  }

  return { parse, toSrt, toVtt };
})();
