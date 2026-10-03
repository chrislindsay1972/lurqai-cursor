// End-to-end smoke test. Records real takes from Chromium's fake camera and
// mic, then checks review, download, upload, slates, the time limit, the
// Space shortcut, deleting, and the camera error messages.
//
//   npm install && npx playwright install chromium && npm test
//
// Downloaded files are checked with ffprobe when it's installed.
// Set SCREENSHOT_DIR to save screenshots of the UI.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const FAKE_DEVICES = '--use-fake-device-for-media-stream';
const EVENT_TYPES = ['camera-ready', 'recording-start', 'take-recorded', 'take-submitted', 'take-deleted', 'recorder-error'];

function step(name) {
  console.log(`• ${name}`);
}

function startServer(uploadDir) {
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

// Returns stream/format info, or null when ffprobe isn't installed.
function probe(file) {
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=format_name:stream=codec_type,codec_name,width,height', '-of', 'json', file],
    { encoding: 'utf8' },
  );
  if (result.error?.code === 'ENOENT') return null;
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

async function captureEvents(page) {
  await page.evaluate((types) => {
    window.recorderEvents = [];
    const recorder = document.querySelector('self-tape-recorder');
    for (const type of types) {
      recorder.addEventListener(type, ({ detail = {} }) => {
        const take = detail.take && {
          label: detail.take.label,
          kind: detail.take.kind,
          filename: detail.take.filename,
          durationSeconds: detail.take.durationSeconds,
          sizeBytes: detail.take.sizeBytes,
          mimeType: detail.take.mimeType,
        };
        const { take: _take, ...rest } = detail;
        window.recorderEvents.push({ type, ...rest, take });
      });
    }
  }, EVENT_TYPES);
}

async function nthEvent(page, type, n = 1) {
  await page.waitForFunction(
    ([t, count]) => window.recorderEvents.filter((event) => event.type === t).length >= count,
    [type, n],
    { timeout: 15_000 },
  );
  return page.evaluate(([t, count]) => window.recorderEvents.filter((event) => event.type === t)[count - 1], [type, n]);
}

function waitForState(page, state) {
  return page.waitForFunction((s) => document.querySelector('self-tape-recorder').state === s, state, { timeout: 15_000 });
}

const uploadDir = await mkdtemp(join(tmpdir(), 'self-tape-uploads-'));
const downloadDir = await mkdtemp(join(tmpdir(), 'self-tape-downloads-'));
const screenshotDir = process.env.SCREENSHOT_DIR;
if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
const { child: server, url } = await startServer(uploadDir);
// Always stop the server and clean up, even if an assertion fails or we're interrupted.
process.on('exit', () => {
  server.kill();
  rmSync(uploadDir, { recursive: true, force: true });
  rmSync(downloadDir, { recursive: true, force: true });
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(1));
setTimeout(() => {
  console.error('Smoke test timed out after 3 minutes.');
  process.exit(1);
}, 180_000).unref();
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', FAKE_DEVICES] });
const problems = [];

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    // The failed-upload step makes one 405 on purpose.
    if (message.type() === 'error' && !message.text().includes('405 (Method Not Allowed)')) {
      problems.push(`console error: ${message.text()}`);
    }
  });
  await page.goto(url);
  await captureEvents(page);
  const ui = page.locator('self-tape-recorder');

  step('turns the camera and mic on');
  await ui.getByRole('button', { name: 'Turn on camera & mic' }).click();
  await waitForState(page, 'ready');
  const ready = await nthEvent(page, 'camera-ready');
  console.log(`  camera ${JSON.stringify(ready)}`);
  await page.waitForFunction(() => document.querySelector('self-tape-recorder').micLevel > 0.05, null, { timeout: 10_000 });
  await ui.getByRole('button', { name: 'Settings' }).click();
  const devices = await ui.evaluate(({ shadowRoot: shadow }) => ({
    cameras: shadow.querySelector('[data-el="cameraSelect"]').options.length,
    mics: shadow.querySelector('[data-el="micSelect"]').options.length,
    info: shadow.querySelector('[data-el="formatInfo"]').textContent,
  }));
  assert.ok(devices.cameras >= 1 && devices.mics >= 1, `device lists: ${JSON.stringify(devices)}`);
  console.log(`  ${devices.info}`);
  await ui.evaluate(({ shadowRoot: shadow }) => {
    shadow.querySelector('[data-el="guidesCheck"]').click();
  });
  if (screenshotDir) await ui.screenshot({ path: join(screenshotDir, '1-ready.png') });

  step('records a scene take after a 1-second countdown, with the sides scrolling');
  await ui.evaluate((recorder) => recorder.setAttribute('countdown', '1'));
  await ui.getByRole('button', { name: 'Record scene', exact: true }).click();
  await waitForState(page, 'countdown');
  await waitForState(page, 'recording');
  await page.waitForTimeout(3_000);
  const scrolled = await ui.evaluate(({ shadowRoot: shadow }) => shadow.querySelector('[data-el="prompter"]').scrollTop);
  assert.ok(scrolled > 20, `sides should auto-scroll while recording (scrollTop ${scrolled})`);
  if (screenshotDir) await ui.screenshot({ path: join(screenshotDir, '2-recording.png') });
  await ui.getByRole('button', { name: 'Stop recording' }).click();
  const take1 = (await nthEvent(page, 'take-recorded')).take;
  console.log(`  ${JSON.stringify(take1)}`);
  assert.match(take1.filename, /^Jane_Doe_Hamlet_Spring_Showcase_Take1\.(mp4|webm)$/);
  assert.ok(take1.durationSeconds >= 2.5 && take1.durationSeconds <= 4, `duration ${take1.durationSeconds}`);
  assert.ok(take1.sizeBytes > 50_000, `size ${take1.sizeBytes}`);

  step('plays the take back with a real duration');
  await ui.getByRole('button', { name: 'Play Take 1' }).first().click();
  await page.waitForFunction(() => {
    const video = document.querySelector('self-tape-recorder').shadowRoot.querySelector('.playback');
    return Number.isFinite(video.duration) && video.duration > 2 && video.currentTime > 0.3;
  }, null, { timeout: 15_000 });
  await ui.getByRole('button', { name: 'Back to camera' }).click();

  step('downloads a playable video file');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    ui.getByRole('link', { name: 'Download Take 1' }).click(),
  ]);
  assert.equal(download.suggestedFilename(), take1.filename);
  const downloaded = join(downloadDir, download.suggestedFilename());
  await download.saveAs(downloaded);
  assert.equal((await stat(downloaded)).size, take1.sizeBytes);
  const info = probe(downloaded);
  if (info) {
    console.log(`  ffprobe: ${info.format.format_name}; ${info.streams.map((s) => `${s.codec_type}=${s.codec_name}${s.width ? ` ${s.width}x${s.height}` : ''}`).join(', ')}`);
    assert.ok(info.streams.some((s) => s.codec_type === 'video'), 'file has a video stream');
    assert.ok(info.streams.some((s) => s.codec_type === 'audio'), 'file has an audio stream');
  }

  step('submits the take to upload-url');
  await ui.getByRole('button', { name: 'Submit Take 1' }).click();
  const submitted = await nthEvent(page, 'take-submitted');
  assert.equal(submitted.result?.ok, true, JSON.stringify(submitted.result));
  const saved = await readdir(uploadDir);
  assert.equal(saved.length, 1);
  assert.ok(saved[0].endsWith(take1.filename), saved[0]);
  assert.equal((await stat(join(uploadDir, saved[0]))).size, take1.sizeBytes);
  await ui.getByText('Submitted ✓').waitFor();

  step('records a slate that stops itself at the time limit');
  await ui.evaluate((recorder) => {
    recorder.setAttribute('countdown', '0');
    recorder.setAttribute('max-duration', '2');
  });
  await ui.getByRole('button', { name: 'Slate', exact: true }).click();
  await ui.getByRole('button', { name: 'Record slate', exact: true }).click();
  const slate = (await nthEvent(page, 'take-recorded', 2)).take;
  assert.equal(slate.kind, 'slate');
  assert.match(slate.filename, /^Jane_Doe_Hamlet_Spring_Showcase_Slate\.(mp4|webm)$/);
  assert.ok(slate.durationSeconds >= 1.9 && slate.durationSeconds <= 2.6, `slate duration ${slate.durationSeconds}`);
  await ui.getByText('Time limit reached').waitFor();

  step("shows the server's reason when an upload fails, then retries");
  await ui.evaluate((recorder) => recorder.setAttribute('upload-url', '/not-an-upload-endpoint'));
  await ui.getByRole('button', { name: 'Submit Slate', exact: true }).click();
  const failed = await nthEvent(page, 'recorder-error');
  assert.equal(failed.code, 'upload-failed');
  assert.equal(failed.message, 'Method not allowed'); // the dev server's JSON { error }
  await ui.getByText('Method not allowed').waitFor();
  await ui.evaluate((recorder) => recorder.setAttribute('upload-url', '/upload'));
  await ui.getByRole('button', { name: 'Retry Slate', exact: true }).click();
  await nthEvent(page, 'take-submitted', 2);
  assert.equal((await readdir(uploadDir)).length, 2);

  step('Space starts and stops a take');
  await ui.evaluate((recorder) => recorder.removeAttribute('max-duration'));
  await ui.getByRole('button', { name: 'Scene', exact: true }).click();
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Space');
  await waitForState(page, 'recording');
  await page.waitForTimeout(1_500);
  await page.keyboard.press('Space');
  const take2 = (await nthEvent(page, 'take-recorded', 3)).take;
  assert.equal(take2.label, 'Take 2');

  step('needs a second click to delete a take');
  await ui.getByRole('button', { name: 'Delete Take 2', exact: true }).click();
  assert.equal(await ui.evaluate((recorder) => recorder.takes.length), 3);
  await ui.getByRole('button', { name: 'Confirm delete Take 2', exact: true }).click();
  await nthEvent(page, 'take-deleted');
  assert.deepEqual(await ui.evaluate((recorder) => recorder.takes.map((take) => take.label)), ['Slate', 'Take 1']);
  if (screenshotDir) await ui.screenshot({ path: join(screenshotDir, '3-takes.png') });

  step('records WebM (what Firefox produces) and plays it back with a real duration');
  await ui.evaluate((recorder) => recorder.setAttribute('mime-type', 'video/webm;codecs=vp9,opus'));
  await ui.getByRole('button', { name: 'Record scene', exact: true }).click();
  await waitForState(page, 'recording');
  await page.waitForTimeout(2_000);
  await ui.getByRole('button', { name: 'Stop recording' }).click();
  const webmTake = (await nthEvent(page, 'take-recorded', 4)).take;
  assert.match(webmTake.filename, /^Jane_Doe_Hamlet_Spring_Showcase_Take3\.webm$/);
  assert.match(webmTake.mimeType, /^video\/webm/);
  await ui.getByRole('button', { name: 'Play Take 3' }).click();
  await page.waitForFunction(() => {
    const video = document.querySelector('self-tape-recorder').shadowRoot.querySelector('.playback');
    return Number.isFinite(video.duration) && video.duration > 1.5 && video.currentTime > 0.3;
  }, null, { timeout: 15_000 });
  if (screenshotDir) await ui.screenshot({ path: join(screenshotDir, '4-review.png') });
  await ui.getByRole('button', { name: 'Back to camera' }).click();
  await ui.evaluate((recorder) => recorder.removeAttribute('mime-type'));

  step('turning the camera off releases it');
  await ui.evaluate((recorder) => recorder.stop());
  await waitForState(page, 'off');
  assert.equal(await ui.evaluate(({ shadowRoot: shadow }) => shadow.querySelector('.preview').srcObject), null);

  assert.deepEqual(problems, [], 'no page or console errors');
} finally {
  await browser.close();
}

// '--use-fake-ui-for-media-stream=deny' acts like clicking "Block" on the
// permission prompt. Without any fake-UI flag, headless Chromium has no prompt
// and reports NotSupportedError, like the built-in browsers of some apps.
const cameraFailures = [
  { name: 'camera access is blocked', flag: '--use-fake-ui-for-media-stream=deny', code: 'permission-denied', text: 'access was blocked' },
  { name: "the browser can't show a camera prompt", flag: null, code: 'unsupported', text: 'open it in Chrome' },
];
try {
  for (const failure of cameraFailures) {
    step(`explains what to do when ${failure.name}`);
    const failingBrowser = await chromium.launch({ args: [FAKE_DEVICES, failure.flag].filter(Boolean) });
    try {
      const page = await failingBrowser.newPage();
      await page.goto(url);
      await captureEvents(page);
      const ui = page.locator('self-tape-recorder');
      await ui.getByRole('button', { name: 'Turn on camera & mic' }).click();
      const error = await nthEvent(page, 'recorder-error');
      assert.equal(error.code, failure.code, JSON.stringify(error));
      await ui.getByRole('alert').getByText(failure.text).waitFor();
      await ui.getByRole('button', { name: 'Try again' }).waitFor();
    } finally {
      await failingBrowser.close();
    }
  }
} finally {
  server.kill();
}

console.log('All smoke tests passed.');
