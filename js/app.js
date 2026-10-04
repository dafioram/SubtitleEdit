/* app.js — wires DOM, Store, Timeline, Waveform, Formats and Checks together */
(function () {
  const $ = (id) => document.getElementById(id);
  const MIN_DUR = 100; // ms
  const THEME_KEY = "subtitle-editor-theme";
  const AUTOSAVE_KEY = "subtitle-editor-autosave-v1";
  const EDITOR_KEY = "subtitle-editor-show-editor";

  const els = {
    app: $("app"),

    // toolbar
    btnNew: $("btn-new"),
    btnOpenVideo: $("btn-open-video"),
    inputVideo: $("input-video"),
    btnOpenSrt: $("btn-open-srt"),
    inputSrt: $("input-srt"),
    btnSample: $("btn-sample"),
    exportMenu: $("export-menu"),
    toolsMenu: $("tools-menu"),
    btnUndo: $("btn-undo"),
    btnRedo: $("btn-redo"),
    btnAdd: $("btn-add"),
    btnSplit: $("btn-split"),
    btnMerge: $("btn-merge"),
    btnDelete: $("btn-delete"),
    btnFind: $("btn-find"),
    btnSettings: $("btn-settings"),
    btnHelp: $("btn-help"),
    btnTheme: $("btn-theme"),
    iconSun: document.querySelector("#btn-theme .icon-sun"),
    iconMoon: document.querySelector("#btn-theme .icon-moon"),

    // video
    video: $("video"),
    videoEmpty: $("video-empty"),
    btnOpenVideo2: $("btn-open-video-2"),
    btnPlay: $("btn-play"),
    iconPlay: document.querySelector("#btn-play .icon-play"),
    iconPause: document.querySelector("#btn-play .icon-pause"),
    timeCurrent: $("time-current"),
    timeDuration: $("time-duration"),
    playbackRate: $("playback-rate"),

    // cue pane
    cuePane: $("cue-pane"),
    cueCount: $("cue-count"),
    warningSummary: $("warning-summary"),
    listFilter: $("list-filter"),
    btnToggleEditor: $("btn-toggle-editor"),
    filterEmpty: $("filter-empty"),
    cueList: $("cue-list"),

    // find bar
    findBar: $("find-bar"),
    findText: $("find-text"),
    findCount: $("find-count"),
    findPrev: $("find-prev"),
    findNext: $("find-next"),
    findClose: $("find-close"),
    replaceText: $("replace-text"),
    replaceOne: $("replace-one"),
    replaceAll: $("replace-all"),
    findCase: $("find-case"),
    findWord: $("find-word"),
    findRegex: $("find-regex"),
    findOnly: $("find-only"),

    // editor panel
    editor: $("cue-editor"),
    editorLabel: $("editor-label"),
    editorStart: $("editor-start"),
    editorEnd: $("editor-end"),
    editorDuration: $("editor-duration"),
    editorText: $("editor-text"),
    editorMirror: document.querySelector("#cue-editor .cue-text-mirror"),
    editorStats: $("editor-stats"),
    editorPrev: $("editor-prev"),
    editorNext: $("editor-next"),

    // timeline
    zoomSlider: $("zoom-slider"),
    zoomIn: $("zoom-in"),
    zoomOut: $("zoom-out"),
    waveformStatus: $("waveform-status"),
    timelineCanvas: $("timeline-canvas"),
    minimapCanvas: $("minimap-canvas"),

    // status bar
    statusFile: $("status-file"),
    statusAutosave: $("status-autosave"),
    encodingSelect: $("encoding-select"),

    // modals
    settingsMaxLineLength: $("settings-max-line-length"),
    settingsMaxLines: $("settings-max-lines"),
    settingsMaxCps: $("settings-max-cps"),
    settingsMinDuration: $("settings-min-duration"),
    settingsSave: $("settings-save"),
    shiftAmount: $("shift-amount"),
    shiftApply: $("shift-apply"),
    qChars: $("q-chars"),
    qRules: $("q-rules"),
    qSummary: $("q-summary"),
    qResults: $("q-results"),
    qShow: $("q-show"),
    qFix: $("q-fix"),
    qReset: $("q-reset"),
    fixList: $("fix-list"),
    fixApply: $("fix-apply"),
  };

  const videoEl = els.video;
  let timeline = null;
  let currentVideoName = null;
  let currentSubName = null;
  let currentFormat = "srt"; // format the subtitles were opened in; Ctrl+S exports to it
  let lastSubFile = null; // { name, buffer } — kept so a different encoding can re-read it
  let activePlayingId = null;
  let rafId = null;
  let editSnapshotTaken = false;
  let playheadMs = 0; // timeline playhead when there is no video
  let playheadFromTimeline = false; // the person clicked the timeline since the last selection
  let listFilter = "all";
  let qCache = new WeakMap(); // cue object -> questionable findings (cue objects are immutable)

  const find = { re: null, error: "", matches: [], byCue: new Map(), current: -1, stale: false };

  // id -> row element, persisted across renders so unaffected rows are never
  // recreated (keeps focus/scroll intact and avoids rebuilding huge lists)
  const rowMap = new Map();
  let renderGeneration = 0;
  const CHUNK_THRESHOLD = 200; // only spread work across frames above this many new rows
  const CHUNK_BUDGET_MS = 8; // time budget per frame while chunk-loading

  // Browsers with `field-sizing: content` grow each textarea to fit its
  // (wrapped) text in pure CSS; others need the JS measuring below.
  const FIELD_SIZING = !!(window.CSS && CSS.supports && CSS.supports("field-sizing", "content"));

  // ---------- small helpers ----------
  function fitHeight(textarea) {
    const border = textarea.offsetHeight - textarea.clientHeight;
    return textarea.scrollHeight + border;
  }

  // Precise (forces layout) — only ever called for the single row a person is
  // actively typing into, never in a bulk loop.
  function autoGrow(textarea) {
    if (FIELD_SIZING) return;
    textarea.style.height = "auto";
    textarea.style.height = fitHeight(textarea) + "px";
  }

  // Fallback sizing for bulk renders: line count alone misses lines that wrap,
  // which left long cues clipped inside a too-short box. Queued textareas are
  // measured together once per frame (all writes, then all reads, then all
  // writes) so a large list costs one reflow rather than one per row.
  // Rows scrolled out of view are skipped (CSS content-visibility) and only
  // measured once they come near the viewport, so opening a long file doesn't
  // force a layout of every row.
  const pendingSize = new Set();
  let sizeFrame = null;
  const rowVisibility = FIELD_SIZING
    ? null
    : new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const row = entry.target;
            row._nearView = entry.isIntersecting;
            if (row._nearView && row._refs.text._needsSize) queueSize(row._refs.text);
          });
        },
        { root: document.getElementById("cue-list"), rootMargin: "400px 0px" }
      );
  function queueSize(textarea) {
    if (FIELD_SIZING) return;
    const row = textarea.closest(".cue-row");
    if (row && !row._nearView) {
      textarea._needsSize = true; // sized when it scrolls into view
      return;
    }
    textarea._needsSize = false;
    pendingSize.add(textarea);
    if (!sizeFrame) sizeFrame = requestAnimationFrame(flushSizes);
  }
  function flushSizes() {
    sizeFrame = null;
    const list = [...pendingSize].filter((t) => t.isConnected);
    pendingSize.clear();
    list.forEach((t) => (t.style.height = "auto"));
    const heights = list.map(fitHeight);
    list.forEach((t, i) => (t.style.height = heights[i] + "px"));
  }

  function plural(n, word, many) {
    return `${n} ${n === 1 ? word : many || word + "s"}`;
  }

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }
  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      /* private mode / storage full — non-essential */
    }
  }

  function downloadText(filename, content, mime) {
    const blob = new Blob([content], { type: mime + ";charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function baseFilename() {
    const name = currentSubName || currentVideoName || "subtitles";
    return name.replace(/\.[^.]+$/, "");
  }

  function triggerExport(format) {
    const cues = Store.getCues();
    if (!cues.length) {
      UI.toast("There are no cues to export yet.");
      return;
    }
    const info = Formats.info(format);
    downloadText(baseFilename() + "." + info.ext, Formats.serialize(cues, format), info.mime);
  }

  function updateStatusFile() {
    const parts = [];
    if (currentVideoName) parts.push(currentVideoName);
    if (currentSubName) parts.push(`${currentSubName} (${Formats.info(currentFormat).ext.toUpperCase()})`);
    els.statusFile.textContent = parts.length ? parts.join(" · ") : "No project loaded";
  }

  function hasVideo() {
    return !!videoEl.getAttribute("src") && videoEl.readyState > 0;
  }

  function currentMs() {
    return hasVideo() ? videoEl.currentTime * 1000 : playheadMs;
  }

  function setPlayhead(ms) {
    playheadMs = Math.max(0, ms);
    if (hasVideo()) videoEl.currentTime = playheadMs / 1000;
    else if (timeline) timeline.setCurrentTime(playheadMs / 1000);
  }

  // ---------- questionable text + highlighting ----------
  function qFor(cue) {
    let r = qCache.get(cue);
    if (!r) {
      r = Checks.find(cue.text, Store.getSettings().questionable);
      qCache.set(cue, r);
    }
    return r;
  }

  function uniqueLabels(findings) {
    return [...new Set(findings.map((f) => f.label))];
  }

  function highlightsFor(cue) {
    const out = qFor(cue).map((q) => ({ start: q.start, end: q.end, cls: "hl-q" }));
    const ms = find.byCue.get(cue.id);
    if (ms) ms.forEach((m) => out.push({ start: m.start, end: m.end, cls: m.i === find.current ? "hl-current" : "hl-find" }));
    return out;
  }

  // escaped HTML for `text` with <mark>s for the given ranges; overlapping
  // ranges resolve per character to the strongest class
  const HL_RANK = { "hl-q": 1, "hl-find": 2, "hl-current": 3 };
  function markup(text, ranges, newline) {
    const cls = new Array(text.length).fill(null);
    ranges.forEach((r) => {
      for (let i = Math.max(0, r.start); i < Math.min(text.length, r.end); i++) {
        if (!cls[i] || HL_RANK[r.cls] > HL_RANK[cls[i]]) cls[i] = r.cls;
      }
    });
    let html = "";
    let i = 0;
    while (i < text.length) {
      let j = i;
      while (j < text.length && cls[j] === cls[i]) j++;
      let seg = Utils.escapeHtml(text.slice(i, j));
      if (newline) seg = seg.replace(/\n/g, newline);
      html += cls[i] ? `<mark class="${cls[i]}">${seg}</mark>` : seg;
      i = j;
    }
    return html;
  }

  // The mirror sits behind a transparent textarea with identical metrics, so
  // its <mark>s appear as highlights on the text being edited.
  function setMirror(mirror, text, ranges) {
    const key = ranges.length ? text + "\u0000" + ranges.map((r) => `${r.start}:${r.end}:${r.cls}`).join(",") : "";
    if (mirror._key === key) return;
    mirror._key = key;
    if (!ranges.length) {
      mirror.textContent = "";
      return;
    }
    mirror.innerHTML = markup(text, ranges) + (text.endsWith("\n") ? " " : "");
  }

  // ---------- cue list rendering ----------
  function buildRow() {
    const row = document.createElement("div");
    row.className = "cue-row";
    row.innerHTML = `
      <div class="cue-row-head">
        <span class="cue-index"></span>
        <div class="cue-times">
          <input type="text" class="time-input" data-field="start" spellcheck="false" aria-label="Start time">
          <span class="time-sep">&rarr;</span>
          <input type="text" class="time-input" data-field="end" spellcheck="false" aria-label="End time">
        </div>
        <span class="cue-duration"></span>
        <span class="cue-badges"><span class="warning-dot" hidden>!</span><span class="q-dot" hidden>?</span></span>
        <button type="button" class="row-delete icon-btn small" data-action="delete" title="Delete cue" aria-label="Delete cue">&times;</button>
      </div>
      <div class="cue-text-wrap">
        <div class="cue-text-mirror" aria-hidden="true"></div>
        <textarea class="cue-text" data-field="text" rows="1" spellcheck="true" aria-label="Subtitle text"></textarea>
      </div>
    `;
    // cache child lookups once so later updates never re-query the DOM
    if (rowVisibility) rowVisibility.observe(row);
    row._refs = {
      index: row.querySelector(".cue-index"),
      start: row.querySelector('[data-field="start"]'),
      end: row.querySelector('[data-field="end"]'),
      duration: row.querySelector(".cue-duration"),
      dot: row.querySelector(".warning-dot"),
      qdot: row.querySelector(".q-dot"),
      mirror: row.querySelector(".cue-text-mirror"),
      text: row.querySelector(".cue-text"),
    };
    return row;
  }

  function cueMatchesFilter(cue, issues) {
    switch (listFilter) {
      case "warnings":
        return issues.length > 0;
      case "questionable":
        return qFor(cue).length > 0;
      case "matches":
        return !find.re || find.byCue.has(cue.id);
      default:
        return true;
    }
  }

  // Every store change re-runs this for every row, so it only touches the DOM
  // when a value actually differs. Rewriting unchanged text/values on 2000
  // rows invalidated the whole list's layout and made each keystroke ~200ms.
  function setText(el, v) {
    if (el._text !== v) el.textContent = el._text = v;
  }
  function setProp(el, prop, v) {
    if (el[prop] !== v) el[prop] = v;
  }

  function updateRowContent(row, cue, index, issues, initial) {
    const refs = row._refs;
    const q = qFor(cue);
    if (row.dataset.id !== cue.id) row.dataset.id = cue.id;
    row.classList.toggle("selected", Store.isSelected(cue.id));
    row.classList.toggle("primary", cue.id === Store.getSelected());
    row.classList.toggle("has-warning", issues.length > 0);
    row.classList.toggle("active", cue.id === activePlayingId);
    setText(refs.index, String(index + 1));

    if (initial || document.activeElement !== refs.start) {
      setProp(refs.start, "value", Utils.msToTimecode(cue.start, ","));
      refs.start.classList.remove("invalid");
    }
    if (initial || document.activeElement !== refs.end) {
      setProp(refs.end, "value", Utils.msToTimecode(cue.end, ","));
      refs.end.classList.remove("invalid");
    }

    setText(refs.duration, Utils.readableDuration(cue.end - cue.start));

    setProp(refs.dot, "hidden", !issues.length);
    setProp(refs.dot, "title", issues.join("; "));
    setProp(refs.qdot, "hidden", !q.length);
    setProp(refs.qdot, "title", q.length ? "Questionable: " + uniqueLabels(q).join("; ") : "");

    if ((initial || document.activeElement !== refs.text) && refs.text.value !== (cue.text || "")) {
      refs.text.value = cue.text || "";
      // Cheap sizing from line count; wrapped lines are handled by CSS
      // field-sizing or the batched queueSize() fallback.
      setProp(refs.text, "rows", Math.max(1, Utils.lines(cue.text || "").length));
      queueSize(refs.text);
    }
    setMirror(refs.mirror, cue.text || "", highlightsFor(cue));

    // a row someone is typing in never vanishes mid-edit because of a filter
    setProp(row, "hidden", !cueMatchesFilter(cue, issues) && !row.contains(document.activeElement));
  }

  function computeAllIssues(cues, settings) {
    return cues.map((cue, i) => Warnings.compute(cue, i, cues, settings));
  }

  function reorderRows(cues) {
    let anchor = els.cueList.firstChild;
    for (const cue of cues) {
      const row = rowMap.get(cue.id);
      if (!row) continue;
      if (row === anchor) {
        anchor = anchor.nextSibling;
      } else {
        els.cueList.insertBefore(row, anchor);
      }
    }
  }

  function renderCueList() {
    const cues = Store.getCues();
    const settings = Store.getSettings();
    const idSet = new Set(cues.map((c) => c.id));

    // drop rows for cues that no longer exist
    for (const [id, row] of rowMap) {
      if (!idSet.has(id)) {
        row.remove();
        rowMap.delete(id);
      }
    }

    const allIssues = computeAllIssues(cues, settings);
    let totalWarnings = 0;
    let totalQuestionable = 0;
    let visible = 0;
    cues.forEach((cue, i) => {
      if (allIssues[i].length) totalWarnings++;
      if (qFor(cue).length) totalQuestionable++;
      if (cueMatchesFilter(cue, allIssues[i])) visible++;
    });

    const filtered = listFilter !== "all" && !(listFilter === "matches" && !find.re);
    els.cueCount.textContent = filtered ? `${visible} / ${cues.length}` : String(cues.length);
    const summary = [];
    if (totalWarnings) summary.push(plural(totalWarnings, "warning"));
    if (totalQuestionable) summary.push(`${totalQuestionable} questionable`);
    els.warningSummary.textContent = summary.join(" · ");
    els.warningSummary.classList.toggle("has-warnings", totalWarnings + totalQuestionable > 0);
    els.btnUndo.disabled = !Store.canUndo();
    els.btnRedo.disabled = !Store.canRedo();

    els.filterEmpty.hidden = !(filtered && cues.length && !visible);
    if (!els.filterEmpty.hidden) {
      els.filterEmpty.textContent =
        listFilter === "warnings" ? "No cues have warnings." :
        listFilter === "questionable" ? "No questionable text found." :
        "No cues match your search.";
    }

    const newCount = cues.reduce((n, c) => n + (rowMap.has(c.id) ? 0 : 1), 0);
    renderGeneration++;
    const myGen = renderGeneration;

    if (newCount > CHUNK_THRESHOLD) {
      chunkedApply(cues, allIssues, myGen);
    } else {
      cues.forEach((cue, i) => {
        let row = rowMap.get(cue.id);
        let initial = false;
        if (!row) {
          row = buildRow();
          rowMap.set(cue.id, row);
          initial = true;
        }
        updateRowContent(row, cue, i, allIssues[i], initial);
      });
      reorderRows(cues);
    }
  }

  // Bulk-loads (e.g. opening a large file) create many rows at once. Rather
  // than build them all synchronously — which can block the tab for seconds
  // and forces the browser to do it all in one uninterruptible burst — this
  // spreads row creation across animation frames in small time-boxed batches,
  // appending each row as it's made so subtitles visibly stream in and the
  // page stays responsive throughout.
  function chunkedApply(cues, allIssues, myGen) {
    let i = 0;
    const total = cues.length;

    function step() {
      if (myGen !== renderGeneration) return; // a newer render superseded this one
      const start = performance.now();
      while (i < total && performance.now() - start < CHUNK_BUDGET_MS) {
        const cue = cues[i];
        let row = rowMap.get(cue.id);
        let initial = false;
        if (!row) {
          row = buildRow();
          rowMap.set(cue.id, row);
          initial = true;
          els.cueList.appendChild(row);
        }
        updateRowContent(row, cue, i, allIssues[i], initial);
        i++;
      }
      if (i < total) {
        requestAnimationFrame(step);
      } else {
        reorderRows(cues);
      }
    }

    requestAnimationFrame(step);
  }

  function setActiveCue(id) {
    if (id === activePlayingId) return;
    if (activePlayingId) {
      const prev = rowMap.get(activePlayingId);
      if (prev) prev.classList.remove("active");
    }
    activePlayingId = id;
    if (id) {
      const row = rowMap.get(id);
      if (row && !row.hidden) {
        row.classList.add("active");
        row.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }

  function updateActiveCueForTime(ms) {
    const cues = Store.getCues();
    let found = null;
    for (const c of cues) {
      if (ms >= c.start && ms < c.end) {
        found = c.id;
        break;
      }
    }
    setActiveCue(found);
  }

  // ---------- editor panel ----------
  function editorShown() {
    return !els.cuePane.classList.contains("editor-hidden");
  }

  function setEditorShown(show) {
    els.cuePane.classList.toggle("editor-hidden", !show);
    els.btnToggleEditor.setAttribute("aria-pressed", String(show));
    storageSet(EDITOR_KEY, show ? "1" : "0");
  }

  function renderEditor() {
    const id = Store.getSelected();
    const cue = id ? Store.getCue(id) : null;
    const rebound = els.editor._cueId !== (cue ? cue.id : null);
    els.editor._cueId = cue ? cue.id : null;
    els.editor.classList.toggle("is-empty", !cue);
    [els.editorStart, els.editorEnd, els.editorDuration, els.editorText, els.editorPrev, els.editorNext].forEach((el) => (el.disabled = !cue));

    if (!cue) {
      els.editorLabel.textContent = Store.getCues().length ? "Select a cue to edit it here" : "No cue selected";
      els.editorStart.value = els.editorEnd.value = els.editorDuration.value = els.editorText.value = "";
      els.editorStats.innerHTML = "";
      setMirror(els.editorMirror, "", []);
      return;
    }

    const cues = Store.getCues();
    const idx = cues.findIndex((c) => c.id === cue.id);
    const n = Store.getSelectedIds().length;
    els.editorLabel.textContent = `#${idx + 1}` + (n > 1 ? ` · ${n} selected` : "");

    const ae = document.activeElement;
    if (rebound || ae !== els.editorStart) {
      els.editorStart.value = Utils.msToTimecode(cue.start, ",");
      els.editorStart.classList.remove("invalid");
    }
    if (rebound || ae !== els.editorEnd) {
      els.editorEnd.value = Utils.msToTimecode(cue.end, ",");
      els.editorEnd.classList.remove("invalid");
    }
    if (rebound || ae !== els.editorDuration) {
      els.editorDuration.value = ((cue.end - cue.start) / 1000).toFixed(3);
      els.editorDuration.classList.remove("invalid");
    }
    if (rebound || ae !== els.editorText) els.editorText.value = cue.text || "";
    setMirror(els.editorMirror, cue.text || "", highlightsFor(cue));

    const s = Store.getSettings();
    const lines = Utils.lines(cue.text || "");
    const lens = lines
      .map((l) => (s.maxLineLength && l.length > s.maxLineLength ? `<b class="over">${l.length}</b>` : String(l.length)))
      .join(" / ");
    const chars = String(cue.text || "").replace(/\n/g, "").length;
    const dur = (cue.end - cue.start) / 1000;
    const cps = dur > 0 ? chars / dur : 0;
    const cpsHtml = s.maxCps && cps > s.maxCps ? `<b class="over">${cps.toFixed(1)}</b>` : cps.toFixed(1);
    els.editorStats.innerHTML = `Line lengths ${lens} · ${chars} chars · ${cpsHtml} chars/sec`;
  }

  // ---------- shared field editing (list rows and editor panel) ----------
  function handleFieldInput(id, el) {
    const cue = Store.getCue(id);
    if (!cue) return;
    if (!editSnapshotTaken) {
      Store.pushHistory();
      editSnapshotTaken = true;
    }
    const field = el.dataset.field;
    if (field === "text") {
      if (el.closest(".cue-row")) autoGrow(el);
      typingId = id;
      Store.updateCue(id, { text: el.value }, { record: false, reason: "text" });
    } else if (field === "duration") {
      const sec = parseFloat(el.value.replace(",", "."));
      if (isFinite(sec) && sec > 0) {
        Store.updateCue(id, { end: cue.start + Math.round(sec * 1000) }, { record: false, resort: false });
        el.classList.remove("invalid");
      } else {
        el.classList.add("invalid");
      }
    } else {
      const ms = Utils.timecodeToMs(el.value);
      if (ms !== null) {
        Store.updateCue(id, { [field]: Math.max(0, ms) }, { record: false, resort: false });
        el.classList.remove("invalid");
      } else {
        el.classList.add("invalid");
      }
    }
  }

  function handleTimeFieldDone(id) {
    const cue = Store.getCue(id);
    if (!cue) return;
    if (cue.end <= cue.start) {
      Store.updateCue(id, { end: cue.start + MIN_DUR }, { record: false });
    }
    Store.resort();
    editSnapshotTaken = false;
  }

  // ---------- undo / redo, keeping the caret where it was ----------
  function withFocusRestored(fn) {
    const ae = document.activeElement;
    let restore = null;
    if (ae && ae.dataset && ae.dataset.field && ae.closest(".cue-row, #cue-editor")) {
      const row = ae.closest(".cue-row");
      const rowId = row && row.dataset.id;
      const field = ae.dataset.field;
      const editorEl = row ? null : ae;
      // blurring lets the list/editor accept the restored values
      ae.blur();
      restore = () => {
        const target = rowId ? rowMap.get(rowId) && rowMap.get(rowId).querySelector(`[data-field="${field}"]`) : editorEl;
        if (target && target.isConnected && !target.disabled) target.focus();
      };
    }
    fn();
    editSnapshotTaken = false;
    if (restore) restore();
  }

  function doUndo() {
    if (!Store.canUndo()) return;
    withFocusRestored(() => Store.undo());
  }
  function doRedo() {
    if (!Store.canRedo()) return;
    withFocusRestored(() => Store.redo());
  }

  // ---------- store change / autosave ----------
  const scheduleAutosave = Utils.debounce(() => {
    try {
      const payload = {
        cues: Store.getCues(),
        settings: Store.getSettings(),
        name: currentSubName,
        format: currentFormat,
        savedAt: Date.now(),
      };
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
      els.statusAutosave.textContent = "Saved " + new Date().toLocaleTimeString();
    } catch (err) {
      console.warn("Autosave failed", err);
    }
  }, 800);

  // Typing only changes one cue's text, which can't change any other row, so
  // that row is updated at once and the list-wide pass (counts, filter) runs
  // once typing pauses. Keeps keystrokes fast on feature-length files.
  let typingId = null;
  const renderListSoon = Utils.debounce(() => renderCueList(), 250);

  function renderTypedRow(id) {
    const cues = Store.getCues();
    const i = cues.findIndex((c) => c.id === id);
    const row = rowMap.get(id);
    if (i === -1 || !row) return false;
    updateRowContent(row, cues[i], i, Warnings.compute(cues[i], i, cues, Store.getSettings()), false);
    return true;
  }

  function onStoreChange(reason) {
    if (reason === "settings") qCache = new WeakMap();
    if (reason === "selection" || reason === "add") playheadFromTimeline = false;
    if (reason !== "selection" && !els.findBar.hidden) recomputeFind();
    if (reason === "text" && renderTypedRow(typingId)) renderListSoon();
    else renderCueList();
    renderEditor();
    if (isModalShown("modal-questionable")) renderQResults();
    if (reason !== "selection") scheduleAutosave();
  }

  function tryRestoreAutosave() {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.settings) Store.setSettings(data.settings);
      if (Array.isArray(data.cues) && data.cues.length) {
        Store.setCues(data.cues, { record: false });
        currentSubName = data.name || null;
        currentFormat = data.format || "srt";
        els.statusAutosave.textContent = "Restored autosaved session from " + new Date(data.savedAt).toLocaleString();
      }
    } catch (err) {
      console.warn("Restore failed", err);
    }
  }

  // ---------- opening files ----------
  function updateEncodingLabel(detected) {
    const auto = els.encodingSelect.querySelector('option[value="auto"]');
    auto.textContent = detected ? `Auto (${Formats.encodingLabel(detected)})` : "Auto-detect";
  }

  function loadSubtitleBuffer(name, buffer, encoding) {
    let decoded;
    try {
      decoded = Formats.decode(buffer, encoding);
    } catch (err) {
      UI.toast(`Couldn't read ${name} as ${Formats.encodingLabel(encoding)}.`, { kind: "error" });
      return false;
    }
    const { format, cues } = Formats.parse(decoded.text, name);
    if (!cues.length) {
      UI.toast(`No subtitles found in ${name}. Is it a valid .srt, .vtt, .ass or .ssa file?`, { kind: "error" });
      return false;
    }
    Store.setCues(cues);
    currentSubName = name;
    currentFormat = format;
    lastSubFile = { name, buffer };
    updateEncodingLabel(encoding === "auto" ? decoded.encoding : null);
    updateStatusFile();
    if (decoded.guessed) {
      UI.toast(`Read as ${Formats.encodingLabel(decoded.encoding)}. If letters look wrong, pick another encoding in the status bar.`);
    }
    return true;
  }

  async function openSubtitleFile(file) {
    const buffer = await file.arrayBuffer();
    loadSubtitleBuffer(file.name, buffer, els.encodingSelect.value);
  }

  // Without a video the player pane is hidden so the cue list gets the full
  // width instead of sitting beside an empty black box.
  function setHasVideo(has) {
    els.app.classList.toggle("no-video", !has);
  }

  async function openVideoFile(file) {
    const url = URL.createObjectURL(file);
    videoEl.src = url;
    videoEl.load();
    currentVideoName = file.name;
    updateStatusFile();
    setHasVideo(true);
    els.videoEmpty.hidden = true;
    els.waveformStatus.textContent = "";
    if (timeline) timeline.setWaveform(null);

    const data = await Waveform.generate(file, (msg) => {
      els.waveformStatus.textContent = msg;
    });
    if (timeline) timeline.setWaveform(data);
  }

  function isVideoFile(file) {
    return /^(video|audio)\//.test(file.type) || /\.(mp4|m4v|mkv|webm|mov|ogv|avi|mp3|m4a|wav|ogg)$/i.test(file.name);
  }

  function openDroppedFiles(files) {
    for (const file of files) {
      if (isVideoFile(file)) openVideoFile(file);
      else if (Formats.isSubtitleFile(file.name)) openSubtitleFile(file);
      else UI.toast(`Can't open ${file.name} — drop a video or a .srt, .vtt, .ass or .ssa file.`, { kind: "error" });
    }
  }

  // ---------- video ----------
  function togglePlay() {
    if (!hasVideo()) {
      UI.toast("Open a video to play it.");
      return;
    }
    if (videoEl.paused) videoEl.play();
    else videoEl.pause();
  }

  function seekBy(deltaMs) {
    if (!hasVideo()) return;
    videoEl.currentTime = Utils.clamp(videoEl.currentTime + deltaMs / 1000, 0, videoEl.duration || Infinity);
  }

  function syncFromVideo() {
    const ms = videoEl.currentTime * 1000;
    playheadMs = ms;
    els.timeCurrent.textContent = Utils.msToTimecode(ms, ",");
    if (timeline) timeline.setCurrentTime(videoEl.currentTime, { follow: false });
    updateActiveCueForTime(ms);
  }

  function tick() {
    if (videoEl.paused || videoEl.ended) {
      rafId = null;
      return;
    }
    const ms = videoEl.currentTime * 1000;
    els.timeCurrent.textContent = Utils.msToTimecode(ms, ",");
    if (timeline) timeline.setCurrentTime(videoEl.currentTime, { follow: true });
    updateActiveCueForTime(ms);
    rafId = requestAnimationFrame(tick);
  }

  function wireVideo() {
    els.btnOpenVideo.addEventListener("click", () => els.inputVideo.click());
    els.btnOpenVideo2.addEventListener("click", () => els.inputVideo.click());
    els.inputVideo.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) openVideoFile(file);
      e.target.value = "";
    });

    videoEl.addEventListener("error", () => {
      if (!videoEl.getAttribute("src")) return;
      setHasVideo(false);
      currentVideoName = null;
      updateStatusFile();
      UI.toast("That video could not be played. Your browser may not support its format or codec.", { kind: "error" });
    });

    videoEl.addEventListener("loadedmetadata", () => {
      els.videoEmpty.hidden = true;
      els.timeDuration.textContent = Utils.msToTimecode(videoEl.duration * 1000, ",");
      if (timeline) timeline.setDuration(videoEl.duration);
    });

    videoEl.addEventListener("play", () => {
      els.iconPlay.hidden = true;
      els.iconPause.hidden = false;
      els.btnPlay.setAttribute("aria-label", "Pause");
      if (!rafId) rafId = requestAnimationFrame(tick);
    });
    videoEl.addEventListener("pause", () => {
      els.iconPlay.hidden = false;
      els.iconPause.hidden = true;
      els.btnPlay.setAttribute("aria-label", "Play");
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      syncFromVideo();
    });
    videoEl.addEventListener("timeupdate", () => {
      if (videoEl.paused) syncFromVideo();
    });
    videoEl.addEventListener("seeked", syncFromVideo);

    els.btnPlay.addEventListener("click", togglePlay);
    els.playbackRate.addEventListener("change", () => {
      videoEl.playbackRate = parseFloat(els.playbackRate.value);
    });
  }

  // ---------- cue actions ----------
  function focusCueText(id, where) {
    requestAnimationFrame(() => {
      let el = null;
      if (where === "editor" || (where !== "row" && editorShown())) el = els.editorText;
      else {
        const row = rowMap.get(id);
        if (row) {
          row.scrollIntoView({ block: "nearest" });
          el = row._refs.text;
        }
      }
      if (el && !el.disabled) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }

  function selectCue(id, opts) {
    opts = opts || {};
    const cue = Store.getCue(id);
    if (!cue) return;
    Store.select(id);
    setPlayhead(cue.start);
    if (timeline) timeline.revealCue(id);
    const row = rowMap.get(id);
    if (row && !row.hidden) row.scrollIntoView({ block: opts.center ? "center" : "nearest" });
    if (opts.focus) focusCueText(id, opts.focus);
  }

  function addCue() {
    const cues = Store.getCues();
    let start;
    if (hasVideo() || playheadFromTimeline) {
      start = currentMs();
    } else {
      // no video: insert right after the selected cue, or at the end
      const sel = Store.getCue(Store.getSelected());
      start = sel ? sel.end : cues.length ? cues[cues.length - 1].end : 0;
    }
    start = Math.max(0, Math.round(start));
    let end = start + 2000;
    const next = cues.find((c) => c.start > start);
    if (next && next.start < end) end = Math.max(start + MIN_DUR, next.start);

    const cue = Store.addCue({ start, end, text: "" });
    if (timeline) timeline.revealCue(cue.id);
    focusCueText(cue.id, editorShown() ? "editor" : "row");
  }

  function deleteCues(ids) {
    if (!ids.length) {
      UI.toast("Select a cue first.");
      return;
    }
    const cues = Store.getCues();
    const firstIdx = cues.findIndex((c) => c.id === ids[0]);
    Store.removeCues(ids);
    // keep a selection so pressing Delete again carries on down the list
    const left = Store.getCues();
    const next = left[Math.min(firstIdx, left.length - 1)];
    if (next) Store.select(next.id);
    UI.toast(`Deleted ${plural(ids.length, "cue")}.`, { action: { label: "Undo", fn: doUndo } });
  }

  function splitText(text) {
    const lines = Utils.lines(text);
    if (lines.length > 1) {
      const mid = Math.ceil(lines.length / 2);
      return [lines.slice(0, mid).join("\n"), lines.slice(mid).join("\n")];
    }
    const words = (text || "").split(" ").filter(Boolean);
    const mid = Math.ceil(words.length / 2);
    return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
  }

  function splitSelectedCue() {
    const id = Store.getSelected();
    const cue = id && Store.getCue(id);
    if (!cue) {
      UI.toast("Select a cue to split first.");
      return;
    }
    if (cue.end - cue.start < MIN_DUR * 2) {
      UI.toast("That cue is too short to split.");
      return;
    }
    const [textA, textB] = splitText(cue.text);
    const at = currentMs();
    let splitMs;
    let byText = false;
    if ((hasVideo() || playheadFromTimeline) && at > cue.start + MIN_DUR && at < cue.end - MIN_DUR) {
      splitMs = Math.round(at);
    } else {
      // no usable playhead: divide the time in proportion to the text
      const total = textA.length + textB.length;
      const ratio = total ? textA.length / total : 0.5;
      splitMs = Utils.clamp(Math.round(cue.start + (cue.end - cue.start) * ratio), cue.start + MIN_DUR, cue.end - MIN_DUR);
      byText = true;
    }
    const cues = Store.getCues();
    const idx = cues.findIndex((c) => c.id === id);
    const cueA = { id: Utils.uid(), start: cue.start, end: splitMs, text: textA };
    const cueB = { id: Utils.uid(), start: splitMs, end: cue.end, text: textB };
    const newList = [...cues];
    newList.splice(idx, 1, cueA, cueB);
    Store.setCues(newList);
    Store.select(cueA.id);
    if (byText && hasVideo()) UI.toast("Split by text length — the playhead wasn't inside this cue.");
  }

  function mergeSelectedCues() {
    const cues = Store.getCues();
    const ids = Store.getSelectedIds();
    if (!ids.length) {
      UI.toast("Select a cue to merge first.");
      return;
    }
    let from, to;
    if (ids.length > 1) {
      const idxs = ids.map((id) => cues.findIndex((c) => c.id === id));
      from = idxs[0];
      to = idxs[idxs.length - 1];
      if (to - from !== idxs.length - 1) {
        UI.toast("Only neighbouring cues can be merged — select cues that are next to each other.");
        return;
      }
    } else {
      from = cues.findIndex((c) => c.id === ids[0]);
      to = from + 1;
      if (to >= cues.length) {
        UI.toast("This is the last cue — there's nothing after it to merge with.");
        return;
      }
    }
    const group = cues.slice(from, to + 1);
    const merged = {
      id: group[0].id,
      start: Math.min(...group.map((c) => c.start)),
      end: Math.max(...group.map((c) => c.end)),
      text: group.map((c) => c.text).filter(Boolean).join("\n"),
    };
    const newList = [...cues];
    newList.splice(from, group.length, merged);
    Store.setCues(newList);
    Store.select(merged.id);
  }

  function nudgeSelectedCue(dir, field) {
    const id = Store.getSelected();
    if (!id) return;
    const cue = Store.getCue(id);
    if (!cue) return;
    const delta = dir * 50;
    if (field === "start") {
      const newStart = Utils.clamp(cue.start + delta, 0, cue.end - MIN_DUR);
      Store.updateCue(id, { start: newStart });
    } else {
      const newEnd = Math.max(cue.start + MIN_DUR, cue.end + delta);
      Store.updateCue(id, { end: newEnd });
    }
    if (timeline) timeline.revealCue(id);
  }

  // moves through the cues currently shown in the list (respects the filter)
  function selectAdjacentCue(dir, focusWhere) {
    const all = Store.getCues();
    const shown = all.filter((c) => {
      const row = rowMap.get(c.id);
      return !row || !row.hidden;
    });
    if (!shown.length) return;
    const curId = Store.getSelected();
    let idx = shown.findIndex((c) => c.id === curId);
    if (idx === -1) {
      const curAll = all.findIndex((c) => c.id === curId);
      idx = curAll === -1 ? -1 : dir > 0 ? shown.findIndex((c) => all.indexOf(c) > curAll) : -1;
      if (idx === -1) idx = dir > 0 ? 0 : shown.length - 1;
    } else {
      idx = Utils.clamp(idx + dir, 0, shown.length - 1);
    }
    selectCue(shown[idx].id, { focus: focusWhere });
  }

  // ---------- cue list DOM interaction ----------
  function wireCueList() {
    // Ctrl/Cmd-click and Shift-click select without moving focus into the row
    els.cueList.addEventListener("mousedown", (e) => {
      const row = e.target.closest(".cue-row");
      if (!row || e.target.closest("[data-action]")) return;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        Store.toggleSelect(row.dataset.id);
      } else if (e.shiftKey) {
        e.preventDefault();
        Store.selectRange(row.dataset.id);
      }
    });

    els.cueList.addEventListener("click", (e) => {
      const row = e.target.closest(".cue-row");
      if (!row) return;
      const id = row.dataset.id;

      if (e.target.closest('[data-action="delete"]')) {
        deleteCues([id]);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.target.matches("input, textarea, button")) return;
      selectCue(id);
    });

    els.cueList.addEventListener("focusin", (e) => {
      if (!e.target.matches(".time-input, .cue-text")) return;
      editSnapshotTaken = false;
      const row = e.target.closest(".cue-row");
      if (row && (Store.getSelected() !== row.dataset.id || Store.getSelectedIds().length > 1)) Store.select(row.dataset.id);
      if (e.target.matches(".cue-text")) autoGrow(e.target);
    });

    els.cueList.addEventListener("input", (e) => {
      const row = e.target.closest(".cue-row");
      if (row) handleFieldInput(row.dataset.id, e.target);
    });

    els.cueList.addEventListener(
      "focusout",
      (e) => {
        if (!e.target.matches(".time-input")) return;
        const row = e.target.closest(".cue-row");
        if (row) handleTimeFieldDone(row.dataset.id);
      },
      true
    );
  }

  function wireEditor() {
    els.editor.addEventListener("focusin", () => {
      editSnapshotTaken = false;
    });
    els.editor.addEventListener("input", (e) => {
      if (els.editor._cueId && e.target.dataset.field) handleFieldInput(els.editor._cueId, e.target);
    });
    els.editor.addEventListener(
      "focusout",
      (e) => {
        if (els.editor._cueId && e.target.matches(".time-input")) handleTimeFieldDone(els.editor._cueId);
      },
      true
    );
    els.editorPrev.addEventListener("click", () => selectAdjacentCue(-1));
    els.editorNext.addEventListener("click", () => selectAdjacentCue(1));
    els.btnToggleEditor.addEventListener("click", () => setEditorShown(!editorShown()));

    // keep highlight mirrors aligned when a textarea scrolls internally
    document.addEventListener(
      "scroll",
      (e) => {
        const t = e.target;
        if (t && t.classList && t.classList.contains("cue-text") && t.previousElementSibling) {
          t.previousElementSibling.scrollTop = t.scrollTop;
        }
      },
      true
    );
  }

  // ---------- list filter ----------
  function setFilter(value) {
    listFilter = value;
    els.listFilter.value = value;
    els.findOnly.checked = value === "matches";
    if (value === "matches" && els.findBar.hidden) openFind();
    renderCueList();
  }

  // ---------- find & replace ----------
  function buildFindRegex() {
    find.error = "";
    const q = els.findText.value;
    if (!q) return null;
    let src = els.findRegex.checked ? q : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let flags = "g" + (els.findCase.checked ? "" : "i");
    if (els.findWord.checked) {
      src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
      flags += "u";
    }
    try {
      return new RegExp(src, flags);
    } catch (err) {
      find.error = "Invalid regex";
      return null;
    }
  }

  function recomputeFind() {
    find.re = buildFindRegex();
    find.matches = [];
    find.byCue = new Map();
    if (find.re) {
      Store.getCues().forEach((c, ci) => {
        const t = c.text || "";
        find.re.lastIndex = 0;
        let m;
        while ((m = find.re.exec(t))) {
          if (!m[0].length) {
            find.re.lastIndex++;
            continue;
          }
          const match = { cueId: c.id, ci, start: m.index, end: m.index + m[0].length, i: find.matches.length };
          find.matches.push(match);
          if (!find.byCue.has(c.id)) find.byCue.set(c.id, []);
          find.byCue.get(c.id).push(match);
        }
      });
    }
    if (find.current >= find.matches.length) find.current = find.matches.length - 1;
    updateFindCount();
  }

  function updateFindCount() {
    const n = find.matches.length;
    els.findCount.classList.toggle("is-error", !!find.error || (!!els.findText.value && !n));
    if (find.error) els.findCount.textContent = find.error;
    else if (!els.findText.value) els.findCount.textContent = "";
    else if (!n) els.findCount.textContent = "No results";
    else if (find.current >= 0) els.findCount.textContent = `${find.current + 1} of ${n}`;
    else els.findCount.textContent = `${n} found`;
  }

  function goToMatch(i) {
    const m = find.matches[i];
    if (!m) return;
    find.current = i;
    updateFindCount();
    selectCue(m.cueId, { center: true });
  }

  function findStep(dir) {
    if (flushFind()) return; // Enter/F3 pressed before the search ran: that search lands on the first match
    const n = find.matches.length;
    if (!n) return;
    let i;
    if (find.current >= 0) {
      i = (find.current + dir + n) % n;
    } else {
      const selIdx = Store.getCues().findIndex((c) => c.id === Store.getSelected());
      if (dir > 0) i = find.matches.findIndex((m) => m.ci >= selIdx);
      else for (i = n - 1; i >= 0 && find.matches[i].ci > selIdx; i--);
      if (i < 0 || i >= n) i = dir > 0 ? 0 : n - 1;
    }
    goToMatch(i);
  }

  function openFind() {
    els.findBar.hidden = false;
    // seed with text selected in a cue, like most editors do
    const ae = document.activeElement;
    if (ae && ae.matches && ae.matches(".cue-text") && ae.selectionEnd > ae.selectionStart) {
      const sel = ae.value.slice(ae.selectionStart, ae.selectionEnd);
      if (!sel.includes("\n")) els.findText.value = sel;
    }
    els.findText.focus();
    els.findText.select();
    find.current = -1;
    recomputeFind();
    renderCueList();
    renderEditor();
  }

  function closeFind() {
    els.findBar.hidden = true;
    find.stale = false;
    find.re = null;
    find.matches = [];
    find.byCue = new Map();
    find.current = -1;
    if (listFilter === "matches") listFilter = "all";
    els.listFilter.value = listFilter;
    els.findOnly.checked = false;
    renderCueList();
    renderEditor();
  }

  function onFindQueryChange() {
    find.current = -1;
    recomputeFind();
    // jump to the first match at or after the selection, as browsers do;
    // the selection change re-renders the list, so only render otherwise
    if (find.matches.length) findStep(1);
    else {
      renderCueList();
      renderEditor();
    }
  }

  // re-highlighting thousands of rows on every letter is wasted work —
  // search once typing in the find box pauses
  const onFindTyping = Utils.debounce(() => flushFind(), 150);

  // runs a search that is still waiting on the debounce; true if it ran
  function flushFind() {
    if (!find.stale) return false;
    find.stale = false;
    onFindQueryChange();
    return true;
  }

  function replaceCurrent() {
    flushFind();
    const m = find.matches[find.current];
    if (!m) {
      findStep(1);
      return;
    }
    const cue = Store.getCue(m.cueId);
    if (!cue) return;
    const t = cue.text || "";
    const repl = els.replaceText.value;
    let replaced;
    if (els.findRegex.checked) {
      const sticky = new RegExp(find.re.source, find.re.flags.replace("g", "") + "y");
      sticky.lastIndex = m.start;
      replaced = t.replace(sticky, repl);
    } else {
      replaced = t.slice(0, m.start) + repl + t.slice(m.end);
    }
    const insertedEnd = m.end + (replaced.length - t.length);
    const ci = m.ci;
    Store.updateCue(cue.id, { text: replaced }); // recomputes matches via onStoreChange
    let next = find.matches.findIndex((x) => x.ci > ci || (x.ci === ci && x.start >= insertedEnd));
    if (next === -1 && find.matches.length) next = 0;
    if (next >= 0) goToMatch(next);
    else {
      find.current = -1;
      updateFindCount();
      UI.toast("All matches replaced.");
    }
  }

  function replaceAllMatches() {
    const re = buildFindRegex();
    if (!re) {
      updateFindCount();
      return;
    }
    const repl = els.replaceText.value;
    const single = new RegExp(re.source, re.flags.replace("g", ""));
    let count = 0;
    let cuesChanged = 0;
    const updated = Store.getCues().map((c) => {
      const before = c.text || "";
      const after = before.replace(re, (whole) => {
        if (!whole.length) return whole;
        count++;
        // regex mode expands $1, $& …; plain mode inserts the text literally
        return els.findRegex.checked ? whole.replace(single, repl) : repl;
      });
      if (after === before) return c;
      cuesChanged++;
      return { ...c, text: after };
    });
    if (!count) {
      UI.toast("Nothing to replace.");
      return;
    }
    Store.setCues(updated);
    UI.toast(`Replaced ${plural(count, "match", "matches")} in ${plural(cuesChanged, "cue")}.`, {
      action: { label: "Undo", fn: doUndo },
    });
  }

  function wireFind() {
    els.btnFind.addEventListener("click", () => (els.findBar.hidden ? openFind() : els.findText.focus()));
    els.findClose.addEventListener("click", closeFind);
    els.findText.addEventListener("input", () => {
      find.stale = true;
      onFindTyping();
    });
    [els.findCase, els.findWord, els.findRegex].forEach((cb) => cb.addEventListener("change", onFindQueryChange));
    els.findOnly.addEventListener("change", () => setFilter(els.findOnly.checked ? "matches" : "all"));
    els.findNext.addEventListener("click", () => findStep(1));
    els.findPrev.addEventListener("click", () => findStep(-1));
    els.replaceOne.addEventListener("click", replaceCurrent);
    els.replaceAll.addEventListener("click", replaceAllMatches);
    els.findText.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        findStep(e.shiftKey ? -1 : 1);
      }
    });
    els.replaceText.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        replaceCurrent();
      }
    });
  }

  // ---------- questionable text ----------
  function isModalShown(id) {
    const m = $(id);
    return UI.isModalOpen() && m && !m.hidden;
  }

  function qSettings() {
    const q = Store.getSettings().questionable || {};
    return {
      chars: typeof q.chars === "string" ? q.chars : Checks.DEFAULT_CHARS,
      rules: { ...Checks.DEFAULTS.rules, ...(q.rules || {}) },
    };
  }

  function buildQRules() {
    if (els.qRules.childElementCount) return;
    els.qRules.innerHTML = Checks.RULES.map(
      (r) => `<label class="checkbox-field"><input type="checkbox" data-rule="${r.id}"> ${Utils.escapeHtml(r.label)}</label>`
    ).join("");
    els.qRules.addEventListener("change", (e) => {
      const id = e.target.dataset.rule;
      if (!id) return;
      const q = qSettings();
      q.rules[id] = e.target.checked;
      Store.setSettings({ questionable: q });
    });
  }

  function renderQResults() {
    const q = qSettings();
    if (document.activeElement !== els.qChars) els.qChars.value = q.chars;
    els.qRules.querySelectorAll("input[data-rule]").forEach((cb) => (cb.checked = !!q.rules[cb.dataset.rule]));

    const cues = Store.getCues();
    const flagged = [];
    let findings = 0;
    cues.forEach((c, i) => {
      const f = qFor(c);
      if (f.length) {
        flagged.push({ c, i, f });
        findings += f.length;
      }
    });
    els.qSummary.textContent = !cues.length
      ? "Open or add some subtitles to check them."
      : flagged.length
      ? `${plural(flagged.length, "cue")} flagged (${plural(findings, "finding")}). Click one to jump to it.`
      : "Nothing questionable found.";
    els.qShow.disabled = !flagged.length;

    const LIMIT = 300;
    els.qResults.innerHTML =
      flagged
        .slice(0, LIMIT)
        .map(({ c, i, f }) => {
          const snippet = markup(c.text || "", f.map((x) => ({ start: x.start, end: x.end, cls: "hl-q" })), '<span class="nl">↵</span>');
          return `<li><button type="button" data-id="${c.id}">
            <span class="r-meta">#${i + 1} · ${Utils.msToTimecode(c.start, ",")}</span>
            <span class="r-labels">${Utils.escapeHtml(uniqueLabels(f).join(" · "))}</span>
            <span class="r-snippet">${snippet}</span>
          </button></li>`;
        })
        .join("") + (flagged.length > LIMIT ? `<li class="muted small">…and ${flagged.length - LIMIT} more — use “Show only these in the list”.</li>` : "");
  }

  function openQuestionable() {
    buildQRules();
    renderQResults();
    UI.openModal("modal-questionable", "#q-chars");
  }

  // ---------- fix common errors ----------
  function fixSettings() {
    const saved = Store.getSettings().fixes || {};
    return Object.fromEntries(Checks.FIXES.map((f) => [f.id, saved[f.id] !== undefined ? !!saved[f.id] : f.on]));
  }

  function renderFixList() {
    const counts = Checks.previewFixes(Store.getCues());
    const enabled = fixSettings();
    els.fixList.innerHTML = Checks.FIXES.map((f) => {
      const n = counts[f.id];
      return `<label class="fix-row">
        <input type="checkbox" data-fix="${f.id}"${enabled[f.id] ? " checked" : ""}>
        <span>${Utils.escapeHtml(f.label)}</span>
        <span class="fix-count${n ? "" : " is-zero"}">${n ? plural(n, "cue") : "none"}</span>
      </label>`;
    }).join("");
  }

  function openFix() {
    renderFixList();
    UI.openModal("modal-fix", "#fix-apply");
  }

  function wireChecks() {
    els.qChars.addEventListener("input", () => {
      const q = qSettings();
      q.chars = els.qChars.value;
      Store.setSettings({ questionable: q });
    });
    els.qResults.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-id]");
      if (!btn) return;
      UI.closeModal();
      selectCue(btn.dataset.id, { center: true, focus: "row" });
    });
    els.qShow.addEventListener("click", () => {
      UI.closeModal();
      setFilter("questionable");
    });
    els.qFix.addEventListener("click", openFix);
    els.qReset.addEventListener("click", () => {
      Store.setSettings({ questionable: { chars: Checks.DEFAULT_CHARS, rules: { ...Checks.DEFAULTS.rules } } });
    });

    els.fixList.addEventListener("change", (e) => {
      const id = e.target.dataset.fix;
      if (!id) return;
      const fixes = fixSettings();
      fixes[id] = e.target.checked;
      Store.setSettings({ fixes });
    });
    els.fixApply.addEventListener("click", () => {
      const { cues, changed } = Checks.applyFixes(Store.getCues(), fixSettings());
      UI.closeModal();
      if (!changed) {
        UI.toast("Nothing needed fixing.");
        return;
      }
      Store.setCues(cues);
      UI.toast(`Fixed ${plural(changed, "cue")}.`, { action: { label: "Undo", fn: doUndo } });
    });
  }

  // ---------- toolbar ----------
  function closeMenus() {
    document.querySelectorAll(".menu.open").forEach((m) => m.classList.remove("open"));
  }

  function openSettings() {
    const s = Store.getSettings();
    els.settingsMaxLineLength.value = s.maxLineLength;
    els.settingsMaxLines.value = s.maxLines;
    els.settingsMaxCps.value = s.maxCps;
    els.settingsMinDuration.value = s.minDurationMs;
    UI.openModal("modal-settings");
  }

  function applyShift() {
    const amount = parseInt(els.shiftAmount.value, 10);
    if (!Number.isFinite(amount) || amount === 0) {
      UI.closeModal();
      return;
    }
    const scope = document.querySelector('input[name="shift-scope"]:checked').value;
    const cues = Store.getCues();
    let targets;
    if (scope === "all") {
      targets = new Set(cues.map((c) => c.id));
    } else {
      const ids = Store.getSelectedIds();
      if (!ids.length) {
        UI.toast("No cue selected — select one or choose “All cues”.");
        return;
      }
      if (scope === "selected") targets = new Set(ids);
      else {
        const from = cues.findIndex((c) => c.id === ids[0]);
        targets = new Set(cues.slice(from).map((c) => c.id));
      }
    }
    const shifted = cues.map((c) => {
      if (!targets.has(c.id)) return c;
      const newStart = Math.max(0, c.start + amount);
      const newEnd = Math.max(newStart + MIN_DUR, c.end + amount);
      return { ...c, start: newStart, end: newEnd };
    });
    Store.setCues(shifted);
    UI.closeModal();
    UI.toast(`Shifted ${plural(targets.size, "cue")} by ${amount > 0 ? "+" : ""}${amount} ms.`, { action: { label: "Undo", fn: doUndo } });
  }

  function wireToolbar() {
    els.btnNew.addEventListener("click", async () => {
      if (Store.getCues().length) {
        const ok = await UI.confirm({
          title: "Start a new project?",
          message: "This clears all current cues. The loaded video stays.",
          okLabel: "Clear cues",
          danger: true,
        });
        if (!ok) return;
      }
      Store.reset();
      currentSubName = null;
      currentFormat = "srt";
      lastSubFile = null;
      updateEncodingLabel(null);
      updateStatusFile();
      try {
        localStorage.removeItem(AUTOSAVE_KEY);
      } catch (err) {
        /* ignore */
      }
      els.statusAutosave.textContent = "";
    });

    els.btnOpenSrt.addEventListener("click", () => els.inputSrt.click());
    els.inputSrt.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (file) await openSubtitleFile(file);
      e.target.value = "";
    });

    els.btnSample.addEventListener("click", async () => {
      try {
        const res = await fetch("sample/sample.srt");
        if (!res.ok) throw new Error("missing");
        loadSubtitleBuffer("sample.srt", await res.arrayBuffer(), "auto");
      } catch (err) {
        UI.toast('Could not load the sample. If you opened index.html straight from disk, serve the folder with a local server (see README), or use "Open Subtitle".', {
          kind: "error",
        });
      }
    });

    // dropdown menus
    document.querySelectorAll("[data-menu]").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const menu = $(btn.dataset.menu);
        const wasOpen = menu.classList.contains("open");
        closeMenus();
        if (!wasOpen) menu.classList.add("open");
      })
    );
    document.addEventListener("click", closeMenus);
    els.exportMenu.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-format]");
      if (btn) triggerExport(btn.dataset.format);
    });
    els.toolsMenu.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-tool]");
      if (!btn) return;
      const tool = btn.dataset.tool;
      if (tool === "questionable") openQuestionable();
      else if (tool === "fix") openFix();
      else if (tool === "shift") UI.openModal("modal-shift");
      else if (tool === "settings") openSettings();
    });

    els.btnUndo.addEventListener("click", doUndo);
    els.btnRedo.addEventListener("click", doRedo);

    els.btnAdd.addEventListener("click", addCue);
    els.btnDelete.addEventListener("click", () => deleteCues(Store.getSelectedIds()));
    els.btnSplit.addEventListener("click", splitSelectedCue);
    els.btnMerge.addEventListener("click", mergeSelectedCues);

    els.shiftApply.addEventListener("click", applyShift);

    els.btnSettings.addEventListener("click", openSettings);
    els.settingsSave.addEventListener("click", () => {
      Store.setSettings({
        maxLineLength: parseInt(els.settingsMaxLineLength.value, 10) || 42,
        maxLines: parseInt(els.settingsMaxLines.value, 10) || 2,
        maxCps: parseInt(els.settingsMaxCps.value, 10) || 21,
        minDurationMs: parseInt(els.settingsMinDuration.value, 10) || 700,
      });
      UI.closeModal();
    });

    els.btnHelp.addEventListener("click", () => UI.openModal("modal-help"));

    els.btnTheme.addEventListener("click", () => {
      const cur = document.documentElement.dataset.theme === "light" ? "light" : "dark";
      applyTheme(cur === "light" ? "dark" : "light");
    });

    $("modal-overlay").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) UI.closeModal();
    });
    document.querySelectorAll(".modal-close").forEach((btn) => btn.addEventListener("click", UI.closeModal));

    els.listFilter.addEventListener("change", () => setFilter(els.listFilter.value));

    Formats.ENCODINGS.forEach(([value, label]) => els.encodingSelect.add(new Option(label, value)));
    els.encodingSelect.addEventListener("change", () => {
      if (!lastSubFile) return; // used for the next file opened
      const enc = els.encodingSelect.value;
      if (loadSubtitleBuffer(lastSubFile.name, lastSubFile.buffer, enc)) {
        const how = enc === "auto" ? "with the encoding auto-detected" : "as " + Formats.encodingLabel(enc);
        UI.toast(`Re-read ${lastSubFile.name} ${how}.`, { action: { label: "Undo", fn: doUndo } });
      }
    });

    els.zoomSlider.addEventListener("input", () => timeline.setZoom(parseFloat(els.zoomSlider.value)));
    els.zoomIn.addEventListener("click", () => timeline.setZoom(timeline.getZoom() * 1.3));
    els.zoomOut.addEventListener("click", () => timeline.setZoom(timeline.getZoom() / 1.3));

    // A mouse-clicked toolbar button keeps keyboard focus, which used to
    // swallow shortcuts (Space would "click" it again). Drop that focus;
    // keyboard-activated buttons (detail === 0) keep theirs.
    document.addEventListener(
      "click",
      (e) => {
        const b = e.target.closest && e.target.closest("button");
        if (b && e.detail > 0 && !b.closest(".modal, .find-bar, .cue-editor, .toasts")) b.blur();
      },
      true
    );

    // drag & drop files anywhere on the window
    let dragDepth = 0;
    const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
    window.addEventListener("dragenter", (e) => {
      if (!hasFiles(e)) return;
      dragDepth++;
      document.body.classList.add("drag-over");
    });
    window.addEventListener("dragleave", (e) => {
      if (!hasFiles(e)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) document.body.classList.remove("drag-over");
    });
    window.addEventListener("dragover", (e) => {
      if (hasFiles(e)) e.preventDefault();
    });
    window.addEventListener("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      document.body.classList.remove("drag-over");
      openDroppedFiles([...e.dataTransfer.files]);
    });
  }

  function updateThemeIcon() {
    const theme = document.documentElement.dataset.theme;
    els.iconSun.hidden = theme !== "dark";
    els.iconMoon.hidden = theme === "dark";
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    storageSet(THEME_KEY, theme);
    updateThemeIcon();
    if (timeline) timeline.refreshTheme();
  }

  // ---------- keyboard shortcuts ----------
  function wireKeyboard() {
    document.addEventListener("keydown", (e) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key;
      const lower = key.length === 1 ? key.toLowerCase() : key;
      const ae = document.activeElement;
      const tag = ae && ae.tagName;
      const inField = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (ae && ae.isContentEditable);
      const inCueField = inField && !!ae.closest(".cue-row, #cue-editor");

      if (key === "Escape") {
        if (document.querySelector(".menu.open")) return closeMenus();
        if (UI.isModalOpen()) return UI.closeModal();
        if (ae && ae.closest && ae.closest("#find-bar")) return closeFind();
        if (ae && ae.blur) ae.blur();
        return;
      }
      if (UI.isModalOpen()) return;

      // --- these work everywhere, including while typing in a cue ---
      if (mod && lower === "f") {
        e.preventDefault();
        openFind();
        return;
      }
      if (key === "F3") {
        e.preventDefault();
        if (els.findBar.hidden) openFind();
        else findStep(e.shiftKey ? -1 : 1);
        return;
      }
      if (mod && lower === "s") {
        e.preventDefault();
        triggerExport(currentFormat);
        return;
      }
      if (e.ctrlKey && (key === " " || e.code === "Space")) {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (mod && key === "Enter") {
        e.preventDefault();
        addCue();
        return;
      }
      if (e.altKey && !mod && (key === "ArrowUp" || key === "ArrowDown")) {
        e.preventDefault();
        const where = inCueField ? (ae.closest("#cue-editor") ? "editor" : "row") : undefined;
        selectAdjacentCue(key === "ArrowUp" ? -1 : 1, where);
        return;
      }
      if (mod && (lower === "z" || lower === "y")) {
        // inside find/settings fields keep the browser's own text undo
        if (inField && !inCueField) return;
        e.preventDefault();
        if (lower === "y" || e.shiftKey) doRedo();
        else doUndo();
        return;
      }

      if (inField) return;
      if (tag === "BUTTON" && (key === " " || key === "Enter")) return; // keyboard-activating a button

      // --- single keys, only when not typing ---
      if (mod && lower === "a") {
        e.preventDefault();
        Store.selectAll();
        return;
      }
      if (key === " ") {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (key === "ArrowLeft" || key === "ArrowRight") {
        e.preventDefault();
        const dir = key === "ArrowLeft" ? -1 : 1;
        if (e.altKey) nudgeSelectedCue(dir, e.shiftKey ? "end" : "start");
        else seekBy(dir * (e.shiftKey ? 5000 : 1000));
        return;
      }
      if (key === "ArrowUp" || key === "ArrowDown") {
        e.preventDefault();
        selectAdjacentCue(key === "ArrowUp" ? -1 : 1);
        return;
      }
      if (key === "Enter") {
        e.preventDefault();
        const id = Store.getSelected();
        if (id) focusCueText(id);
        else selectAdjacentCue(1, editorShown() ? "editor" : "row");
        return;
      }
      if (key === "Insert") {
        e.preventDefault();
        addCue();
        return;
      }
      if (key === "Delete") {
        e.preventDefault();
        deleteCues(Store.getSelectedIds());
        return;
      }
      if (key === "?") {
        UI.openModal("modal-help");
        return;
      }
    });
  }

  // ---------- init ----------
  function init() {
    const savedTheme = storageGet(THEME_KEY) || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    document.documentElement.dataset.theme = savedTheme;
    updateThemeIcon();
    setEditorShown(storageGet(EDITOR_KEY) === "1"); // off by default: the list gets the room

    timeline = Timeline.create({
      canvas: els.timelineCanvas,
      minimapCanvas: els.minimapCanvas,
      onSeek: (ms) => {
        playheadMs = ms;
        playheadFromTimeline = true;
        if (hasVideo()) videoEl.currentTime = ms / 1000;
      },
      onCueActivate: (id) => {
        const row = rowMap.get(id);
        row && !row.hidden && row.scrollIntoView({ block: "nearest" });
      },
      onZoomChange: (px) => {
        els.zoomSlider.value = Math.round(px);
      },
    });

    // timeline labels are drawn on a canvas, so redraw once the fonts arrive
    if (document.fonts) document.fonts.ready.then(() => timeline.render());

    wireToolbar();
    wireVideo();
    wireCueList();
    wireEditor();
    wireFind();
    wireChecks();
    wireKeyboard();

    // fallback sizing depends on the list's width, which changes when the
    // window resizes or the video pane appears/disappears
    if (!FIELD_SIZING) {
      let lastWidth = 0;
      new ResizeObserver(([entry]) => {
        const w = Math.round(entry.contentRect.width);
        if (w === lastWidth) return;
        lastWidth = w;
        rowMap.forEach((row) => queueSize(row._refs.text));
      }).observe(els.cueList);
    }

    Store.subscribe(onStoreChange);
    tryRestoreAutosave();
    onStoreChange("init");
    updateStatusFile();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
