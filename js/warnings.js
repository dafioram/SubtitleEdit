/* warnings.js — quality-check rules shared by the cue list and timeline */
const Warnings = (function () {
  // cues must be the full, start-sorted array; index is this cue's position in it
  function compute(cue, index, cues, settings) {
    const issues = [];
    const dur = cue.end - cue.start;

    if (dur <= 0) {
      issues.push("Zero or negative duration");
    } else if (settings.minDurationMs && dur < settings.minDurationMs) {
      issues.push(`Duration is ${dur}ms (min ${settings.minDurationMs}ms)`);
    }

    const lines = Utils.lines(cue.text);
    const charCount = String(cue.text || "").replace(/\n/g, "").length;

    if (settings.maxLines && lines.length > settings.maxLines) {
      issues.push(`${lines.length} lines (max ${settings.maxLines})`);
    }
    lines.forEach((l, i) => {
      if (settings.maxLineLength && l.length > settings.maxLineLength) {
        issues.push(`Line ${i + 1} has ${l.length} chars (max ${settings.maxLineLength})`);
      }
    });

    if (dur > 0 && settings.maxCps) {
      const cps = charCount / (dur / 1000);
      if (cps > settings.maxCps) {
        issues.push(`${cps.toFixed(1)} chars/sec (max ${settings.maxCps})`);
      }
    }

    if (index > 0) {
      const prev = cues[index - 1];
      if (prev && cue.start < prev.end) {
        issues.push("Overlaps previous cue");
      }
    }

    if (!cue.text || !cue.text.trim()) {
      issues.push("Empty text");
    }

    return issues;
  }

  return { compute };
})();
