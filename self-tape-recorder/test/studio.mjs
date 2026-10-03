// End-to-end test of the studio flow on a phone-sized screen:
//   add a script (PDF, Final Draft, pasted text) → choose scenes and a character
//   → record while the app reads the other parts → save → My Videos → reload
//   → play → share by email → download → submit → delete.
//
//   npm install && npx playwright install chromium && node test/studio.mjs
//
// The microphone is a generated WAV (1.5 s of "speech", then silence) so the
// app can hear the actor finish lines. Set SCREENSHOT_DIR to save screenshots.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'self-tape-studio-'));
const uploadDir = join(work, 'uploads');
const screenshotDir = process.env.SCREENSHOT_DIR;
if (screenshotDir) mkdirSync(screenshotDir, { recursive: true });
const PDFJS = '/node_modules/pdfjs-dist/legacy/build/pdf.min.mjs';

function step(name) {
  console.log(`• ${name}`);
}

// A mono 16-bit WAV that loops: 0.6 s silence, 1.5 s tone, 2 s silence.
function writeSpeechWav(path, sampleRate = 48_000) {
  const pattern = [[0.6, 0], [1.5, 0.25], [2.0, 0]];
  const period = pattern.reduce((sum, [duration]) => sum + duration, 0);
  const count = Math.round(period * sampleRate);
  const wav = Buffer.alloc(44 + count * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + count * 2, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) {
    let at = i / sampleRate;
    let level = 0;
    for (const [duration, amplitude] of pattern) {
      if (at < duration) {
        level = amplitude;
        break;
      }
      at -= duration;
    }
    wav.writeInt16LE(Math.round(level * Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 32767), 44 + i * 2);
  }
  writeFileSync(path, wav);
}

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['dev-server.mjs'], {
      cwd: root,
      env: { ...process.env, PORT: '0', UPLOAD_DIR: uploadDir },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`dev server exited with code ${code}`)));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (text) => {
      const url = text.match(/http:\/\/\S+/)?.[0];
      if (url) resolve({ child, url });
    });
  });
}

const wav = join(work, 'actor.wav');
writeSpeechWav(wav);
const { child: server, url } = await startServer();
process.on('exit', () => {
  server.kill();
  rmSync(work, { recursive: true, force: true });
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(1));
setTimeout(() => {
  console.error('Studio test timed out after 4 minutes.');
  process.exit(1);
}, 240_000).unref();

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`],
});
const problems = [];

try {
  step('prints the sides to PDF, at full size and shrunk to 80%');
  const printer = await browser.newPage();
  await printer.goto(`${url}test/fixtures/sides.html`);
  const pdfOptions = {
    format: 'Letter',
    margin: { top: '1in', bottom: '1in', left: '0.75in', right: '0.5in' },
    displayHeaderFooter: true,
    headerTemplate: '<div style="width:100%;font:12pt Courier;text-align:right;padding-right:1in"><span class="pageNumber"></span>.</div>',
    footerTemplate: '<div></div>',
  };
  const sidesPdf = await printer.pdf(pdfOptions);
  const smallPdf = await printer.pdf({ ...pdfOptions, scale: 0.8 });
  await printer.close();

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    acceptDownloads: true,
  });
  // Stand-in for the phone's share sheet: records what would be shared.
  await context.addInitScript(() => {
    window.shared = [];
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: (data) => Boolean(data?.files?.length) });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async ({ files, title, text }) => {
        window.shared.push({ title, text, files: files.map((file) => ({ name: file.name, type: file.type, size: file.size })) });
      },
    });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    // Headless Chromium has no mail app for the email fallback's mailto: link.
    if (message.type() === 'error' && !message.text().includes('mailto:')) problems.push(`console error: ${message.text()}`);
  });
  await page.goto(`${url}studio.html`);
  const studio = page.locator('self-tape-studio');
  const recorder = studio.locator('self-tape-recorder');
  await studio.evaluate((element, src) => element.setAttribute('pdfjs-src', src), PDFJS);
  const notice = studio.locator('[data-el="notice"]');
  const noOverflow = async (where) => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(overflow, 0, `${where}: page scrolls sideways by ${overflow}px`);
  };

  step('steps 3–4: adds the PDF sides from the phone’s files');
  const fileInput = studio.locator('input[type="file"]');
  await fileInput.setInputFiles({ name: 'Hamlet_sides.pdf', mimeType: 'application/pdf', buffer: sidesPdf });
  await studio.getByRole('heading', { name: 'Hamlet sides' }).waitFor();
  await notice.getByText('Added “Hamlet sides”: 2 scenes, 4 characters.').waitFor();
  const scenes = studio.locator('[data-el="sceneList"] label');
  assert.deepEqual(await scenes.locator('strong').allTextContents(), ['12. INT. CASTLE BATTLEMENTS - NIGHT', '13. INT. CASTLE - GREAT HALL - DAY']);
  assert.deepEqual(await scenes.locator('input').evaluateAll((inputs) => inputs.map((input) => input.checked)), [true, true]);
  const characters = studio.locator('[data-el="characterList"] label');
  assert.deepEqual(await characters.locator('strong').allTextContents(), ['HAMLET', 'GHOST', 'CLAUDIUS', 'GERTRUDE']);
  assert.ok(await characters.first().locator('input').isChecked(), 'the part with the most lines is chosen');
  await noOverflow('script detail');
  if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'studio-1-scenes.png'), fullPage: true });

  step('step 5: chooses scene 13 only, playing HAMLET');
  await scenes.nth(0).click(); // untick scene 12
  assert.deepEqual(await characters.locator('strong').allTextContents(), ['CLAUDIUS', 'GERTRUDE', 'HAMLET']);
  await characters.filter({ hasText: 'HAMLET' }).click();
  assert.deepEqual(await studio.locator('.voice-row .who').allTextContents(), ['CLAUDIUS', 'GERTRUDE']);
  await studio.getByRole('button', { name: 'Record these scenes' }).click();
  await studio.getByText("Hamlet sides · 13. INT. CASTLE - GREAT HALL - DAY · You're HAMLET").waitFor();

  step('step 6: records; the app reads CLAUDIUS and GERTRUDE and hears HAMLET’s line');
  await recorder.evaluate((element) => {
    window.spoken = [];
    element.setAttribute('countdown', '0');
    element.readerSpeak = async (line) => {
      window.spoken.push(`${line.character}: ${line.text}`);
      await new Promise((resolve) => setTimeout(resolve, 300));
    };
  });
  await recorder.getByRole('button', { name: 'Turn on camera & mic' }).click();
  await page.waitForFunction(() => document.querySelector('self-tape-studio').shadowRoot.querySelector('self-tape-recorder').state === 'ready');
  await recorder.getByRole('button', { name: 'Record scene', exact: true }).click();
  await page.waitForFunction(() => window.spoken.length === 1, null, { timeout: 5000 });
  // After CLAUDIUS, the actor's own line is highlighted while the app listens.
  await recorder.locator('.sl.current.mine').getByText('A little more than kin').waitFor({ timeout: 5000 });
  await page.waitForTimeout(400); // let the lines finish scrolling
  if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'studio-2-recording.png') });
  // The take stops by itself 2.5 s after the last line.
  await recorder.getByRole('button', { name: 'Save Take 1', exact: true }).waitFor({ timeout: 20_000 });
  assert.deepEqual(await page.evaluate(() => window.spoken), [
    'CLAUDIUS: But now, my cousin Hamlet, and my son —',
    'GERTRUDE: Good Hamlet, cast thy nighted colour off.',
  ]);

  step('step 7: saves the take to My Videos');
  await recorder.getByRole('button', { name: 'Save Take 1', exact: true }).click();
  await recorder.getByText('Saved to My Videos ✓').waitFor();
  await studio.locator('[data-el="videoCount"]').getByText('1').waitFor();

  step('adds the Final Draft script and plays GHOST, cueing by page turner and the Next line button');
  await studio.getByRole('tab', { name: /My Scripts/ }).click();
  assert.equal(await recorder.evaluate((element) => element.state), 'off', 'leaving Record turns the camera off');
  await studio.getByRole('button', { name: /My Scripts/ }).click();
  await fileInput.setInputFiles({ name: 'battlements.fdx', mimeType: 'application/xml', buffer: readFileSync(join(root, 'test/fixtures/battlements.fdx')) });
  await studio.getByRole('heading', { name: 'THE BATTLEMENTS' }).waitFor();
  await scenes.nth(1).click(); // untick scene 2, keep scene 1
  await characters.filter({ hasText: 'GHOST' }).click();
  assert.deepEqual(await studio.locator('.voice-row .who').allTextContents(), ['HAMLET', 'HORATIO', 'MARCELLUS']);
  await studio.getByRole('combobox', { name: 'Voice for MARCELLUS' }).selectOption('skip');
  await studio.getByRole('button', { name: 'Record these scenes' }).click();
  await recorder.evaluate((element) => {
    window.spoken = [];
  });
  await recorder.getByRole('button', { name: 'Turn on camera & mic' }).click();
  await page.waitForFunction(() => document.querySelector('self-tape-studio').shadowRoot.querySelector('self-tape-recorder').state === 'ready');
  await recorder.getByRole('button', { name: 'Record scene', exact: true }).click();
  const currentLine = recorder.locator('.sl.current');
  await currentLine.getByText('Mark me.').waitFor({ timeout: 5000 });
  await page.keyboard.press('PageDown'); // a Bluetooth page turner
  await currentLine.getByText('My hour is almost come').waitFor({ timeout: 5000 });
  await recorder.getByRole('button', { name: 'Next line' }).click();
  await recorder.getByRole('button', { name: 'Save Take 2', exact: true }).waitFor({ timeout: 20_000 });
  assert.deepEqual(await page.evaluate(() => window.spoken), [
    'HAMLET: (whispering) Angels and ministers of grace defend us!',
    'HAMLET: I will.',
    'HORATIO: My lord, my lord!',
  ]); // MARCELLUS was set to "Don't read this part"
  await recorder.getByRole('button', { name: 'Save Take 2', exact: true }).click();
  await recorder.getByText('Saved to My Videos ✓').first().waitFor();

  step('handles a scaled-down PDF, pasted text and an unsupported file');
  await studio.getByRole('tab', { name: /My Scripts/ }).click();
  await studio.getByRole('button', { name: /My Scripts/ }).click();
  await fileInput.setInputFiles({ name: 'Hamlet_small.pdf', mimeType: 'application/pdf', buffer: smallPdf });
  await studio.getByRole('heading', { name: 'Hamlet small' }).waitFor();
  assert.deepEqual(await characters.locator('strong').allTextContents(), ['HAMLET', 'GHOST', 'CLAUDIUS', 'GERTRUDE']);
  await studio.getByRole('button', { name: /My Scripts/ }).click();
  await studio.getByText('Or paste the text of a scene').click();
  await studio.getByRole('textbox', { name: 'Scene text' }).fill('ANNA\nDid you hear that?\n\nBEN\nHear what?');
  await studio.getByRole('button', { name: 'Add this scene' }).click();
  await studio.getByRole('heading', { name: 'Pasted scene' }).waitFor();
  assert.deepEqual(await characters.locator('strong').allTextContents(), ['ANNA', 'BEN']);
  await studio.getByRole('button', { name: /My Scripts/ }).click();
  await fileInput.setInputFiles({ name: 'sides.docx', mimeType: 'application/octet-stream', buffer: Buffer.from('not a script') });
  await notice.getByText('Save the script as a PDF first, then add the PDF.').waitFor();
  const scriptCards = studio.locator('[data-el="scriptList"] .card-title');
  assert.deepEqual(await scriptCards.allTextContents(), ['Pasted scene', 'Hamlet small', 'THE BATTLEMENTS', 'Hamlet sides']);
  for (const title of ['Pasted scene', 'Hamlet small']) {
    await studio.getByRole('button', { name: `Delete ${title}` }).click();
    await studio.getByRole('button', { name: `Confirm: Delete ${title}` }).click();
  }
  await page.waitForFunction(() => document.querySelector('self-tape-studio').shadowRoot.querySelectorAll('[data-el="scriptList"] li').length === 2);

  step('step 8: My Videos survives a reload and plays back');
  await page.reload();
  await studio.evaluate((element, src) => element.setAttribute('pdfjs-src', src), PDFJS);
  await studio.getByRole('tab', { name: /My Videos/ }).click();
  const videos = studio.locator('[data-el="videoList"] .card-title');
  await videos.first().waitFor();
  assert.deepEqual(await videos.allTextContents(), ['GHOST · Take 2', 'HAMLET · Take 1']);
  await noOverflow('My Videos');
  await studio.getByRole('button', { name: 'Play HAMLET · Take 1' }).click();
  await page.waitForFunction(() => {
    const video = document.querySelector('self-tape-studio').shadowRoot.querySelector('[data-el="playerVideo"]');
    return Number.isFinite(video.duration) && video.duration > 3 && video.currentTime > 0.3;
  }, null, { timeout: 15_000 });
  if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'studio-3-videos.png'), fullPage: true });
  await studio.getByRole('button', { name: 'Close' }).click();
  await studio.getByRole('tab', { name: 'Record' }).click();
  await studio.getByText("THE BATTLEMENTS · 1. INT. CASTLE BATTLEMENTS - NIGHT · You're GHOST").waitFor();
  await studio.getByRole('tab', { name: /My Videos/ }).click();

  step('step 9: shares the audition by email from My Videos');
  await studio.getByRole('button', { name: 'Share HAMLET · Take 1' }).click();
  await page.waitForFunction(() => window.shared.length === 1);
  const [shared] = await page.evaluate(() => window.shared);
  assert.equal(shared.title, 'Self-tape – Jane Doe – HAMLET – Hamlet sides');
  assert.match(shared.text, /Here is my self-tape for HAMLET in Hamlet sides\.[\s\S]*Jane Doe$/);
  assert.equal(shared.files.length, 1);
  assert.match(shared.files[0].name, /^Jane_Doe_HAMLET_Hamlet_sides_Take1\.(mp4|webm)$/);
  assert.match(shared.files[0].type, /^video\//);
  assert.ok(shared.files[0].size > 50_000);

  step('without a share sheet, downloads the video and opens an email');
  await page.evaluate(() => Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined }));
  const [fallbackDownload] = await Promise.all([
    page.waitForEvent('download'),
    studio.getByRole('button', { name: 'Share GHOST · Take 2' }).click(),
  ]);
  assert.match(fallbackDownload.suggestedFilename(), /^Jane_Doe_GHOST_THE_BATTLEMENTS_Take2\.(mp4|webm)$/);
  await notice.getByText('has been downloaded. Attach it to the email that opened.').waitFor();

  step('downloads, submits to the portal, and deletes');
  const [download] = await Promise.all([page.waitForEvent('download'), studio.getByRole('button', { name: 'Download HAMLET · Take 1' }).click()]);
  const saved = join(work, download.suggestedFilename());
  await download.saveAs(saved);
  assert.equal(statSync(saved).size, shared.files[0].size);
  await studio.getByRole('button', { name: 'Submit HAMLET · Take 1' }).click();
  await studio.locator('[data-el="videoList"] li').filter({ hasText: 'HAMLET · Take 1' }).getByText('Submitted ✓').waitFor();
  const uploads = readdirSync(uploadDir);
  assert.equal(uploads.length, 1);
  assert.equal(statSync(join(uploadDir, uploads[0])).size, shared.files[0].size);
  await studio.getByRole('button', { name: 'Delete GHOST · Take 2' }).click();
  await studio.getByRole('button', { name: 'Confirm: Delete GHOST · Take 2' }).click();
  await page.waitForFunction(() => document.querySelector('self-tape-studio').shadowRoot.querySelectorAll('[data-el="videoList"] li').length === 1);
  await page.reload();
  await studio.getByRole('tab', { name: /My Videos/ }).click();
  await studio.locator('[data-el="videoList"] li').first().getByText('Submitted ✓').waitFor();
  assert.equal(await studio.locator('[data-el="videoList"] li').count(), 1);

  assert.deepEqual(problems, [], 'no page or console errors');
} finally {
  await browser.close();
  server.kill();
}
console.log('Studio test passed.');
