/* store.js — single source of truth for cues + selection + undo history */
const Store = (function () {
  const HISTORY_LIMIT = 100;

  let cues = [];
  let selectedId = null;
  let history = [];
  let future = [];
  const listeners = new Set();

  let settings = {
    maxLineLength: 42,
    maxLines: 2,
    maxCps: 21,
    minDurationMs: 700,
  };

  function snapshot() {
    return cues.map((c) => ({ ...c }));
  }

  function notify(reason) {
    listeners.forEach((fn) => fn(reason || "change"));
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function pushHistory() {
    history.push(snapshot());
    if (history.length > HISTORY_LIMIT) history.shift();
    future = [];
  }

  function canUndo() {
    return history.length > 0;
  }
  function canRedo() {
    return future.length > 0;
  }

  function undo() {
    if (!canUndo()) return;
    future.push(snapshot());
    cues = history.pop();
    notify("undo");
  }

  function redo() {
    if (!canRedo()) return;
    history.push(snapshot());
    cues = future.pop();
    notify("redo");
  }

  function setCues(newCues, opts) {
    opts = opts || {};
    if (opts.record !== false) pushHistory();
    cues = newCues.map((c) => ({ id: c.id || Utils.uid(), start: c.start, end: c.end, text: c.text || "" }));
    if (opts.sort !== false) cues.sort((a, b) => a.start - b.start);
    notify(opts.reason || "set");
  }

  function addCue(cue, opts) {
    opts = opts || {};
    if (opts.record !== false) pushHistory();
    const full = { id: cue.id || Utils.uid(), start: cue.start, end: cue.end, text: cue.text || "" };
    cues = [...cues, full].sort((a, b) => a.start - b.start);
    selectedId = full.id;
    notify("add");
    return full;
  }

  function updateCue(id, patch, opts) {
    opts = opts || {};
    if (opts.record !== false) pushHistory();
    cues = cues.map((c) => (c.id === id ? { ...c, ...patch } : c));
    if (opts.resort !== false && (patch.start !== undefined || patch.end !== undefined)) {
      cues.sort((a, b) => a.start - b.start);
    }
    notify(opts.reason || "update");
  }

  function removeCue(id, opts) {
    opts = opts || {};
    if (opts.record !== false) pushHistory();
    cues = cues.filter((c) => c.id !== id);
    if (selectedId === id) selectedId = null;
    notify("remove");
  }

  function removeCues(ids, opts) {
    opts = opts || {};
    if (opts.record !== false) pushHistory();
    const idSet = new Set(ids);
    cues = cues.filter((c) => !idSet.has(c.id));
    if (idSet.has(selectedId)) selectedId = null;
    notify("remove");
  }

  function select(id) {
    selectedId = id;
    notify("selection");
  }

  function getCues() {
    return cues;
  }

  function getCue(id) {
    return cues.find((c) => c.id === id) || null;
  }

  function getSelected() {
    return selectedId;
  }

  function getSettings() {
    return { ...settings };
  }

  function setSettings(patch) {
    settings = { ...settings, ...patch };
    notify("settings");
  }

  function resort() {
    cues = [...cues].sort((a, b) => a.start - b.start);
    notify("resort");
  }

  function reset() {
    cues = [];
    selectedId = null;
    history = [];
    future = [];
    notify("reset");
  }

  return {
    subscribe, pushHistory, canUndo, canRedo, undo, redo,
    setCues, addCue, updateCue, removeCue, removeCues,
    select, getCues, getCue, getSelected,
    getSettings, setSettings, reset, resort,
  };
})();
