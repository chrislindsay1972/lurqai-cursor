/**
 * <self-tape-studio> — the whole self-tape flow for actors, built for phones:
 *
 *   My Scripts  Add a script (PDF or Final Draft) from the phone's files, then
 *               choose the scenes and the character you're playing.
 *   Record      Perform your part while the app reads the other characters.
 *   My Videos   Review saved takes, share them by email, download or submit.
 *
 *   <script type="module" src="self-tape-studio.js"></script>
 *   <self-tape-studio actor-name="Jane Doe"></self-tape-studio>
 *
 * Scripts and videos are kept on the device. See README.md for the details.
 */
import { fixDuration, postVideo } from './self-tape-recorder.js';
import { DEFAULT_PDFJS_SRC, ScriptError, parseScriptFile, parseText } from './script-parser.js';
import { loadVoices, speak, unlockSpeech } from './scene-reader.js';
import { openStudioStore } from './studio-store.js';

const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13l10.5-6.5z"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
const DARK = '--str-bg: #17171a; --str-surface: #222226; --str-border: #34343b; --str-text: #ececf0; --str-muted: #a3a3ad;';
const FORMATS = { pdf: 'PDF', fdx: 'Final Draft', text: 'Text' };

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
  color: var(--str-text);
  font: 15px/1.45 var(--str-font);
}
:host([hidden]) { display: none; }
:host([theme="dark"]) { ${DARK} }
@media (prefers-color-scheme: dark) { :host([theme="auto"]) { ${DARK} } }
/* Hand the theme on to the recorder inside. */
self-tape-recorder {
  --str-accent: inherit; --str-primary: inherit; --str-success: inherit; --str-bg: inherit; --str-surface: inherit;
  --str-border: inherit; --str-text: inherit; --str-muted: inherit; --str-radius: inherit; --str-font: inherit;
}
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
button, select, input, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
button:disabled { cursor: not-allowed; opacity: .5; }
:focus-visible { outline: 2px solid var(--str-primary); outline-offset: 2px; }
h2 { margin: 0; font-size: 20px; }
h2:focus { outline: none; }
h3 { display: flex; align-items: center; gap: 8px; margin: 24px 0 10px; font-size: 16px; }

.studio { display: flex; flex-direction: column; gap: 14px; }
.tabs {
  position: sticky; top: 0; z-index: 2; display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; padding: 4px;
  border: 1px solid var(--str-border); border-radius: 12px; background: var(--str-surface);
}
.tabs button { min-height: 42px; padding: 6px 4px; border: 0; border-radius: 9px; background: none; color: var(--str-muted); font-size: 14px; font-weight: 600; white-space: nowrap; }
.tabs button[aria-selected="true"] { background: var(--str-bg); color: var(--str-text); box-shadow: 0 1px 2px rgba(0, 0, 0, .15); }
.badge {
  display: inline-block; min-width: 20px; margin-left: 4px; padding: 0 6px; border-radius: 999px;
  background: var(--str-primary); color: #fff; font-size: 12px; line-height: 20px;
}
.notice { margin: 0; padding: 10px 14px; border: 1px solid var(--str-border); border-radius: 10px; background: var(--str-surface); }
.notice.error { border-color: var(--str-accent); color: var(--str-accent); }
.view-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }
.hint, .meta { margin: 6px 0 0; color: var(--str-muted); font-size: 14px; }
.empty { margin: 14px 0 0; padding: 22px 16px; border: 1px dashed var(--str-border); border-radius: 12px; color: var(--str-muted); text-align: center; }

.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 40px; padding: 0 16px;
  border: 1px solid var(--str-border); border-radius: 10px; background: var(--str-bg); color: var(--str-text); font-weight: 600;
}
.btn:hover:not(:disabled) { background: var(--str-surface); }
.btn.primary { border-color: transparent; background: var(--str-primary); color: #fff; }
.btn.primary:hover:not(:disabled) { background: var(--str-primary); filter: brightness(1.08); }
.btn.wide { width: 100%; min-height: 50px; margin-top: 24px; font-size: 16px; }
.btn.danger.confirm { border-color: transparent; background: var(--str-accent); color: #fff; }
.btn.small { min-height: 34px; padding: 0 12px; font-size: 14px; }
.btn.icon { padding: 0 10px; }
.btn svg { width: 16px; height: 16px; flex: none; }
.link { padding: 4px 0; border: 0; background: none; color: var(--str-primary); font-weight: 600; }
.file-btn { position: relative; overflow: hidden; }
.file-btn input { position: absolute; inset: 0; width: 100%; opacity: 0; cursor: pointer; }
.file-btn:focus-within { outline: 2px solid var(--str-primary); outline-offset: 2px; }

.cards { display: grid; gap: 10px; margin: 14px 0 0; padding: 0; list-style: none; }
.card {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px 12px; padding: 12px;
  border: 1px solid var(--str-border); border-radius: 12px; background: var(--str-bg);
}
.card-title { margin: 0; font-weight: 700; overflow-wrap: anywhere; }
.card-meta { margin: 2px 0 0; color: var(--str-muted); font-size: 13px; overflow-wrap: anywhere; }
.card-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.card.video { grid-template-columns: 112px minmax(0, 1fr); align-items: start; }
.card.video .card-actions { grid-column: 1 / -1; justify-content: flex-start; }
.card.video .danger { margin-left: auto; }
.thumb { position: relative; width: 112px; aspect-ratio: 16 / 9; padding: 0; overflow: hidden; border: 0; border-radius: 8px; background: #000; }
.thumb img { display: block; width: 100%; height: 100%; object-fit: cover; }
.play-icon {
  position: absolute; top: 50%; left: 50%; display: grid; place-items: center; width: 30px; height: 30px;
  transform: translate(-50%, -50%); border-radius: 50%; background: rgba(0, 0, 0, .6); color: #fff;
}
.play-icon svg { width: 14px; height: 14px; margin-left: 2px; }
.dur {
  position: absolute; right: 4px; bottom: 4px; padding: 1px 5px; border-radius: 4px; background: rgba(0, 0, 0, .72);
  color: #fff; font-size: 11px; font-variant-numeric: tabular-nums;
}
.status { margin: 4px 0 0; font-size: 13px; }
.status.ok { color: var(--str-success); }
.status.err { color: var(--str-accent); }

.choices { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.choice {
  display: flex; align-items: flex-start; gap: 10px; padding: 12px; border: 1px solid var(--str-border);
  border-radius: 12px; background: var(--str-bg); cursor: pointer;
}
.choice:has(input:checked) { border-color: var(--str-primary); box-shadow: 0 0 0 1px var(--str-primary); }
.choice input { flex: none; width: 20px; height: 20px; margin: 1px 0 0; accent-color: var(--str-primary); }
.choice strong { display: block; overflow-wrap: anywhere; }
.choice small { display: block; color: var(--str-muted); font-size: 13px; }
.step {
  display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 50%;
  background: var(--str-primary); color: #fff; font-size: 13px;
}
.voices { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.voice-row { display: grid; grid-template-columns: minmax(84px, auto) minmax(0, 1fr) auto; align-items: center; gap: 8px; }
.voice-row .who { font-weight: 700; overflow-wrap: anywhere; }
select, textarea { width: 100%; border: 1px solid var(--str-border); border-radius: 8px; background: var(--str-bg); color: var(--str-text); }
select { min-height: 40px; padding: 0 8px; }
textarea { min-height: 140px; margin-top: 8px; padding: 10px 12px; line-height: 1.5; resize: vertical; }
.paste { margin-top: 20px; }
.paste summary { color: var(--str-primary); font-weight: 600; cursor: pointer; }
.paste .btn { margin-top: 8px; }
.record-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 12px; margin-bottom: 12px; }
.record-head p { margin: 0; }
.player { overflow: hidden; margin-top: 14px; border-radius: 12px; background: #000; }
.player video { display: block; width: 100%; max-height: 70vh; background: #000; }
.player-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px; background: var(--str-surface); }
.player-bar p { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
`;

const MARKUP = `
<div class="studio">
  <div class="tabs" role="tablist" aria-label="Self-tape studio">
    <button type="button" role="tab" id="tab-scripts" aria-controls="view-scripts" data-tab="scripts">My Scripts</button>
    <button type="button" role="tab" id="tab-record" aria-controls="view-record" data-tab="record">Record</button>
    <button type="button" role="tab" id="tab-videos" aria-controls="view-videos" data-tab="videos">My Videos<span class="badge" data-el="videoCount" hidden></span></button>
  </div>
  <p class="notice" data-el="notice" role="status" hidden></p>

  <section id="view-scripts" role="tabpanel" aria-labelledby="tab-scripts" data-view="scripts">
    <div data-el="libraryView">
      <div class="view-head">
        <h2>My Scripts</h2>
        <label class="btn primary file-btn">Add a script
          <input type="file" data-el="fileInput">
        </label>
      </div>
      <p class="hint">A PDF or Final Draft (.fdx) file, such as sides your agent emailed you. On iPhone, save the attachment to Files first, then pick it from Files here.</p>
      <p class="empty" data-el="scriptsEmpty">No scripts yet.</p>
      <ul class="cards" data-el="scriptList"></ul>
      <details class="paste">
        <summary>Or paste the text of a scene</summary>
        <textarea data-el="pasteInput" rows="8" aria-label="Scene text" placeholder="HAMLET&#10;To be, or not to be, that is the question.&#10;&#10;OPHELIA&#10;Good my lord…"></textarea>
        <button type="button" class="btn" data-el="pasteButton">Add this scene</button>
      </details>
    </div>
    <div data-el="detailView" hidden>
      <button type="button" class="link" data-el="backToScripts">&lsaquo; My Scripts</button>
      <h2 data-el="scriptTitle" tabindex="-1"></h2>
      <p class="meta" data-el="scriptMeta"></p>
      <h3><span class="step">1</span> Choose your scenes</h3>
      <ul class="choices" data-el="sceneList"></ul>
      <h3><span class="step">2</span> Choose your character</h3>
      <ul class="choices" data-el="characterList"></ul>
      <p class="empty" data-el="noCast" hidden>Choose at least one scene with dialogue.</p>
      <div data-el="voiceSection">
        <h3><span class="step">3</span> Voices for the other parts</h3>
        <ul class="voices" data-el="voiceList"></ul>
        <p class="hint" data-el="voiceHint"></p>
      </div>
      <button type="button" class="btn primary wide" data-el="recordScenes">Record these scenes</button>
    </div>
  </section>

  <section id="view-record" role="tabpanel" aria-labelledby="tab-record" data-view="record" hidden>
    <div class="record-head">
      <p data-el="recordSummary">No script chosen. You can still record with your own lines under Sides.</p>
      <button type="button" class="link" data-el="changeScene">Choose a script</button>
    </div>
    <self-tape-recorder data-el="recorder" submit-label="Save" submitting-label="Saving" submitted-label="Saved to My Videos"></self-tape-recorder>
  </section>

  <section id="view-videos" role="tabpanel" aria-labelledby="tab-videos" data-view="videos" hidden>
    <h2>My Videos</h2>
    <p class="hint">Videos stay on this device until you delete them. Phones can clear storage for websites you haven't used for a while, so share or submit the takes you want to keep.</p>
    <div class="player" data-el="player" hidden>
      <video data-el="playerVideo" controls playsinline></video>
      <div class="player-bar">
        <p data-el="playerTitle"></p>
        <button type="button" class="link" data-el="closePlayer">Close</button>
      </div>
    </div>
    <p class="empty" data-el="videosEmpty">No videos yet. Record a scene, then tap Save.</p>
    <ul class="cards" data-el="videoList"></ul>
  </section>
</div>
`;

export class SelfTapeStudio extends HTMLElement {
  static observedAttributes = ['actor-name', 'max-duration', 'upload-url'];

  #els = {};
  #tabs = [];
  #views = [];
  #store = null;
  #scripts = [];
  #videos = [];
  #voices = [];
  #openScriptId = null;
  #draft = null; // the scene/character/voice choices being made
  #session = null; // what the Record tab is set up for
  #playerUrl = null;
  #noticeTimer = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${STYLE}</style>${MARKUP}`;
    for (const el of root.querySelectorAll('[data-el]')) this.#els[el.dataset.el] = el;
    this.#tabs = [...root.querySelectorAll('[role="tab"]')];
    this.#views = [...root.querySelectorAll('[role="tabpanel"]')];
    this.#bindUi();
  }

  connectedCallback() {
    this.#openStore();
    this.#syncRecorder();
    this.#els.recorder.uploadHandler = (take) => this.#saveTake(take);
    this.#showTab(this.#preference('tab') ?? 'scripts', { focus: false });
    this.#load();
  }

  disconnectedCallback() {
    this.#closePlayer();
  }

  attributeChangedCallback() {
    this.#syncRecorder();
    this.#renderVideos();
  }

  /** Adds a script File, as if the actor had picked it. Resolves to the saved script. */
  async addScript(file) {
    this.#openStore();
    this.#notify(`Reading “${file.name}”…`);
    try {
      const parsed = await parseScriptFile(file, { pdfjsSrc: this.getAttribute('pdfjs-src') || DEFAULT_PDFJS_SRC });
      return await this.#keepScript(parsed, file.name);
    } catch (error) {
      this.#fail(error instanceof ScriptError ? error.message : `Couldn't add “${file.name}”: ${error.message}`);
      return null;
    }
  }

  // ---- Loading and saving ---------------------------------------------------

  #openStore() {
    const key = this.getAttribute('storage-key');
    this.#store ??= openStudioStore(key ? `self-tape-studio:${key}` : 'self-tape-studio');
  }

  async #load() {
    try {
      await Promise.all([this.#loadScripts(), this.#loadVideos()]);
      this.#voices = await loadVoices(); // before restoring, so the last session gets the same voices
      this.#restoreSession();
      if (this.#openScriptId) this.#renderCast();
    } catch (error) {
      this.#fail(error.message);
    }
  }

  async #loadScripts() {
    this.#scripts = (await this.#store.scripts.all()).sort((a, b) => b.addedAt - a.addedAt);
    this.#renderScripts();
  }

  async #loadVideos() {
    this.#videos = (await this.#store.videos.all()).sort((a, b) => b.createdAt - a.createdAt);
    this.#renderVideos();
  }

  async #keepScript(parsed, fileName) {
    const script = {
      id: makeId(),
      title: parsed.title,
      format: parsed.format,
      fileName,
      addedAt: Date.now(),
      scenes: parsed.scenes,
      characters: parsed.characters,
      selection: null,
    };
    await this.#store.scripts.put(script);
    await this.#loadScripts();
    this.#notify(`Added “${script.title}”: ${plural(script.scenes.length, 'scene')}, ${plural(script.characters.length, 'character')}.`);
    this.#emit('script-added', { script });
    this.#openScript(script.id);
    return script;
  }

  async #saveTake(take) {
    const session = this.#session;
    const video = {
      id: makeId(),
      createdAt: Date.now(),
      label: take.label,
      kind: take.kind,
      filename: take.filename,
      mimeType: take.mimeType,
      durationSeconds: take.durationSeconds,
      sizeBytes: take.sizeBytes,
      thumbnail: take.thumbnail,
      blob: take.blob,
      character: session?.character ?? null,
      scriptTitle: session?.title ?? null,
      scenes: session?.scenes ?? [],
      submittedAt: null,
    };
    await this.#store.videos.put(video);
    navigator.storage?.persist?.().catch(() => {}); // ask the browser not to clear saved videos
    await this.#loadVideos();
    this.#emit('video-saved', { video: publicVideo(video) });
    return { id: video.id };
  }

  // ---- My Scripts -------------------------------------------------------------

  #renderScripts() {
    const e = this.#els;
    e.scriptsEmpty.hidden = this.#scripts.length > 0;
    e.scriptList.replaceChildren(
      ...this.#scripts.map((script) => {
        const item = document.createElement('li');
        item.className = 'card';
        item.dataset.id = script.id;
        item.innerHTML = `
          <div>
            <p class="card-title"></p>
            <p class="card-meta"></p>
          </div>
          <div class="card-actions">
            <button type="button" class="btn small primary" data-action="open">Open</button>
            <button type="button" class="btn small danger" data-action="delete">Delete</button>
          </div>`;
        item.querySelector('.card-title').textContent = script.title;
        item.querySelector('.card-meta').textContent = [
          FORMATS[script.format] ?? 'Script',
          plural(script.scenes.length, 'scene'),
          plural(script.characters.length, 'character'),
          `added ${formatDate(script.addedAt)}`,
        ].join(' · ');
        item.querySelector('[data-action="open"]').setAttribute('aria-label', `Open ${script.title}`);
        item.querySelector('[data-action="delete"]').setAttribute('aria-label', `Delete ${script.title}`);
        return item;
      }),
    );
  }

  async #onScriptClick(event) {
    const control = event.target.closest('[data-action]');
    const script = this.#scripts.find((each) => each.id === control?.closest('[data-id]')?.dataset.id);
    if (!script) return;
    if (control.dataset.action === 'open') {
      this.#openScript(script.id);
    } else if (control.dataset.action === 'delete' && confirmTwice(control, `Delete ${script.title}`)) {
      await this.#store.scripts.delete(script.id);
      if (this.#session?.scriptId === script.id) this.#clearSession();
      await this.#loadScripts();
      this.#emit('script-deleted', { id: script.id });
    }
  }

  #openScript(id) {
    const script = this.#scripts.find((each) => each.id === id);
    if (!script) return;
    this.#openScriptId = id;
    const saved = script.selection;
    const all = script.scenes.map((_, index) => index);
    this.#draft = {
      // Sides usually hold one to three scenes: choose them all. For a whole script, start with the first.
      scenes: new Set(saved?.scenes?.filter((index) => index < all.length) ?? (all.length <= 3 ? all : [0])),
      character: saved?.character ?? null,
      voices: { ...saved?.voices },
    };
    const e = this.#els;
    e.libraryView.hidden = true;
    e.detailView.hidden = false;
    e.scriptTitle.textContent = script.title;
    e.scriptMeta.textContent = [FORMATS[script.format] ?? 'Script', script.fileName].filter(Boolean).join(' · ');
    this.#showTab('scripts', { focus: false });
    this.#renderScenes();
    this.#renderCast();
    e.scriptTitle.focus();
  }

  #closeScript() {
    this.#openScriptId = null;
    this.#els.detailView.hidden = true;
    this.#els.libraryView.hidden = false;
  }

  #currentScript() {
    return this.#scripts.find((each) => each.id === this.#openScriptId) ?? null;
  }

  #renderScenes() {
    const script = this.#currentScript();
    this.#els.sceneList.replaceChildren(
      ...script.scenes.map((scene, index) => {
        const lines = scene.lines.filter((line) => line.kind === 'dialogue').length;
        const item = choice('checkbox', 'scene', String(index), this.#draft.scenes.has(index), scene.label,
          `${scene.characters.join(', ') || 'No dialogue'} · ${plural(lines, 'line')}`);
        item.querySelector('input').addEventListener('change', (event) => {
          if (event.target.checked) this.#draft.scenes.add(index);
          else this.#draft.scenes.delete(index);
          this.#renderCast();
        });
        return item;
      }),
    );
  }

  #cast() {
    return castOf(this.#currentScript(), this.#draft.scenes);
  }

  #renderCast() {
    const e = this.#els;
    const draft = this.#draft;
    if (!draft) return;
    const cast = this.#cast();
    if (!cast.some((member) => member.name === draft.character)) draft.character = cast[0]?.name ?? null;
    e.noCast.hidden = cast.length > 0;
    e.characterList.replaceChildren(
      ...cast.map((member) => {
        const item = choice('radio', 'character', member.name, member.name === draft.character, member.name, plural(member.lines, 'line'));
        item.querySelector('input').addEventListener('change', () => {
          draft.character = member.name;
          this.#renderVoices();
        });
        return item;
      }),
    );
    this.#renderVoices();
  }

  #renderVoices() {
    const e = this.#els;
    const draft = this.#draft;
    const others = this.#cast().filter((member) => member.name !== draft.character);
    e.voiceSection.hidden = others.length === 0;
    e.recordScenes.disabled = !draft.character;
    e.voiceList.replaceChildren(
      ...others.map(({ name }) => {
        const item = document.createElement('li');
        item.className = 'voice-row';
        const who = document.createElement('span');
        who.className = 'who';
        who.textContent = name;
        const select = document.createElement('select');
        select.setAttribute('aria-label', `Voice for ${name}`);
        select.add(new Option('Automatic', ''));
        for (const voice of this.#voices) select.add(new Option(`${voice.name} (${voice.lang})`, voice.voiceURI));
        select.add(new Option("Don't read this part", 'skip'));
        select.value = [...select.options].some((option) => option.value === draft.voices[name]) ? draft.voices[name] : '';
        select.addEventListener('change', () => {
          draft.voices[name] = select.value;
        });
        const preview = document.createElement('button');
        preview.type = 'button';
        preview.className = 'btn small';
        preview.textContent = 'Hear';
        preview.setAttribute('aria-label', `Hear the voice for ${name}`);
        preview.addEventListener('click', () => this.#previewVoice(name));
        item.append(who, select, preview);
        return item;
      }),
    );
    e.voiceHint.textContent = this.#voices.length
      ? "Voices come from this device. If a part shouldn't be read, choose “Don't read this part”."
      : "This browser has no voices to read with, so the app will pause for about as long as each line takes.";
  }

  /** Voices for every other part, with "Automatic" resolved so previews match the take. */
  #resolveVoices(script, { scenes, character, voices: chosen = {} }) {
    const voices = {};
    castOf(script, scenes)
      .filter((member) => member.name !== character)
      .forEach(({ name }, index) => {
        if (chosen[name]) voices[name] = chosen[name];
        else if (this.#voices.length) voices[name] = this.#voices[index % this.#voices.length].voiceURI;
      });
    return voices;
  }

  #previewVoice(name) {
    unlockSpeech();
    const script = this.#currentScript();
    const chosen = this.#resolveVoices(script, { ...this.#draft, scenes: [...this.#draft.scenes] })[name];
    if (chosen === 'skip') {
      this.#notify(`${name} won't be read aloud.`);
      return;
    }
    const sample = [...this.#draft.scenes]
      .flatMap((index) => script.scenes[index].lines)
      .find((line) => line.kind === 'dialogue' && line.character === name);
    globalThis.speechSynthesis?.cancel();
    speak(sample?.text ?? `This is the voice for ${name}.`, { voice: this.#voices.find((voice) => voice.voiceURI === chosen) ?? null });
  }

  async #startSession() {
    const script = this.#currentScript();
    const draft = this.#draft;
    if (!script || !draft.character) return;
    const indexes = [...draft.scenes].sort((a, b) => a - b);
    script.selection = { scenes: indexes, character: draft.character, voices: { ...draft.voices } };
    this.#store.scripts.put(script).catch((error) => this.#fail(error.message));
    this.#preference('lastScript', script.id);
    this.#applySession(script, script.selection, this.#resolveVoices(script, script.selection));
    this.#showTab('record');
  }

  #applySession(script, selection, voices) {
    const scenes = selection.scenes.map((index) => script.scenes[index]).filter(Boolean);
    if (!scenes.length || !selection.character) return;
    this.#session = { scriptId: script.id, title: script.title, scenes: scenes.map((scene) => scene.label), character: selection.character };
    const recorder = this.#els.recorder;
    recorder.setAttribute('character', selection.character);
    recorder.setAttribute('project', script.title);
    recorder.script = { title: script.title, character: selection.character, lines: scenes.flatMap((scene) => scene.lines), voices };
    this.#els.recordSummary.textContent =
      `${script.title} · ${scenes.length === 1 ? scenes[0].label : plural(scenes.length, 'scene')} · You're ${selection.character}`;
    this.#els.changeScene.textContent = 'Change';
  }

  /** Sets the Record tab up as last time, unless the actor has already chosen something. */
  #restoreSession() {
    if (this.#session) return;
    const script = this.#scripts.find((each) => each.id === this.#preference('lastScript'));
    if (script?.selection) this.#applySession(script, script.selection, this.#resolveVoices(script, script.selection));
  }

  #clearSession() {
    this.#session = null;
    const recorder = this.#els.recorder;
    recorder.script = null;
    recorder.removeAttribute('character');
    recorder.removeAttribute('project');
    this.#els.recordSummary.textContent = 'No script chosen. You can still record with your own lines under Sides.';
    this.#els.changeScene.textContent = 'Choose a script';
  }

  // ---- My Videos ----------------------------------------------------------------

  #renderVideos() {
    const e = this.#els;
    e.videosEmpty.hidden = this.#videos.length > 0;
    e.videoCount.hidden = this.#videos.length === 0;
    e.videoCount.textContent = String(this.#videos.length);
    const canSubmit = Boolean(this.getAttribute('upload-url'));
    e.videoList.replaceChildren(
      ...this.#videos.map((video) => {
        const title = videoTitle(video);
        const item = document.createElement('li');
        item.className = 'card video';
        item.dataset.id = video.id;
        item.innerHTML = `
          <button type="button" class="thumb" data-action="play"><img alt=""><span class="play-icon">${PLAY_ICON}</span><span class="dur"></span></button>
          <div>
            <p class="card-title"></p>
            <p class="card-meta" data-field="scenes"></p>
            <p class="card-meta" data-field="info"></p>
            <p class="status" data-field="status"></p>
          </div>
          <div class="card-actions">
            <button type="button" class="btn small primary" data-action="share">Share</button>
            <button type="button" class="btn small" data-action="download">Download</button>
            <button type="button" class="btn small" data-action="submit">Submit</button>
            <button type="button" class="btn small icon danger" data-action="delete">${TRASH_ICON}</button>
          </div>`;
        const image = item.querySelector('img');
        if (video.thumbnail) image.src = video.thumbnail;
        else image.remove();
        item.querySelector('.dur').textContent = formatTime(video.durationSeconds);
        item.querySelector('.card-title').textContent = title;
        item.querySelector('[data-field="scenes"]').textContent = [video.scriptTitle, video.scenes.join(' · ')].filter(Boolean).join(': ');
        item.querySelector('[data-field="info"]').textContent =
          `${formatDate(video.createdAt, true)} · ${formatTime(video.durationSeconds)} · ${formatBytes(video.sizeBytes)}`;
        const status = item.querySelector('[data-field="status"]');
        if (video.submittedAt) {
          status.textContent = 'Submitted ✓';
          status.classList.add('ok');
        }
        const submit = item.querySelector('[data-action="submit"]');
        submit.hidden = !canSubmit || Boolean(video.submittedAt);
        for (const [action, verb] of [['play', 'Play'], ['share', 'Share'], ['download', 'Download'], ['submit', 'Submit'], ['delete', 'Delete']]) {
          item.querySelector(`[data-action="${action}"]`).setAttribute('aria-label', `${verb} ${title}`);
        }
        return item;
      }),
    );
  }

  #onVideoClick(event) {
    const control = event.target.closest('[data-action]');
    const item = control?.closest('[data-id]');
    const video = this.#videos.find((each) => each.id === item?.dataset.id);
    if (!video) return;
    const action = control.dataset.action;
    if (action === 'play') this.#play(video);
    else if (action === 'share') this.#share(video); // must run inside the tap for iPhone's share sheet
    else if (action === 'download') this.#download(video);
    else if (action === 'submit') this.#submit(video, item);
    else if (action === 'delete' && confirmTwice(control, `Delete ${videoTitle(video)}`)) this.#deleteVideo(video);
  }

  #play(video) {
    this.#closePlayer();
    const e = this.#els;
    const player = e.playerVideo;
    this.#playerUrl = URL.createObjectURL(video.blob);
    this.#els.player.dataset.id = video.id;
    e.playerTitle.textContent = videoTitle(video);
    e.player.hidden = false;
    player.poster = video.thumbnail ?? '';
    player.onloadedmetadata = () => {
      const play = () => player.play().catch(() => {});
      if (Number.isFinite(player.duration)) play();
      else fixDuration(player).then(play);
    };
    player.src = this.#playerUrl;
    e.player.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }

  #closePlayer() {
    const player = this.#els.playerVideo;
    player.pause();
    player.onloadedmetadata = null;
    player.removeAttribute('src');
    player.load();
    this.#els.player.hidden = true;
    delete this.#els.player.dataset.id;
    if (this.#playerUrl) URL.revokeObjectURL(this.#playerUrl);
    this.#playerUrl = null;
  }

  #share(video) {
    const file = new File([video.blob], video.filename, { type: video.blob.type || 'video/mp4' });
    const { subject, body } = this.#emailText(video);
    if (navigator.canShare?.({ files: [file] })) {
      // iPhone and Android: the share sheet offers Mail with the video attached.
      navigator
        .share({ files: [file], title: subject, text: body })
        .then(() => this.#emit('video-shared', { video: publicVideo(video), method: 'share' }))
        .catch((error) => {
          if (error?.name !== 'AbortError') this.#fail(`Couldn't share: ${error.message}`);
        });
      return;
    }
    // No share sheet (most computers): save the file, then open an email to attach it to.
    this.#download(video);
    this.#openLink(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${body}\n\n(Attach ${video.filename}, which has just been downloaded.)`)}`);
    this.#notify(`${video.filename} has been downloaded. Attach it to the email that opened.`);
    this.#emit('video-shared', { video: publicVideo(video), method: 'email' });
  }

  #emailText(video) {
    const actor = this.getAttribute('actor-name')?.trim() ?? '';
    const role = [video.character, video.scriptTitle && `in ${video.scriptTitle}`].filter(Boolean).join(' ');
    return {
      subject: ['Self-tape', actor, video.character, video.scriptTitle].filter(Boolean).join(' – '),
      body: `Hi,\n\nHere is my self-tape${role ? ` for ${role}` : ''}.\n\nThanks,\n${actor}`.trim(),
    };
  }

  #download(video) {
    const url = URL.createObjectURL(video.blob);
    this.#openLink(url, video.filename);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  #openLink(href, download) {
    const link = document.createElement('a');
    link.href = href;
    if (download) link.download = download;
    link.hidden = true;
    this.shadowRoot.append(link);
    link.click();
    link.remove();
  }

  async #submit(video, item) {
    const url = this.getAttribute('upload-url');
    if (!url) return;
    const status = item.querySelector('[data-field="status"]');
    const button = item.querySelector('[data-action="submit"]');
    const show = (text, tone = '') => {
      status.textContent = text;
      status.className = `status ${tone}`;
    };
    button.disabled = true;
    show('Uploading…');
    try {
      const result = await postVideo({
        url,
        blob: video.blob,
        filename: video.filename,
        field: this.getAttribute('upload-field') || 'video',
        withCredentials: this.hasAttribute('upload-credentials'),
        onProgress: (fraction) => show(`Uploading… ${Math.round(fraction * 100)}%`),
        fields: {
          filename: video.filename,
          kind: video.kind,
          durationSeconds: video.durationSeconds,
          mimeType: video.mimeType,
          actorName: this.getAttribute('actor-name'),
          character: video.character,
          project: video.scriptTitle,
          scenes: video.scenes.join(' | '),
        },
      });
      video.submittedAt = Date.now();
      await this.#store.videos.put(video);
      this.#renderVideos();
      this.#emit('video-submitted', { video: publicVideo(video), result });
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Retry';
      show(error.message, 'err');
    }
  }

  async #deleteVideo(video) {
    if (this.#els.player.dataset.id === video.id) this.#closePlayer();
    await this.#store.videos.delete(video.id);
    await this.#loadVideos();
    this.#emit('video-deleted', { id: video.id });
  }

  // ---- Plumbing -------------------------------------------------------------------

  #bindUi() {
    const e = this.#els;
    for (const tab of this.#tabs) tab.addEventListener('click', () => this.#showTab(tab.dataset.tab));
    e.fileInput.addEventListener('change', async () => {
      const [file] = e.fileInput.files;
      e.fileInput.value = ''; // so the same file can be chosen again
      if (file) await this.addScript(file);
    });
    e.pasteButton.addEventListener('click', async () => {
      try {
        await this.#keepScript(parseText(e.pasteInput.value, 'Pasted scene'), null);
        e.pasteInput.value = '';
      } catch (error) {
        this.#fail(error.message);
      }
    });
    e.scriptList.addEventListener('click', (event) => this.#onScriptClick(event));
    e.backToScripts.addEventListener('click', () => this.#closeScript());
    e.recordScenes.addEventListener('click', () => this.#startSession());
    e.changeScene.addEventListener('click', () => {
      if (this.#session) this.#openScript(this.#session.scriptId);
      else this.#showTab('scripts');
    });
    e.videoList.addEventListener('click', (event) => this.#onVideoClick(event));
    e.closePlayer.addEventListener('click', () => this.#closePlayer());
    this.shadowRoot.querySelector('[role="tablist"]').addEventListener('keydown', (event) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (!step) return;
      const index = this.#tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
      this.#showTab(this.#tabs[(index + step + this.#tabs.length) % this.#tabs.length].dataset.tab);
    });
  }

  #showTab(name, { focus = true } = {}) {
    const recorder = this.#els.recorder;
    const current = this.#tabs.find((tab) => tab.getAttribute('aria-selected') === 'true')?.dataset.tab;
    if (current === name && focus) return;
    if (current === 'record' && name !== 'record' && ['countdown', 'recording', 'saving'].includes(recorder.state)) {
      this.#notify('Stop recording before leaving this page.');
      return;
    }
    if (!this.#tabs.some((tab) => tab.dataset.tab === name)) name = 'scripts';
    for (const tab of this.#tabs) {
      const selected = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }
    for (const view of this.#views) view.hidden = view.dataset.view !== name;
    // Turn the camera off away from the Record tab, for privacy and battery.
    if (name !== 'record' && recorder.state !== 'off') recorder.stop();
    if (name !== 'videos') this.#closePlayer();
    this.#preference('tab', name);
  }

  #syncRecorder() {
    const recorder = this.#els.recorder;
    for (const name of ['actor-name', 'max-duration']) {
      const value = this.getAttribute(name);
      if (value === null) recorder.removeAttribute(name);
      else recorder.setAttribute(name, value);
    }
  }

  #notify(message, tone = 'info') {
    const notice = this.#els.notice;
    notice.textContent = message;
    notice.classList.toggle('error', tone === 'error');
    notice.hidden = false;
    clearTimeout(this.#noticeTimer);
    this.#noticeTimer = setTimeout(() => {
      notice.hidden = true;
    }, tone === 'error' ? 12_000 : 6000);
  }

  #fail(message) {
    this.#notify(message, 'error');
    this.#emit('studio-error', { message });
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  // Small per-device conveniences (last tab, last script); storage may be unavailable.
  #preference(name, value) {
    const key = `self-tape-studio:${this.getAttribute('storage-key') ?? ''}:${name}`;
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch {
      // private browsing or blocked storage: just don't remember
    }
    return null;
  }
}

// ---- Helpers ----------------------------------------------------------------------

/** Characters with lines in the given scenes, most lines first. */
function castOf(script, sceneIndexes) {
  const counts = new Map();
  for (const index of [...sceneIndexes].sort((a, b) => a - b)) {
    for (const line of script.scenes[index]?.lines ?? []) {
      if (line.kind === 'dialogue') counts.set(line.character, (counts.get(line.character) ?? 0) + 1);
    }
  }
  return [...counts].map(([name, lines]) => ({ name, lines })).sort((a, b) => b.lines - a.lines || a.name.localeCompare(b.name));
}

function choice(type, name, value, checked, title, detail) {
  const item = document.createElement('li');
  const label = document.createElement('label');
  label.className = 'choice';
  const input = document.createElement('input');
  input.type = type;
  input.name = name;
  input.value = value;
  input.checked = checked;
  const text = document.createElement('span');
  const strong = document.createElement('strong');
  strong.textContent = title;
  const small = document.createElement('small');
  small.textContent = detail;
  text.append(strong, small);
  label.append(input, text);
  item.append(label);
  return item;
}

// First tap arms a delete button; a second tap within 3 seconds confirms.
function confirmTwice(button, label) {
  if (button.classList.contains('confirm')) return true;
  const content = button.innerHTML;
  button.classList.add('confirm');
  button.textContent = 'Delete?';
  button.setAttribute('aria-label', `Confirm: ${label}`);
  setTimeout(() => {
    button.classList.remove('confirm');
    button.innerHTML = content;
    button.setAttribute('aria-label', label);
  }, 3000);
  return false;
}

function videoTitle(video) {
  return video.character ? `${video.character} · ${video.label}` : video.label;
}

function publicVideo(video) {
  return { ...video };
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function formatDate(time, withTime = false) {
  return new Date(time).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(withTime && { hour: 'numeric', minute: '2-digit' }),
  });
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

function makeId() {
  return crypto.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

if (!customElements.get('self-tape-studio')) customElements.define('self-tape-studio', SelfTapeStudio);
