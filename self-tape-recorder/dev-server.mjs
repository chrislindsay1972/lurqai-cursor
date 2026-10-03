#!/usr/bin/env node
// Local server for trying the recorder: serves this folder and saves
// submitted takes to ./uploads (or $UPLOAD_DIR). Needs Node 20+.
//
//   node dev-server.mjs              -> http://127.0.0.1:8080
//   PORT=3000 node dev-server.mjs
//
// Browsers only allow camera access on https:// or localhost, so open the
// demo on this machine. It is a development aid, not a production server.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const uploadDir = resolve(process.env.UPLOAD_DIR || join(root, 'uploads'));
const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST || '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Accepts the multipart POST that <self-tape-recorder upload-url="/upload"> sends.
async function saveUpload(req, res) {
  const request = new Request('http://localhost/upload', {
    method: 'POST',
    headers: { 'content-type': req.headers['content-type'] ?? '' },
    body: Readable.toWeb(req),
    duplex: 'half',
  });
  const form = await request.formData();
  const file = form.get('video');
  if (!(file instanceof File) || file.size === 0) {
    sendJson(res, 400, { ok: false, error: 'Expected a video file in the "video" field.' });
    return;
  }
  const original = String(form.get('filename') || file.name || 'take.mp4');
  const name = `${Date.now()}_${original.replace(/[^\w.-]+/g, '_')}`;
  await mkdir(uploadDir, { recursive: true });
  await writeFile(join(uploadDir, name), Buffer.from(await file.arrayBuffer()));
  console.log(`Saved ${join(uploadDir, name)} (${file.size} bytes)`);
  sendJson(res, 200, { ok: true, savedAs: name, bytes: file.size });
}

async function serveFile(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');
  const relative = decodeURIComponent(pathname).replace(/\/$/, '/index.html');
  const file = resolve(root, `.${relative}`);
  if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) {
    sendJson(res, 403, { ok: false, error: 'Forbidden' });
    return;
  }
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) {
    sendJson(res, 404, { ok: false, error: 'Not found' });
    return;
  }
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': 'no-store',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/upload') await saveUpload(req, res);
    else if (req.method === 'GET' || req.method === 'HEAD') await serveFile(req, res);
    else sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: error.message });
    else res.end();
  }
});

server.listen(port, host, () => {
  console.log(`Self-tape recorder demo: http://${host}:${server.address().port}/`);
});
