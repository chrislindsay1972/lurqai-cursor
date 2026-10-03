/**
 * Reads a script (PDF, Final Draft .fdx, Fountain or plain text) into scenes,
 * characters and lines, so an actor can pick a scene and the app can read the
 * other parts.
 *
 *   const script = await parseScriptFile(file);
 *   // { title, format, scenes: [{ number, heading, label, lines }], characters: [{ name, lines }] }
 *   // a line is { kind: 'heading' | 'action' | 'dialogue' | 'transition', text, character? }
 */

// pdf.js is loaded only when a PDF is added. The legacy build also runs on older
// iPhones; point pdfjs-src at your own copy to avoid the CDN.
export const DEFAULT_PDFJS_SRC = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/legacy/build/pdf.min.mjs';

export class ScriptError extends Error {
  name = 'ScriptError';
}

const SCREEN_HEADING = /^(?:INT|EXT|EST|I\/E|INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT)(?:[.\s]|$)/;
const PLAY_HEADING = /^(?:ACT\s+[IVXLC\d]+(?:[,.:]?\s*SCENE\s+[IVXLC\d]+)?|SCENE\s+[IVXLC\d]+)\b/i;
const TRANSITION =
  /^(?:(?:SMASH |MATCH |JUMP |HARD |QUICK )?CUT TO|DISSOLVE TO|FADE (?:IN|OUT|TO BLACK)|BACK TO|INTERCUT|THE END|END OF (?:SCENE|ACT|EPISODE)|BLACKOUT|LIGHTS (?:UP|DOWN|OUT))\b|\bTO:$/;
// Page furniture in PDFs: page numbers, (MORE), CONTINUED:, revision stars.
const PAGE_NOISE = /^(?:\(?(?:MORE|CONTINUED|CONT['’]?D)\)?:?|CONTINUED:?\s*\(\d+\)|\d+\.?|\*+|page \d+(?: of \d+)?)$/i;
const MARGIN_MARK = /^(?:[A-Z]?\d{1,4}[A-Z]{0,2}\.?|\*+)$/;

/** Reads a File (from an <input type="file">) into a script. */
export async function parseScriptFile(file, { pdfjsSrc = DEFAULT_PDFJS_SRC } = {}) {
  const name = file.name || 'Script';
  const title = name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || 'Script';
  const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  if (extension === 'fdx') return parseFdx(await file.text(), title);
  if (extension === 'pdf' || file.type === 'application/pdf') return parsePdf(await file.arrayBuffer(), { pdfjsSrc, title });
  if (['txt', 'text', 'fountain', 'spmd'].includes(extension) || file.type.startsWith('text/')) {
    return parseText(await file.text(), title);
  }
  if (extension === 'fdr') {
    throw new ScriptError('This is an old Final Draft file (.fdr). Open it in Final Draft and save it as .fdx, or export a PDF.');
  }
  if (['doc', 'docx', 'pages', 'rtf', 'odt'].includes(extension)) {
    throw new ScriptError('Save the script as a PDF first, then add the PDF.');
  }
  throw new ScriptError(`“${name}” isn't a script file this app can read. Use a PDF or a Final Draft (.fdx) file.`);
}

/** Final Draft (.fdx) files are XML with typed paragraphs. */
export function parseFdx(xml, title = 'Script') {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  if (doc.getElementsByTagName('parsererror').length || root?.nodeName !== 'FinalDraft') {
    throw new ScriptError("This Final Draft file couldn't be read. Try exporting it again, or export a PDF.");
  }
  const section = (name) => [...root.children].find((child) => child.nodeName === name);
  const content = section('Content');
  if (!content) throw new ScriptError('This Final Draft file has no script in it.');
  const TYPES = {
    'Scene Heading': 'heading',
    Character: 'character',
    Dialogue: 'dialogue',
    Parenthetical: 'parenthetical',
    Transition: 'transition',
  };
  const textOf = (paragraph) =>
    [...paragraph.childNodes]
      .filter((node) => node.nodeName === 'Text')
      .map((node) => node.textContent)
      .join('');
  const elements = [...content.getElementsByTagName('Paragraph')].map((paragraph) => ({
    type: TYPES[paragraph.getAttribute('Type')] ?? 'action',
    text: textOf(paragraph),
    number: paragraph.getAttribute('Number') || null,
  }));
  const titlePage = section('TitlePage');
  const titleText = titlePage && [...titlePage.getElementsByTagName('Paragraph')].map(textOf).map(tidy).find(Boolean);
  return buildScript(elements, titleText || title, 'fdx');
}

/** PDFs: rebuilds lines from text positions, then uses screenplay indentation. */
export async function parsePdf(data, { pdfjsSrc = DEFAULT_PDFJS_SRC, title = 'Script' } = {}) {
  let pdfjs;
  try {
    pdfjs = await import(/* @vite-ignore */ /* webpackIgnore: true */ pdfjsSrc);
  } catch {
    throw new ScriptError("The PDF reader couldn't be loaded. Check your internet connection and try again.");
  }
  pdfjs.GlobalWorkerOptions.workerSrc ||= pdfjsSrc.replace(/pdf(\.min)?\.mjs(\?.*)?$/, 'pdf.worker$1.mjs$2');
  const task = pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (error) {
    task.destroy();
    if (error?.name === 'PasswordException') throw new ScriptError('This PDF is password-protected. Ask for an unlocked copy.');
    throw new ScriptError("This PDF couldn't be opened. It may be damaged.");
  }
  const lines = [];
  try {
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const { width, height } = page.getViewport({ scale: 1 });
      const { items } = await page.getTextContent();
      lines.push(...pageLines(items, { page: number, width, height }));
    }
  } finally {
    task.destroy(); // also stops the worker
  }
  if (!lines.length) {
    throw new ScriptError('This PDF has no text in it. It may be a scan or a photo, so ask for the original PDF.');
  }
  return buildScript(classifyLines(withIndents(lines)), title, 'pdf');
}

/** Plain text and Fountain: blank lines and capitals mark the structure. */
export function parseText(text, title = 'Script') {
  const source = text.replace(/\r\n?/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\[\[[\s\S]*?\]\]/g, '');
  const rows = source.split('\n');
  // A Fountain title page: "Title: …" lines at the top.
  let scriptTitle = title;
  if (/^title\s*:/i.test(rows[0] ?? '')) {
    scriptTitle = rows[0].replace(/^title\s*:/i, '').replace(/[*_]/g, '').trim() || title;
    while (rows.length && rows[0].trim()) rows.shift();
  }
  const lines = [];
  let gap = true;
  for (const row of rows) {
    const trimmed = row.trim();
    if (!trimmed || /^={3,}$/.test(trimmed)) {
      gap = true;
      continue;
    }
    if (/^(?:#|=(?!=))/.test(trimmed)) continue; // Fountain sections and synopses
    const text = trimmed.replace(/^>\s*|\s*<$/g, '').replace(/(\*{1,3}|_)(\S(?:.*?\S)?)\1/g, '$2');
    lines.push({ text, indent: null, gap });
    gap = false;
  }
  return buildScript(classifyLines(lines), scriptTitle, 'text');
}

/**
 * Sorts lines into script elements. Each line is { text, indent, gap }: indent is
 * the distance from the left margin in ems (null for plain text) and gap means a
 * blank line came before it.
 */
export function classifyLines(input) {
  const lines = input.map((line) => ({ ...line, text: tidy(line.text) })).filter((line) => line.text);
  const indented = (line, min) => line.indent !== null && line.indent !== undefined && line.indent >= min;
  // Screenplay layout: character names sit well right of the dialogue under them.
  const screenplay =
    lines.filter((line, i) => {
      const next = lines[i + 1];
      return indented(line, 8) && cueName(line.text) && next && indented(next, 3) && next.indent < line.indent;
    }).length >= 2;
  const cueCounts = tally(lines.map((line) => cueName(line.text)));
  // Are names written "HAMLET." (common in plays) or "HAMLET" (screenplays) here?
  // A one-off name in the other style is more likely shouted action than a character.
  const recurring = lines.filter((line) => cueCounts.get(cueName(line.text)) >= 2);
  const stageStyle = recurring.filter((line) => endsWithStop(line.text)).length > recurring.length / 2;
  // Plays often put the speaker inline ("HAMLET. To be…"); trust names that recur.
  const inlineCounts = tally(lines.map((line) => inlineCue(line.text)?.name));
  const inlineNames = new Set([...inlineCounts].filter(([, count]) => count >= 2).map(([name]) => name));
  const useInline = !screenplay && [...inlineNames].reduce((sum, name) => sum + inlineCounts.get(name), 0) >= 3;

  const elements = [];
  let speaking = false;
  const add = (line, type, text = line.text) => {
    const last = elements.at(-1);
    if (!line.gap && last?.type === type && (type === 'action' || type === 'dialogue')) last.text += ` ${text}`;
    else elements.push({ type, text });
  };
  lines.forEach((line, i) => {
    const { text } = line;
    const next = lines[i + 1];
    if (isHeading(text)) {
      const { number, heading } = splitSceneNumber(text);
      elements.push({ type: 'heading', text: heading, number });
      speaking = false;
      return;
    }
    if (isAllCaps(text) && TRANSITION.test(text)) {
      elements.push({ type: 'transition', text });
      speaking = false;
      return;
    }
    const name = cueName(text);
    const startsSpeech = next && !next.gap && !cueName(next.text) && !isHeading(next.text);
    const atSceneStart = !elements.length || ['heading', 'transition'].includes(elements.at(-1).type);
    const newSpeaker = line.gap || speaking || atSceneStart; // a name can't appear mid-paragraph
    const trusted = screenplay
      ? indented(line, 8)
      : text.startsWith('@') ||
        cueCounts.get(name) >= 2 ||
        (name?.length > 1 && newSpeaker && endsWithStop(text) === stageStyle);
    if (name && startsSpeech && trusted) {
      elements.push({ type: 'character', text: text.replace(/^@/, '') });
      speaking = true;
      return;
    }
    if (useInline) {
      const inline = inlineCue(text);
      if (inline && (inlineNames.has(inline.name) || (inline.name.length > 1 && newSpeaker))) {
        elements.push({ type: 'character', text: inline.name });
        if (inline.direction) elements.push({ type: 'parenthetical', text: inline.direction });
        elements.push({ type: 'dialogue', text: inline.text });
        speaking = true;
        return;
      }
    }
    if (speaking && !line.gap && (!screenplay || indented(line, 3))) {
      add(line, 'dialogue');
      return;
    }
    speaking = false;
    add(line, 'action');
  });
  return elements;
}

/** Turns typed elements into scenes and a cast list. */
export function buildScript(elements, title, format) {
  const scenes = [];
  let scene = null;
  let speech = null;
  const startScene = (heading = null, number = null) => {
    scene = { number, heading, lines: heading ? [{ kind: 'heading', text: heading }] : [] };
    scenes.push(scene);
    speech = null;
  };
  for (const element of elements) {
    const text = tidy(element.text);
    if (!text) continue;
    if (element.type === 'heading') {
      startScene(text, element.number ?? null);
      continue;
    }
    if (!scene) startScene();
    if (element.type === 'character') {
      speech = { kind: 'dialogue', character: characterName(text), text: '' };
      scene.lines.push(speech);
    } else if ((element.type === 'dialogue' || element.type === 'parenthetical') && speech) {
      speech.text = speech.text ? `${speech.text} ${text}` : text;
    } else {
      speech = null;
      scene.lines.push({ kind: element.type === 'transition' ? 'transition' : 'action', text });
    }
  }
  for (const each of scenes) {
    // Drop empty speeches and rejoin speeches split across pages ("(MORE)" … "(CONT'D)").
    each.lines = each.lines
      .filter((line) => line.kind !== 'dialogue' || line.text)
      .reduce((lines, line) => {
        const previous = lines.at(-1);
        if (line.kind === 'dialogue' && previous?.kind === 'dialogue' && previous.character === line.character) {
          previous.text = `${previous.text} ${line.text}`;
        } else {
          lines.push(line);
        }
        return lines;
      }, []);
  }
  const usable = scenes.filter((each) => each.lines.length);
  usable.forEach((each, index) => {
    each.label = each.heading ? `${each.number ? `${each.number}. ` : ''}${each.heading}` : `Scene ${index + 1}`;
    each.characters = [...new Set(each.lines.filter((line) => line.kind === 'dialogue').map((line) => line.character))];
  });
  const counts = tally(usable.flatMap((each) => each.lines.filter((line) => line.kind === 'dialogue').map((line) => line.character)));
  const characters = [...counts]
    .map(([name, lines]) => ({ name, lines }))
    .sort((a, b) => b.lines - a.lines || a.name.localeCompare(b.name));
  if (!characters.length) {
    throw new ScriptError(
      "We couldn't find any characters' lines in this script. It works best with sides or scripts in standard script layout, exported as PDF or Final Draft.",
    );
  }
  return { title, format, scenes: usable, characters };
}

// ---- PDF layout ----------------------------------------------------------------

function pageLines(items, { page, width, height }) {
  const pieces = items
    // Skip rotated text: diagonal "SAMPLE"/watermark stamps.
    .filter((item) => item.str?.trim() && Math.abs(item.transform[1]) < 0.01 && Math.abs(item.transform[2]) < 0.01)
    .map((item) => ({
      text: item.str,
      x: item.transform[4],
      y: item.transform[5],
      width: item.width,
      size: Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 12,
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const piece of pieces) {
    const row = rows.at(-1);
    if (row && Math.abs(row.y - piece.y) <= piece.size * 0.45) row.pieces.push(piece);
    else rows.push({ y: piece.y, pieces: [piece] });
  }
  const lines = [];
  for (const row of rows) {
    const parts = row.pieces.sort((a, b) => a.x - b.x);
    const size = median(parts.map((part) => part.size));
    const gapAfter = (index) => parts[index + 1].x - (parts[index].x + parts[index].width);
    let number = null;
    // Scene numbers and revision stars sit out in the margins.
    while (parts.length > 1 && MARGIN_MARK.test(parts[0].text.trim()) && gapAfter(0) > size * 2) {
      number ??= parts[0].text.trim().replace(/\.$/, '');
      parts.shift();
    }
    while (parts.length > 1 && MARGIN_MARK.test(parts.at(-1).text.trim()) && gapAfter(parts.length - 2) > size * 2) {
      const mark = parts.pop().text.trim().replace(/\.$/, '');
      if (/\d/.test(mark)) number ??= mark; // shooting scripts repeat the number on the right
    }
    let text = '';
    let end = null;
    for (const part of parts) {
      if (end !== null && part.x - end > size * 0.2 && !/\s$/.test(text) && !/^\s/.test(part.text)) text += ' ';
      text += part.text;
      end = part.x + part.width;
    }
    text = tidy(text);
    const inMargin = row.y > height * 0.93 || row.y < height * 0.06;
    if (!text || PAGE_NOISE.test(text) || (inMargin && text.length <= 60)) continue;
    lines.push({ page, x: parts[0].x, y: row.y, size, text: number && isHeading(text) ? `${number} ${text}` : text, width });
  }
  return lines;
}

// Adds indent (ems from the action margin) and gap (blank line before) to PDF lines.
function withIndents(lines) {
  const buckets = tally(lines.map((line) => Math.round(line.x / 2) * 2));
  const minimum = Math.max(2, lines.length * 0.04);
  const common = [...buckets].filter(([, count]) => count >= minimum).map(([x]) => x);
  const margin = common.length ? Math.min(...common) : Math.min(...lines.map((line) => line.x));
  return lines.map((line, i) => {
    const previous = lines[i - 1];
    const gap = !previous || previous.page !== line.page || previous.y - line.y > line.size * 1.7;
    return { text: line.text, indent: (line.x - margin) / line.size, gap };
  });
}

// ---- Line rules ------------------------------------------------------------------

function isAllCaps(text) {
  return /\p{Lu}/u.test(text) && !/\p{Ll}/u.test(text);
}

function splitSceneNumber(text) {
  let number = null;
  let heading = text.replace(/\s*#([^#]+)#\s*$/, (_, value) => {
    number = value.trim();
    return '';
  });
  heading = heading.replace(/^\.(?=[A-Za-z])/, ''); // Fountain forced heading
  heading = heading.replace(/^([A-Z]?\d+[A-Z]?)\.?\s+(?=\S)/, (_, value) => {
    number ??= value;
    return '';
  });
  if (number) heading = heading.replace(new RegExp(`\\s+${number}\\.?$`), '');
  return { number, heading: heading.trim() };
}

function isHeading(text) {
  if (text.length > 100) return false;
  if (/^\.[A-Za-z]/.test(text)) return true;
  const { heading } = splitSceneNumber(text);
  if (SCREEN_HEADING.test(heading) && isAllCaps(heading.replace(/\(.*?\)/g, ''))) return true;
  if (/^(?:int|ext|est|i\/e|int\.?\/ext)\.\s/i.test(heading)) return true;
  return heading.length < 80 && PLAY_HEADING.test(heading);
}

function cueName(text) {
  if (text.startsWith('@')) return characterName(text.slice(1)) || null; // Fountain forced character
  const name = text
    .replace(/\s*\^$/, '') // Fountain dual dialogue
    .replace(/\s*\([^)]*\)/g, '') // (V.O.), (CONT'D)
    .replace(/[.:]$/, '') // stage-play style "HAMLET." or "HAMLET:"
    .trim();
  if (!name || name.length > 30 || name.split(/\s+/).length > 4) return null;
  if (!isAllCaps(name) || !/^[\p{Lu}\d][\p{Lu}\d .'’&#-]*$/u.test(name)) return null;
  if (isHeading(name) || TRANSITION.test(name)) return null;
  return name.replace(/\s+/g, ' ');
}

function endsWithStop(text) {
  return /[.:]$/.test(text.replace(/\s*\([^)]*\)\s*$/, ''));
}

function inlineCue(text) {
  const match = /^([^:]{1,30}):\s+(.*)$/.exec(text) ?? /^(.{1,30}?)\.\s+(.*)$/.exec(text);
  if (!match || !/\p{Ll}/u.test(match[2])) return null;
  const direction = /\(([^)]*)\)\s*$/.exec(match[1])?.[0] ?? '';
  const name = cueName(match[1].replace(/\s*\([^)]*\)\s*$/, ''));
  return name ? { name, direction, text: match[2].trim() } : null;
}

function characterName(text) {
  return text
    .replace(/\s*\^$/, '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/[.:]$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function tidy(text) {
  return String(text ?? '')
    .replace(/[  -​]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tally(values) {
  const counts = new Map();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 12;
}
