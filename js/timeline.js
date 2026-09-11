/* timeline.js — virtualized canvas timeline (no DOM scroll; renders only the visible window) */
const Timeline = (function () {
  const RULER_H = 22;
  const WAVE_H = 68;
  const TRACK_H = 42;
  const CANVAS_H = RULER_H + WAVE_H + TRACK_H;
  const HANDLE_PX = 7;
  const MIN_DUR_MS = 100;
  const MIN_PX_PER_SEC = 4;
  const MAX_PX_PER_SEC = 800;
  const NICE_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

  function create(opts) {
    const canvas = opts.canvas;
    const minimap = opts.minimapCanvas;
    const ctx = canvas.getContext("2d");
    const mctx = minimap.getContext("2d");
    const onSeek = opts.onSeek || function () {};
    const onCueActivate = opts.onCueActivate || function () {};

    let duration = 0; // seconds
    let pxPerSecond = 60;
    let scrollOffsetSec = 0;
    let currentTimeSec = 0;
    let waveform = null;
    let dpr = window.devicePixelRatio || 1;
    let dragState = null;
    let colors = readColors();

    function readColors() {
      const cs = getComputedStyle(document.documentElement);
      return {
        bg: cs.getPropertyValue("--panel").trim() || "#1b1d24",
        border: cs.getPropertyValue("--border-soft").trim() || "#24262f",
        grid: cs.getPropertyValue("--border").trim() || "#2b2e38",
        text: cs.getPropertyValue("--text-dim").trim() || "#9296a3",
        wave: cs.getPropertyValue("--teal").trim() || "#4fc3b0",
        accent: cs.getPropertyValue("--accent").trim() || "#e7b750",
        accentContrast: cs.getPropertyValue("--accent-contrast").trim() || "#14151a",
        danger: cs.getPropertyValue("--danger").trim() || "#e15b4d",
        playhead: cs.getPropertyValue("--text").trim() || "#ececed",
      };
    }

    function refreshTheme() {
      colors = readColors();
      render();
    }

    function viewDurationSec() {
      return canvas.clientWidth / pxPerSecond;
    }

    function timeToX(sec) {
      return (sec - scrollOffsetSec) * pxPerSecond;
    }
    function xToTime(x) {
      return scrollOffsetSec + x / pxPerSecond;
    }

    function clampScroll() {
      const maxStart = Math.max(0, duration - viewDurationSec() * 0.1);
      scrollOffsetSec = Utils.clamp(scrollOffsetSec, 0, Math.max(0, maxStart));
    }

    function setDuration(sec) {
      duration = Math.max(0, sec || 0);
      clampScroll();
      render();
    }

    function setWaveform(data) {
      waveform = data;
      render();
    }

    function setZoom(px, anchorSec) {
      const oldPx = pxPerSecond;
      pxPerSecond = Utils.clamp(px, MIN_PX_PER_SEC, MAX_PX_PER_SEC);
      if (anchorSec !== undefined && oldPx !== pxPerSecond) {
        const anchorX = timeToXWith(oldPx, anchorSec);
        scrollOffsetSec = anchorSec - anchorX / pxPerSecond;
      }
      clampScroll();
      render();
      if (opts.onZoomChange) opts.onZoomChange(pxPerSecond);
    }
    function timeToXWith(px, sec) {
      return (sec - scrollOffsetSec) * px;
    }

    function setCurrentTime(sec, options) {
      currentTimeSec = Math.max(0, sec || 0);
      const follow = options && options.follow;
      if (follow) {
        const vd = viewDurationSec();
        if (currentTimeSec < scrollOffsetSec || currentTimeSec > scrollOffsetSec + vd * 0.92) {
          scrollOffsetSec = Math.max(0, currentTimeSec - vd * 0.15);
          clampScroll();
        }
      }
      render();
    }

    function revealCue(cueId) {
      const cue = Store.getCue(cueId);
      if (!cue) return;
      const center = (cue.start + cue.end) / 2000;
      const vd = viewDurationSec();
      scrollOffsetSec = Math.max(0, center - vd / 2);
      clampScroll();
      render();
    }

    function niceStep() {
      for (const step of NICE_STEPS) {
        if (step * pxPerSecond >= 70) return step;
      }
      return NICE_STEPS[NICE_STEPS.length - 1];
    }

    function fmtTick(sec) {
      const ms = Math.round(sec * 1000);
      if (duration >= 3600 || sec >= 3600) return Utils.msToTimecode(ms, ".").slice(0, 8);
      return Utils.msToTimecode(ms, ".").slice(3, 8); // MM:SS
    }

    function resize() {
      dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth || canvas.parentElement.clientWidth;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(CANVAS_H * dpr));
      canvas.style.height = CANVAS_H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const mw = minimap.clientWidth || minimap.parentElement.clientWidth;
      minimap.width = Math.max(1, Math.round(mw * dpr));
      minimap.height = Math.max(1, Math.round(28 * dpr));
      minimap.style.height = "28px";
      mctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      clampScroll();
      render();
    }

    function render() {
      const W = canvas.clientWidth;
      ctx.clearRect(0, 0, W, CANVAS_H);

      // background
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, W, CANVAS_H);

      drawRuler(W);
      drawWaveform(W);
      drawCueTrack(W);
      drawPlayhead(W);
      drawMinimap();
    }

    function drawRuler(W) {
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, W, RULER_H);
      ctx.strokeStyle = colors.border;
      ctx.beginPath();
      ctx.moveTo(0, RULER_H + 0.5);
      ctx.lineTo(W, RULER_H + 0.5);
      ctx.stroke();

      const step = niceStep();
      const firstTick = Math.floor(scrollOffsetSec / step) * step;
      ctx.font = "10px " + (getComputedStyle(document.documentElement).getPropertyValue("--font-mono") || "monospace");
      ctx.fillStyle = colors.text;
      ctx.textBaseline = "middle";

      for (let t = firstTick; t <= scrollOffsetSec + W / pxPerSecond + step; t += step) {
        const x = timeToX(t);
        if (x < -40 || x > W + 40) continue;
        ctx.strokeStyle = colors.grid;
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, RULER_H);
        ctx.lineTo(Math.round(x) + 0.5, CANVAS_H);
        ctx.stroke();

        ctx.strokeStyle = colors.text;
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, RULER_H - 6);
        ctx.lineTo(Math.round(x) + 0.5, RULER_H);
        ctx.stroke();

        if (t >= 0) ctx.fillText(fmtTick(t), x + 4, RULER_H / 2);
      }
    }

    function drawWaveform(W) {
      const top = RULER_H;
      const midY = top + WAVE_H / 2;
      ctx.strokeStyle = colors.border;
      ctx.beginPath();
      ctx.moveTo(0, top + WAVE_H + 0.5);
      ctx.lineTo(W, top + WAVE_H + 0.5);
      ctx.stroke();

      if (!waveform) {
        ctx.strokeStyle = colors.grid;
        ctx.beginPath();
        ctx.moveTo(0, midY + 0.5);
        ctx.lineTo(W, midY + 0.5);
        ctx.stroke();
        return;
      }

      const { peaksMin, peaksMax, bucketSeconds } = waveform;
      const halfH = WAVE_H / 2 - 4;
      ctx.fillStyle = colors.wave;
      ctx.globalAlpha = 0.75;
      for (let x = 0; x < W; x++) {
        const t = xToTime(x);
        const bucket = Math.round(t / bucketSeconds);
        if (bucket < 0 || bucket >= peaksMin.length) continue;
        const minV = peaksMin[bucket];
        const maxV = peaksMax[bucket];
        const y1 = midY - maxV * halfH;
        const y2 = midY - minV * halfH;
        ctx.fillRect(x, Math.min(y1, y2), 1, Math.max(1, Math.abs(y2 - y1)));
      }
      ctx.globalAlpha = 1;
    }

    function cueRect(cue) {
      const top = RULER_H + WAVE_H + 6;
      const h = TRACK_H - 10;
      const x1 = timeToX(cue.start / 1000);
      const x2 = timeToX(cue.end / 1000);
      return { x1, x2, top, h };
    }

    function drawCueTrack(W) {
      const cues = Store.getCues();
      const selectedId = Store.getSelected();
      const settings = Store.getSettings();

      for (let i = 0; i < cues.length; i++) {
        const cue = cues[i];
        const { x1, x2, top, h } = cueRect(cue);
        if (x2 < 0 || x1 > W) continue;

        const issues = Warnings.compute(cue, i, cues, settings);
        const hasWarning = issues.length > 0;
        const isSelected = cue.id === selectedId;

        const rx1 = Math.max(-2, x1);
        const rx2 = Math.min(W + 2, x2);
        const rw = Math.max(2, rx2 - rx1);

        ctx.fillStyle = colors.accent;
        ctx.globalAlpha = isSelected ? 0.95 : 0.55;
        roundRect(ctx, rx1, top, rw, h, 3);
        ctx.fill();
        ctx.globalAlpha = 1;

        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.strokeStyle = hasWarning ? colors.danger : (isSelected ? colors.accent : colors.border);
        roundRect(ctx, rx1, top, rw, h, 3);
        ctx.stroke();

        if (rw > 18) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(rx1 + 3, top, rw - 6, h);
          ctx.clip();
          ctx.fillStyle = colors.accentContrast;
          ctx.font = "600 11px " + (getComputedStyle(document.documentElement).getPropertyValue("--font-ui") || "sans-serif");
          ctx.textBaseline = "middle";
          const label = (cue.text || "").split("\n")[0] || "(empty)";
          ctx.fillText(label, rx1 + 6, top + h / 2 + 1);
          ctx.restore();
        }

        if (hasWarning) {
          ctx.fillStyle = colors.danger;
          ctx.beginPath();
          ctx.arc(Math.min(rx1 + rw - 6, W - 6), top + 6, 3, 0, Math.PI * 2);
          ctx.fill();
        }

        // resize handles for selected cue
        if (isSelected && rw > 12) {
          ctx.fillStyle = colors.accentContrast;
          ctx.globalAlpha = 0.9;
          ctx.fillRect(rx1 + 1, top + 2, 3, h - 4);
          ctx.fillRect(rx2 - 4, top + 2, 3, h - 4);
          ctx.globalAlpha = 1;
        }
      }
    }

    function drawPlayhead(W) {
      const x = timeToX(currentTimeSec);
      if (x < -2 || x > W + 2) return;
      ctx.strokeStyle = colors.playhead;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, CANVAS_H);
      ctx.stroke();
      ctx.fillStyle = colors.playhead;
      ctx.beginPath();
      ctx.moveTo(x - 5, 0);
      ctx.lineTo(x + 5, 0);
      ctx.lineTo(x, 7);
      ctx.closePath();
      ctx.fill();
    }

    function drawMinimap() {
      const W = minimap.clientWidth;
      const H = 28;
      mctx.clearRect(0, 0, W, H);
      mctx.fillStyle = colors.bg;
      mctx.fillRect(0, 0, W, H);
      mctx.strokeStyle = colors.border;
      mctx.strokeRect(0.5, 0.5, W - 1, H - 1);

      if (duration <= 0) return;
      const pxPerSecMini = W / duration;
      const cues = Store.getCues();
      mctx.fillStyle = colors.accent;
      mctx.globalAlpha = 0.7;
      cues.forEach((cue) => {
        const x1 = (cue.start / 1000) * pxPerSecMini;
        const x2 = (cue.end / 1000) * pxPerSecMini;
        mctx.fillRect(x1, 6, Math.max(1, x2 - x1), H - 12);
      });
      mctx.globalAlpha = 1;

      const vd = Math.min(duration, viewDurationSec());
      const vx1 = scrollOffsetSec * pxPerSecMini;
      const vx2 = (scrollOffsetSec + vd) * pxPerSecMini;
      mctx.fillStyle = colors.text;
      mctx.globalAlpha = 0.15;
      mctx.fillRect(vx1, 0, Math.max(2, vx2 - vx1), H);
      mctx.globalAlpha = 1;
      mctx.strokeStyle = colors.playhead;
      mctx.strokeRect(vx1 + 0.5, 0.5, Math.max(2, vx2 - vx1) - 1, H - 1);

      const px = (currentTimeSec) * pxPerSecMini;
      mctx.strokeStyle = colors.danger;
      mctx.beginPath();
      mctx.moveTo(Math.round(px) + 0.5, 0);
      mctx.lineTo(Math.round(px) + 0.5, H);
      mctx.stroke();
    }

    function roundRect(c, x, y, w, h, r) {
      const rr = Math.min(r, w / 2, h / 2);
      c.beginPath();
      c.moveTo(x + rr, y);
      c.arcTo(x + w, y, x + w, y + h, rr);
      c.arcTo(x + w, y + h, x, y + h, rr);
      c.arcTo(x, y + h, x, y, rr);
      c.arcTo(x, y, x + w, y, rr);
      c.closePath();
    }

    // ---- hit testing ----
    function hitTest(x, y) {
      if (y < RULER_H) return { mode: "seek" };
      const cues = Store.getCues();
      for (let i = cues.length - 1; i >= 0; i--) {
        const cue = cues[i];
        const { x1, x2, top, h } = cueRect(cue);
        if (y < top - 4 || y > top + h + 4) continue;
        if (Math.abs(x - x1) <= HANDLE_PX) return { mode: "resize-left", cueId: cue.id };
        if (Math.abs(x - x2) <= HANDLE_PX) return { mode: "resize-right", cueId: cue.id };
        if (x >= x1 && x <= x2) return { mode: "move", cueId: cue.id };
      }
      return { mode: "seek" };
    }

    function localXY(evt) {
      const rect = canvas.getBoundingClientRect();
      return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
    }

    function onPointerDown(evt) {
      const { x, y } = localXY(evt);
      const hit = hitTest(x, y);

      if (hit.mode === "seek") {
        const t = Utils.clamp(xToTime(x), 0, duration || Infinity);
        currentTimeSec = t;
        onSeek(t * 1000);
        dragState = { mode: "seek" };
        render();
      } else {
        const cue = Store.getCue(hit.cueId);
        if (!cue) return;
        Store.select(cue.id);
        onCueActivate(cue.id);
        Store.pushHistory();
        if (hit.mode === "move") {
          dragState = { mode: "move", cueId: cue.id, grabOffsetSec: xToTime(x) - cue.start / 1000, dur: cue.end - cue.start };
        } else {
          dragState = { mode: hit.mode, cueId: cue.id };
        }
        render();
      }
      canvas.setPointerCapture(evt.pointerId);
    }

    function onPointerMove(evt) {
      const { x, y } = localXY(evt);

      if (!dragState) {
        const hit = hitTest(x, y);
        canvas.style.cursor =
          hit.mode === "resize-left" || hit.mode === "resize-right" ? "ew-resize" :
          hit.mode === "move" ? "grab" : "text";
        return;
      }

      if (dragState.mode === "seek") {
        const t = Utils.clamp(xToTime(x), 0, duration || Infinity);
        currentTimeSec = t;
        onSeek(t * 1000);
        render();
        return;
      }

      const cue = Store.getCue(dragState.cueId);
      if (!cue) return;

      if (dragState.mode === "resize-left") {
        let newStart = Utils.clamp(xToTime(x) * 1000, 0, cue.end - MIN_DUR_MS);
        Store.updateCue(cue.id, { start: newStart }, { record: false });
      } else if (dragState.mode === "resize-right") {
        const maxEnd = duration ? duration * 1000 : Infinity;
        let newEnd = Utils.clamp(xToTime(x) * 1000, cue.start + MIN_DUR_MS, maxEnd);
        Store.updateCue(cue.id, { end: newEnd }, { record: false });
      } else if (dragState.mode === "move") {
        let newStart = Utils.clamp((xToTime(x) - dragState.grabOffsetSec) * 1000, 0, Infinity);
        let newEnd = newStart + dragState.dur;
        const maxEnd = duration ? duration * 1000 : Infinity;
        if (newEnd > maxEnd) {
          newEnd = maxEnd;
          newStart = newEnd - dragState.dur;
        }
        Store.updateCue(cue.id, { start: newStart, end: newEnd }, { record: false });
      }
      render();
    }

    function onPointerUp(evt) {
      dragState = null;
      try { canvas.releasePointerCapture(evt.pointerId); } catch (e) {}
    }

    function onWheel(evt) {
      evt.preventDefault();
      const { x } = localXY(evt);
      if (evt.ctrlKey || evt.metaKey) {
        const factor = Math.exp(-evt.deltaY * 0.0025);
        setZoom(pxPerSecond * factor, xToTime(x));
      } else {
        const delta = (evt.deltaX || evt.deltaY) / pxPerSecond;
        scrollOffsetSec += delta;
        clampScroll();
        render();
      }
    }

    function onMinimapPointer(evt) {
      const rect = minimap.getBoundingClientRect();
      const x = evt.clientX - rect.left;
      const pxPerSecMini = rect.width / (duration || 1);
      const t = x / pxPerSecMini;
      const vd = viewDurationSec();
      scrollOffsetSec = Utils.clamp(t - vd / 2, 0, Math.max(0, duration - vd * 0.1));
      render();
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    let minimapDragging = false;
    minimap.addEventListener("pointerdown", (e) => { minimapDragging = true; onMinimapPointer(e); });
    window.addEventListener("pointermove", (e) => { if (minimapDragging) onMinimapPointer(e); });
    window.addEventListener("pointerup", () => { minimapDragging = false; });

    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas.parentElement);
    ro.observe(minimap.parentElement);

    Store.subscribe(() => render());

    resize();

    return {
      setDuration, setWaveform, setCurrentTime, setZoom, revealCue,
      refreshTheme, resize, render,
      getZoom: () => pxPerSecond,
    };
  }

  return { create };
})();
