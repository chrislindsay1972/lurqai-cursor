/**
 * The reader for a self-tape: speaks the other characters' lines with the
 * device's built-in voices, and tells from the microphone when the actor has
 * finished a line so the next cue can come in.
 */

const WORDS_PER_SECOND = 2.5;

/** What to say out loud: drops "(beat)", "(to Ophelia)" and [stage directions]. */
export function spokenText(text) {
  return String(text ?? '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Rough time to say a line, in seconds. */
export function estimateSeconds(text) {
  const words = spokenText(text).split(' ').filter(Boolean).length;
  return Math.max(0.8, words / WORDS_PER_SECOND);
}

/**
 * Follows the microphone level to tell when the actor has started, then
 * finished, a line. Call update(levelDb, nowMs) every ~50 ms; it returns
 * 'waiting' (not started yet), 'speaking', or 'done'.
 *
 * - pauseMs: how long a silence ends the line.
 * - minSpeechMs: ignore pauses before this much of the line has gone by, so a
 *   dramatic pause near the start doesn't trigger the next cue.
 * - startMs: voice must last this long to count, so knocks and clicks don't.
 */
export function createCueDetector({ pauseMs = 1200, minSpeechMs = 600, startMs = 120, marginDb = 14 } = {}) {
  let minimum = minSpeechMs;
  let floor = null; // background noise, in dBFS
  let lastUpdate = null;
  let voicedSince = null;
  let speechStart = null;
  let lastVoiced = null;
  return {
    update(levelDb, now) {
      const level = Math.max(-100, Number.isFinite(levelDb) ? levelDb : -100);
      const seconds = lastUpdate === null ? 0 : Math.max(0, now - lastUpdate) / 1000;
      lastUpdate = now;
      // Drop to quiet moments at once, but rise slowly so speech never becomes "background".
      floor = floor === null ? level : Math.min(level, floor + 3 * seconds);
      const threshold = Math.min(-20, Math.max(-50, floor + marginDb));
      if (level > threshold) {
        voicedSince ??= now;
        lastVoiced = now;
        if (speechStart === null && now - voicedSince >= startMs) speechStart = voicedSince;
      } else {
        voicedSince = null;
      }
      if (speechStart === null) return 'waiting';
      return now - speechStart >= minimum && now - lastVoiced >= pauseMs ? 'done' : 'speaking';
    },
    /** Listen for a new line. The noise estimate carries over. */
    reset({ minSpeechMs: nextMinimum = minSpeechMs } = {}) {
      minimum = nextMinimum;
      voicedSince = null;
      speechStart = null;
      lastVoiced = null;
    },
  };
}

let voiceList = null;

/** The device's voices, preferring the page's language (English by default). */
export function loadVoices(lang = globalThis.document?.documentElement.lang || globalThis.navigator?.language || 'en') {
  const synth = globalThis.speechSynthesis;
  if (!synth) return Promise.resolve([]);
  voiceList ??= new Promise((resolve) => {
    // Voices load asynchronously in most browsers.
    const finish = () => {
      synth.removeEventListener?.('voiceschanged', check);
      clearTimeout(timer);
      resolve(synth.getVoices());
    };
    const check = () => {
      if (synth.getVoices().length) finish();
    };
    const timer = setTimeout(finish, 1500);
    synth.addEventListener?.('voiceschanged', check);
    check();
  });
  const base = lang.toLowerCase().split(/[-_]/)[0];
  return voiceList.then((voices) => {
    const local = voices.filter((voice) => voice.lang.toLowerCase().startsWith(base));
    return local.length ? local : voices;
  });
}

let unlocked = false;

/**
 * iPhones only allow speech that starts from a tap. Call this inside the tap
 * that starts recording; later lines can then be spoken without one.
 */
export function unlockSpeech() {
  const synth = globalThis.speechSynthesis;
  if (unlocked || !synth || typeof SpeechSynthesisUtterance === 'undefined') return;
  const silence = new SpeechSynthesisUtterance(' ');
  silence.volume = 0;
  synth.speak(silence);
  unlocked = true;
}

/**
 * Says a line with a device voice. Resolves when it has been said, or after
 * about as long as it would take if the device can't speak, so a scene never
 * stalls. Abort with signal to stop at once.
 */
export function speak(text, { voice = null, rate = 1, signal } = {}) {
  const words = spokenText(text);
  if (!words || signal?.aborted) return Promise.resolve();
  if (!globalThis.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
    return wait(estimateSeconds(words) * 1000, signal);
  }
  // Chrome cuts off utterances longer than ~15 seconds, so go sentence by sentence.
  const sentences = words.match(/[^.!?…]+(?:[.!?…]+["'”’)]*)?\s*/g) ?? [words];
  return sentences.reduce(
    (previous, sentence) => previous.then(() => speakSentence(sentence.trim(), voice, rate, signal)),
    Promise.resolve(),
  );
}

function speakSentence(text, voice, rate, signal) {
  return new Promise((resolve) => {
    if (!text || signal?.aborted) {
      resolve();
      return;
    }
    const synth = globalThis.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    utterance.rate = rate;
    const expected = estimateSeconds(text) * 1000;
    const started = performance.now();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(safety);
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = () => {
      synth.cancel();
      finish();
    };
    // No voice installed (or a failed engine): keep the rhythm by waiting instead.
    const onError = () => setTimeout(finish, Math.max(0, expected - (performance.now() - started)));
    // Some engines never fire 'end'; don't let the scene hang on them.
    const safety = setTimeout(finish, expected * 2 + 2500);
    utterance.addEventListener('end', finish);
    utterance.addEventListener('error', onError);
    signal?.addEventListener('abort', onAbort, { once: true });
    synth.speak(utterance);
  });
}

function wait(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
