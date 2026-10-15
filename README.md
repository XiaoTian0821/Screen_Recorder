# Screen Recorder Studio

A professional, **fully client-side** screen recording studio that runs in a modern
web browser. It captures your screen (or a single window/tab), your microphone,
your webcam overlay, and—where the browser permits—system audio, mixes them
together, and stores every recording locally in your browser's IndexedDB. **No
video ever leaves your device.**

---

## 1. Project Overview

Screen Recorder Studio is a zero-backend, zero-install studio for capturing
online classes, teaching demos, software walkthroughs, programming lessons,
presentations, and (with explicit permission) meetings and desktop apps.

- Pure HTML + CSS + Vanilla ES6/ES-module JavaScript
- `getDisplayMedia` (screen capture), `getUserMedia` (mic & camera)
- `MediaRecorder` (the recording engine)
- Web Audio API (mixing mic + system audio, gain, level meter)
- Canvas API (optional studio composition of screen + webcam)
- IndexedDB (persistent local library) + LocalStorage (preferences only)

No PHP, no Node, no Express, no React/Vue/Angular, no Tailwind, no server,
no external paid API, no analytics.

## 2. Main Features

| Feature | Notes |
|---|---|
| Screen / window / tab capture | Native `getDisplayMedia` permission dialog |
| Live preview | Selected source plays in the main stage |
| Start / pause / resume / stop | Full MediaRecorder lifecycle |
| Elapsed timer | Excludes paused time |
| Microphone capture | Echo cancellation + noise suppression options |
| System audio | Merged via Web Audio when the browser provides it |
| Separate volume sliders | Mic and system audio, 0–200 % |
| Webcam picture-in-picture | Draggable, circle or rectangle, mirrored optional |
| Studio composition | Optional canvas composite of screen + webcam at the selected resolution/FPS |
| Settings | 720p/1080p/4K, 24/30/60 fps, 2–20 Mbps, persisted locally |
| Snapshot | Capture a frame as PNG from the review player |
| Review modal | Play, size, format, save, download |
| Local library | IndexedDB: list, thumbnails, preview, download, rename, delete |
| Keyboard shortcuts | Alt+R / Alt+P / Alt+M / Alt+W, Esc to close dialogs |
| Toasts + a11y | Non-blocking notifications, focus management, ARIA labels |

## 3. Technology Stack

- HTML5, CSS3, Vanilla JavaScript (ES modules)
- Web APIs: `MediaDevices.getDisplayMedia`, `getUserMedia`, `MediaRecorder`,
  `AudioContext` / `GainNode` / `AnalyserNode` / `MediaStreamAudioDestinationNode`,
  `HTMLCanvasElement.captureStream`, `IndexedDB`, `localStorage`

## 4. Folder Structure

```
Screen-Recorder-Studio/
├── index.html
├── README.md
├── css/
│   ├── style.css          # design tokens, layout, responsive rules
│   └── components.css     # buttons, modals, drawer, toasts, library
├── js/
│   ├── app.js             # entry point: state machine + UI wiring
│   ├── recorder.js        # MediaRecorder lifecycle, timer, blob output
│   ├── audio-mixer.js     # Web Audio graph for mic + system audio
│   ├── canvas-compositor.js # optional screen + webcam composition
│   ├── storage.js         # IndexedDB + LocalStorage persistence
│   └── visualizer.js      # level meter / bar visualizer helpers
└── assets/
    └── icons/             # (optional; the app ships with inline SVG)
```

## 5. Installation

There is nothing to install. The app is static files.

### Running locally (recommended)

Because `getDisplayMedia` and ES modules require a **secure context**, serve
the folder through `localhost` rather than opening `index.html` via `file://`.

**Option A — Python:**
```bash
cd Screen-Recorder-Studio
python -m http.server 8080
# open http://localhost:8080
```

**Option B — Node's static server (for convenience, not used at runtime):**
```bash
npx serve .
```

**Option C — XAMPP (matches this workspace):**
Place the folder under `htdocs` and open
`http://localhost/Screen_Recoder/` in Chrome or Edge.

**Option D — any other static server** (nginx, caddy, etc.) pointing at this folder.

> A bare `file://` URL may work for parts of the UI but **will not** enable
> screen capture in most browsers. Use `localhost` or HTTPS.

## 6. Browser Compatibility

| Browser | Screen capture | Mic | Camera | System audio | Output codec |
|---|---|---|---|---|---|
| Chrome / Edge (desktop) | ✅ | ✅ | ✅ | ✅ (tab share or "share audio") | WebM (VP9/VP8 + Opus) |
| Firefox (desktop) | ✅ (some platform limits) | ✅ | ✅ | partial | WebM |
| Safari | ✅ (macOS) | ✅ | ✅ | limited | MP4 when available, else WebM |

The app detects support at runtime and shows clear messages when a feature is
unavailable; it never crashes on missing APIs.

## 7. How to Record a Screen

1. Open the app over `localhost`/HTTPS.
2. Click **Select Screen** and choose a screen, window, or tab in the browser
   dialog. The preview appears in the main stage.
3. (Optional) Click the **Mic** button to enable narration, the **Cam** button
   to enable the webcam overlay.
4. Click **Start** (or `Alt+R`). The timer runs; pause with **Pause**
   (`Alt+P`).
5. Click **Stop** (or `Alt+R` again). The review modal opens with the finished
   video: play it, snapshot a frame, download it, or **Save to Library**.

## 8. Microphone & Webcam Setup

- **Mic:** Toggle **Mic**. Settings → echo cancellation / noise suppression /
  volume. The live meter under "Microphone" in the source row shows input level.
- **Webcam:** Toggle **Cam**. Drag the floating overlay to where you like; use
  the ✕ button to close it, the ◯ button to switch circle/rectangle shape.
  Settings → *Mirror webcam* to flip the preview for a more natural look.

## 9. System-Audio Limitations (Important)

System (desktop/tab) audio capture depends on **all three** of these:

1. **Browser** — Chrome/Edge support it; Firefox is partial; Safari is limited.
2. **Operating system** — some OSes expose different audio routes.
3. **Selected source** — pick "share this tab" or enable "share audio" when
   sharing a screen/window; otherwise no audio track is attached.

When system audio is **not** available, the app simply records video + mic and
displays a hint. It never claims to capture audio the browser cannot provide.

## 10. Output Format

- The app probes `MediaRecorder.isTypeSupported()` at load and prefers
  `video/webm;codecs=vp9,opus`, then `vp8,opus`, then plain `webm`, then
  `mp4` (Safari), then `ogg`.
- The **actual** MIME type of the produced Blob is displayed in the review
  modal and library — a `.webm` is never mislabelled as `.mp4`.
- Filenames are generated like `Recording 2026-10-15 13-45.webm`.

## 11. Library & Storage

- Recordings are stored **only** in your browser's IndexedDB (`ScreenRecorderDB`)
  on **your** machine.
- Saving to the library stores the video Blob, a thumbnail, and metadata.
- The library survives normal reloads until the user clears site data or runs
  out of storage quota.
- IndexedDB has browser-specific quotas (often several GB). Very long 4K/60fps
  sessions can fail to save; the app reports the failure and the in-memory
  Blob is still available to download directly from the review modal.

## 12. Troubleshooting

| Symptom | What to do |
|---|---|
| "Select Screen" button does nothing / no dialog | You are on `file://`. Serve the folder over `localhost` or HTTPS. |
| Recording starts but no audio | Re-share the tab/screen with "share audio" enabled, or enable the mic. |
| Webcam overlay appears but no image | Check the camera permission dialog; try a different camera. |
| The timer stops mid-recording | The external "Stop sharing" chip was pressed; the session is finalized automatically. |
| "Could not save to library" | Browser storage is full or blocked; download the file from the review modal instead. |
| Browser shows "MP4" | Some browsers (Safari) encode to MP4; the app always uses the **actual** `Blob.type`, not the filename. |
| No recording formats detected | Your browser is very old; upgrade to a recent Chrome/Edge/Firefox/Safari. |

## 13. Privacy Notes

- All media processing happens locally in the browser.
- No network requests are made by the application after initial load
  (no analytics, no telemetry, no uploads).
- Permissions are requested **only** when you click the relevant button.
- Stopped tracks are released; audio contexts are closed; object URLs are
  revoked when no longer needed.

## 14. Known Limitations

- **Screen resolution:** the native `getDisplayMedia` resolution is chosen by
  the browser and the selected source; the Settings resolution is a target
  that is guaranteed only when the canvas-composition pipeline is used.
- **Canvas composition cost:** 4K @ 60 fps with an active webcam is
  CPU-intensive; use 1080p/30fps for smooth recording.
- **System audio:** not universally available (see §9).
- **MP4:** only when the browser natively supports it (Safari). The app does
  **not** bundle a third-party muxer, so it will never fabricate an MP4 on
  a browser that cannot produce one.
- **Large files:** the Blob is kept in memory until saved; very long sessions
  may exceed available RAM or the storage quota.

## 15. Extending

Each JS module has a single responsibility:

- `recorder.js` — add new codec candidates to `MIME_CANDIDATES`.
- `audio-mixer.js` — add extra input sources (e.g., a second mic).
- `canvas-compositor.js` — add a second webcam or custom layouts.
- `storage.js` — add new IndexedDB fields or a second store.

All public functions return Promises and throw descriptive Errors, so you can
wrap them in any UI layer without a framework.
