/**
 * <self-tape-recorder> — lets actors record audition self-tapes in the browser.
 *
 * Camera + mic preview, sides shown over the preview (auto-scrolling while
 * recording), countdown, scene and slate takes, review, download and upload.
 * Give it a script (the script property) and it reads the other characters'
 * lines aloud, waiting for the actor's lines in between.
 * No dependencies and no build step:
 *
 *   <script type="module" src="self-tape-recorder.js"></script>
 *   <self-tape-recorder actor-name="Jane Doe" character="Ophelia" project="Hamlet"
 *                       upload-url="/upload"></self-tape-recorder>
 *
 * Attributes, properties, methods and events are documented in README.md.
 */
import { createCueDetector, estimateSeconds, loadVoices, speak, unlockSpeech } from './scene-reader.js';

const QUALITY = {
  '1080p': { width: 1920, height: 1080, videoBitsPerSecond: 6_000_000 },
  '720p': { width: 1280, height: 720, videoBitsPerSecond: 4_000_000 },
};
const AUDIO_BITS_PER_SECOND = 160_000;

// Most compatible first: H.264/AAC MP4 plays everywhere and casting sites
// accept it. Browsers that can't write MP4 (e.g. Firefox) fall back to WebM.
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=avc1,opus',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];
const EXTENSIONS = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/x-matroska': 'mkv', 'video/quicktime': 'mov' };

const ICONS = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13l10.5-6.5z"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14"/></svg>',
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V5m0 0L7.5 9.5M12 5l4.5 4.5M5 20h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
};

const STYLE = `
:host {
  --str-accent: #e5484d;
  --str-primary: #3e63dd;
  --str-success: #2f9e6b;
  --str-bg: #ffffff;
  --str-surface: #f4f4f6;
  --str-border: #e3e3e8;
  --str-text: #1a1a1f;
  --str-muted: #676773;
  --str-radius: 14px;
  --str-font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  display: block;
  container-type: inline-size;
  color: var(--str-text);
  font: 14px/1.4 var(--str-font);
}
:host([hidden]) { display: none; }
:host([theme="dark"]) {
  --str-bg: #17171a; --str-surface: #222226; --str-border: #34343b; --str-text: #ececf0; --str-muted: #a3a3ad;
}
@media (prefers-color-scheme: dark) {
  :host([theme="auto"]) {
    --str-bg: #17171a; --str-surface: #222226; --str-border: #34343b; --str-text: #ececf0; --str-muted: #a3a3ad;
  }
}
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
button, select, input, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
button:disabled { cursor: not-allowed; opacity: .5; }
:focus-visible { outline: 2px solid var(--str-primary); outline-offset: 2px; }

.str {
  display: grid; grid-template-columns: minmax(0, 1fr) 272px; gap: 16px; padding: 16px;
  background: var(--str-bg); border: 1px solid var(--str-border); border-radius: var(--str-radius);
}
.main { display: flex; flex-direction: column; gap: 12px; min-width: 0; }

.stage { position: relative; aspect-ratio: 16 / 9; overflow: hidden; background: #000; border-radius: calc(var(--str-radius) - 4px); }
.stage video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #000; }
.preview.mirrored { transform: scaleX(-1); }
.guides span { position: absolute; background: rgba(255, 255, 255, .4); }
.guides .v1, .guides .v2 { top: 0; bottom: 0; width: 1px; }
.guides .h1, .guides .h2 { left: 0; right: 0; height: 1px; }
.guides .v1 { left: 33.333%; }
.guides .v2 { left: 66.667%; }
.guides .h1 { top: 33.333%; }
.guides .h2 { top: 66.667%; }
.prompter {
  position: absolute; top: 0; left: 0; right: 0; max-height: 34%; overflow-y: auto; padding: 10px 8%;
  background: rgba(0, 0, 0, .5); color: #fff; font-size: var(--str-prompter-size, 26px); line-height: 1.45;
  text-shadow: 0 1px 3px rgba(0, 0, 0, .9);
  text-align: center; white-space: pre-wrap; overflow-wrap: anywhere; scrollbar-width: none;
}
.prompter::-webkit-scrollbar { display: none; }
.countdown {
  position: absolute; inset: 0; display: grid; place-items: center; background: rgba(0, 0, 0, .35); color: #fff;
  font-size: 96px; font-size: clamp(56px, 16cqw, 160px); font-weight: 700; font-variant-numeric: tabular-nums;
  text-shadow: 0 2px 16px rgba(0, 0, 0, .5);
}
.countdown span { animation: pop .9s ease-out both; }
@keyframes pop { from { transform: scale(1.4); opacity: 0; } 30% { opacity: 1; } to { transform: scale(1); opacity: .9; } }
.rec-badge {
  position: absolute; left: 12px; bottom: 12px; display: flex; align-items: center; gap: 8px; padding: 6px 10px;
  border-radius: 999px; background: rgba(0, 0, 0, .62); color: #fff; font-size: 13px; font-weight: 600;
  letter-spacing: .04em; font-variant-numeric: tabular-nums;
}
.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--str-accent); animation: blink 1.2s steps(2, start) infinite; }
@keyframes blink { to { visibility: hidden; } }
.rotate-hint {
  position: absolute; left: 50%; bottom: 12px; max-width: 90%; padding: 6px 12px; transform: translateX(-50%);
  border-radius: 999px; background: rgba(0, 0, 0, .7); color: #fff; font-size: 13px; text-align: center;
}
.start-screen {
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; padding: 20px; text-align: center; color: #f2f2f4;
  background: radial-gradient(ellipse at center, #2a2a30 0%, #0c0c0e 100%);
}
.start-title { margin: 0; font-size: 20px; font-weight: 600; }
.tips { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; color: #b9b9c3; font-size: 13px; }
.start-error { max-width: 460px; margin: 0; color: #ffb4b4; font-size: 14px; }
.back { position: absolute; top: 12px; right: 12px; }

.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 12px; }
.toggles { display: flex; gap: 8px; margin-left: auto; }
.segmented { display: inline-flex; padding: 3px; border: 1px solid var(--str-border); border-radius: 999px; background: var(--str-surface); }
.segmented button { padding: 6px 14px; border: 0; border-radius: 999px; background: none; color: var(--str-muted); font-weight: 500; }
.segmented button[aria-pressed="true"] { background: var(--str-bg); color: var(--str-text); box-shadow: 0 1px 2px rgba(0, 0, 0, .15); }
.record {
  display: inline-flex; align-items: center; gap: 10px; height: 46px; padding: 0 22px 0 16px; border: 0;
  border-radius: 999px; background: var(--str-accent); color: #fff; font-size: 16px; font-weight: 600;
}
.record-icon { width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: border-radius .15s; }
.record.is-recording .record-icon { border-radius: 3px; }
.timer { color: var(--str-muted); font-weight: 600; font-variant-numeric: tabular-nums; }
.meter { width: 64px; height: 6px; overflow: hidden; border: 1px solid var(--str-border); border-radius: 3px; background: var(--str-surface); }
.meter-fill { display: block; width: 100%; height: 100%; background: var(--str-success); transform: scaleX(0); transform-origin: left; }
.meter-fill.hot { background: #f0a020; }
.btn {
  display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px; border: 1px solid var(--str-border);
  border-radius: 10px; background: var(--str-bg); color: var(--str-text); font-weight: 500;
}
.btn:hover:not(:disabled) { background: var(--str-surface); }
.btn[aria-expanded="true"] { border-color: var(--str-muted); background: var(--str-surface); }
.btn.primary { height: 44px; padding: 0 20px; border-color: transparent; background: var(--str-primary); color: #fff; font-size: 15px; }
.btn.primary:hover:not(:disabled) { background: var(--str-primary); filter: brightness(1.08); }
.stage .btn:not(.primary) { border-color: rgba(255, 255, 255, .25); background: rgba(0, 0, 0, .6); color: #fff; }

.notice { margin: 0; padding: 8px 12px; border: 1px solid var(--str-border); border-radius: 10px; background: var(--str-surface); }
.notice.error { border-color: var(--str-accent); color: var(--str-accent); }

.panel {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px 16px; padding: 14px;
  border: 1px solid var(--str-border); border-radius: 12px; background: var(--str-surface);
}
.panel label { display: flex; flex-direction: column; gap: 6px; color: var(--str-muted); font-size: 13px; }
.panel label.check { flex-direction: row; align-items: center; gap: 8px; color: var(--str-text); font-size: 14px; }
.panel label.wide, .format-info { grid-column: 1 / -1; }
select, textarea { border: 1px solid var(--str-border); border-radius: 8px; background: var(--str-bg); color: var(--str-text); }
select { height: 36px; padding: 0 8px; font-size: 14px; }
textarea { min-height: 140px; padding: 10px 12px; font-size: 15px; line-height: 1.5; resize: vertical; }
input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--str-primary); }
input[type="range"] { accent-color: var(--str-primary); }
.format-info { margin: 0; color: var(--str-muted); font-size: 12px; }

.takes { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.takes-title { margin: 0; font-size: 15px; font-weight: 600; }
.takes-title span { color: var(--str-muted); font-weight: 500; }
.takes-empty { margin: 0; padding: 18px 14px; border: 1px dashed var(--str-border); border-radius: 12px; color: var(--str-muted); text-align: center; }
.takes-list { display: flex; flex-direction: column; gap: 10px; max-height: 560px; margin: 0; padding: 0; overflow-y: auto; list-style: none; }
.take {
  display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 8px 10px; padding: 8px;
  border: 1px solid var(--str-border); border-radius: 12px; background: var(--str-bg);
}
.take.active { border-color: var(--str-primary); box-shadow: 0 0 0 1px var(--str-primary); }
.thumb { position: relative; width: 96px; aspect-ratio: 16 / 9; padding: 0; overflow: hidden; border: 0; border-radius: 8px; background: #000; }
.thumb img { display: block; width: 100%; height: 100%; object-fit: cover; }
.thumb .play-icon {
  position: absolute; top: 50%; left: 50%; display: grid; place-items: center; width: 28px; height: 28px;
  transform: translate(-50%, -50%); border-radius: 50%; background: rgba(0, 0, 0, .6); color: #fff;
}
.thumb .play-icon svg { width: 14px; height: 14px; margin-left: 2px; }
.thumb:hover .play-icon { background: var(--str-primary); }
.thumb .dur {
  position: absolute; right: 4px; bottom: 4px; padding: 1px 5px; border-radius: 4px; background: rgba(0, 0, 0, .72);
  color: #fff; font-size: 11px; font-variant-numeric: tabular-nums;
}
.take-title { font-weight: 600; }
.take-sub { color: var(--str-muted); font-size: 12px; }
.take-status { font-size: 12px; }
.take-status.ok { color: var(--str-success); }
.take-status.err { color: var(--str-accent); }
.take-actions { display: flex; flex-wrap: wrap; gap: 6px; grid-column: 1 / -1; }
.icon-btn {
  display: inline-flex; align-items: center; gap: 4px; height: 30px; padding: 0 9px; border: 1px solid var(--str-border);
  border-radius: 8px; background: var(--str-bg); color: var(--str-text); font-size: 12px; font-weight: 500; text-decoration: none;
}
.icon-btn svg { flex: none; width: 14px; height: 14px; }
.icon-btn:hover:not(:disabled) { background: var(--str-surface); }
.icon-btn.submit { border-color: transparent; background: var(--str-primary); color: #fff; }
.icon-btn.submit:hover:not(:disabled) { background: var(--str-primary); filter: brightness(1.08); }
.icon-btn.danger { margin-left: auto; }
.icon-btn.danger.confirm { border-color: transparent; background: var(--str-accent); color: #fff; }
.confirm-label { display: none; }
.confirm .confirm-label { display: inline; }
.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

/* A scene needs more room than plain sides; size the text to the screen. */
.prompter.script { max-height: 50%; font-size: var(--str-prompter-size, clamp(15px, 2.6cqw, 26px)); text-align: left; }
.prompter .sl { margin: 0 0 .4em; padding: 2px 8px; border-radius: 6px; }
.prompter .sl.heading { font-size: .62em; font-weight: 700; letter-spacing: .06em; opacity: .7; }
.prompter .sl.action, .prompter .sl.transition { font-size: .7em; font-style: italic; opacity: .65; }
.prompter .who { display: block; font-size: .58em; font-weight: 700; letter-spacing: .08em; opacity: .75; }
.prompter .sl.other { opacity: .8; }
.prompter .sl.mine { color: #ffe08a; }
.prompter .sl.done { opacity: .35; }
.prompter .sl.current { opacity: 1; background: rgba(255, 255, 255, .16); }
.next-cue { position: absolute; right: 12px; bottom: 12px; }
.script-summary { margin: 0; color: var(--str-text); font-size: 14px; }

@container (max-width: 760px) {
  .str { grid-template-columns: minmax(0, 1fr); padding: 12px; }
  .takes-list { max-height: none; }
}
@container (max-width: 520px) {
  .tips { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .dot, .countdown span { animation: none; }
}
`;

const MARKUP = `
<div class="str" part="container">
  <div class="main">
    <div class="stage" part="stage" data-el="stage" tabindex="0" role="group" aria-label="Camera preview. Press Space to start or stop recording.">
      <video class="preview" data-el="preview" playsinline muted autoplay></video>
      <video class="playback" data-el="playback" playsinline controls hidden></video>
      <div class="guides" data-el="guides" aria-hidden="true" hidden><span class="v1"></span><span class="v2"></span><span class="h1"></span><span class="h2"></span></div>
      <div class="prompter" data-el="prompter" hidden><div data-el="prompterText"></div></div>
      <div class="countdown" data-el="countdown" aria-hidden="true" hidden></div>
      <div class="rec-badge" data-el="recBadge" hidden><span class="dot"></span>REC <span data-el="recTime">0:00</span></div>
      <div class="rotate-hint" data-el="rotateHint" hidden>Turn your device sideways: casting expects landscape video.</div>
      <div class="start-screen" data-el="startScreen">
        <p class="start-title">Record your self-tape</p>
        <ul class="tips">
          <li>Camera at eye level, landscape</li>
          <li>Frame yourself from mid-chest up</li>
          <li>Face a window or soft light</li>
          <li>Quiet room, plain background</li>
        </ul>
        <button type="button" class="btn primary" data-el="startButton">Turn on camera &amp; mic</button>
        <p class="start-error" data-el="startError" role="alert" hidden></p>
      </div>
      <button type="button" class="btn back" data-el="backButton" hidden>&larr; Back to camera</button>
      <button type="button" class="btn next-cue" data-el="nextCue" hidden>Next line &rsaquo;</button>
    </div>
    <div class="toolbar" part="toolbar">
      <div class="segmented" role="group" aria-label="Recording type">
        <button type="button" data-el="kindScene" data-kind="scene" aria-pressed="true">Scene</button>
        <button type="button" data-el="kindSlate" data-kind="slate" aria-pressed="false">Slate</button>
      </div>
      <button type="button" class="record" data-el="recordButton"><span class="record-icon" aria-hidden="true"></span><span data-el="recordLabel">Record</span></button>
      <span class="timer" data-el="timer">0:00</span>
      <span class="meter" title="Microphone level" aria-hidden="true"><span class="meter-fill" data-el="meterFill"></span></span>
      <div class="toggles">
        <button type="button" class="btn" data-el="sidesToggle" aria-expanded="false">Sides</button>
        <button type="button" class="btn" data-el="settingsToggle" aria-expanded="false">Settings</button>
      </div>
    </div>
    <p class="notice" data-el="notice" role="status" hidden></p>
    <div class="panel" data-el="sidesPanel" hidden>
      <label class="wide" data-el="sidesLabel">Sides or monologue
        <textarea data-el="sidesInput" rows="6" placeholder="Paste your lines here. They show over the preview while you record and never appear in the video."></textarea>
      </label>
      <p class="wide script-summary" data-el="scriptSummary" data-script-only hidden></p>
      <label class="check" data-script-only hidden><input type="checkbox" data-el="readerCheck" checked> Read the other parts aloud</label>
      <label data-script-only hidden>A pause this long ends your line
        <select data-el="pauseSelect">
          <option value="0.7">Short (0.7 seconds)</option>
          <option value="1.2" selected>Normal (1.2 seconds)</option>
          <option value="2">Long (2 seconds)</option>
        </select>
      </label>
      <label class="check" data-script-only hidden><input type="checkbox" data-el="autoStopCheck" checked> Stop recording when the scene ends</label>
      <label class="check"><input type="checkbox" data-el="prompterCheck"> Show on screen</label>
      <label data-el="speedLabel">Scroll speed while recording <input type="range" data-el="speedRange" min="0" max="100" value="30"></label>
      <label>Text size <input type="range" data-el="sizeRange" min="16" max="48" value="26"></label>
    </div>
    <div class="panel" data-el="settingsPanel" hidden>
      <label>Camera <select data-el="cameraSelect"></select></label>
      <label>Microphone <select data-el="micSelect"></select></label>
      <label>Quality
        <select data-el="qualitySelect">
          <option value="1080p">1080p Full HD</option>
          <option value="720p">720p HD (smaller files)</option>
        </select>
      </label>
      <label>Countdown
        <select data-el="countdownSelect">
          <option value="0">Off</option>
          <option value="3" selected>3 seconds</option>
          <option value="5">5 seconds</option>
          <option value="10">10 seconds</option>
        </select>
      </label>
      <label class="check"><input type="checkbox" data-el="mirrorCheck" checked> Mirror preview</label>
      <label class="check"><input type="checkbox" data-el="guidesCheck"> Framing guides</label>
      <label class="check"><input type="checkbox" data-el="noiseCheck"> Noise reduction</label>
      <p class="format-info" data-el="formatInfo"></p>
    </div>
  </div>
  <aside class="takes" part="takes" aria-label="Takes">
    <p class="takes-title">Takes <span data-el="takesCount"></span></p>
    <p class="takes-empty" data-el="takesEmpty">Your takes appear here. Record as many as you like, then download or submit your best.</p>
    <ol class="takes-list" data-el="takesList"></ol>
  </aside>
  <p class="sr-only" data-el="status" aria-live="polite"></p>
</div>
`;

export class SelfTapeRecorder extends HTMLElement {
  static observedAttributes = [
    'actor-name', 'character', 'project', 'sides', 'countdown', 'quality', 'max-duration', 'cue-pause',
    'upload-url', 'submit-label', 'submitting-label', 'submitted-label',
  ];

  /** Optional async (line, { voice, signal }) => void that reads a line with your own voices. */
  readerSpeak = null;

  #els = {};
  #state = 'off'; // off | starting | ready | countdown | recording | saving | error
  #mode = 'live'; // live | review
  #kind = 'scene';
  #session = 0;
  #stream = null;
  #recorder = null;
  #recordStart = 0;
  #recordedSeconds = 0;
  #thumbnail = null;
  #takes = [];
  #counts = { scene: 0, slate: 0 };
  #reviewingId = null;
  #uploadHandler = null;
  #cancelCountdown = null;
  #audioContext = null;
  #micLevel = 0;
  #timers = {};
  #frames = {};
  #script = null;
  #voices = [];
  #reader = null;
  #analyser = null;
  #samples = null;
  #scriptOnly = [];

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${STYLE}</style>${MARKUP}`;
    for (const el of root.querySelectorAll('[data-el]')) this.#els[el.dataset.el] = el;
    this.#scriptOnly = [...root.querySelectorAll('[data-script-only]')];
    this.#bindUi();
  }

  connectedCallback() {
    document.addEventListener('keydown', this.#onKeyDown);
    window.addEventListener('beforeunload', this.#onBeforeUnload);
    navigator.mediaDevices?.addEventListener?.('devicechange', this.#onDeviceChange);
    this.#render();
    this.#renderTakes();
    if (this.hasAttribute('autostart')) this.start();
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this.#onKeyDown);
    window.removeEventListener('beforeunload', this.#onBeforeUnload);
    navigator.mediaDevices?.removeEventListener?.('devicechange', this.#onDeviceChange);
    this.stop();
  }

  attributeChangedCallback(name, _previous, value) {
    const e = this.#els;
    if (name === 'sides') {
      this.sides = value ?? '';
    } else if (name === 'countdown') {
      const seconds = value === null ? '3' : String(Math.min(30, Math.max(0, Math.round(Number(value) || 0))));
      if (![...e.countdownSelect.options].some((option) => option.value === seconds)) {
        e.countdownSelect.add(new Option(`${seconds} ${seconds === '1' ? 'second' : 'seconds'}`, seconds));
      }
      e.countdownSelect.value = seconds;
    } else if (name === 'quality') {
      if (!(value in QUALITY) || e.qualitySelect.value === value) return;
      e.qualitySelect.value = value;
      if (this.#state === 'ready') this.start(); // reopen the camera at the new size
    } else if (name === 'max-duration') {
      this.#render();
    } else if (name === 'cue-pause') {
      const seconds = positiveNumber(value);
      if (!seconds) return;
      if (![...e.pauseSelect.options].some((option) => Number(option.value) === seconds)) {
        e.pauseSelect.add(new Option(`${seconds} seconds`, String(seconds)));
      }
      e.pauseSelect.value = [...e.pauseSelect.options].find((option) => Number(option.value) === seconds).value;
    } else {
      this.#renderTakes(); // actor-name, character and project feed filenames; upload-url shows Submit
    }
  }

  // ---- Public API ----------------------------------------------------------

  /** off | starting | ready | countdown | recording | saving | error */
  get state() { return this.#state; }

  /** All takes, newest first. */
  get takes() { return this.#takes.map((take) => this.#publicTake(take)); }

  /** Current microphone level, 0–1. */
  get micLevel() { return this.#micLevel; }

  get sides() { return this.#els.sidesInput.value; }
  set sides(text) {
    const e = this.#els;
    e.sidesInput.value = text ?? '';
    if (!this.#script) e.prompterText.textContent = e.sidesInput.value;
    if (e.sidesInput.value.trim()) e.prompterCheck.checked = true;
    this.#render();
  }

  /**
   * The scene to perform: { title, character, lines, voices }. lines come from
   * script-parser.js ({ kind, text, character }); character is the actor's part;
   * voices maps other characters to a voiceURI, or 'skip'. Set null to go back
   * to plain sides.
   */
  get script() { return this.#script; }
  set script(value) {
    this.#stopReader();
    if (!Array.isArray(value?.lines)) {
      this.#script = null;
    } else {
      const character = String(value.character ?? '').trim().toUpperCase();
      this.#script = {
        title: value.title ?? '',
        character,
        voices: { ...value.voices },
        lines: value.lines.map((line) => ({
          ...line,
          mine: line.kind === 'dialogue' && String(line.character).toUpperCase() === character,
        })),
      };
      this.#els.prompterCheck.checked = true;
      loadVoices().then((voices) => {
        this.#voices = voices;
      });
    }
    this.#renderScript();
    this.#render();
  }

  /** async (take, { onProgress }) => result. Replaces the built-in upload-url POST. */
  get uploadHandler() { return this.#uploadHandler; }
  set uploadHandler(handler) {
    this.#uploadHandler = typeof handler === 'function' ? handler : null;
    this.#renderTakes();
  }

  /** Turns the camera and mic on (or restarts them with the current settings). */
  async start() {
    if (['starting', 'countdown', 'recording', 'saving'].includes(this.#state)) return;
    const problem = unsupportedReason();
    if (problem) {
      this.#showError(problem);
      return;
    }
    const session = ++this.#session;
    this.#setState('starting');
    try {
      const stream = await this.#openStream();
      if (session !== this.#session) {
        stopTracks(stream);
        return;
      }
      this.#useStream(stream);
      this.#setState('ready');
      const { width, height } = stream.getVideoTracks()[0]?.getSettings() ?? {};
      this.#emit('camera-ready', { width, height, mimeType: pickMimeType(this.getAttribute('mime-type')) });
    } catch (error) {
      if (session !== this.#session) return;
      this.#stopStream();
      this.#showError(describeMediaError(error));
    }
  }

  /** Turns the camera and mic off. A take being recorded is kept. */
  stop() {
    this.#session++;
    this.#cancelCountdown?.();
    this.#stopReader();
    this.stopRecording();
    this.#stopStream();
    this.#setState('off');
  }

  /** Starts a take (after the countdown, if one is set). */
  async record() {
    if (this.#state !== 'ready') return;
    if (this.#mode === 'review') this.#showLive();
    const seconds = Number(this.#els.countdownSelect.value) || 0;
    if (seconds > 0 && !(await this.#countdown(seconds))) return;
    this.#beginRecording();
  }

  /** Stops the current take (or cancels the countdown). */
  stopRecording() {
    if (this.#state === 'countdown') {
      this.#cancelCountdown?.();
      return;
    }
    if (this.#state !== 'recording') return;
    this.#recordedSeconds = (performance.now() - this.#recordStart) / 1000;
    clearInterval(this.#timers.tick);
    clearTimeout(this.#timers.thumbnail);
    this.#thumbnail ??= this.#captureFrame();
    this.#stopPrompterScroll();
    this.#stopReader();
    this.#setState('saving');
    const recorder = this.#recorder;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }

  /** Uploads a take with uploadHandler, or POSTs it to upload-url. */
  async submitTake(id) {
    const take = this.#takes.find((t) => t.id === id);
    const upload = this.#uploader();
    if (!take || !upload || take.status === 'uploading' || take.status === 'submitted') return;
    take.status = 'uploading';
    take.progress = 0;
    take.error = null;
    this.#updateTake(take);
    try {
      const result = await upload(this.#publicTake(take), {
        onProgress: (fraction) => {
          take.progress = Math.min(1, Math.max(0, Number(fraction) || 0));
          this.#updateTake(take);
        },
      });
      take.status = 'submitted';
      this.#updateTake(take);
      this.#announce(`${take.label} submitted.`);
      this.#emit('take-submitted', { take: this.#publicTake(take), result });
    } catch (error) {
      take.status = 'failed';
      take.error = error?.message || 'Upload failed.';
      this.#updateTake(take);
      this.#emit('recorder-error', { code: 'upload-failed', message: take.error, take: this.#publicTake(take) });
    }
  }

  deleteTake(id) {
    const index = this.#takes.findIndex((take) => take.id === id);
    if (index === -1) return;
    const [take] = this.#takes.splice(index, 1);
    if (this.#reviewingId === id) this.#showLive();
    URL.revokeObjectURL(take.url);
    this.#renderTakes();
    this.#announce(`${take.label} deleted.`);
    this.#emit('take-deleted', { id, label: take.label });
  }

  /** Removes every take and restarts numbering at Take 1. */
  clearTakes() {
    if (this.#mode === 'review') this.#showLive();
    for (const take of this.#takes) URL.revokeObjectURL(take.url);
    this.#takes = [];
    this.#counts = { scene: 0, slate: 0 };
    this.#renderTakes();
  }

  // ---- Camera and microphone -----------------------------------------------

  async #openStream() {
    const e = this.#els;
    const preset = QUALITY[e.qualitySelect.value] ?? QUALITY['1080p'];
    const processing = e.noiseCheck.checked;
    const video = { width: { ideal: preset.width }, height: { ideal: preset.height }, frameRate: { ideal: 30 } };
    // Voice processing is off by default: it flattens whispers and shouts.
    const audio = { echoCancellation: processing, noiseSuppression: processing, autoGainControl: processing };
    if (e.cameraSelect.value) video.deviceId = { exact: e.cameraSelect.value };
    if (e.micSelect.value) audio.deviceId = { exact: e.micSelect.value };
    this.#stopStream(); // some cameras can't be opened twice
    try {
      return await navigator.mediaDevices.getUserMedia({ video, audio });
    } catch (error) {
      if (error?.name !== 'OverconstrainedError') throw error;
      // A remembered device was unplugged: fall back to the defaults.
      return navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    }
  }

  #useStream(stream) {
    this.#stream = stream;
    for (const track of stream.getTracks()) track.addEventListener('ended', this.#onTrackEnded);
    const preview = this.#els.preview;
    preview.srcObject = stream;
    preview.play().catch(() => {});
    this.#startMeter(stream);
    this.#refreshDevices();
    this.#updateFormatInfo();
  }

  #stopStream() {
    this.#stopMeter();
    if (!this.#stream) return;
    for (const track of this.#stream.getTracks()) track.removeEventListener('ended', this.#onTrackEnded);
    stopTracks(this.#stream);
    this.#stream = null;
    this.#els.preview.srcObject = null;
  }

  #onTrackEnded = () => {
    this.#session++;
    this.#cancelCountdown?.();
    this.stopRecording(); // keeps whatever was recorded
    this.#stopStream();
    this.#showError({
      code: 'device-lost',
      message: 'Your camera or microphone was disconnected. Reconnect it, then turn the camera back on.',
    });
  };

  #onDeviceChange = () => {
    if (this.#stream) this.#refreshDevices();
  };

  async #refreshDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoId = this.#stream?.getVideoTracks()[0]?.getSettings().deviceId;
      const audioId = this.#stream?.getAudioTracks()[0]?.getSettings().deviceId;
      fillSelect(this.#els.cameraSelect, devices.filter((d) => d.kind === 'videoinput'), videoId, 'Camera');
      fillSelect(this.#els.micSelect, devices.filter((d) => d.kind === 'audioinput'), audioId, 'Microphone');
    } catch {
      // Device lists are a convenience; recording works without them.
    }
  }

  #updateFormatInfo() {
    const { width, height, frameRate } = this.#stream?.getVideoTracks()[0]?.getSettings() ?? {};
    const mimeType = pickMimeType(this.getAttribute('mime-type'));
    const container = mimeType.startsWith('video/mp4') ? 'MP4' : mimeType.startsWith('video/webm') ? 'WebM' : 'the browser default';
    const size = width && height ? `${width}×${height}` : 'unknown size';
    this.#els.formatInfo.textContent =
      `Camera: ${size}${frameRate ? ` at ${Math.round(frameRate)} fps` : ''}. Takes are saved as ${container}.`;
  }

  #startMeter(stream) {
    this.#stopMeter();
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass || !stream.getAudioTracks().length) return;
    const context = new AudioContextClass();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    this.#analyser = analyser;
    this.#samples = new Float32Array(analyser.fftSize);
    const fill = this.#els.meterFill;
    const draw = () => {
      const decibels = this.#readMicDb();
      const level = Math.min(1, Math.max(0, (decibels + 60) / 60));
      // Rise instantly, fall slowly, like a hardware meter.
      this.#micLevel = level > this.#micLevel ? level : this.#micLevel * 0.9 + level * 0.1;
      fill.style.transform = `scaleX(${this.#micLevel})`;
      fill.classList.toggle('hot', decibels > -3);
      this.#frames.meter = requestAnimationFrame(draw);
    };
    context.resume().catch(() => {});
    this.#audioContext = context;
    draw();
  }

  #stopMeter() {
    cancelAnimationFrame(this.#frames.meter);
    this.#audioContext?.close().catch(() => {});
    this.#audioContext = null;
    this.#analyser = null;
    this.#micLevel = 0;
    this.#els.meterFill.style.transform = 'scaleX(0)';
  }

  /** Current microphone peak level in dBFS (-100 when there's no mic). */
  #readMicDb() {
    if (!this.#analyser) return -100;
    this.#analyser.getFloatTimeDomainData(this.#samples);
    let peak = 0;
    for (const sample of this.#samples) peak = Math.max(peak, Math.abs(sample));
    return 20 * Math.log10(peak || 1e-5);
  }

  // ---- Recording -----------------------------------------------------------

  #toggleRecording() {
    if (this.#state === 'recording') this.stopRecording();
    else if (this.#state === 'countdown') this.#cancelCountdown?.();
    else this.record();
  }

  #countdown(seconds) {
    this.#setState('countdown');
    this.#announce(`Recording in ${seconds} seconds`);
    return new Promise((resolve) => {
      let remaining = seconds;
      const show = () => {
        const digit = document.createElement('span');
        digit.textContent = String(remaining);
        this.#els.countdown.replaceChildren(digit);
      };
      const finish = (go) => {
        clearInterval(this.#timers.countdown);
        this.#cancelCountdown = null;
        this.#els.countdown.replaceChildren();
        if (!go && this.#state === 'countdown') this.#setState(this.#stream ? 'ready' : 'off');
        resolve(go);
      };
      show();
      this.#timers.countdown = setInterval(() => {
        remaining -= 1;
        if (remaining > 0) show();
        else finish(true);
      }, 1000);
      this.#cancelCountdown = () => finish(false);
    });
  }

  #beginRecording() {
    const preset = QUALITY[this.#els.qualitySelect.value] ?? QUALITY['1080p'];
    const mimeType = pickMimeType(this.getAttribute('mime-type'));
    const options = {
      videoBitsPerSecond: positiveNumber(this.getAttribute('video-bitrate')) ?? preset.videoBitsPerSecond,
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      ...(mimeType && { mimeType }),
    };
    const kind = this.#kind;
    const chunks = [];
    let recorder;
    try {
      recorder = createRecorder(this.#stream, options);
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size) chunks.push(event.data);
      });
      recorder.addEventListener('stop', () => this.#saveTake(recorder, chunks, kind));
      recorder.addEventListener('error', (event) => {
        const message = event.error?.message || 'The recording stopped unexpectedly.';
        this.#notify(message, 'error');
        this.#emit('recorder-error', { code: 'record-failed', message });
      });
      recorder.start(1000); // 1 s chunks keep memory spikes small on long takes
    } catch (error) {
      this.#setState('ready');
      this.#notify(`Couldn't start recording: ${error.message}`, 'error');
      this.#emit('recorder-error', { code: 'record-failed', message: error.message });
      return;
    }
    this.#recorder = recorder;
    this.#recordStart = performance.now();
    this.#thumbnail = null;
    this.#setState('recording');
    this.#timers.tick = setInterval(() => this.#tick(), 200);
    this.#tick();
    this.#timers.thumbnail = setTimeout(() => {
      this.#thumbnail = this.#captureFrame();
    }, 1000);
    if (this.#readerOn()) this.#startReader();
    else this.#startPrompterScroll();
    this.#announce('Recording');
    this.#emit('recording-start', { kind, mimeType: recorder.mimeType });
  }

  #tick() {
    const elapsed = (performance.now() - this.#recordStart) / 1000;
    const max = positiveNumber(this.getAttribute('max-duration'));
    this.#els.recTime.textContent = formatTime(elapsed);
    this.#els.timer.textContent = max ? `${formatTime(elapsed)} / ${formatTime(max)}` : formatTime(elapsed);
    if (max && elapsed >= max) {
      this.stopRecording();
      this.#notify(`Time limit reached (${formatTime(max)}). Your take was saved.`);
    }
  }

  #saveTake(recorder, chunks, kind) {
    // The recorder can also stop by itself (e.g. on an encoder error).
    if (this.#state === 'recording') this.#recordedSeconds = (performance.now() - this.#recordStart) / 1000;
    clearInterval(this.#timers.tick);
    clearTimeout(this.#timers.thumbnail);
    this.#stopPrompterScroll();
    this.#stopReader();
    this.#highlightLine(-1);
    this.#recorder = null;
    if (this.#state === 'recording' || this.#state === 'saving') this.#setState(this.#stream ? 'ready' : 'off');
    this.#els.prompter.scrollTop = 0;

    const mimeType = recorder.mimeType || chunks[0]?.type || 'video/webm';
    const type = mimeType.split(';')[0].trim();
    const blob = new Blob(chunks, { type });
    if (!blob.size) {
      this.#notify('Nothing was recorded. Please try again.', 'error');
      return;
    }
    const number = ++this.#counts[kind];
    const take = {
      id: makeId(),
      kind,
      number,
      label: kind === 'slate' ? (number > 1 ? `Slate ${number}` : 'Slate') : `Take ${number}`,
      blob,
      url: URL.createObjectURL(blob),
      mimeType,
      extension: EXTENSIONS[type] ?? 'mp4',
      durationSeconds: Math.round(this.#recordedSeconds * 10) / 10,
      sizeBytes: blob.size,
      createdAt: new Date(),
      thumbnail: this.#thumbnail,
      status: 'new',
      progress: 0,
      error: null,
      downloaded: false,
    };
    this.#takes.unshift(take);
    this.#renderTakes();
    this.#announce(`${take.label} saved, ${formatTime(take.durationSeconds)} long.`);
    this.#emit('take-recorded', { take: this.#publicTake(take) });
  }

  #captureFrame() {
    const video = this.#els.preview;
    if (!video.videoWidth) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = Math.round((320 * video.videoHeight) / video.videoWidth);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.72);
  }

  #startPrompterScroll() {
    const prompter = this.#els.prompter;
    if (prompter.hidden) return;
    let last = performance.now();
    let carry = 0; // browsers round scrollTop, so accumulate sub-pixel steps
    const step = (now) => {
      carry += (Number(this.#els.speedRange.value) * 1.2 * (now - last)) / 1000;
      last = now;
      if (carry >= 1) {
        prompter.scrollTop += Math.floor(carry);
        carry %= 1;
      }
      this.#frames.prompter = requestAnimationFrame(step);
    };
    this.#frames.prompter = requestAnimationFrame(step);
  }

  #stopPrompterScroll() {
    cancelAnimationFrame(this.#frames.prompter);
  }

  // ---- Takes ---------------------------------------------------------------

  #filenameFor(take) {
    const parts = ['actor-name', 'character', 'project'].map((name) => slug(this.getAttribute(name) ?? '')).filter(Boolean);
    const suffix = take.kind === 'slate' ? (take.number > 1 ? `Slate${take.number}` : 'Slate') : `Take${take.number}`;
    return `${parts.length ? parts.join('_') : 'SelfTape'}_${suffix}.${take.extension}`;
  }

  #publicTake(take) {
    return {
      id: take.id,
      kind: take.kind,
      number: take.number,
      label: take.label,
      filename: this.#filenameFor(take),
      blob: take.blob,
      url: take.url,
      mimeType: take.mimeType,
      durationSeconds: take.durationSeconds,
      sizeBytes: take.sizeBytes,
      createdAt: take.createdAt,
      thumbnail: take.thumbnail,
      status: take.status,
    };
  }

  #canSubmit() {
    return Boolean(this.#uploadHandler || this.getAttribute('upload-url'));
  }

  #uploader() {
    if (this.#uploadHandler) return this.#uploadHandler;
    const url = this.getAttribute('upload-url');
    return url ? (take, options) => this.#postTake(url, take, options) : null;
  }

  #postTake(url, take, { onProgress }) {
    return postVideo({
      url,
      blob: take.blob,
      filename: take.filename,
      field: this.getAttribute('upload-field') || 'video',
      withCredentials: this.hasAttribute('upload-credentials'),
      onProgress,
      fields: {
        filename: take.filename,
        kind: take.kind,
        take: take.number,
        durationSeconds: take.durationSeconds,
        mimeType: take.mimeType,
        actorName: this.getAttribute('actor-name'),
        character: this.getAttribute('character'),
        project: this.getAttribute('project'),
      },
    });
  }

  #renderTakes() {
    const e = this.#els;
    const canSubmit = this.#canSubmit();
    e.takesEmpty.hidden = this.#takes.length > 0;
    e.takesCount.textContent = this.#takes.length ? `(${this.#takes.length})` : '';
    e.takesList.replaceChildren(...this.#takes.map((take) => this.#takeItem(take, canSubmit)));
  }

  #takeItem(take, canSubmit) {
    const item = document.createElement('li');
    item.className = 'take';
    item.dataset.id = take.id;
    item.classList.toggle('active', this.#mode === 'review' && this.#reviewingId === take.id);
    item.innerHTML = `
      <button type="button" class="thumb" data-action="play"><img alt=""><span class="play-icon">${ICONS.play}</span><span class="dur"></span></button>
      <div>
        <div class="take-title"></div>
        <div class="take-sub"></div>
        <div class="take-status"></div>
      </div>
      <div class="take-actions">
        <a class="icon-btn" data-action="download">${ICONS.download}<span>Download</span></a>
        <button type="button" class="icon-btn submit" data-action="submit">${ICONS.upload}<span>Submit</span></button>
        <button type="button" class="icon-btn danger" data-action="delete">${ICONS.trash}<span class="confirm-label">Delete?</span></button>
      </div>`;
    const image = item.querySelector('img');
    if (take.thumbnail) image.src = take.thumbnail;
    else image.remove();
    item.querySelector('.dur').textContent = formatTime(take.durationSeconds);
    item.querySelector('.thumb').setAttribute('aria-label', `Play ${take.label}`);
    item.querySelector('.take-title').textContent = take.label;
    item.querySelector('.take-sub').textContent =
      `${formatTime(take.durationSeconds)} · ${formatBytes(take.sizeBytes)} · ${take.extension.toUpperCase()}`;
    const link = item.querySelector('[data-action="download"]');
    link.href = take.url;
    link.download = this.#filenameFor(take);
    link.setAttribute('aria-label', `Download ${take.label}`);
    item.querySelector('[data-action="delete"]').setAttribute('aria-label', `Delete ${take.label}`);
    item.querySelector('[data-action="submit"]').dataset.enabled = String(canSubmit);
    this.#paintStatus(item, take);
    return item;
  }

  #paintStatus(item, take) {
    const labels = {
      submit: this.getAttribute('submit-label') || 'Submit',
      submitting: this.getAttribute('submitting-label') || 'Uploading',
      submitted: this.getAttribute('submitted-label') || 'Submitted',
    };
    const status = item.querySelector('.take-status');
    status.textContent = {
      uploading: `${labels.submitting}…${take.progress > 0 ? ` ${Math.round(take.progress * 100)}%` : ''}`,
      submitted: `${labels.submitted} ✓`,
      failed: take.error ?? 'Upload failed.',
    }[take.status] ?? '';
    status.classList.toggle('ok', take.status === 'submitted');
    status.classList.toggle('err', take.status === 'failed');
    const submit = item.querySelector('[data-action="submit"]');
    const action = { uploading: labels.submitting, submitted: labels.submitted, failed: 'Retry' }[take.status] ?? labels.submit;
    submit.querySelector('span').textContent = action;
    submit.setAttribute('aria-label', `${action} ${take.label}`);
    submit.disabled = take.status === 'uploading';
    submit.hidden = submit.dataset.enabled !== 'true' || take.status === 'submitted';
  }

  #updateTake(take) {
    const item = [...this.#els.takesList.children].find((child) => child.dataset.id === take.id);
    if (item) this.#paintStatus(item, take);
  }

  #onTakeClick(event) {
    const control = event.target.closest('[data-action]');
    const take = this.#takes.find((t) => t.id === control?.closest('.take')?.dataset.id);
    if (!take) return;
    const action = control.dataset.action;
    if (action === 'play') this.#review(take);
    else if (action === 'download') take.downloaded = true;
    else if (action === 'submit') this.submitTake(take.id);
    else if (action === 'delete') this.#confirmDelete(control, take);
  }

  #confirmDelete(button, take) {
    if (button.classList.contains('confirm')) {
      this.deleteTake(take.id);
      return;
    }
    button.classList.add('confirm');
    button.setAttribute('aria-label', `Confirm delete ${take.label}`);
    setTimeout(() => {
      button.classList.remove('confirm');
      button.setAttribute('aria-label', `Delete ${take.label}`);
    }, 3000);
  }

  #review(take) {
    if (['countdown', 'recording', 'saving'].includes(this.#state)) return;
    const video = this.#els.playback;
    this.#mode = 'review';
    this.#reviewingId = take.id;
    video.poster = take.thumbnail ?? '';
    video.onloadedmetadata = () => {
      const play = () => video.play().catch(() => {});
      if (Number.isFinite(video.duration)) play();
      else fixDuration(video).then(play);
    };
    video.src = take.url;
    this.#render();
    this.#markActive();
  }

  #showLive() {
    const video = this.#els.playback;
    video.pause();
    video.onloadedmetadata = null;
    video.removeAttribute('src');
    video.load();
    this.#mode = 'live';
    this.#reviewingId = null;
    this.#render();
    this.#markActive();
  }

  #markActive() {
    for (const item of this.#els.takesList.children) {
      item.classList.toggle('active', this.#mode === 'review' && item.dataset.id === this.#reviewingId);
    }
  }

  // ---- Reader ----------------------------------------------------------------

  #readerOn() {
    return Boolean(this.#script && this.#els.readerCheck.checked);
  }

  #renderScript() {
    const e = this.#els;
    const script = this.#script;
    e.prompter.classList.toggle('script', Boolean(script));
    if (!script) {
      e.prompterText.textContent = e.sidesInput.value;
      return;
    }
    const mine = script.lines.filter((line) => line.mine).length;
    const others = [...new Set(script.lines.filter((line) => line.kind === 'dialogue' && !line.mine).map((line) => line.character))];
    e.scriptSummary.textContent =
      `${script.title ? `${script.title}: ` : ''}you're playing ${script.character || 'nobody yet'} (${mine} ${mine === 1 ? 'line' : 'lines'}).` +
      (others.length ? ` The reader plays ${others.join(', ')}.` : '');
    e.prompterText.replaceChildren(
      ...script.lines.map((line, index) => {
        const item = document.createElement('p');
        item.className = `sl ${line.kind}`;
        item.dataset.index = String(index);
        if (line.kind === 'dialogue') {
          item.classList.add(line.mine ? 'mine' : 'other');
          const who = document.createElement('span');
          who.className = 'who';
          who.textContent = line.character;
          item.append(who, line.text);
        } else {
          item.textContent = line.text;
        }
        return item;
      }),
    );
    e.prompter.scrollTop = 0;
  }

  #startReader() {
    this.#stopReader();
    if (!this.#readerOn()) return;
    const pauseMs = (Number(this.#els.pauseSelect.value) || 1.2) * 1000;
    this.#reader = { index: -1, finished: false, line: null, timer: null, timeout: null, detector: createCueDetector({ pauseMs }) };
    this.#nextCue();
  }

  #stopReader() {
    const reader = this.#reader;
    if (!reader) return;
    reader.line?.abort();
    clearInterval(reader.timer);
    clearTimeout(reader.timeout);
    this.#reader = null;
    this.#render();
  }

  /** Goes to the next line: reads it aloud, or listens while the actor says it. */
  #nextCue() {
    const reader = this.#reader;
    if (!reader || reader.finished) return;
    reader.line?.abort();
    clearInterval(reader.timer);
    clearTimeout(reader.timeout);
    const { lines, voices } = this.#script;
    let index = reader.index + 1;
    while (index < lines.length && (lines[index].kind !== 'dialogue' || (!lines[index].mine && voices[lines[index].character] === 'skip'))) {
      index++;
    }
    reader.index = index;
    this.#highlightLine(index);
    if (index >= lines.length) {
      this.#finishScene(reader);
      return;
    }
    reader.line = new AbortController();
    if (lines[index].mine) this.#listenFor(lines[index], reader, index);
    else this.#readAloud(lines[index], reader, index);
    this.#render();
  }

  async #readAloud(line, reader, index) {
    const say = this.readerSpeak ?? ((cue, options) => speak(cue.text, options));
    try {
      await say(line, { voice: this.#voiceFor(line.character), signal: reader.line.signal });
    } catch {
      // A voice that fails shouldn't spoil the take: carry on with the scene.
    }
    if (this.#reader !== reader || reader.index !== index) return; // skipped or stopped meanwhile
    reader.timeout = setTimeout(() => this.#nextCue(), 250);
  }

  #listenFor(line, reader, index) {
    reader.detector.reset({ minSpeechMs: Math.max(600, estimateSeconds(line.text) * 400) });
    // Let the reader's voice die away first so it isn't taken for the actor.
    const listenFrom = performance.now() + 300;
    reader.timer = setInterval(() => {
      if (this.#reader !== reader || reader.index !== index) {
        clearInterval(reader.timer);
        return;
      }
      const now = performance.now();
      if (now >= listenFrom && reader.detector.update(this.#readMicDb(), now) === 'done') this.#nextCue();
    }, 50);
  }

  #finishScene(reader) {
    reader.finished = true;
    this.#announce('End of the scene.');
    this.#render();
    this.#emit('scene-end', { recording: this.#state === 'recording' });
    if (this.#state === 'recording' && this.#els.autoStopCheck.checked) {
      // Hold the moment for a beat, as casting expects, then stop.
      reader.timeout = setTimeout(() => {
        if (this.#reader === reader) this.stopRecording();
      }, 2500);
    }
  }

  #highlightLine(index) {
    const items = this.#els.prompterText.children;
    for (const item of items) {
      if (!item.dataset.index) continue;
      const position = Number(item.dataset.index);
      item.classList.toggle('current', position === index);
      item.classList.toggle('done', index >= 0 && position < index);
    }
    const current = items[index];
    if (current) this.#els.prompter.scrollTo({ top: Math.max(0, current.offsetTop - 8), behavior: 'smooth' });
  }

  #voiceFor(character) {
    const chosen = this.#script.voices[character];
    if (chosen) return this.#voices.find((voice) => voice.voiceURI === chosen) ?? null;
    // Otherwise give each character a different voice.
    const others = [...new Set(this.#script.lines.filter((line) => line.kind === 'dialogue' && !line.mine).map((line) => line.character))];
    return this.#voices.length ? this.#voices[Math.max(0, others.indexOf(character)) % this.#voices.length] : null;
  }

  // ---- UI plumbing ---------------------------------------------------------

  #bindUi() {
    const e = this.#els;
    e.startButton.addEventListener('click', () => this.start());
    e.recordButton.addEventListener('click', () => {
      if (this.#readerOn()) unlockSpeech(); // iPhones only allow speech that starts from a tap
      this.#toggleRecording();
    });
    e.nextCue.addEventListener('click', () => this.#nextCue());
    e.readerCheck.addEventListener('change', () => this.#render());
    e.backButton.addEventListener('click', () => this.#showLive());
    for (const button of [e.kindScene, e.kindSlate]) {
      button.addEventListener('click', () => {
        this.#kind = button.dataset.kind;
        this.#render();
      });
    }
    e.sidesToggle.addEventListener('click', () => this.#togglePanel(e.sidesToggle, e.sidesPanel));
    e.settingsToggle.addEventListener('click', () => this.#togglePanel(e.settingsToggle, e.settingsPanel));
    for (const control of [e.cameraSelect, e.micSelect, e.qualitySelect, e.noiseCheck]) {
      control.addEventListener('change', () => {
        if (this.#state === 'ready') this.start();
      });
    }
    for (const control of [e.mirrorCheck, e.guidesCheck, e.prompterCheck]) {
      control.addEventListener('change', () => this.#render());
    }
    e.sidesInput.addEventListener('input', () => {
      if (!this.#script) e.prompterText.textContent = e.sidesInput.value;
      this.#render();
    });
    e.sizeRange.addEventListener('input', () => e.prompter.style.setProperty('--str-prompter-size', `${e.sizeRange.value}px`));
    e.preview.addEventListener('resize', () => this.#render());
    e.takesList.addEventListener('click', (event) => this.#onTakeClick(event));
  }

  #togglePanel(button, panel) {
    panel.hidden = !panel.hidden;
    button.setAttribute('aria-expanded', String(!panel.hidden));
  }

  #setState(state) {
    this.#state = state;
    this.#render();
  }

  #render() {
    const e = this.#els;
    const state = this.#state;
    const live = this.#mode === 'live';
    const cameraOn = ['ready', 'countdown', 'recording', 'saving'].includes(state);
    const busy = ['countdown', 'recording', 'saving'].includes(state);

    e.startScreen.hidden = !live || cameraOn;
    e.startButton.disabled = state === 'starting';
    e.startButton.textContent =
      state === 'starting' ? 'Waiting for camera…' : state === 'error' ? 'Try again' : 'Turn on camera & mic';
    e.startError.hidden = state !== 'error';

    e.preview.hidden = !live;
    e.preview.classList.toggle('mirrored', e.mirrorCheck.checked);
    e.playback.hidden = live;
    e.backButton.hidden = live;
    e.guides.hidden = !(live && cameraOn && e.guidesCheck.checked);
    const scriptMode = Boolean(this.#script);
    for (const el of this.#scriptOnly) el.hidden = !scriptMode;
    e.sidesLabel.hidden = scriptMode;
    e.speedLabel.hidden = scriptMode && e.readerCheck.checked;
    e.prompter.hidden = !(live && cameraOn && e.prompterCheck.checked && (scriptMode || e.sidesInput.value.trim()));
    e.nextCue.hidden = !(live && this.#reader && !this.#reader.finished);
    e.countdown.hidden = state !== 'countdown';
    e.recBadge.hidden = state !== 'recording';
    e.rotateHint.hidden = !(live && cameraOn && e.preview.videoHeight > e.preview.videoWidth);

    e.recordLabel.textContent = state === 'recording' ? 'Stop' : state === 'countdown' ? 'Cancel' : 'Record';
    e.recordButton.setAttribute(
      'aria-label',
      state === 'recording' ? 'Stop recording' : state === 'countdown' ? 'Cancel countdown' : `Record ${this.#kind}`,
    );
    e.recordButton.disabled = !['ready', 'countdown', 'recording'].includes(state);
    e.recordButton.classList.toggle('is-recording', state === 'recording');

    for (const button of [e.kindScene, e.kindSlate]) {
      button.setAttribute('aria-pressed', String(button.dataset.kind === this.#kind));
      button.disabled = busy;
    }
    for (const control of [e.cameraSelect, e.micSelect, e.qualitySelect, e.noiseCheck]) {
      control.disabled = busy || state === 'starting';
    }
    if (state !== 'recording') {
      const max = positiveNumber(this.getAttribute('max-duration'));
      e.timer.textContent = max ? `Limit ${formatTime(max)}` : '0:00';
    }
  }

  #showError({ code, message }) {
    this.#els.startError.textContent = message;
    this.#setState('error');
    this.#emit('recorder-error', { code, message });
  }

  #notify(message, tone = 'info') {
    const notice = this.#els.notice;
    notice.textContent = message;
    notice.classList.toggle('error', tone === 'error');
    notice.hidden = false;
    clearTimeout(this.#timers.notice);
    this.#timers.notice = setTimeout(() => {
      notice.hidden = true;
    }, 6000);
  }

  #announce(text) {
    const region = this.#els.status;
    region.textContent = '';
    setTimeout(() => {
      region.textContent = text;
    }, 50);
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  // Space starts/stops a take when nothing else on the page has focus, so an
  // actor can press it and step back to their mark during the countdown.
  #onKeyDown = (event) => {
    if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape' && this.#state === 'countdown') {
      this.#cancelCountdown?.();
      return;
    }
    const target = event.composedPath()[0];
    const typing = target instanceof Element && target.closest('input, textarea, select, [contenteditable]');
    // Bluetooth page turners and presentation clickers send these keys.
    if (this.#reader && !this.#reader.finished && ['ArrowRight', 'ArrowDown', 'PageDown'].includes(event.key) && !typing) {
      event.preventDefault();
      this.#nextCue();
      return;
    }
    if (event.code !== 'Space' || this.#mode !== 'live') return;
    if (!['ready', 'countdown', 'recording'].includes(this.#state)) return;
    const focused = document.activeElement;
    if (focused && focused !== document.body && focused !== document.documentElement && focused !== this) return;
    if (target instanceof Element && target.closest('input, textarea, select, button, a, [contenteditable]')) return;
    if (this.checkVisibility && !this.checkVisibility()) return;
    event.preventDefault();
    if (this.#readerOn()) unlockSpeech();
    this.#toggleRecording();
  };

  #onBeforeUnload = (event) => {
    const unsaved = this.#takes.some((take) => !take.downloaded && take.status !== 'submitted');
    if (this.#state !== 'recording' && !unsaved) return;
    event.preventDefault();
    event.returnValue = true; // older browsers need this to show the prompt
  };
}

// ---- Helpers ----------------------------------------------------------------

function unsupportedReason() {
  if (!window.isSecureContext) {
    return { code: 'insecure-context', message: 'Recording only works on a secure page (https:// or localhost).' };
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    return {
      code: 'unsupported',
      message: "This browser can't record video. Please use the latest Chrome, Edge, Safari or Firefox.",
    };
  }
  return null;
}

function describeMediaError(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        code: 'permission-denied',
        message: 'Camera or microphone access was blocked. Allow it from the camera icon in the address bar, then try again.',
      };
    case 'NotFoundError':
    case 'OverconstrainedError':
      return { code: 'no-device', message: 'No camera or microphone was found. Connect one, then try again.' };
    case 'NotReadableError':
    case 'AbortError':
      return {
        code: 'device-busy',
        message: 'Your camera or microphone is being used by another app (Zoom, Teams, FaceTime…). Close it, then try again.',
      };
    case 'NotSupportedError': // e.g. the built-in browsers of social and email apps
      return {
        code: 'unsupported',
        message: "This browser can't use your camera here. If you opened this link inside another app, open it in Chrome, Edge, Safari or Firefox instead.",
      };
    default:
      return { code: 'camera-failed', message: `Couldn't start the camera${error?.message ? `: ${error.message}` : '.'}` };
  }
}

function pickMimeType(preferred) {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  return [preferred, ...MIME_CANDIDATES].find((type) => type && MediaRecorder.isTypeSupported(type)) ?? '';
}

// A short plain-text or JSON ({ error } / { message }) reason from the server, if it sent one.
function serverMessage(xhr) {
  const text = (xhr.responseText || '').trim();
  try {
    const body = JSON.parse(text);
    return typeof body?.error === 'string' ? body.error : typeof body?.message === 'string' ? body.message : '';
  } catch {
    return text.length <= 200 && !text.startsWith('<') ? text : '';
  }
}

/**
 * POSTs a video as multipart/form-data, reporting progress. Used for
 * upload-url, and handy for uploading saved videos later.
 */
export function postVideo({ url, blob, filename, field = 'video', fields = {}, withCredentials = false, onProgress = () => {} }) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append(field, blob, filename);
    for (const [name, value] of Object.entries(fields)) {
      if (value !== null && value !== undefined && value !== '') form.append(name, String(value));
    }
    const xhr = new XMLHttpRequest(); // fetch() can't report upload progress
    xhr.open('POST', url);
    xhr.withCredentials = withCredentials;
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status === 413) {
        reject(new Error('This video is too big for the server. Try a shorter take, or 720p in Settings.'));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(serverMessage(xhr) || `Upload failed (HTTP ${xhr.status}).`));
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText));
      } catch {
        resolve(xhr.responseText);
      }
    });
    xhr.addEventListener('error', () => reject(new Error('Upload failed. Check your connection and try again.')));
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled.')));
    xhr.send(form);
  });
}

function createRecorder(stream, options) {
  try {
    return new MediaRecorder(stream, options);
  } catch {
    return new MediaRecorder(stream); // let the browser choose its own format
  }
}

// Chrome writes WebM without a duration, so <video> reports Infinity and
// can't scrub. Seeking far past the end makes it work out the real length.
export function fixDuration(video) {
  return new Promise((resolve) => {
    if (Number.isFinite(video.duration)) {
      resolve();
      return;
    }
    const cleanUp = () => {
      clearTimeout(timeout);
      video.removeEventListener('durationchange', done);
      video.removeEventListener('timeupdate', done);
    };
    const done = () => {
      if (!Number.isFinite(video.duration)) return;
      cleanUp();
      video.currentTime = 0;
      resolve();
    };
    const timeout = setTimeout(() => {
      cleanUp();
      resolve();
    }, 3000);
    video.addEventListener('durationchange', done);
    video.addEventListener('timeupdate', done);
    video.currentTime = 1e101;
  });
}

function fillSelect(select, devices, activeId, fallbackLabel) {
  select.replaceChildren(
    ...devices.map((device, index) => {
      const option = new Option(device.label || `${fallbackLabel} ${index + 1}`, device.deviceId);
      option.selected = device.deviceId === activeId;
      return option;
    }),
  );
}

function stopTracks(stream) {
  for (const track of stream.getTracks()) track.stop();
}

function positiveNumber(value) {
  const number = Number(value);
  return value !== null && Number.isFinite(number) && number > 0 ? number : null;
}

function formatTime(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

function slug(text) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '');
}

function makeId() {
  return crypto.randomUUID?.() ?? `take-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

if (!customElements.get('self-tape-recorder')) {
  customElements.define('self-tape-recorder', SelfTapeRecorder);
}
