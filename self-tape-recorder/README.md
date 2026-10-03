# Self-tape studio and recorder

Two drop-in web components that let actors make audition self-tapes in the browser, on a phone or a computer. They need no app, plugin or build step: plain JavaScript files that work in any web page, including PHP, WordPress, React and Lovable sites.

- **`<self-tape-studio>`** is the whole flow. Actors add a script, choose their scenes and character, and record while the app reads the other parts. Then they review the take and share it by email.
- **`<self-tape-recorder>`** is just the camera and recorder, for portals that already handle the scripts. The studio uses it inside.

## Try it

You need Node 20 or later.

```sh
cd self-tape-recorder
node dev-server.mjs
```

- The studio: <http://127.0.0.1:8080/studio.html>
- The recorder on its own: <http://127.0.0.1:8080/>

Takes you submit are saved in `self-tape-recorder/uploads/`. Phones only allow the camera on HTTPS pages, so to try it on a phone, put it on an HTTPS site (see [Good to know](#good-to-know)).

## The studio

The studio follows how actors already work with sides from their agent:

1. **Add a script.** Tap **Add a script** and choose the PDF or Final Draft (.fdx) file. On iPhone, save the email attachment to Files first, then pick it from Files. The app splits the script into scenes and characters.
2. **Choose scenes and a character.** Tick the scenes and pick your part. Each other part gets a voice, or "Don't read this part"; tap **Hear** for a sample.
3. **Record.** Tap **Record these scenes**. The scene shows over the camera preview with your lines highlighted. The app reads the other parts aloud, and waits for you to finish each of your lines before giving the next cue. The take stops itself 2.5 seconds after the last line.
4. **Save** the take. It goes to **My Videos**.
5. **Review and share.** In My Videos, play the take back and tap **Share**. On a phone this opens the share sheet, where Mail attaches the video. On a computer it downloads the video and opens an email to attach it to. **Download**, **Submit** (to your portal) and delete are there too.

### Add the studio to your portal

Copy these five files into your site's static files, in the same folder: `self-tape-studio.js`, `self-tape-recorder.js`, `scene-reader.js`, `script-parser.js` and `studio-store.js`.

```html
<script type="module" src="/js/self-tape-studio.js"></script>

<self-tape-studio
  actor-name="Jane Doe"
  storage-key="actor-1234"
  upload-url="/upload.php">
</self-tape-studio>
```

| Attribute | What it does |
| --- | --- |
| `actor-name` | Used in filenames and in the email ("Self-tape – Jane Doe – OPHELIA – Hamlet") |
| `storage-key` | Keeps each signed-in actor's scripts and videos separate on a shared device. Use the actor's ID. |
| `upload-url` | Shows **Submit** in My Videos. It sends the same POST as the recorder ([Receiving uploads](#receiving-uploads)), plus a `scenes` field. |
| `upload-field`, `upload-credentials` | As for the recorder |
| `pdfjs-src` | Where pdf.js is loaded from, the first time a PDF is added. Defaults to jsDelivr. To self-host, point it at your copy of `pdfjs-dist/legacy/build/pdf.min.mjs`, with `pdf.worker.min.mjs` beside it. |
| `max-duration` | Time limit per take, in seconds |
| `theme` | `light` (default), `dark`, or `auto` to follow the device setting |

`addScript(file)` adds a script `File`, for example sides your portal already holds for an audition.

The studio's events bubble out to your page: `script-added`, `script-deleted`, `video-saved`, `video-shared`, `video-submitted`, `video-deleted` and `studio-error`. For `video-shared`, `detail.method` is `share` (share sheet) or `email` (download and email).

### Scripts it can read

- **PDF** files with selectable text, laid out as a screenplay (most sides) or as a play. Page numbers, (MORE) and (CONT'D) page breaks, scene numbers, watermarks and pages printed at a reduced size are all handled. A scanned PDF (a picture of the pages) can't be read, and the app says so.
- **Final Draft** `.fdx` files, from Final Draft 8 onwards. Older `.fdr` files need saving as `.fdx` or exporting as PDF first.
- **Fountain** and **plain text**, including plays written `HAMLET. To be…` or with names on their own lines. Actors can also paste a scene.

Unusual layouts can confuse it. The main known gap is two characters speaking at once, printed side by side in a PDF.

### The reader

- **Voices** are the device's own, so they're free and work offline. Which voices there are depends on the device.
- **Listening:** the app tells when the actor has finished a line from the microphone. It waits for them to start speaking, then for a pause. The pause length is Short (0.7 s), Normal (1.2 s) or Long (2 s), set under **Sides**. Early in a long line, a dramatic pause doesn't count as the end.
- **Skipping ahead:** **Next line** on screen, or a Bluetooth page turner or presentation clicker (Right or Down arrow, Page Down), moves straight to the next cue.
- **In the recording:** the reader's voice comes out of the speaker and is recorded, like a reader in the room. With the phone's volume at about half, it stays quieter than the actor.

### Where scripts and videos are kept

They're kept on the device, in the browser's storage (IndexedDB), until the actor deletes them. Nothing is uploaded unless the actor taps **Submit**. Browsers, and Safari on iPhone especially, can clear storage for sites that haven't been used for a while. The studio asks the browser to keep it, and My Videos tells actors to share or submit the takes they want to keep.

## The recorder on its own

Copy `self-tape-recorder.js` and `scene-reader.js` into your site's static files, in the same folder. Then load the recorder and add the element to the audition page:

```html
<script type="module" src="/js/self-tape-recorder.js"></script>

<self-tape-recorder
  actor-name="Jane Doe"
  character="Ophelia"
  project="Hamlet"
  max-duration="180"
  upload-url="/upload.php">
</self-tape-recorder>

<script type="module">
  // Optional: preload the sides for this audition.
  document.querySelector('self-tape-recorder').sides = 'OPHELIA\nGood my lord, how does your honour for this many a day?';
</script>
```

**What actors get**

- A live camera preview with camera and microphone pickers, a mic level meter, a mirrored preview and framing guides.
- Their **sides** shown over the preview, scrolling automatically while they record. The overlay is never part of the video.
- A 3, 5 or 10-second **countdown** so they can get to their mark. The Space bar starts and stops a take.
- **Scene** and **Slate** takes, with as many retakes as they like. They can play any take back, then **download** it or **submit** it, with an upload progress bar.
- Casting-style filenames such as `Jane_Doe_Ophelia_Hamlet_Take2.mp4` and `Jane_Doe_Ophelia_Hamlet_Slate.mp4`.
- An optional time limit that stops a take automatically.
- Plain-language help when something goes wrong: the camera is blocked or in use by another app, the camera is unplugged mid-take, an in-app browser can't use the camera, or an upload is too large.

### Receiving uploads

With `upload-url` set, **Submit** sends a `multipart/form-data` POST:

| Field | Value |
| --- | --- |
| `video` | The video file. Rename the field with `upload-field`. |
| `filename` | For example `Jane_Doe_Ophelia_Hamlet_Take2.mp4` |
| `kind` | `scene` or `slate` |
| `take` | The take number |
| `durationSeconds` | Length in seconds |
| `mimeType` | For example `video/mp4;codecs=avc1,mp4a.40.2` |
| `actorName`, `character`, `project` | Copied from the attributes |

- **Success:** any 2xx response counts as success. A JSON body is passed to the `take-submitted` event as `result`.
- **Failure:** the actor sees your response's short text, or its JSON `error`/`message` field, next to a **Retry** button.
- **Authentication:** cookies are sent for same-origin uploads, so your normal login protects the endpoint. Add `upload-credentials` if uploads go to a different origin.

A PHP endpoint that saves takes safely:

```php
<?php
// upload.php: receives takes from <self-tape-recorder upload-url="/upload.php">.
// Check the actor is signed in to your portal before accepting anything.
const UPLOAD_DIR = '/var/private/self-tapes'; // keep videos outside the public web root
const ALLOWED = ['video/mp4' => 'mp4', 'video/webm' => 'webm', 'video/quicktime' => 'mov'];

$file = $_FILES['video'] ?? null;
if (!$file || $file['error'] !== UPLOAD_ERR_OK) {
    // Usually the file is bigger than upload_max_filesize or post_max_size in php.ini.
    http_response_code(400);
    exit("The video didn't arrive. It may be too large: try a shorter take, or 720p in Settings.");
}
// Trust the file's contents, not its name: the extension comes from the detected type.
$type = (new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']);
if (!isset(ALLOWED[$type])) {
    http_response_code(415);
    exit('That file is not a video.');
}
$base = preg_replace('/[^A-Za-z0-9_-]+/', '_', pathinfo($_POST['filename'] ?? 'take', PATHINFO_FILENAME));
$name = date('Ymd-His') . '_' . bin2hex(random_bytes(3)) . "_{$base}." . ALLOWED[$type];
if (!move_uploaded_file($file['tmp_name'], UPLOAD_DIR . '/' . $name)) {
    http_response_code(500);
    exit('The video could not be saved. Please try again.');
}
header('Content-Type: application/json');
echo json_encode(['ok' => true, 'savedAs' => $name]);
```

**Allow big uploads.** A 1080p take is up to about 45 MB per minute, and 720p about 30 MB. In PHP, raise `upload_max_filesize` and `post_max_size` (for example to `512M`). On nginx, raise `client_max_body_size`, which defaults to 1 MB.

### Custom uploads (Supabase, S3, signed URLs, API tokens)

Set `uploadHandler` and the recorder calls it instead of posting to `upload-url`. Throw an error to show it to the actor with a **Retry** button. Call `onProgress(0…1)` if your uploader reports progress.

```js
const recorder = document.querySelector('self-tape-recorder');

recorder.uploadHandler = async (take, { onProgress }) => {
  const path = `${auditionId}/${actorId}/${take.filename}`;
  const { error } = await supabase.storage
    .from('self-tapes')
    .upload(path, take.blob, { contentType: take.blob.type });
  if (error) throw error;
  return { path }; // becomes event.detail.result on 'take-submitted'
};
```

### React (Vite, Lovable)

The studio needs no wiring beyond its attributes:

```tsx
// Studio.tsx: keep the five studio files in the same folder.
import './self-tape-studio.js';

export function AuditionStudio({ actor }: { actor: { id: string; name: string } }) {
  return <self-tape-studio actor-name={actor.name} storage-key={actor.id} upload-url="/api/self-tapes" />;
}
```

The recorder with your own upload:

```tsx
// SelfTape.tsx: keep self-tape-recorder.js and scene-reader.js in the same folder.
import { useEffect, useRef } from 'react';
import './self-tape-recorder.js';

export type Take = { filename: string; blob: Blob; kind: 'scene' | 'slate'; durationSeconds: number };
type Recorder = HTMLElement & { uploadHandler: ((take: Take) => Promise<unknown>) | null };

export function SelfTape(props: {
  actorName: string;
  character: string;
  project: string;
  sides?: string;
  upload: (take: Take) => Promise<unknown>;
  onSubmitted?: (take: Take) => void;
}) {
  const ref = useRef<Recorder>(null);
  const { upload, onSubmitted } = props;

  useEffect(() => {
    const recorder = ref.current;
    if (!recorder) return;
    recorder.uploadHandler = upload;
    const handle = (event: Event) => onSubmitted?.((event as CustomEvent<{ take: Take }>).detail.take);
    recorder.addEventListener('take-submitted', handle);
    return () => recorder.removeEventListener('take-submitted', handle);
  }, [upload, onSubmitted]);

  return (
    <self-tape-recorder
      ref={ref}
      actor-name={props.actorName}
      character={props.character}
      project={props.project}
      sides={props.sides}
      max-duration={180}
    />
  );
}
```

TypeScript needs to be told about the tags once, for example in `src/self-tape-recorder.d.ts`:

```ts
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

type HtmlProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'self-tape-studio': HtmlProps & {
        'actor-name'?: string;
        'upload-url'?: string;
        'storage-key'?: string;
        'pdfjs-src'?: string;
        'max-duration'?: number | string;
        theme?: 'light' | 'dark' | 'auto';
      };
      'self-tape-recorder': HtmlProps & {
        'actor-name'?: string;
        character?: string;
        project?: string;
        sides?: string;
        'max-duration'?: number | string;
        countdown?: number | string;
        quality?: '1080p' | '720p';
        'upload-url'?: string;
        theme?: 'light' | 'dark' | 'auto';
      };
    }
  }
}
```

These snippets type-check against React 18 and React 19 types.

## Recorder reference

### Attributes

| Attribute | Default | What it does |
| --- | --- | --- |
| `actor-name`, `character`, `project` | – | Build filenames (`Jane_Doe_Ophelia_Hamlet_Take2.mp4`) and are sent with uploads |
| `sides` | – | Text shown over the preview. Also settable as the `sides` property. |
| `max-duration` | none | Time limit in seconds; the take stops automatically |
| `countdown` | `3` | Seconds before recording starts (0–30) |
| `quality` | `1080p` | `1080p` or `720p` |
| `cue-pause` | `1.2` | In script mode, the seconds of silence that end the actor's line |
| `upload-url` | – | Shows **Submit** and POSTs takes here |
| `upload-field` | `video` | Form field name for the file |
| `upload-credentials` | off | Send cookies with cross-origin uploads |
| `submit-label`, `submitting-label`, `submitted-label` | `Submit`, `Uploading`, `Submitted` | Wording for the Submit button and its status |
| `mime-type` | automatic | Force a recording format, such as `video/webm` |
| `video-bitrate` | 6 Mbps at 1080p, 4 Mbps at 720p | Video bits per second |
| `autostart` | off | Ask for the camera as soon as the page loads, instead of waiting for a click |
| `theme` | `light` | `light`, `dark`, or `auto` to follow the device setting |

### Properties and methods

- `sides`: the sides text (read and write).
- `script`: a scene to perform with the reader (read and write). See [Script mode](#script-mode).
- `uploadHandler`: `async (take, { onProgress }) => result`. See [Custom uploads](#custom-uploads-supabase-s3-signed-urls-api-tokens).
- `readerSpeak`: `async (line, { voice, signal }) => void`, to read lines with your own voices instead of the device's.
- `takes`: all takes, newest first (read-only).
- `state`: one of `off`, `starting`, `ready`, `countdown`, `recording`, `saving` or `error` (read-only).
- `micLevel`: the current microphone level from 0 to 1 (read-only).
- `start()` and `stop()` turn the camera on and off. `record()` and `stopRecording()` start and stop a take.
- `submitTake(id)`, `deleteTake(id)` and `clearTakes()`. `clearTakes()` also restarts numbering at Take 1.

A **take** has these fields:
- `id`, `kind` (`scene` or `slate`), `number`, `label` and `filename`
- `blob` (the video) and `url` (an object URL, revoked when the take is deleted)
- `mimeType`, `durationSeconds`, `sizeBytes` and `createdAt`
- `thumbnail`, a JPEG data URL
- `status`: `new`, `uploading`, `submitted` or `failed`

### Script mode

Set `script` to `{ title, character, lines, voices }` and the recorder shows the scene over the preview, with the actor's lines highlighted. While recording, it reads the other parts and listens for the actor's lines, as described in [The reader](#the-reader).

- `lines`: the scene's lines, as `script-parser.js` produces them (`{ kind, text, character }`, where `kind` is `heading`, `action`, `dialogue` or `transition`).
- `character`: the actor's part.
- `voices` (optional): a `voiceURI` for each other character, or `'skip'` to leave a part unread.

Set `script` to `null` to go back to plain sides.

### Events

All events bubble and cross shadow DOM boundaries.

| Event | `event.detail` |
| --- | --- |
| `camera-ready` | `{ width, height, mimeType }` |
| `recording-start` | `{ kind, mimeType }` |
| `scene-end` | `{ recording }`, when the reader reaches the end of the script |
| `take-recorded` | `{ take }` |
| `take-submitted` | `{ take, result }` |
| `take-deleted` | `{ id, label }` |
| `recorder-error` | `{ code, message, take? }` |

The `code` in `recorder-error` is one of `permission-denied`, `no-device`, `device-busy`, `unsupported`, `insecure-context`, `device-lost`, `camera-failed`, `record-failed` or `upload-failed`.

### Styling

Restyle either component with CSS custom properties: `--str-primary` (buttons), `--str-accent` (the Record button), `--str-bg`, `--str-surface`, `--str-border`, `--str-text`, `--str-muted`, `--str-radius` and `--str-font`. Set them on the studio and they reach the recorder inside it. For deeper changes, the recorder's parts `container`, `stage`, `toolbar` and `takes` can be targeted with `::part()`.

```css
self-tape-studio {
  --str-primary: #7c3aed;
  --str-font: "Inter", sans-serif;
}
```

## Video formats

The recorder uses the most widely playable format the browser can write. In order of preference:
1. H.264/AAC MP4
2. Other MP4
3. WebM

Safari records H.264 MP4. Chrome and Edge record MP4, using H.264 where the system provides an encoder. Firefox usually records WebM. The **Settings** panel shows which format the current browser will use.

If your casting workflow needs H.264 MP4 every time, convert on the server. This command was tested on both MP4 and WebM recordings:

```sh
ffmpeg -i take.webm -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p \
       -c:a aac -b:a 160k -movflags +faststart take.mp4
```

## Good to know

- **HTTPS:** phones only allow the camera on `https://` pages. `localhost` works on a computer for testing.
- **Takes in the recorder** stay in the browser until they're downloaded, submitted or saved. If an actor tries to leave with unsaved takes, the browser asks them to confirm first.
- **Natural sound:** voice processing (echo cancellation, noise suppression, auto gain) is off by default, so whispers and shouts keep their range. Actors can turn on **Noise reduction** in Settings.
- **In-app browsers** in social and email apps often can't use the camera. The recorder tells actors to open the link in Chrome, Edge, Safari or Firefox.
- **Phones in portrait:** the recorder suggests turning the phone sideways, because casting expects landscape video.
- **Large videos by email:** iPhone Mail sends large attachments with Mail Drop. Other email services may refuse attachments over about 20–25 MB, so offer **Submit** to your portal as well.

## Tests

```sh
npm install
npx playwright install chromium
npm test
```

- `test/unit.mjs` runs without a browser. It covers how scripts are read and how the end of an actor's line is detected.
- `test/smoke.mjs` records real takes from Chromium's fake camera. It covers review, download (checked with `ffprobe` when installed), uploads (including a failure and retry), slates, the time limit, the Space shortcut, deleting, MP4 and WebM output, and the error messages.
- `test/studio.mjs` runs the studio on a phone-sized screen. It adds a PDF printed from `test/fixtures/sides.html` at full and reduced size, a Final Draft file and pasted text. It records with a generated "voice" as the microphone, then saves, reloads, plays back, shares, downloads, submits and deletes.

So far these tests have only run in Chromium. They haven't covered Safari on iPhone, Android or Firefox: the camera, the reader's voice during recording, the Files picker and the share sheet. They also haven't used real device voices or real-world PDFs beyond the test file.
