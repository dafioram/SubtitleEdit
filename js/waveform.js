/* waveform.js — best-effort waveform peak extraction. Fails gracefully. */
const Waveform = (function () {
  const BUCKETS_PER_SECOND = 10; // 100ms resolution
  const MAX_DURATION_SECONDS = 3 * 60 * 60; // skip waveform beyond 3h (memory/time guard)
  const MAX_FILE_BYTES = 500 * 1024 * 1024; // skip waveform beyond 500MB

  // Returns { peaksMin: Float32Array, peaksMax: Float32Array, bucketSeconds: number, duration: number }
  // or null if generation was skipped/failed.
  async function generate(file, onStatus) {
    try {
      if (file.size > MAX_FILE_BYTES) {
        onStatus && onStatus("File too large for waveform preview — timeline will show cues only.");
        return null;
      }

      onStatus && onStatus("Decoding audio…");
      const arrayBuffer = await file.arrayBuffer();
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        onStatus && onStatus("");
        return null;
      }
      const audioCtx = new AudioCtx();
      let audioBuffer;
      try {
        audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
      } finally {
        audioCtx.close && audioCtx.close();
      }

      const duration = audioBuffer.duration;
      if (duration > MAX_DURATION_SECONDS) {
        onStatus && onStatus("Video too long for waveform preview — timeline will show cues only.");
        return null;
      }

      onStatus && onStatus("Analyzing waveform…");
      const raw = audioBuffer.getChannelData(0);
      const totalBuckets = Math.max(1, Math.ceil(duration * BUCKETS_PER_SECOND));
      const samplesPerBucket = Math.max(1, Math.floor(raw.length / totalBuckets));

      const peaksMin = new Float32Array(totalBuckets);
      const peaksMax = new Float32Array(totalBuckets);

      for (let b = 0; b < totalBuckets; b++) {
        const start = b * samplesPerBucket;
        const end = Math.min(raw.length, start + samplesPerBucket);
        let min = 0, max = 0;
        for (let i = start; i < end; i++) {
          const v = raw[i];
          if (v < min) min = v;
          if (v > max) max = v;
        }
        peaksMin[b] = min;
        peaksMax[b] = max;
      }

      onStatus && onStatus("");
      return { peaksMin, peaksMax, bucketSeconds: 1 / BUCKETS_PER_SECOND, duration };
    } catch (err) {
      console.warn("Waveform generation skipped:", err);
      onStatus && onStatus("Waveform unavailable for this file — timeline will show cues only.");
      return null;
    }
  }

  return { generate };
})();
