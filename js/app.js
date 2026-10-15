/**
 * app.js — Application bootstrap, UI coordination, state machine.
 *
 * This is the entry module (loaded by index.html). It wires all the
 * smaller modules together and owns the top-level state machine:
 *
 *   idle -> screen-selected -> recording -> paused -> processing -> review
 *
 * Every transition is explicit; invalid combinations of control states
 * are guarded so repeated async calls cannot corrupt the pipeline.
 */

import { Recorder, formatTime, formatBytes, detectMimeType, mimeToExt, mimeLabel } from './recorder.js';
import { AudioMixer } from './audio-mixer.js';
import { CanvasCompositor } from './canvas-compositor.js';
import { bindMeter } from './visualizer.js';
import * as store from './storage.js';

/* ------------------------------------------------------------------ */
/*  Default settings & persisted preferences                           */
/* ------------------------------------------------------------------ */
const DEFAULTS = {
  resolution: 1080,        // 720 | 1080 | 2160
  fps: 30,                 // 24 | 30 | 60
  bitrate: 8000000,        // bits/s
  echoCancel: true,
  noiseSuppress: true,
  micVolume: 100,          // 0–200 %
  sysVolume: 100,          // 0–200 %
  mirror: true,
  studioCompose: false,
};

const RES_MAP = { 720: [1280, 720], 1080: [1920, 1080], 2160: [3840, 2160] };

let settings = { ...DEFAULTS, ...(store.loadPrefs() || {}) };

/* ------------------------------------------------------------------ */
/*  Element refs                                                       */
/* ------------------------------------------------------------------ */
const $ = (sel) => document.querySelector(sel);

const els = {
  previewVideo: $('#preview-video'),
  compositorCanvas: $('#compositor-canvas'),
  emptyState: $('#empty-state'),
  emptyFeatureNote: $('#empty-feature-note'),
  stageIndicators: $('#stage-indicators'),
  recIndicator: $('#rec-indicator'),
  pausedIndicator: $('#paused-indicator'),
  processingIndicator: $('#processing-indicator'),
  shareSourceLabel: $('#share-source-label'),
  stageEndNote: $('#stage-end-note'),
  webcamOverlay: $('#webcam-overlay'),
  webcamVideo: $('#webcam-video'),
  statusIndicator: $('#status-indicator'),
  statusLabel: $('#status-label'),

  btnSelect: $('#btn-select-screen'),
  btnStart: $('#btn-start'),
  btnPause: $('#btn-pause'),
  pauseIcon: $('#pause-icon'),
  pauseLabel: $('#pause-label'),
  btnStop: $('#btn-stop'),
  btnMic: $('#btn-mic'),
  micLabel: $('#mic-label'),
  btnWebcam: $('#btn-webcam'),
  webcamLabel: $('#webcam-label'),
  btnDownload: $('#btn-download'),
  timer: $('#timer'),
  recMeta: $('#rec-meta'),

  micMeterFill: $('#mic-meter-fill'),
  screenSourceName: $('#screen-source-name'),
  micStatusName: $('#mic-status-name'),
  camStatusName: $('#cam-status-name'),
  formatName: $('#format-name'),
  resFpsName: $('#res-fps-name'),

  // modals
  reviewModal: $('#review-modal'),
  reviewVideo: $('#review-video'),
  reviewDuration: $('#review-duration'),
  reviewSize: $('#review-size'),
  reviewFormat: $('#review-format'),
  btnSnapshot: $('#btn-snapshot'),
  btnSaveLibrary: $('#btn-save-library'),
  btnReviewDownload: $('#btn-review-download'),
  btnReviewClose: $('#btn-review-close'),

  settingsModal: $('#settings-modal'),
  helpModal: $('#help-modal'),
  libraryDrawer: $('#library-drawer'),
  libraryCount: $('#library-count'),
  libraryList: $('#library-list'),
  libraryEmpty: $('#library-empty'),
  previewModal: $('#preview-modal'),
  previewVideoEl: $('#preview-video-el'),
  previewMetaTitle: $('#preview-meta-title'),
  previewMetaSize: $('#preview-meta-size'),
  previewMetaFormat: $('#preview-meta-format'),
  previewMetaData: $('#preview-meta-date'),
  btnPreviewDownload: $('#btn-preview-download'),
  btnPreviewClose: $('#btn-preview-close'),
  confirmModal: $('#confirm-modal'),
  confirmText: $('#confirm-text'),
  btnConfirmOk: $('#btn-confirm-ok'),
  btnConfirmCancel: $('#btn-confirm-cancel'),
  toastRegion: $('#toast-region'),
};

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */
const app = {
  state: 'idle',           // idle | screen | recording | paused | processing | review | error
  screenStream: null,
  micStream: null,
  camStream: null,
  sysStream: null,
  mixer: new AudioMixer(),
  compositor: new CanvasCompositor(els.compositorCanvas),
  recorder: new Recorder(),
  latestBlob: null,
  latestMime: null,
  latestDuration: 0,
  latestTitle: '',
  busy: false,             // guards against duplicate async starts
  meterUnbind: null,
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function setState(next) {
  app.state = next;
  syncStatusIndicator();
  syncDockButtons();
  syncStageIndicators();
}

function syncStatusIndicator() {
  const map = {
    idle: 'Idle',
    screen: 'Screen selected',
    recording: 'Recording',
    paused: 'Paused',
    processing: 'Processing',
    review: 'Review',
    error: 'Error',
  };
  els.statusLabel.textContent = map[app.state] || app.state;
  els.statusIndicator.dataset.status = app.state;
}

function syncDockButtons() {
  const s = app.state;
  const hasScreen = !!app.screenStream;
  els.btnStart.disabled = !hasScreen || s === 'recording' || s === 'processing' || app.busy;
  els.btnStart.classList.toggle('is-recording', s === 'recording' || s === 'paused');
  const startLabel = els.btnStart.querySelector('.dock-btn-label');
  if (startLabel) startLabel.textContent = s === 'recording' || s === 'paused' ? 'Stop' : 'Start';

  els.btnPause.disabled = !(s === 'recording' || s === 'paused');
  const paused = s === 'paused';
  els.pauseLabel.textContent = paused ? 'Resume' : 'Pause';
  els.pauseIcon.innerHTML = paused
    ? '<polygon points="8,5 19,12 8,19"/>'
    : '<rect x="7" y="6" width="3.5" height="12" rx="1"/><rect x="13.5" y="6" width="3.5" height="12" rx="1"/>';

  els.btnStop.disabled = !(s === 'recording' || s === 'paused');
  els.btnMic.disabled = !hasScreen || s === 'recording' || s === 'paused' || s === 'processing' || app.busy;
  els.btnWebcam.disabled = !hasScreen || s === 'recording' || s === 'paused' || s === 'processing' || app.busy;
  els.btnDownload.disabled = !app.latestBlob;
}

function syncStageIndicators() {
  const s = app.state;
  els.emptyState.style.display = app.screenStream ? 'none' : 'flex';
  els.stageIndicators.hidden = !app.screenStream;
  els.recIndicator.hidden = s !== 'recording';
  els.pausedIndicator.hidden = s !== 'paused';
  els.processingIndicator.hidden = s !== 'processing';
  els.shareSourceLabel.hidden = !app.screenStream;
  els.stageEndNote.hidden = !!app.screenStream && s !== 'idle';
}

function updateMicWebcamCards() {
  els.micStatusName.textContent = app.micStream ? 'Enabled' : 'Disabled';
  els.camStatusName.textContent = app.camStream ? 'Enabled' : 'Disabled';
  els.micLabel.textContent = app.micStream ? 'Mic on' : 'Mic off';
  els.webcamLabel.textContent = app.camStream ? 'Cam on' : 'Cam off';
  els.btnMic.classList.toggle('active', !!app.micStream);
  els.btnWebcam.classList.toggle('active', !!app.camStream);
}

function updateResFpsIndicator() {
  const [w, h] = RES_MAP[settings.resolution] || RES_MAP[1080];
  els.resFpsName.textContent = `${w}×${h} · ${settings.fps} fps`;
}

function updateFormatIndicator() {
  const mime = detectMimeType();
  els.formatName.textContent = mimeLabel(mime);
  els.formatName.title = mime || '';
}

/* ------------------------------------------------------------------ */
/*  Toasts                                                             */
/* ------------------------------------------------------------------ */
function toast(type, title, msg = '') {
  const icons = { success: '✓', error: '✕', warning: '!', info: 'i' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', 'alert');
  const iconEl = document.createElement('span');
  iconEl.className = 'toast-icon';
  iconEl.textContent = icons[type] || 'i';
  el.appendChild(iconEl);
  const body = document.createElement('div');
  const t = document.createElement('div');
  t.className = 'toast-title';
  t.textContent = title;
  body.appendChild(t);
  if (msg) {
    const m = document.createElement('div');
    m.className = 'toast-msg';
    m.textContent = msg;
    body.appendChild(m);
  }
  el.appendChild(body);
  els.toastRegion.appendChild(el);

  setTimeout(() => {
    el.classList.add('leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400); // safety
  }, 4200);
}

/* ------------------------------------------------------------------ */
/*  Screen capture                                                     */
/* ------------------------------------------------------------------ */
async function selectScreen() {
  if (app.busy) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    showToastAndState('error', 'Screen capture unavailable',
      'This browser does not support getDisplayMedia(). Use a recent Chrome or Edge over HTTPS/localhost.');
    setState('error');
    return;
  }
  app.busy = true;
  setState('screen');
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: settings.fps },
      audio: true, // ask for system audio when offered
    });

    // Replace any previous stream cleanly.
    releaseScreen();
    app.screenStream = stream;

    // Route to preview
    const video = els.previewVideo;
    video.srcObject = stream;
    await video.play().catch(() => {});

    const track = stream.getVideoTracks()[0];
    const label = track && track.label ? track.label : 'Screen';
    els.shareSourceLabel.textContent = label;
    els.screenSourceName.textContent = label;

    // System audio: the stream may contain audio tracks (desktop audio / tab audio).
    const audioTracks = stream.getAudioTracks();
    app.sysStream = audioTracks.length ? new MediaStream(audioTracks) : null;

    // Detect external stop (browser "Stop sharing" button).
    track.onended = () => handleScreenEnded();

    // If a webcam is active and studio compose is on, we may want the canvas to be live
    // immediately, but the recorded stream only matters at start. Leave preview as-is.
    if (settings.studioCompose && app.camStream) {
      // keep compositor idle for now; it is started at recording start
    }

    setState('screen');
    toast('success', 'Screen selected', `${label}`);
  } catch (err) {
    console.warn('[srs] screen select failed', err);
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
      toast('error', 'Permission denied', 'You closed or denied the share dialog. You can retry anytime.');
      setState('idle');
    } else {
      toast('error', 'Could not start screen capture', err.message || String(err));
      setState('idle');
    }
  } finally {
    app.busy = false;
    syncDockButtons();
  }
}

function handleScreenEnded() {
  if (!app.screenStream) return;
  // If we were mid-recording, finalize what we have.
  if (app.state === 'recording' || app.state === 'paused') {
    stopRecording();
  } else {
    releaseScreen();
    releaseMic();
    releaseCam();
    app.compositor.stop();
    app.mixer.destroy();
    if (app.meterUnbind) { app.meterUnbind(0); app.meterUnbind = null; }
    els.timer.textContent = '00:00:00';
    els.timer.classList.remove('is-live');
    showCanvasPreview(false);
    setState('idle');
  }
  toast('warning', 'Screen sharing ended', 'The shared source was stopped from outside.');
}

function releaseScreen() {
  if (app.screenStream) {
    app.screenStream.getTracks().forEach(t => t.stop());
    app.screenStream = null;
  }
  if (app.sysStream) {
    app.sysStream.getTracks().forEach(t => t.stop());
    app.sysStream = null;
  }
  els.previewVideo.srcObject = null;
  els.previewVideo.pause();
}

/* ------------------------------------------------------------------ */
/*  Microphone                                                         */
/* ------------------------------------------------------------------ */
async function toggleMic() {
  if (app.micStream) {
    releaseMic();
    toast('info', 'Microphone disabled', 'Mic audio will no longer be captured.');
    updateMicWebcamCards();
    syncDockButtons();
    return;
  }
  if (!navigator.mediaDevices.getUserMedia) {
    toast('error', 'Microphone unavailable', 'getUserMedia is not supported here.');
    return;
  }
  try {
    app.busy = true;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: settings.echoCancel,
        noiseSuppression: settings.noiseSuppress,
      },
    });
    app.micStream = stream;
    const t = stream.getAudioTracks()[0];
    updateMicWebcamCards();
    toast('success', 'Microphone enabled', (t && t.label) ? t.label : '');
  } catch (err) {
    console.warn('[srs] mic failed', err);
    if (err.name === 'NotAllowedError') {
      toast('error', 'Mic permission denied', 'Allow microphone access in your browser and retry.');
    } else {
      toast('error', 'Microphone unavailable', err.message || String(err));
    }
    app.micStream = null;
  } finally {
    app.busy = false;
    syncDockButtons();
    updateMicWebcamCards();
  }
}

function releaseMic() {
  if (app.micStream) {
    app.micStream.getTracks().forEach(t => t.stop());
    app.micStream = null;
  }
  updateMicWebcamCards();
}

/* ------------------------------------------------------------------ */
/*  Webcam                                                             */
/* ------------------------------------------------------------------ */
async function toggleCam() {
  if (app.camStream) {
    releaseCam();
    toast('info', 'Webcam disabled', 'The overlay was removed.');
    updateMicWebcamCards();
    syncDockButtons();
    return;
  }
  if (!navigator.mediaDevices.getUserMedia) {
    toast('error', 'Webcam unavailable', 'getUserMedia is not supported here.');
    return;
  }
  try {
    app.busy = true;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    app.camStream = stream;
    const video = els.webcamVideo;
    video.srcObject = stream;
    await video.play().catch(() => {});
    video.classList.toggle('mirror', settings.mirror);
    els.webcamOverlay.hidden = false;
    showWebcamOverlay(true);
    updateMicWebcamCards();
    toast('success', 'Webcam enabled', settings.mirror ? 'Mirrored' : '');
  } catch (err) {
    console.warn('[srs] cam failed', err);
    if (err.name === 'NotAllowedError') {
      toast('error', 'Camera permission denied', 'Allow camera access and retry.');
    } else if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
      toast('error', 'No camera found', 'Connect a webcam and retry.');
    } else {
      toast('error', 'Webcam unavailable', err.message || String(err));
    }
    app.camStream = null;
  } finally {
    app.busy = false;
    syncDockButtons();
    updateMicWebcamCards();
  }
}

function releaseCam() {
  if (app.camStream) {
    app.camStream.getTracks().forEach(t => t.stop());
    app.camStream = null;
  }
  els.webcamVideo.srcObject = null;
  els.webcamVideo.pause();
  showWebcamOverlay(false);
  updateMicWebcamCards();
}

function showWebcamOverlay(show) {
  els.webcamOverlay.hidden = !show;
}

/* ------------------------------------------------------------------ */
/*  Recording                                                          */
/* ------------------------------------------------------------------ */
async function startRecording() {
  if (app.state !== 'idle' && app.state !== 'screen') return;
  if (!app.screenStream) {
    toast('warning', 'No screen selected', 'Choose a screen first with “Select Screen”.');
    return;
  }

  app.busy = true;
  setState('processing');
  try {
    // 1. Build video source: either direct track or canvas-composited.
    let videoTracks;
    const useCanvas = settings.studioCompose && app.camStream;

    if (useCanvas) {
      const [w, h] = RES_MAP[settings.resolution] || RES_MAP[1080];
      // The preview <video> must be playing for drawImage to have frames.
      const canvasStream = app.compositor.start(
        els.previewVideo, els.webcamVideo, w, h, settings.fps
      );
      app.compositor.setMirror(settings.mirror);
      videoTracks = canvasStream.getVideoTracks();
      showCanvasPreview(true);
    } else {
      videoTracks = app.screenStream.getVideoTracks();
      showCanvasPreview(false);
    }

    // 2. Build audio source.
    let audioTracks = [];
    const wantSys = !!app.sysStream;
    const wantMic = !!app.micStream;

    if (wantSys || wantMic) {
      const micForMixer = wantMic ? app.micStream : new MediaStream();
      const sysForMixer = wantSys ? app.sysStream : new MediaStream();
      app.mixer.init(micForMixer, sysForMixer);
      app.mixer.setMicVolume(settings.micVolume);
      app.mixer.setSysVolume(settings.sysVolume);
      app.mixer.onLevel = app.meterUnbind || bindMeter(els.micMeterFill);
      app.meterUnbind = app.mixer.onLevel;
      const out = app.mixer.getOutput();
      if (out) audioTracks = out.getAudioTracks();
      if (!audioTracks.length && !wantMic && wantSys) {
        // Fallback: attach system audio directly.
        audioTracks = app.sysStream.getAudioTracks();
      }
    } else {
      // No mic, no mixer — but we may still want raw system audio.
      if (wantSys) audioTracks = app.sysStream.getAudioTracks();
    }

    // 3. Assemble the final stream.
    const combined = new MediaStream([...videoTracks, ...audioTracks]);
    if (combined.getTracks().length === 0) {
      throw new Error('No usable media tracks for recording.');
    }

    // 4. Start the recorder.
    app.latestBlob = null;
    app.latestTitle = defaultTitle();
    await app.recorder.start(combined, {
      videoBitrate: settings.bitrate,
      onTick: (ms) => {
        els.timer.textContent = formatTime(ms);
        els.recMeta.textContent = `${mimeLabel(app.recorder.mimeType)} · ${settings.fps} fps`;
      },
      onStopped: (blob) => {
        if (blob) finalizeRecording(blob);
      },
      onError: (err) => {
        console.error('[srs] recorder error', err);
        toast('error', 'Recording error', err.message || String(err));
        setState('error');
        app.busy = false;
        syncDockButtons();
      },
    });

    setState('recording');
    els.timer.textContent = '00:00:00';
    els.timer.classList.add('is-live');
    els.recMeta.textContent = '';
    toast('success', 'Recording started', `${els.shareSourceLabel.textContent || 'Screen'}`);
  } catch (err) {
    console.error('[srs] start failed', err);
    toast('error', 'Could not start recording', err.message || String(err));
    setState('idle');
    app.compositor.stop();
    app.mixer.destroy();
  } finally {
    app.busy = false;
    syncDockButtons();
  }
}

async function togglePauseResume() {
  if (app.state === 'recording') {
    app.recorder.pause();
    setState('paused');
    els.timer.classList.remove('is-live');
    toast('info', 'Recording paused');
  } else if (app.state === 'paused') {
    app.recorder.resume();
    setState('recording');
    els.timer.classList.add('is-live');
    toast('info', 'Recording resumed');
  }
}

async function stopRecording() {
  if (!(app.state === 'recording' || app.state === 'paused')) {
    // Not in a recording state; nothing to finalize.
    return;
  }
  app.busy = true;
  setState('processing');
  els.timer.classList.remove('is-live');
  try {
    const blob = await app.recorder.stop();
    // stop() already invokes onStopped -> finalizeRecording via onStopped.
    // We also call it explicitly here if onStopped path missed the blob.
    if (blob && !app.latestBlob) finalizeRecording(blob);
  } finally {
    app.busy = false;
    syncDockButtons();
  }
}

function finalizeRecording(blob) {
  if (!blob || blob.size === 0) {
    toast('warning', 'Recording empty', 'No data was captured. The session may have ended too quickly.');
    setState('idle');
    syncDockButtons();
    return;
  }
  app.latestBlob = blob;
  app.latestMime = app.recorder.mimeType || detectMimeType();
  app.latestDuration = app.recorder.getElapsed();
  els.timer.classList.remove('is-live');

  // Stop compositor and mixer; clean up.
  app.compositor.stop();
  app.mixer.destroy();
  if (app.meterUnbind) { app.meterUnbind(0); app.meterUnbind = null; }
  showCanvasPreview(false);

  openReviewModal(blob, app.latestMime, app.latestDuration, app.latestTitle);
  setState('review');
  toast('success', 'Recording completed', `Saved as ${mimeLabel(app.latestMime)}.`);
  syncDockButtons();
}

function defaultTitle() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `Recording ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}`;
}

function showCanvasPreview(show) {
  els.previewVideo.style.display = show ? 'none' : '';
  els.compositorCanvas.style.display = show ? '' : 'none';
  if (show) {
    els.compositorCanvas.width = els.compositorCanvas.width || 1920;
    els.compositorCanvas.height = els.compositorCanvas.height || 1080;
  }
}

/* ------------------------------------------------------------------ */
/*  Review modal                                                       */
/* ------------------------------------------------------------------ */
let reviewUrl = null;

function openReviewModal(blob, mime, durationMs, title) {
  // Revoke any prior review URL.
  closeReviewUrl();
  reviewUrl = URL.createObjectURL(blob);
  els.reviewVideo.src = reviewUrl;
  els.reviewVideo.load();
  els.reviewDuration.textContent = formatTime(durationMs || 0);
  els.reviewSize.textContent = formatBytes(blob.size);
  els.reviewFormat.textContent = mimeLabel(mime);
  els.reviewModal.hidden = false;
  focusModal(els.reviewModal);
}

function closeReviewUrl() {
  if (reviewUrl) { URL.revokeObjectURL(reviewUrl); reviewUrl = null; }
  els.reviewVideo.pause();
  els.reviewVideo.removeAttribute('src');
  els.reviewVideo.load();
}

function closeReviewModal() {
  els.reviewModal.hidden = true;
  closeReviewUrl();
  if (app.state === 'review') setState('idle');
  syncDockButtons();
}

/* ------------------------------------------------------------------ */
/*  Snapshot                                                           */
/* ------------------------------------------------------------------ */
function takeSnapshot() {
  const video = els.reviewVideo;
  if (!video || !video.videoWidth) {
    toast('warning', 'No video frame', 'Play the video a moment, then try the snapshot again.');
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const ext = 'png';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  canvas.toBlob((blob) => {
    if (!blob) {
      toast('error', 'Snapshot failed', 'Could not encode the frame.');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `snapshot-${stamp}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('success', 'Snapshot saved', `Downloaded as PNG (${canvas.width}×${canvas.height}).`);
  }, 'image/png');
}

/* ------------------------------------------------------------------ */
/*  Download latest                                                    */
/* ------------------------------------------------------------------ */
function downloadLatest() {
  if (!app.latestBlob) return;
  const ext = mimeToExt(app.latestMime);
  const url = URL.createObjectURL(app.latestBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${app.latestTitle || 'recording'}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('success', 'Download started', `${app.latestTitle}.${ext}`);
}

/* ------------------------------------------------------------------ */
/*  Save to library                                                    */
/* ------------------------------------------------------------------ */
async function saveToLibrary() {
  if (!app.latestBlob) {
    toast('warning', 'Nothing to save', 'Record something first.');
    return;
  }
  try {
    const thumb = await captureThumbFromBlob(app.latestBlob, app.latestMime);
    const record = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: app.latestTitle || 'Recording',
      createdAt: Date.now(),
      duration: app.latestDuration,
      blob: app.latestBlob,
      mime: app.latestMime,
      size: app.latestBlob.size,
      dimensions: readVideoDims(app.latestBlob, app.latestMime),
      thumbnail: thumb,
    };
    await store.putRecording(record);
    toast('success', 'Saved to library', record.title);
    closeReviewModal();
    refreshLibrary();
  } catch (err) {
    console.error('[srs] save failed', err);
    toast('error', 'Could not save', err.message || String(err));
  }
}

function readVideoDims(blob, mime) {
  // Best-effort: decode via a temporary <video>. We return a Promise of null now,
  // but for library display we can skip it to avoid a second decode pass.
  return null;
}

async function captureThumbFromBlob(blob, mime) {
  let url = null;
  let v = null;
  try {
    url = URL.createObjectURL(blob);
    v = document.createElement('video');
    v.muted = true;
    await new Promise((res, rej) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        res();
      };
      const timeout = setTimeout(finish, 4000);
      v.onloadeddata = () => {
        const seekTo = Math.min(1, (v.duration || 0) / 2);
        if (!seekTo) {
          finish();
          return;
        }
        v.onseeked = finish;
        try {
          v.currentTime = seekTo;
        } catch (err) {
          finish();
        }
      };
      v.onerror = () => rej(new Error('thumb decode failed'));
      v.src = url;
      v.load();
    });
    const c = document.createElement('canvas');
    const w = v.videoWidth || 320;
    const h = v.videoHeight || 180;
    c.width = 320;
    c.height = Math.round(320 * h / w);
    const ctx = c.getContext('2d');
    ctx.drawImage(v, 0, 0, c.width, c.height);
    const png = await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('encode failed')), 'image/png'));
    return png;
  } catch (e) {
    return null;
  } finally {
    if (url) URL.revokeObjectURL(url);
    if (v) {
      v.srcObject = null;
      v.removeAttribute('src');
      v.load();
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Library                                                            */
/* ------------------------------------------------------------------ */
let confirmCallback = null;

function refreshLibrary() {
  store.getAllRecordings().then(rows => {
    els.libraryCount.textContent = String(rows.length);
    els.libraryList.textContent = '';
    els.libraryEmpty.hidden = rows.length > 0;

    rows.forEach(rec => {
      const item = document.createElement('div');
      item.className = 'library-item';
      item.setAttribute('role', 'listitem');

      // Thumbnail
      const thumb = document.createElement('div');
      thumb.className = 'library-thumb';
      if (rec.thumbnail) {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(rec.thumbnail);
        img.alt = '';
        thumb.appendChild(img);
      } else {
        const ph = document.createElement('div');
        ph.className = 'no-thumb';
        ph.textContent = '▦';
        thumb.appendChild(ph);
      }
      item.appendChild(thumb);

      // Main
      const main = document.createElement('div');
      main.className = 'library-item-main';

      const titleEl = document.createElement('div');
      titleEl.className = 'library-item-title';
      titleEl.textContent = rec.title; // safe textContent
      main.appendChild(titleEl);

      const sub = document.createElement('div');
      sub.className = 'library-item-sub';
      const d = new Date(rec.createdAt);
      const fmt = d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
      sub.append(
        textSpan(fmt),
        textSpan(formatTime(rec.duration || 0)),
        textSpan(formatBytes(rec.size)),
      );
      main.appendChild(sub);

      // Actions
      const actions = document.createElement('div');
      actions.className = 'library-item-actions';

      const btnPreview = libBtn('Preview', () => openPreviewModal(rec));
      const btnDownload = libBtn('Download', () => downloadFromRecord(rec));
      const btnRename = libBtn('Rename', () => promptRename(rec, main));
      const btnDelete = libBtn('Delete', () => confirmDelete(rec), 'lib-danger');

      actions.append(btnPreview, btnDownload, btnRename, btnDelete);
      main.appendChild(actions);

      item.appendChild(main);
      els.libraryList.appendChild(item);
    });
  }).catch(err => {
    console.error('[srs] library load failed', err);
    toast('error', 'Library error', err.message || String(err));
  });
}

function textSpan(t) { const s = document.createElement('span'); s.textContent = t; return s; }
function libBtn(label, fn, extraClass = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `lib-btn ${extraClass}`;
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}

function openLibrary() {
  refreshLibrary();
  els.libraryDrawer.hidden = false;
  focusModal(els.libraryDrawer);
}

function closeLibrary() {
  els.libraryDrawer.hidden = true;
}

function openPreviewModal(rec) {
  const url = URL.createObjectURL(rec.blob);
  els.previewVideoEl.src = url;
  els.previewMetaTitle.textContent = rec.title;
  els.previewMetaSize.textContent = formatBytes(rec.size);
  els.previewMetaFormat.textContent = mimeLabel(rec.mime);
  els.previewMetaData.textContent = new Date(rec.createdAt).toLocaleString();
  els.previewModal.hidden = false;
  els.previewModal.dataset.blobUrl = url;
  els.previewModal.dataset.recId = rec.id;
  focusModal(els.previewModal);
}

function closePreviewModal() {
  if (els.previewModal.dataset.blobUrl) URL.revokeObjectURL(els.previewModal.dataset.blobUrl);
  delete els.previewModal.dataset.blobUrl;
  els.previewVideoEl.pause();
  els.previewVideoEl.removeAttribute('src');
  els.previewVideoEl.load();
  els.previewModal.hidden = true;
}

function downloadFromRecord(rec) {
  const ext = mimeToExt(rec.mime);
  const url = URL.createObjectURL(rec.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${rec.title.replace(/[^\w\- ]/g, '_')}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('success', 'Download started', rec.title);
}

function promptRename(rec, parentEl) {
  const titleEl = parentEl.querySelector('.library-item-title');
  const input = document.createElement('input');
  input.className = 'rename-input';
  input.value = rec.title;
  input.maxLength = 120;
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = async () => {
    const next = input.value.trim();
    if (next && next !== rec.title) {
      try {
        await store.renameRecording(rec.id, next);
        toast('success', 'Renamed', next);
        refreshLibrary();
        return;
      } catch (e) {
        toast('error', 'Rename failed', e.message || String(e));
      }
    }
    refreshLibrary();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') refreshLibrary();
  });
  input.addEventListener('blur', commit, { once: true });
}

function confirmDelete(rec) {
  els.confirmText.textContent = `Delete “${rec.title}”? This cannot be undone.`;
  confirmCallback = () => {
    store.deleteRecording(rec.id).then(() => {
      toast('success', 'Deleted', rec.title);
      refreshLibrary();
    }).catch(err => toast('error', 'Delete failed', err.message || String(err)));
  };
  els.confirmModal.hidden = false;
  focusModal(els.confirmModal);
}

/* ------------------------------------------------------------------ */
/*  Settings modal                                                     */
/* ------------------------------------------------------------------ */
function openSettings() {
  const setPressed = (sel, val) => {
    els.settingsModal.querySelectorAll(sel).forEach(el => {
      el.setAttribute('aria-pressed', String(el.dataset.res === String(val) || el.dataset.fps === String(val) || el.dataset.bitrate === String(val)));
    });
  };
  setPressed('[data-res]', settings.resolution);
  setPressed('[data-fps]', settings.fps);
  setPressed('[data-bitrate]', settings.bitrate);

  $('#chk-echo-cancel').checked = settings.echoCancel;
  $('#chk-noise-suppress').checked = settings.noiseSuppress;
  $('#mic-volume').value = settings.micVolume;
  $('#sys-volume').value = settings.sysVolume;
  $('#mic-volume-value').textContent = settings.micVolume + '%';
  $('#sys-volume-value').textContent = settings.sysVolume + '%';
  $('#chk-mirror').checked = settings.mirror;
  $('#chk-studio-compose').checked = settings.studioCompose;

  els.settingsModal.hidden = false;
  focusModal(els.settingsModal);
}

function saveSettingsFromModal() {
  const pressed = (selector, key) => {
    const el = els.settingsModal.querySelector(`${selector}[aria-pressed="true"]`);
    return el ? Number(el.dataset[key]) : null;
  };
  settings.resolution = pressed('[data-res]', 'res') || settings.resolution;
  settings.fps = pressed('[data-fps]', 'fps') || settings.fps;
  settings.bitrate = pressed('[data-bitrate]', 'bitrate') || settings.bitrate;
  settings.echoCancel = $('#chk-echo-cancel').checked;
  settings.noiseSuppress = $('#chk-noise-suppress').checked;
  settings.micVolume = Number($('#mic-volume').value);
  settings.sysVolume = Number($('#sys-volume').value);
  settings.mirror = $('#chk-mirror').checked;
  settings.studioCompose = $('#chk-studio-compose').checked;

  // Apply mirror immediately if webcam is active.
  if (app.camStream) els.webcamVideo.classList.toggle('mirror', settings.mirror);

  store.savePrefs(settings);
  updateResFpsIndicator();
  const sysNote = $('#sys-audio-note');
  if (sysNote) sysNote.hidden = !app.sysStream;

  toast('success', 'Settings saved', `${RES_MAP[settings.resolution][0]}×${RES_MAP[settings.resolution][1]} · ${settings.fps} fps · ${Math.round(settings.bitrate / 1e6)} Mbps`);
  els.settingsModal.hidden = true;
}

/* ------------------------------------------------------------------ */
/*  Modal helpers                                                      */
/* ------------------------------------------------------------------ */
const lastFocused = new WeakMap();

function focusModal(modal) {
  lastFocused.set(modal, document.activeElement);
  const focusable = modal.querySelector('button, [href], input, select, textarea');
  if (focusable) focusable.focus();
}

function restoreFocus(modal) {
  const prev = lastFocused.get(modal);
  if (prev && document.contains(prev)) prev.focus();
}

function closeAllModals() {
  els.reviewModal.hidden = true;
  closeReviewUrl();
  els.settingsModal.hidden = true;
  els.helpModal.hidden = true;
  els.previewModal.hidden = true;
  closePreviewModal();
  els.confirmModal.hidden = true;
  els.libraryDrawer.hidden = true;
}

/* ------------------------------------------------------------------ */
/*  Feature detection messages                                         */
/* ------------------------------------------------------------------ */
function featureCompatNotes() {
  const notes = [];
  if (!('MediaRecorder' in window)) notes.push('MediaRecorder is not available — recording will not work.');
  else if (!detectMimeType()) notes.push('No supported recording format detected in this browser.');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    notes.push('Screen capture (getDisplayMedia) is not available — use HTTPS or localhost with a recent Chrome/Edge.');
  }
  return notes;
}

function renderFeatureNotes() {
  const notes = featureCompatNotes();
  els.emptyFeatureNote.hidden = notes.length === 0;
  els.emptyFeatureNote.textContent = notes.join(' ');
}

/* ------------------------------------------------------------------ */
/*  Events / wiring                                                    */
/* ------------------------------------------------------------------ */
function wire() {
  // Header
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-library').addEventListener('click', openLibrary);
  $('#btn-help').addEventListener('click', () => {
    els.helpModal.hidden = false;
    focusModal(els.helpModal);
  });

  // Dock
  els.btnSelect.addEventListener('click', selectScreen);
  els.btnStart.addEventListener('click', () => {
    if (app.state === 'recording' || app.state === 'paused') stopRecording();
    else startRecording();
  });
  els.btnPause.addEventListener('click', togglePauseResume);
  els.btnStop.addEventListener('click', stopRecording);
  els.btnMic.addEventListener('click', toggleMic);
  els.btnWebcam.addEventListener('click', toggleCam);
  els.btnDownload.addEventListener('click', downloadLatest);

  // Webcam overlay controls
  $('#btn-webcam-shape').addEventListener('click', () => {
    const cur = els.webcamOverlay.dataset.shape === 'circle' ? 'rect' : 'circle';
    els.webcamOverlay.dataset.shape = cur;
  });
  $('#btn-webcam-close').addEventListener('click', () => {
    releaseCam();
    toast('info', 'Webcam closed', 'Overlay removed. The camera track has been stopped.');
    syncDockButtons();
  });
  wireWebcamDrag();

  // Review modal
  els.btnReviewDownload.addEventListener('click', downloadLatest);
  els.btnReviewClose.addEventListener('click', closeReviewModal);
  els.btnSaveLibrary.addEventListener('click', saveToLibrary);
  els.btnSnapshot.addEventListener('click', takeSnapshot);

  // Settings chips
  els.settingsModal.querySelectorAll('[data-res],[data-fps],[data-bitrate]').forEach(chip => {
    chip.addEventListener('click', () => {
      const group = chip.dataset.res ? '[data-res]' : chip.dataset.fps ? '[data-fps]' : '[data-bitrate]';
      els.settingsModal.querySelectorAll(group).forEach(c => c.setAttribute('aria-pressed', 'false'));
      chip.setAttribute('aria-pressed', 'true');
    });
  });
  $('#mic-volume').addEventListener('input', (e) => $('#mic-volume-value').textContent = e.target.value + '%');
  $('#sys-volume').addEventListener('input', (e) => $('#sys-volume-value').textContent = e.target.value + '%');
  $('#btn-settings-save').addEventListener('click', saveSettingsFromModal);

  // Modal close buttons (generic [data-close])
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.close);
      if (!target) return;
      target.hidden = true;
      if (target === els.reviewModal) closeReviewModal();
      if (target === els.previewModal) closePreviewModal();
      if (target === els.libraryDrawer) closeLibrary();
      restoreFocus(target);
    });
  });

  // Backdrop click closes top-most dialog
  [els.reviewModal, els.settingsModal, els.helpModal, els.previewModal, els.confirmModal].forEach(m => {
    m.addEventListener('mousedown', (e) => {
      if (e.target === m) {
        m.hidden = true;
        if (m === els.reviewModal) closeReviewModal();
        if (m === els.previewModal) closePreviewModal();
        restoreFocus(m);
      }
    });
  });

  // Confirm modal
  els.btnConfirmOk.addEventListener('click', () => {
    els.confirmModal.hidden = true;
    const cb = confirmCallback;
    confirmCallback = null;
    cb && cb();
  });
  els.btnConfirmCancel.addEventListener('click', () => {
    els.confirmModal.hidden = true;
    confirmCallback = null;
  });

  // Preview modal download
  els.btnPreviewDownload.addEventListener('click', () => {
    const recId = els.previewModal.dataset.recId;
    if (!recId) return;
    store.getRecording(recId).then(rec => rec && downloadFromRecord(rec));
  });
  els.btnPreviewClose.addEventListener('click', () => {
    els.previewModal.hidden = true;
    closePreviewModal();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', handleKeys);

  // Clean up on page unload.
  window.addEventListener('beforeunload', cleanupAll);

  // Live settings hint: reflect sys audio availability
  const sysNote = $('#sys-audio-note');
  if (sysNote) sysNote.hidden = !!app.sysStream;
}

function handleKeys(e) {
  // Ignore when typing in inputs or editing.
  const t = e.target;
  const inInput = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

  if (e.key === 'Escape') {
    if (!els.confirmModal.hidden) { els.confirmModal.hidden = true; confirmCallback = null; return; }
    if (!els.helpModal.hidden) { els.helpModal.hidden = true; return; }
    if (!els.previewModal.hidden) { els.previewModal.hidden = true; closePreviewModal(); return; }
    if (!els.settingsModal.hidden) { els.settingsModal.hidden = true; return; }
    if (!els.reviewModal.hidden) { closeReviewModal(); return; }
    if (!els.libraryDrawer.hidden) { closeLibrary(); return; }
    return;
  }

  if (!e.altKey || inInput) return;
  const k = e.key.toLowerCase();
  if (k === 'r') { e.preventDefault(); (app.state === 'recording' || app.state === 'paused') ? stopRecording() : startRecording(); }
  else if (k === 'p') { e.preventDefault(); togglePauseResume(); }
  else if (k === 'm') { e.preventDefault(); toggleMic(); }
  else if (k === 'w') { e.preventDefault(); toggleCam(); }
}

function cleanupAll() {
  releaseScreen();
  releaseMic();
  releaseCam();
  app.compositor.stop();
  app.mixer.destroy();
  app.recorder.destroy();
}

/* ------------------------------------------------------------------ */
/*  Webcam drag                                                         */
/* ------------------------------------------------------------------ */
function wireWebcamDrag() {
  const overlay = els.webcamOverlay;
  let dragging = false, offX = 0, offY = 0;

  const onDown = (e) => {
    if (e.target.closest('.webcam-mini-btn')) return;
    dragging = true;
    overlay.classList.add('is-dragging');
    const r = overlay.getBoundingClientRect();
    const sr = overlay.parentElement.getBoundingClientRect();
    offX = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    offY = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
    overlay.dataset.parentW = sr.width;
    overlay.dataset.parentH = sr.height;
    e.preventDefault();
  };
  const onMove = (e) => {
    if (!dragging) return;
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    const parentW = Number(overlay.dataset.parentW);
    const parentH = Number(overlay.dataset.parentH);
    const x = cx - offX;
    const y = cy - offY;
    overlay.style.right = 'auto';
    overlay.style.bottom = 'auto';
    overlay.style.left = Math.max(0, Math.min(parentW - overlay.offsetWidth, x)) + 'px';
    overlay.style.top = Math.max(0, Math.min(parentH - overlay.offsetHeight, y)) + 'px';
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    overlay.classList.remove('is-dragging');
  };

  overlay.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  overlay.addEventListener('touchstart', onDown, { passive: false });
  window.addEventListener('touchmove', onMove, { passive: true });
  window.addEventListener('touchend', onUp);
}

function showToastAndState(type, title, msg) {
  toast(type, title, msg);
}

/* ------------------------------------------------------------------ */
/*  Init                                                               */
/* ------------------------------------------------------------------ */
function init() {
  wire();
  renderFeatureNotes();
  updateFormatIndicator();
  updateResFpsIndicator();
  updateMicWebcamCards();
  setState('idle');

  // If a saved camera/mic setting exists, keep indicators in sync.
  console.info('[srs] initialized', settings);
}

init();
