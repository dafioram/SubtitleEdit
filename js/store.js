/* store.js — single source of truth for cues + selection + undo history */
const Store = (function () {
  const HISTORY_LIMIT = 100;

  let cues = [];
  let selectedId = null; // primary selection (the cue being edited)
  let selectedIds = new Set(); // every selected cue, including the primary
  let anchorId = null; // where a Shift-click range starts
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

  // drop selections that point at cues which no longer exist
  function pruneSelection() {
    if (!selectedIds.size) return;
    const live = new Set(cues.map((c) => c.id));
    selectedIds = new Set([...selectedIds].filter((id) => live.has(id)));
    if (selectedId && !live.has(selectedId)) selectedId = [...selectedIds].pop() || null;
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
    pruneSelection();
    notify("undo");
  }

  function redo() {
    if (!canRedo()) return;
    history.push(snapshot());
    cues = future.pop();
    pruneSelection();
    notify("redo");
  }

  function setCues(newCues, opts) {
    opts = opts || {};
    if (opts.record !== false) pushHistory();
    cues = newCues.map((c) => ({ id: c.id || Utils.uid(), start: c.start, end: c.end, text: c.text || "" }));
    if (opts.sort !== false) cues.sort((a, b) => a.start - b.start);
    pruneSelection();
    notify(opts.reason || "set");
  }

  function addCue(cue, opts) {
    opts = opts || {};
    if (opts.record !== false) pushHistory();
    const full = { id: cue.id || Utils.uid(), start: cue.start, end: cue.end, text: cue.text || "" };
    cues = [...cues, full].sort((a, b) => a.start - b.start);
    selectedId = full.id;
    selectedIds = new Set([full.id]);
    anchorId = full.id;
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
    pruneSelection();
    notify("remove");
  }

  function removeCues(ids, opts) {
    opts = opts || {};
    if (opts.record !== false) pushHistory();
    const idSet = new Set(ids);
    cues = cues.filter((c) => !idSet.has(c.id));
    pruneSelection();
    notify("remove");
  }

  function select(id) {
    selectedId = id || null;
    selectedIds = new Set(id ? [id] : []);
    anchorId = selectedId;
    notify("selection");
  }

  // Ctrl/Cmd-click: add or remove one cue from the selection
  function toggleSelect(id) {
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
      if (selectedId === id) selectedId = [...selectedIds].pop() || null;
    } else {
      selectedIds.add(id);
      selectedId = id;
    }
    anchorId = id;
    notify("selection");
  }

  // Shift-click: select every cue between the anchor and this one
  function selectRange(id) {
    const a = cues.findIndex((c) => c.id === (anchorId || id));
    const b = cues.findIndex((c) => c.id === id);
    if (b === -1) return;
    const from = Math.min(a === -1 ? b : a, b);
    const to = Math.max(a === -1 ? b : a, b);
    selectedIds = new Set(cues.slice(from, to + 1).map((c) => c.id));
    selectedId = id;
    notify("selection");
  }

  function selectAll() {
    selectedIds = new Set(cues.map((c) => c.id));
    if (!selectedId && cues.length) selectedId = cues[0].id;
    notify("selection");
  }

  function isSelected(id) {
    return selectedIds.has(id);
  }

  // selected cue ids in time order
  function getSelectedIds() {
    return cues.filter((c) => selectedIds.has(c.id)).map((c) => c.id);
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
    selectedIds = new Set();
    anchorId = null;
    history = [];
    future = [];
    notify("reset");
  }

  return {
    subscribe, pushHistory, canUndo, canRedo, undo, redo,
    setCues, addCue, updateCue, removeCue, removeCues,
    select, toggleSelect, selectRange, selectAll, isSelected, getSelectedIds,
    getCues, getCue, getSelected,
    getSettings, setSettings, reset, resort,
  };
})();
