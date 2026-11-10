# Sardiye Studio

Local tool that adds broadcast-style overlays (name cards, definitions, numbers, maps, quotes, lists, headlines, keywords, timelines, comparisons, charts) to commentary videos. Transcribes with faster-whisper, plans with Claude, renders overlays in headless Chromium at the source resolution, composites with FFmpeg.

User documentation: see [GUIDE.md](GUIDE.md).

## Run

Mac, one line:

```bash
curl -fsSL https://raw.githubusercontent.com/chadbrightside/overlay-studio/main/install-mac.sh | bash
```

Or by hand:

```bash
npm install
npm run setup     # downloads Chromium, installs faster-whisper
npm start         # http://localhost:3777
```

## How it works

```
video ──► python/transcribe.py (faster-whisper, word timestamps) ──► transcript.json
transcript ──► src/planner.js (Claude, structured output, zod schema) ──► plan.json
plan ──► src/renderer.js (Playwright + templates/, PNG sequence with alpha per overlay)
      ──► src/compose.js (ffmpeg filter graph: overlay=enable=between(t,...)) ──► renders/
```

- `src/server.js`: Express API + static UI (`ui/`). Long operations run as jobs (`src/jobs.js`) and the UI polls `/api/jobs/:id`.
- `src/pipeline.js`: orchestrates rendering and export; caches frame sets per overlay by a hash of the overlay content, brand settings, scale, fps and the template files.
- `templates/overlays.js`: the overlay types and a deterministic `seek(t)` animation driver. `Overlay.mount(spec, theme)` then `Overlay.seek(t)` per frame; nothing depends on wall-clock time, so renders are reproducible.
- Design space is 1920 px wide; `deviceScaleFactor = sourceWidth / 1920` makes 4K renders pixel-sharp without touching the templates.
- Export modes: `burn` (full-resolution re-encode, audio copied), `alpha` (ProRes 4444 overlay-only track with alpha), `proxy` (1080p check render).

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | tool availability |
| GET/PUT | `/api/settings` | settings (API key masked on read) |
| GET/POST | `/api/projects` | list / create from a video path |
| POST | `/api/projects/script` | create from a script (no video yet) |
| GET/PUT | `/api/projects/:id/script` | read / edit the script |
| POST | `/api/projects/:id/video` | attach the recording → job: transcribe, then time the overlays by their anchor words (`src/align.js`) |
| POST | `/api/projects/:id/transcribe` | job |
| POST | `/api/projects/:id/transcript/import` | SRT/VTT body |
| POST | `/api/projects/:id/plan` | `{notes, revise}` → job |
| PUT | `/api/projects/:id/plan` | save edits |
| POST | `/api/projects/:id/overlays/:oid/still` | thumbnail PNG + frame |
| POST | `/api/projects/:id/overlays/:oid/clip` | 1080p preview clip job |
| POST | `/api/projects/:id/export` | `{mode, codec, crf, preset}` → job |
| GET | `/api/jobs/:id` | progress, log, result |

## Adding an overlay type

1. Add the type to `OVERLAY_TYPES` and the prompt in `src/planner.js`.
2. Add a builder in `templates/overlays.js` and styles in `templates/overlays.css`.
3. Add its editable fields to `TYPES` in `ui/app.js`, and its Arabic labels to `ui/i18n.js`.

## Publishing an update

The app on the YouTuber's machine checks `package.json` on the `main` branch of `chadbrightside/overlay-studio`. To ship a change:

```bash
npm version patch -m "Sardiye Studio %s"
```

```bash
git push origin main --tags
```

Within a minute, his app shows "A new version is available" with an Update now button. Only these paths are replaced on his side: `src`, `ui`, `templates`, `python`, `package.json`, `package-lock.json`, the guide, the readme and the launcher scripts. His `data` and `inbox` folders are never touched.
