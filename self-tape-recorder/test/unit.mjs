// Unit tests for script parsing and cue detection. No browser needed:
//   node --test test/unit.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ScriptError, buildScript, classifyLines, parseText } from '../script-parser.js';
import { createCueDetector, estimateSeconds, spokenText } from '../scene-reader.js';

const dialogue = (scene) => scene.lines.filter((line) => line.kind === 'dialogue').map((line) => [line.character, line.text]);

test('screenplay-style text: scenes, cues, parentheticals, transitions', () => {
  const script = parseText(
    `Title: The Battlements

INT. CASTLE BATTLEMENTS - NIGHT #1#

Wind howls. HAMLET waits, alone.

HAMLET
(whispering)
Angels and ministers of grace
defend us!

GHOST (V.O.)
Mark me.

CUT TO:

EXT. GRAVEYARD - DAY

HAMLET (CONT'D)
Alas, poor Yorick!`,
    'fallback',
  );
  assert.equal(script.title, 'The Battlements');
  assert.deepEqual(script.scenes.map((scene) => scene.label), ['1. INT. CASTLE BATTLEMENTS - NIGHT', 'EXT. GRAVEYARD - DAY']);
  assert.deepEqual(dialogue(script.scenes[0]), [
    ['HAMLET', '(whispering) Angels and ministers of grace defend us!'],
    ['GHOST', 'Mark me.'],
  ]);
  assert.deepEqual(
    script.scenes[0].lines.map((line) => line.kind),
    ['heading', 'action', 'dialogue', 'dialogue', 'transition'],
  );
  assert.deepEqual(dialogue(script.scenes[1]), [['HAMLET', 'Alas, poor Yorick!']]);
  assert.deepEqual(script.characters, [
    { name: 'HAMLET', lines: 2 },
    { name: 'GHOST', lines: 1 },
  ]);
});

test('stage play with speaker names on their own lines and no blank lines', () => {
  const script = parseText(`ACT III, SCENE 1
HAMLET
To be, or not to be, that is the question:
Whether 'tis nobler in the mind to suffer
OPHELIA
Good my lord,
How does your honour for this many a day?
HAMLET
I humbly thank you; well, well, well.`);
  assert.equal(script.scenes.length, 1);
  assert.equal(script.scenes[0].label, 'ACT III, SCENE 1');
  assert.deepEqual(dialogue(script.scenes[0]), [
    ['HAMLET', "To be, or not to be, that is the question: Whether 'tis nobler in the mind to suffer"],
    ['OPHELIA', 'Good my lord, How does your honour for this many a day?'],
    ['HAMLET', 'I humbly thank you; well, well, well.'],
  ]);
});

test('play with the speaker inline: "HAMLET. To be…" and "MR. SMITH: …"', () => {
  const script = parseText(`HAMLET. To be, or not to be,
that is the question.
OPHELIA. Good my lord.
HAMLET. I humbly thank you.
MR. SMITH: Is anyone there?
MR. SMITH: Hello?`);
  assert.deepEqual(dialogue(script.scenes[0]), [
    ['HAMLET', 'To be, or not to be, that is the question.'],
    ['OPHELIA', 'Good my lord.'],
    ['HAMLET', 'I humbly thank you.'],
    ['MR. SMITH', 'Is anyone there? Hello?'],
  ]);
});

test('shouted action in capitals is not mistaken for a character', () => {
  const script = parseText(`INT. KITCHEN - DAY

ANNA
Did you hear that?

BANG!

THE DOOR SLAMS.
Anna jumps.

ANNA
Who's there?`);
  assert.deepEqual(dialogue(script.scenes[0]).map(([who]) => who), ['ANNA', 'ANNA']);
  assert.ok(script.scenes[0].lines.some((line) => line.kind === 'action' && line.text === 'THE DOOR SLAMS. Anna jumps.'));
});

test('PDF-style lines: indentation decides cues, dialogue and action', () => {
  // indent is in ems from the action margin, as in a standard screenplay PDF.
  const at = (indent, text, gap = false) => ({ indent, text, gap });
  const elements = classifyLines([
    at(0, '12 INT. CASTLE - NIGHT 12', true),
    at(0, 'The GHOST appears.', true),
    at(13.2, 'GHOST', true),
    at(6, 'Remember me.'),
    at(13.2, 'HAMLET'),
    at(9.6, '(shaken)'),
    at(6, 'Remember thee?'),
    at(0, 'He kneels. THE CANDLES GUTTER.', true),
    at(0, 'SILENCE', true),
    at(0, 'Then nothing.'),
    at(27, 'CUT TO:', true),
  ]);
  assert.deepEqual(elements, [
    { type: 'heading', text: 'INT. CASTLE - NIGHT', number: '12' },
    { type: 'action', text: 'The GHOST appears.' },
    { type: 'character', text: 'GHOST' },
    { type: 'dialogue', text: 'Remember me.' },
    { type: 'character', text: 'HAMLET' },
    { type: 'dialogue', text: '(shaken) Remember thee?' },
    { type: 'action', text: 'He kneels. THE CANDLES GUTTER.' },
    { type: 'action', text: 'SILENCE Then nothing.' },
    { type: 'transition', text: 'CUT TO:' },
  ]);
  const script = buildScript(elements, 'Sides', 'pdf');
  assert.equal(script.scenes[0].label, '12. INT. CASTLE - NIGHT');
  assert.deepEqual(script.scenes[0].characters, ['GHOST', 'HAMLET']);
});

test('a speech split across PDF pages is joined back together', () => {
  const script = buildScript(
    [
      { type: 'character', text: 'HAMLET' },
      { type: 'dialogue', text: 'O, that this too too solid flesh' },
      { type: 'character', text: "HAMLET (CONT'D)" },
      { type: 'dialogue', text: 'would melt.' },
    ],
    'Sides',
    'pdf',
  );
  assert.deepEqual(dialogue(script.scenes[0]), [['HAMLET', 'O, that this too too solid flesh would melt.']]);
});

test('a script with no dialogue explains the problem', () => {
  assert.throws(() => parseText('Just some notes about the audition.\nBring headshots.'), ScriptError);
});

test('spoken text drops directions; durations are sensible', () => {
  assert.equal(spokenText('(beat) To be, [aside] or not (to Ophelia) to be.'), 'To be, or not to be.');
  assert.equal(estimateSeconds('one two three four five'), 2);
  assert.equal(estimateSeconds('Hi.'), 0.8);
});

// Feeds the detector a level timeline: [[durationMs, levelDb], …] in 50 ms steps.
function run(detector, timeline, start = 0) {
  let now = start;
  const states = [];
  for (const [duration, level] of timeline) {
    for (let t = 0; t < duration; t += 50) {
      states.push([now, detector.update(level, now)]);
      now += 50;
    }
  }
  return { states, end: now, doneAt: states.find(([, state]) => state === 'done')?.[0] ?? null };
}

test('cue detector: speech then a pause ends the line', () => {
  const detector = createCueDetector({ pauseMs: 1200 });
  const { doneAt, states } = run(detector, [[500, -70], [2000, -18], [2000, -70]]);
  assert.equal(states.find(([t]) => t === 400)[1], 'waiting');
  assert.equal(states.find(([t]) => t === 1000)[1], 'speaking');
  // speech stops at 2500 ms; the line ends 1.2 s later
  assert.ok(doneAt >= 3650 && doneAt <= 3800, `done at ${doneAt}`);
});

test('cue detector: short pauses inside a line do not end it', () => {
  const detector = createCueDetector({ pauseMs: 1200 });
  const { doneAt } = run(detector, [[1000, -18], [700, -70], [1000, -18], [1500, -70]]);
  assert.ok(doneAt >= 3850, `done at ${doneAt}`);
});

test('cue detector: a knock is not speech', () => {
  const detector = createCueDetector();
  const { states } = run(detector, [[300, -70], [50, -5], [3000, -70]]);
  assert.ok(states.every(([, state]) => state === 'waiting'));
});

test('cue detector: an early dramatic pause is ignored for long lines', () => {
  const detector = createCueDetector({ pauseMs: 1000, minSpeechMs: 4000 });
  const { doneAt } = run(detector, [[600, -18], [1500, -70], [2500, -18], [1500, -70]]);
  // the 1.5 s pause at 0.6 s is too early to be the end of a 4 s line
  assert.ok(doneAt >= 5500, `done at ${doneAt}`);
});

test('cue detector: adapts to a noisy room', () => {
  const detector = createCueDetector({ pauseMs: 1000 });
  const { states, doneAt } = run(detector, [[2000, -40], [1500, -12], [1500, -40]]);
  assert.equal(states.find(([t]) => t === 1500)[1], 'waiting'); // steady room noise isn't speech
  assert.ok(doneAt >= 4450 && doneAt <= 4600, `done at ${doneAt}`);
});

test('cue detector: reset listens for the next line but keeps the noise level', () => {
  const detector = createCueDetector({ pauseMs: 500 });
  const first = run(detector, [[1000, -40], [800, -12], [800, -40]]);
  assert.ok(first.doneAt);
  detector.reset();
  const second = run(detector, [[1000, -40]], first.end);
  assert.ok(second.states.every(([, state]) => state === 'waiting'));
});
