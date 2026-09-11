# Caption — a browser-based subtitle editor

A static, no-build-step subtitle editor that runs entirely in the browser. Load a video,
import an `.srt` file, and edit timing and text against a waveform timeline. Nothing is
uploaded anywhere — the video and subtitles never leave your machine.

## Features

- **Import/export** `.srt`, export also to `.vtt`
- **Video playback** synced to the cue list and timeline, adjustable speed
- **Waveform timeline** (best-effort, generated locally from the video's audio track) with
  zoom, pan, a minimap, and draggable cue edges for precise timing
- **Cue list** with inline text and timecode editing
- **Add / delete / split / merge** cues, **shift timing** by a fixed offset, **find & replace**
- **Quality checks**: overlapping cues, lines that are too long, too many lines, reading
  speed (characters/second), and minimum duration — thresholds are configurable
- **Undo/redo**, full keyboard shortcuts (see the in-app `?` help panel)
- **Autosave** to your browser's local storage, so a refresh won't lose your edits
- **Light/dark theme**

## Running locally

This is a plain static site — no build step, no dependencies. Because the video/audio
decoding and the "Try Sample" button use browser APIs that require an HTTP origin (not
`file://`), serve the folder with any static file server, for example:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

or `npx serve .`, or the VS Code "Live Server" extension — anything that serves static
files works.

## Deploying to GitHub Pages

**Option A — GitHub Actions (included, recommended)**

1. Push this repository to GitHub.
2. In the repo, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push to your default branch (or run the workflow manually from the **Actions** tab).
   `.github/workflows/deploy.yml` builds nothing — it just publishes these files — and your
   site will be live at `https://<username>.github.io/<repo>/`. The workflow triggers on
   pushes to `main`; edit the `branches:` line in that file if your default branch is named
   differently (e.g. `master`).

**Option B — Deploy from a branch**

1. Push this repository to GitHub.
2. Go to **Settings → Pages**, set **Source** to **Deploy from a branch**, and pick your
   default branch with the `/ (root)` folder.
3. Save. Your site will be live at `https://<username>.github.io/<repo>/` within a minute
   or two.

Either option works since there's nothing to compile — the site is served as-is.

## Project structure

```
index.html
css/styles.css
js/
  utils.js       time/formatting helpers
  srt.js         .srt parsing + .srt/.vtt export
  store.js       app state, undo/redo, settings
  warnings.js    quality-check rules
  waveform.js    audio decoding + waveform peaks
  timeline.js    canvas timeline, waveform + cue drawing, drag interactions
  app.js         wires everything to the DOM
sample/sample.srt
```

## Notes and limitations

- The waveform is generated locally via the Web Audio API and is skipped gracefully for
  very large or very long files, or files without a decodable audio track — the timeline
  still works for cue editing either way.
- Autosave stores your cues and settings in the browser's local storage on the device
  you're using. It does not store the video file itself (browsers can't persist arbitrary
  files that way) — reopen your video after a refresh and your cue edits will still be there.
- Built with vanilla HTML/CSS/JS; tested in current Chrome, Firefox, and Safari.

## License

MIT — see `LICENSE`.
