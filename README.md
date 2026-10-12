# EYE DRAW

Draw trails of text with your eyes.

EYE DRAW uses your webcam to track where you're looking. The cursor follows your gaze, and each blink drops a point; points join up into lines stamped with whatever text you type.

A [Maybe Machine](https://ravipopat.info/maybe-machines) by [Ravi Popat](https://ravipopat.info).

**Try it:** https://dinefining.github.io/eye-draw/

## Run it

Requires [Node.js](https://nodejs.org) 18+.

```bash
git clone https://github.com/dinefining/eye-draw.git
cd eye-draw
npm install
npm run dev
```

Then open http://localhost:3300 in Chrome or Safari and allow camera access.

## Build

```bash
npm run build
```

The static site lands in `dist/`. Asset paths are relative, so it can be hosted from any folder, including GitHub Pages.

## How it works

- **Face tracking**: [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) finds 478 face landmarks per frame, including the irises. Everything runs in the browser; no video leaves your machine.
- **Gaze estimation** (`tracker.ts`, `gazeModel.ts`): for each eye, the iris position is measured relative to the eye corners, combined with head pose, and mapped to screen coordinates by a ridge regression fitted during calibration.
- **Smoothing** (`gazeFilter.ts`): a short median filter removes spikes, then a One Euro filter smooths the cursor while keeping fast eye movements responsive.
- **Blinks** (`tracker.ts`): a blink is a sudden drop in eye openness relative to a rolling baseline, so slow changes like looking down don't count. Each point is placed at the median gaze from just before the blink.
- **Drawing** (`strokes.ts`): points are joined with straight lines or a centripetal Catmull-Rom curve, and the text is stamped along the path, upright or rotated to follow it.

## Controls

| Control | Does |
| --- | --- |
| Text field, − / + | What to draw, and its size |
| Draw / Pause | Start or stop placing points (`Space`) |
| Clear | Erase everything |
| trail | Gap between repeats of the text |
| Sharp / Smooth | Straight corners or curves |
| Sit / Tilt | Text upright, or following the line |
| Save | Download a JPEG |
| Recal | Recalibrate |

Shortcuts: `Z` or `⌫` undo, `Shift`+`Z` redo, `Esc` lift the pen. Holding your eyes closed for a second also lifts the pen. On touch screens, Undo / Redo / New line appear in the menu.

## Project layout

```
App.tsx                  UI, calibration, drawing state
tracker.ts               Camera + MediaPipe, gaze features, blink detection
gazeModel.ts             Ridge regression from features to screen position
gazeFilter.ts            Cursor smoothing
strokes.ts               Stroke rendering
components/WebcamFeed.tsx  Camera preview with eye overlay
components/Instructions.tsx  Info panel
public/mediapipe/        Face model (the wasm runtime is copied in on install)
public/favicon.svg, og.png
scripts/copy-mediapipe.mjs
```

## Deploy to GitHub Pages

1. Push this repo to `github.com/dinefining/eye-draw`.
2. Run `npm run build` and publish the `dist/` folder, for example with the [`gh-pages`](https://www.npmjs.com/package/gh-pages) package: `npx gh-pages -d dist`.
3. In the repo's **Settings → Pages**, set the source to the `gh-pages` branch.

The site will be at https://dinefining.github.io/eye-draw/.

## Share preview

`public/og.png` is the social preview image. The `og:image` and `twitter:image` tags in `index.html` point at `https://dinefining.github.io/eye-draw/og.png`; update them if you host it elsewhere.
