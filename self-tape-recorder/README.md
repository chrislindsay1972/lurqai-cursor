# Self-tape recorder

`<self-tape-recorder>` is a drop-in web component that lets actors record audition self-tapes in the browser. It needs no app, plugin or build step: one JavaScript file works in any web page, including PHP, WordPress, React and Lovable sites.

**What actors get**

- A live camera preview with camera and microphone pickers, a mic level meter, a mirrored preview and framing guides.
- Their **sides** shown over the preview, scrolling automatically while they record. The overlay is never part of the video.
- A 3, 5 or 10-second **countdown** so they can get to their mark. The Space bar starts and stops a take.
- **Scene** and **Slate** takes, with as many retakes as they like. They can play any take back, then **download** it or **submit** it, with an upload progress bar.
- Casting-style filenames such as `Jane_Doe_Ophelia_Hamlet_Take2.mp4` and `Jane_Doe_Ophelia_Hamlet_Slate.mp4`.
- An optional time limit that stops a take automatically.
- Plain-language help when something goes wrong: the camera is blocked or in use by another app, the camera is unplugged mid-take, an in-app browser can't use the camera, or an upload is too large.

## Try it

You need Node 20 or later.

```sh
cd self-tape-recorder
node dev-server.mjs
```

Open <http://127.0.0.1:8080/>, turn the camera on, record a take and press **Submit**. The file is saved in `self-tape-recorder/uploads/`.

## Add it to your portal

1. Copy `self-tape-recorder.js` into your site's static files.
2. Load it and add the element to the audition page:

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

The page must be served over **HTTPS**; `localhost` is fine for testing. Browsers block the camera on plain `http://`.

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

```tsx
// SelfTape.tsx: keep self-tape-recorder.js in the same folder.
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

TypeScript needs to be told about the tag once, for example in `src/self-tape-recorder.d.ts`:

```ts
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'self-tape-recorder': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
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

Both snippets type-check against React 18 and React 19 types.

## Reference

### Attributes

| Attribute | Default | What it does |
| --- | --- | --- |
| `actor-name`, `character`, `project` | – | Build filenames (`Jane_Doe_Ophelia_Hamlet_Take2.mp4`) and are sent with uploads |
| `sides` | – | Text shown over the preview. Also settable as the `sides` property. |
| `max-duration` | none | Time limit in seconds; the take stops automatically |
| `countdown` | `3` | Seconds before recording starts (0–30) |
| `quality` | `1080p` | `1080p` or `720p` |
| `upload-url` | – | Shows **Submit** and POSTs takes here |
| `upload-field` | `video` | Form field name for the file |
| `upload-credentials` | off | Send cookies with cross-origin uploads |
| `mime-type` | automatic | Force a recording format, such as `video/webm` |
| `video-bitrate` | 6 Mbps at 1080p, 4 Mbps at 720p | Video bits per second |
| `autostart` | off | Ask for the camera as soon as the page loads, instead of waiting for a click |
| `theme` | `light` | `light`, `dark`, or `auto` to follow the device setting |

### Properties and methods

- `sides`: the sides text (read and write).
- `uploadHandler`: `async (take, { onProgress }) => result`. See [Custom uploads](#custom-uploads-supabase-s3-signed-urls-api-tokens).
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

### Events

All events bubble and cross shadow DOM boundaries.

| Event | `event.detail` |
| --- | --- |
| `camera-ready` | `{ width, height, mimeType }` |
| `recording-start` | `{ kind, mimeType }` |
| `take-recorded` | `{ take }` |
| `take-submitted` | `{ take, result }` |
| `take-deleted` | `{ id, label }` |
| `recorder-error` | `{ code, message, take? }` |

The `code` in `recorder-error` is one of `permission-denied`, `no-device`, `device-busy`, `unsupported`, `insecure-context`, `device-lost`, `camera-failed`, `record-failed` or `upload-failed`.

### Styling

Restyle the recorder with CSS custom properties: `--str-primary` (buttons), `--str-accent` (the Record button), `--str-bg`, `--str-surface`, `--str-border`, `--str-text`, `--str-muted`, `--str-radius` and `--str-font`. For deeper changes, the parts `container`, `stage`, `toolbar` and `takes` can be targeted with `::part()`.

```css
self-tape-recorder {
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

- **Takes stay in the browser** until they're downloaded or submitted. If an actor tries to leave with unsaved takes, the browser asks them to confirm first.
- **Natural sound:** voice processing (echo cancellation, noise suppression, auto gain) is off by default, so whispers and shouts keep their range. Actors can turn on **Noise reduction** in Settings.
- **In-app browsers** in social and email apps often can't use the camera. The recorder tells actors to open the link in Chrome, Edge, Safari or Firefox.
- **Phones in portrait:** the recorder suggests turning the phone sideways, because casting expects landscape video.

## Tests

```sh
npm install
npx playwright install chromium
npm test
```

The smoke test records real takes from Chromium's fake camera and mic. It covers:
- review, download (checked with `ffprobe` when installed) and upload, including a failed upload and its retry;
- slates, the time limit and the Space shortcut;
- deleting, MP4 and WebM output, and the blocked-camera and unsupported-browser messages.

So far it has only run in Chromium. Safari, iPhone and Firefox have not been tested yet.
