/* app.js — wires DOM, Store, Timeline, Waveform and SRT together */
(function () {
  const $ = (id) => document.getElementById(id);
  const MIN_DUR = 100; // ms
  const THEME_KEY = "subtitle-editor-theme";
  const AUTOSAVE_KEY = "subtitle-editor-autosave-v1";

  const els = {
    app: $("app"),

    // toolbar
    btnNew: $("btn-new"),
    btnOpenVideo: $("btn-open-video"),
    inputVideo: $("input-video"),
    btnOpenSrt: $("btn-open-srt"),
    inputSrt: $("input-srt"),
    btnSample: $("btn-sample"),
    btnExport: $("btn-export"),
    exportMenu: $("export-menu"),
    btnUndo: $("btn-undo"),
    btnRedo: $("btn-redo"),
    btnAdd: $("btn-add"),
    btnSplit: $("btn-split"),
    btnMerge: $("btn-merge"),
    btnDelete: $("btn-delete"),
    btnShift: $("btn-shift"),
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
    cueCount: $("cue-count"),
    warningSummary: $("warning-summary"),
    cueList: $("cue-list"),

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

    // modals
    modalOverlay: $("modal-overlay"),
    settingsMaxLineLength: $("settings-max-line-length"),
    settingsMaxLines: $("settings-max-lines"),
    settingsMaxCps: $("settings-max-cps"),
    settingsMinDuration: $("settings-min-duration"),
    settingsSave: $("settings-save"),
    shiftAmount: $("shift-amount"),
    shiftApply: $("shift-apply"),
    findText: $("find-text"),
    replaceText: $("replace-text"),
    findCaseSensitive: $("find-case-sensitive"),
    findReplaceAll: $("find-replace-all"),
    findResult: $("find-result"),
  };

  const videoEl = els.video;
  let timeline = null;
  let currentVideoName = null;
  let currentSrtName = null;
  let activePlayingId = null;
  let rafId = null;
  let editSnapshotTaken = false;

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
  const pendingSize = new Set();
  let sizeFrame = null;
  function queueSize(textarea) {
    if (FIELD_SIZING) return;
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
    const name = currentSrtName || currentVideoName || "subtitles";
    return name.replace(/\.[^.]+$/, "");
  }

  function triggerExport(format) {
    const cues = Store.getCues();
    if (!cues.length) {
      alert("There are no cues to export yet.");
      return;
    }
    if (format === "srt") downloadText(baseFilename() + ".srt", SRT.toSrt(cues), "text/plain");
    else downloadText(baseFilename() + ".vtt", SRT.toVtt(cues), "text/vtt");
  }

  function updateStatusFile() {
    const parts = [];
    if (currentVideoName) parts.push(currentVideoName);
    if (currentSrtName) parts.push(currentSrtName);
    els.statusFile.textContent = parts.length ? parts.join(" · ") : "No project loaded";
  }

  // ---------- modals ----------
  function openModal(id) {
    els.modalOverlay.hidden = false;
    document.querySelectorAll(".modal").forEach((m) => (m.hidden = m.id !== id));
    const modal = $(id);
    const focusable = modal && modal.querySelector("input, textarea, select, button");
    focusable && focusable.focus();
  }
  function closeModal() {
    els.modalOverlay.hidden = true;
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
        <span class="warning-dot" hidden>!</span>
        <button type="button" class="row-delete icon-btn small" data-action="delete" title="Delete cue" aria-label="Delete cue">&times;</button>
      </div>
      <textarea class="cue-text" data-field="text" rows="1" spellcheck="true" aria-label="Subtitle text"></textarea>
    `;
    // cache child lookups once so later updates never re-query the DOM
    row._refs = {
      index: row.querySelector(".cue-index"),
      start: row.querySelector('[data-field="start"]'),
      end: row.querySelector('[data-field="end"]'),
      duration: row.querySelector(".cue-duration"),
      dot: row.querySelector(".warning-dot"),
      text: row.querySelector(".cue-text"),
    };
    return row;
  }

  function updateRowContent(row, cue, index, issues, selectedId, initial) {
    const refs = row._refs;
    row.dataset.id = cue.id;
    row.classList.toggle("selected", cue.id === selectedId);
    row.classList.toggle("has-warning", issues.length > 0);
    row.classList.toggle("active", cue.id === activePlayingId);
    refs.index.textContent = index + 1;

    if (initial || document.activeElement !== refs.start) {
      refs.start.value = Utils.msToTimecode(cue.start, ",");
      refs.start.classList.remove("invalid");
    }
    if (initial || document.activeElement !== refs.end) {
      refs.end.value = Utils.msToTimecode(cue.end, ",");
      refs.end.classList.remove("invalid");
    }

    refs.duration.textContent = Utils.readableDuration(cue.end - cue.start);

    if (issues.length) {
      refs.dot.hidden = false;
      refs.dot.title = issues.join("; ");
    } else {
      refs.dot.hidden = true;
      refs.dot.title = "";
    }

    if (initial || document.activeElement !== refs.text) {
      refs.text.value = cue.text || "";
      // Cheap sizing from line count — no layout read/write here. Precise
      // pixel sizing (autoGrow) only happens while a person is actively
      // typing into a row (see the "input" handler in wireCueList), so bulk
      // renders never force a synchronous reflow per row.
      refs.text.rows = Math.max(1, Utils.lines(cue.text || "").length);
      queueSize(refs.text);
    }
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
    const selectedId = Store.getSelected();
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
    allIssues.forEach((issues) => {
      if (issues.length) totalWarnings++;
    });

    els.cueCount.textContent = String(cues.length);
    els.warningSummary.textContent = totalWarnings ? `${totalWarnings} warning${totalWarnings > 1 ? "s" : ""}` : "";
    els.warningSummary.classList.toggle("has-warnings", totalWarnings > 0);
    els.btnUndo.disabled = !Store.canUndo();
    els.btnRedo.disabled = !Store.canRedo();

    const newCount = cues.reduce((n, c) => n + (rowMap.has(c.id) ? 0 : 1), 0);
    renderGeneration++;
    const myGen = renderGeneration;

    if (newCount > CHUNK_THRESHOLD) {
      chunkedApply(cues, allIssues, selectedId, myGen);
    } else {
      cues.forEach((cue, i) => {
        let row = rowMap.get(cue.id);
        let initial = false;
        if (!row) {
          row = buildRow();
          rowMap.set(cue.id, row);
          initial = true;
        }
        updateRowContent(row, cue, i, allIssues[i], selectedId, initial);
      });
      reorderRows(cues);
    }
  }

  // Bulk-loads (e.g. opening a large .srt) create many rows at once. Rather
  // than build them all synchronously — which can block the tab for seconds
  // and forces the browser to do it all in one uninterruptible burst — this
  // spreads row creation across animation frames in small time-boxed batches,
  // appending each row as it's made so subtitles visibly stream in and the
  // page stays responsive throughout.
  function chunkedApply(cues, allIssues, selectedId, myGen) {
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
        updateRowContent(row, cue, i, allIssues[i], selectedId, initial);
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
      if (row) {
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

  // ---------- store change / autosave ----------
  const scheduleAutosave = Utils.debounce(() => {
    try {
      const payload = { cues: Store.getCues(), settings: Store.getSettings(), savedAt: Date.now() };
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
      els.statusAutosave.textContent = "Saved " + new Date().toLocaleTimeString();
    } catch (err) {
      console.warn("Autosave failed", err);
    }
  }, 800);

  function onStoreChange() {
    renderCueList();
    scheduleAutosave();
  }

  function tryRestoreAutosave() {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.settings) Store.setSettings(data.settings);
      if (Array.isArray(data.cues) && data.cues.length) {
        Store.setCues(data.cues, { record: false });
        els.statusAutosave.textContent = "Restored autosaved session from " + new Date(data.savedAt).toLocaleString();
      }
    } catch (err) {
      console.warn("Restore failed", err);
    }
  }

  // ---------- video ----------
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

  function togglePlay() {
    if (videoEl.readyState === 0) return;
    if (videoEl.paused) videoEl.play();
    else videoEl.pause();
  }

  function seekBy(deltaMs) {
    if (videoEl.readyState === 0) return;
    videoEl.currentTime = Utils.clamp(videoEl.currentTime + deltaMs / 1000, 0, videoEl.duration || Infinity);
  }

  function syncFromVideo() {
    const ms = videoEl.currentTime * 1000;
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
      alert("That video could not be played. Your browser may not support its format or codec.");
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
  function addCueAtPlayhead() {
    const cues = Store.getCues();
    const curMs = videoEl.readyState > 0 ? videoEl.currentTime * 1000 : cues.length ? cues[cues.length - 1].end : 0;
    let start = Math.max(0, Math.round(curMs));
    let end = start + 2000;
    const next = cues.find((c) => c.start > start);
    if (next && next.start < end) end = Math.max(start + MIN_DUR, next.start);

    const cue = Store.addCue({ start, end, text: "" });
    if (timeline) timeline.revealCue(cue.id);
    requestAnimationFrame(() => {
      const row = rowMap.get(cue.id);
      if (row) {
        row.scrollIntoView({ block: "center" });
        row._refs.text.focus();
      }
    });
  }

  function deleteSelectedCue() {
    const id = Store.getSelected();
    if (!id) return;
    Store.removeCue(id);
  }

  function splitSelectedCue() {
    const id = Store.getSelected();
    if (!id) {
      alert("Select a cue first.");
      return;
    }
    const cue = Store.getCue(id);
    if (!cue) return;
    const curMs = videoEl.currentTime * 1000;
    if (curMs <= cue.start + MIN_DUR || curMs >= cue.end - MIN_DUR) {
      alert("Move the playhead inside the selected cue to split it there.");
      return;
    }
    const lines = Utils.lines(cue.text);
    let textA, textB;
    if (lines.length > 1) {
      const mid = Math.ceil(lines.length / 2);
      textA = lines.slice(0, mid).join("\n");
      textB = lines.slice(mid).join("\n");
    } else {
      const words = (cue.text || "").split(" ").filter(Boolean);
      const mid = Math.ceil(words.length / 2);
      textA = words.slice(0, mid).join(" ");
      textB = words.slice(mid).join(" ");
    }
    const cues = Store.getCues();
    const idx = cues.findIndex((c) => c.id === id);
    const cueA = { id: Utils.uid(), start: cue.start, end: Math.round(curMs), text: textA };
    const cueB = { id: Utils.uid(), start: Math.round(curMs), end: cue.end, text: textB };
    const newList = [...cues];
    newList.splice(idx, 1, cueA, cueB);
    Store.setCues(newList);
    Store.select(cueA.id);
  }

  function mergeSelectedCue() {
    const id = Store.getSelected();
    if (!id) {
      alert("Select a cue first.");
      return;
    }
    const cues = Store.getCues();
    const idx = cues.findIndex((c) => c.id === id);
    if (idx === -1 || idx >= cues.length - 1) {
      alert("Select a cue that has another cue after it to merge them.");
      return;
    }
    const a = cues[idx], b = cues[idx + 1];
    const merged = { id: a.id, start: a.start, end: Math.max(a.end, b.end), text: [a.text, b.text].filter(Boolean).join("\n") };
    const newList = [...cues];
    newList.splice(idx, 2, merged);
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

  function selectAdjacentCue(dir) {
    const cues = Store.getCues();
    if (!cues.length) return;
    const curId = Store.getSelected();
    let idx = cues.findIndex((c) => c.id === curId);
    idx = idx === -1 ? (dir > 0 ? 0 : cues.length - 1) : Utils.clamp(idx + dir, 0, cues.length - 1);
    const cue = cues[idx];
    Store.select(cue.id);
    if (videoEl.readyState > 0) videoEl.currentTime = cue.start / 1000;
    if (timeline) timeline.revealCue(cue.id);
    const row = rowMap.get(cue.id);
    row && row.scrollIntoView({ block: "nearest" });
  }

  // ---------- cue list DOM interaction ----------
  function wireCueList() {
    els.cueList.addEventListener("click", (e) => {
      const row = e.target.closest(".cue-row");
      if (!row) return;
      const id = row.dataset.id;

      if (e.target.closest('[data-action="delete"]')) {
        Store.removeCue(id);
        return;
      }
      if (e.target.matches("input, textarea, button")) return;

      Store.select(id);
      const cue = Store.getCue(id);
      if (cue && videoEl.readyState > 0) videoEl.currentTime = cue.start / 1000;
      if (timeline) timeline.revealCue(id);
    });

    els.cueList.addEventListener("focusin", (e) => {
      if (!e.target.matches(".time-input, .cue-text")) return;
      editSnapshotTaken = false;
      const row = e.target.closest(".cue-row");
      if (row) Store.select(row.dataset.id);
      if (e.target.matches(".cue-text")) autoGrow(e.target);
    });

    els.cueList.addEventListener("input", (e) => {
      const row = e.target.closest(".cue-row");
      if (!row) return;
      const id = row.dataset.id;

      if (!editSnapshotTaken) {
        Store.pushHistory();
        editSnapshotTaken = true;
      }

      if (e.target.matches(".cue-text")) {
        autoGrow(e.target);
        Store.updateCue(id, { text: e.target.value }, { record: false });
      } else if (e.target.matches(".time-input")) {
        const ms = Utils.timecodeToMs(e.target.value);
        if (ms !== null) {
          const field = e.target.dataset.field;
          Store.updateCue(id, { [field]: Math.max(0, ms) }, { record: false, resort: false });
          e.target.classList.remove("invalid");
        } else {
          e.target.classList.add("invalid");
        }
      }
    });

    els.cueList.addEventListener(
      "focusout",
      (e) => {
        if (!e.target.matches(".time-input")) return;
        const row = e.target.closest(".cue-row");
        if (!row) return;
        const id = row.dataset.id;
        const cue = Store.getCue(id);
        if (!cue) return;
        if (cue.end <= cue.start) {
          Store.updateCue(id, { end: cue.start + MIN_DUR }, { record: false });
        }
        Store.resort();
        editSnapshotTaken = false;
      },
      true
    );
  }

  // ---------- toolbar ----------
  function wireToolbar() {
    els.btnNew.addEventListener("click", () => {
      if (!confirm("Start a new project? This clears all current cues and undo history. The loaded video stays.")) return;
      Store.reset();
      currentSrtName = null;
      updateStatusFile();
      localStorage.removeItem(AUTOSAVE_KEY);
      els.statusAutosave.textContent = "";
    });

    els.btnOpenSrt.addEventListener("click", () => els.inputSrt.click());
    els.inputSrt.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (file) {
        const text = await file.text();
        const cues = SRT.parse(text);
        if (!cues.length) {
          alert("No subtitle cues were found in that file. Double check it is a valid .srt.");
        } else {
          Store.setCues(cues);
          currentSrtName = file.name;
          updateStatusFile();
        }
      }
      e.target.value = "";
    });

    els.btnSample.addEventListener("click", async () => {
      try {
        const res = await fetch("sample/sample.srt");
        if (!res.ok) throw new Error("missing");
        const text = await res.text();
        Store.setCues(SRT.parse(text));
        currentSrtName = "sample.srt";
        updateStatusFile();
      } catch (err) {
        alert('Could not load the sample file. If you opened index.html directly from disk, serve it with a local server instead (see README), or use "Open SRT" with your own file.');
      }
    });

    els.btnExport.addEventListener("click", (e) => {
      e.stopPropagation();
      els.exportMenu.classList.toggle("open");
    });
    document.addEventListener("click", () => els.exportMenu.classList.remove("open"));
    els.exportMenu.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-format]");
      if (!btn) return;
      triggerExport(btn.dataset.format);
      els.exportMenu.classList.remove("open");
    });

    els.btnUndo.addEventListener("click", () => Store.undo());
    els.btnRedo.addEventListener("click", () => Store.redo());

    els.btnAdd.addEventListener("click", addCueAtPlayhead);
    els.btnDelete.addEventListener("click", deleteSelectedCue);
    els.btnSplit.addEventListener("click", splitSelectedCue);
    els.btnMerge.addEventListener("click", mergeSelectedCue);

    els.btnShift.addEventListener("click", () => openModal("modal-shift"));
    els.shiftApply.addEventListener("click", () => {
      const amount = parseInt(els.shiftAmount.value, 10);
      if (!Number.isFinite(amount) || amount === 0) {
        closeModal();
        return;
      }
      const scope = document.querySelector('input[name="shift-scope"]:checked').value;
      if (scope === "selected") {
        const id = Store.getSelected();
        if (!id) {
          alert("No cue selected.");
          return;
        }
        const cue = Store.getCue(id);
        const newStart = Math.max(0, cue.start + amount);
        const newEnd = Math.max(newStart + MIN_DUR, cue.end + amount);
        Store.updateCue(id, { start: newStart, end: newEnd });
      } else {
        const shifted = Store.getCues().map((c) => {
          const newStart = Math.max(0, c.start + amount);
          const newEnd = Math.max(newStart + MIN_DUR, c.end + amount);
          return { ...c, start: newStart, end: newEnd };
        });
        Store.setCues(shifted);
      }
      closeModal();
    });

    els.btnFind.addEventListener("click", () => {
      els.findResult.textContent = "";
      openModal("modal-find");
    });
    els.findReplaceAll.addEventListener("click", () => {
      const find = els.findText.value;
      if (!find) {
        els.findResult.textContent = "Enter text to find.";
        return;
      }
      const caseSensitive = els.findCaseSensitive.checked;
      const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      let re;
      try {
        re = new RegExp(escaped, caseSensitive ? "g" : "gi");
      } catch (err) {
        els.findResult.textContent = "That search text is not valid.";
        return;
      }
      let count = 0;
      const replaceWith = els.replaceText.value;
      const updated = Store.getCues().map((c) => {
        const newText = (c.text || "").replace(re, () => {
          count++;
          return replaceWith;
        });
        return { ...c, text: newText };
      });
      if (count > 0) Store.setCues(updated);
      els.findResult.textContent = `Replaced ${count} occurrence${count !== 1 ? "s" : ""}.`;
    });

    els.btnSettings.addEventListener("click", () => {
      const s = Store.getSettings();
      els.settingsMaxLineLength.value = s.maxLineLength;
      els.settingsMaxLines.value = s.maxLines;
      els.settingsMaxCps.value = s.maxCps;
      els.settingsMinDuration.value = s.minDurationMs;
      openModal("modal-settings");
    });
    els.settingsSave.addEventListener("click", () => {
      Store.setSettings({
        maxLineLength: parseInt(els.settingsMaxLineLength.value, 10) || 42,
        maxLines: parseInt(els.settingsMaxLines.value, 10) || 2,
        maxCps: parseInt(els.settingsMaxCps.value, 10) || 21,
        minDurationMs: parseInt(els.settingsMinDuration.value, 10) || 700,
      });
      closeModal();
    });

    els.btnHelp.addEventListener("click", () => openModal("modal-help"));

    els.btnTheme.addEventListener("click", () => {
      const cur = document.documentElement.dataset.theme === "light" ? "light" : "dark";
      applyTheme(cur === "light" ? "dark" : "light");
    });

    els.modalOverlay.addEventListener("click", (e) => {
      if (e.target === els.modalOverlay) closeModal();
    });
    document.querySelectorAll(".modal-close").forEach((btn) => btn.addEventListener("click", closeModal));

    els.zoomSlider.addEventListener("input", () => timeline.setZoom(parseFloat(els.zoomSlider.value)));
    els.zoomIn.addEventListener("click", () => timeline.setZoom(timeline.getZoom() * 1.3));
    els.zoomOut.addEventListener("click", () => timeline.setZoom(timeline.getZoom() / 1.3));
  }

  function updateThemeIcon() {
    const theme = document.documentElement.dataset.theme;
    els.iconSun.hidden = theme !== "dark";
    els.iconMoon.hidden = theme === "dark";
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    updateThemeIcon();
    if (timeline) timeline.refreshTheme();
  }

  // ---------- keyboard shortcuts ----------
  function wireKeyboard() {
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (!els.modalOverlay.hidden) {
          closeModal();
          return;
        }
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        return;
      }

      const tag = document.activeElement && document.activeElement.tagName;
      if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(tag)) return;
      if (!els.modalOverlay.hidden) return;

      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) Store.redo();
        else Store.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        Store.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        triggerExport("srt");
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        if (e.altKey) nudgeSelectedCue(dir, e.shiftKey ? "end" : "start");
        else seekBy(dir * (e.shiftKey ? 5000 : 1000));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        selectAdjacentCue(-1);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        selectAdjacentCue(1);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        addCueAtPlayhead();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelectedCue();
        return;
      }
      if (e.key === "?") {
        openModal("modal-help");
        return;
      }
    });
  }

  // ---------- init ----------
  function init() {
    const savedTheme = localStorage.getItem(THEME_KEY) || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    document.documentElement.dataset.theme = savedTheme;
    updateThemeIcon();

    timeline = Timeline.create({
      canvas: els.timelineCanvas,
      minimapCanvas: els.minimapCanvas,
      onSeek: (ms) => {
        if (videoEl.readyState > 0) videoEl.currentTime = ms / 1000;
      },
      onCueActivate: (id) => {
        const row = rowMap.get(id);
        row && row.scrollIntoView({ block: "nearest" });
      },
      onZoomChange: (px) => {
        els.zoomSlider.value = Math.round(px);
      },
    });

    wireToolbar();
    wireVideo();
    wireCueList();
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
    onStoreChange();
    updateStatusFile();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
