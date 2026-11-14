# LiveCaps

A web app that watches the camera, detects people and animals, and (in later stages)
recognizes them by name and saves "moments".

**Current state: Stages 1, 4, 5 and 6.**
You can see people drawn as pose, hand and face landmarks and animals as boxes labelled
`Dog`, `Cat`, `Bird`, etc., enroll people by face and pets by photo, and see confirmed
names on the live camera (`Barack (Human)`, `Bruno (Cat)`). Capture, the gallery,
geocoding and cloud backup are still to come —
the navigation keeps their placeholders so the roadmap stays visible.

---

## 1. Requirements

- Node.js **20 or newer** (tested with Node 22.19.0)
- npm 10+
- A browser with WebAssembly + camera support (Chrome, Edge, Safari 16+, Firefox)
- A camera (built-in or USB)

## 2. Install and run

```bash
cd moments
npm install
npm run dev
```

Open the URL it prints, normally **http://localhost:5173**.

`localhost` counts as a secure context, so the camera works there without HTTPS.

The first time you open the Live page, the browser downloads the detection model
(~7 MB), the three landmark models (pose, hand and face, ~18 MB total) and the
MediaPipe WASM engine from their CDNs. After that they are cached.

Enrolling a face additionally downloads Human's face models (~7.5 MB, one time).
Enrolling a pet downloads the MobileNetV3 embedder (~4 MB, one time). Both are cached
by the browser afterwards.

## 3. Testing on a phone (camera needs HTTPS)

Browsers only allow `getUserMedia` on **HTTPS** or **localhost**. Opening
`http://192.168.x.x:5173` from your phone will *not* give camera access.

### Option A — self-signed HTTPS (fastest, same Wi-Fi)

```bash
npm run dev:https
```

Then open the `https://192.168.x.x:5173` address printed in the terminal.
Your phone shows a certificate warning once — choose *Advanced → Proceed*.
This is expected with a self-signed certificate.

### Option B — a tunnel (works on any network)

```bash
npm run dev
# in a second terminal:
cloudflared tunnel --url http://localhost:5173
# or: ngrok http 5173
```

Open the public `https://…` URL the tunnel prints. The tunnel terminates TLS for you.

> Tip: on a phone, keep the phone and computer on the same Wi-Fi for Option A.

## 4. Project structure

```
moments/
├─ .env.example              every setting, with defaults documented
├─ index.html                theme boot script (no flash of wrong colours)
├─ src/
│  ├─ config/env.ts          typed, validated settings + defaults
│  ├─ db/
│  │  ├─ schema.ts           Dexie database: subjects + embeddings (+ reserved tables)
│  │  └─ subjects.ts         create / rename / delete-cascade queries
│  ├─ ml/
│  │  ├─ objectDetector.ts   MediaPipe ObjectDetector wrapper (loads once)
│  │  ├─ landmarkers.ts      pose + hand + face landmarkers (loads once)
│  │  ├─ faceService.ts      Human face detection + 1024-float descriptors
│  │  ├─ petService.ts       MediaPipe ImageEmbedder for pet vectors
│  │  ├─ imageUtils.ts       photo decode, downscale, crop from the video frame
│  │  ├─ tracker.ts          IoU tracker with a 1.5 s TTL
│  │  ├─ recognizer.ts       cosine similarity, best-of-descriptors, 3-vote rule
│  │  ├─ labels.ts           COCO class -> "Human" / "Dog" / ... filter
│  │  └─ types.ts            shared detection/overlay types
│  ├─ hooks/
│  │  ├─ useCamera.ts        device picker, compatibility mode, stream info
│  │  ├─ useGreenFrame.ts    detects a flat green virtual-camera frame
│  │  ├─ useDetectionLoop.ts throttled inference + measured FPS
│  │  ├─ useLandmarkLoop.ts  throttled pose/hand/face inference + grace hold
│  │  ├─ useEmbeddingGallery.ts  loads every descriptor into memory
│  │  ├─ useLiveRecognition.ts   tracker + async recognition + voting
│  │  └─ useApplyTheme.ts    keeps the `dark` class in sync
│  ├─ components/
│  │  ├─ CanvasOverlay.tsx   landmarks for people, boxes for animals, labels
│  │  ├─ SubjectForm.tsx     person/pet enrollment with per-photo validation
│  │  ├─ ConsentScreen.tsx   privacy notice shown before the first enrollment
│  │  ├─ DebugPanel.tsx      live best/runner-up scores, votes, notes
│  │  ├─ NavBar.tsx          navigation + theme switch
│  │  ├─ Pill.tsx            status badges
│  │  └─ PageShell.tsx       layout for not-yet-built pages
│  ├─ pages/                 Live, Gallery, PeoplePets, EnvApis, Settings
│  ├─ store/
│  │  ├─ settingsStore.ts    per-camera thresholds + automatic tuning
│  │  └─ themeStore.ts       Zustand + localStorage theme choice
│  ├─ App.tsx                router + layout
│  └─ main.tsx               React entry point
└─ vite.config.ts / vite.config.https.ts
```

## 5. How it works (plain English)

```
camera frame (one <video> element, no second stream)
   │
   ├─ MediaPipe ObjectDetector (EfficientDet-Lite0)
   │     │   finds: person, cat, dog, bird, horse, ... (80 COCO classes)
   │     ▼
   │  filter to living things + rename to friendly labels
   │     │
   │     ▼
   │  IoU tracker  (stable id per object, 1.5 s TTL)
   │     │
   │     ├─ person  -> crop the person box -> Human face detect
   │     │              -> one face? big enough? -> 1024-float descriptor
   │     │              -> cosine similarity vs every enrolled face
   │     │              -> best score >= face threshold ? name : "Unknown"
   │     │
   │     └─ dog/cat -> crop the animal box -> MobileNetV3 image vector
   │                    -> cosine similarity vs every enrolled pet of that species
   │                    -> best score >= pet threshold ? name : "Unknown"
   │     │
   │     ▼
   │  3 identical results in a row -> name is confirmed for that track
   │
   └─ MediaPipe Pose + Hand + Face landmarkers
         -> normalized landmarks (33 body points, 21 per hand, face contours)
   │
   ▼
CanvasOverlay
   video pixels -> screen pixels (scale), flip x when the front camera is mirrored
   │
   ▼
pose/hand/face skeleton + "Barack (Human)" chip  /  amber box "Bruno (Cat)"
```

- **Human bodies are drawn as landmarks, not boxes.** The person rectangle is still
  computed internally because tracking and face crops need it, but only the pose,
  hand and face skeleton plus the name chip are painted. Animals keep their amber
  box because there is no animal landmark model.
- **One camera stream.** Pose, hand and face read the same `<video>` element as the
  detector, so the overlay can never drift from the preview.
- Each of the three landmark models loads **independently**. If one fails, the other
  two keep working and the Debug panel shows which one failed.
- A brief model miss keeps the last skeleton for **250 ms** so it does not flicker;
  after that the landmarks disappear until the person is found again.
- Detection runs about **8 times per second**, not on every animation frame. The
  landmark loop uses the same cadence.
- Recognition is **not** run on every frame. A track is scanned at most once every
  700 ms and only until it has a name, so a named person costs nothing while they
  stay in view.
- Matching uses the **best of that person's enrollment photos**, not an average.
  One photo with the right angle and lighting is enough.
- A name needs **3 identical results in a row**. A different result resets the count,
  which stops a single bad frame from showing the wrong name.
- **Each camera tunes itself.** The active camera is remembered by `deviceId`; its
  thresholds and score samples are stored separately, so a laptop webcam and a phone
  running DroidCam never overwrite each other. Choosing another camera loads its profile
  automatically.
- **Automatic threshold:** after **6 named** and **3 unknown** tracks on that camera, the
  threshold moves to the midpoint between the weakest correct score and the strongest
  incorrect score — but only if those groups are at least **0.06** apart. Face values stay
  within 0.40–0.80 and pet values within 0.55–0.92. If the groups overlap, the previous
  value is kept rather than guessing.
- Moving a slider switches **that threshold on that camera** to manual. **Reset this
  camera** clears its samples and returns it to automatic with the `.env` starting value.
- **Face-size gate:** faces below `VITE_MIN_FACE_SIZE_PX` (80 px) are skipped. Human's
  box is generous (it includes hair), so 80 px is roughly a 45–50 px face.
- The model loads **once** and is reused; leaving the page turns the camera off.
- Nothing is uploaded. All inference happens in your browser.

### Privacy

- A consent screen appears before the first face enrollment. Declining leaves face
  enrollment off; pet naming still works.
- Only enrolled people are stored. Unknown faces are matched against the gallery in
  memory and then discarded — never written to the database.
- Enrollment photos are **not** stored. Only the numeric descriptor is saved, and the
  previews in the form live in memory until the form closes.
- Deleting a person or pet removes their row **and** every descriptor in the same
  IndexedDB transaction.

## 6. Settings (`.env`)

Copy `.env.example` to `.env` only if you want to change something — every value has
a working default.

| Variable | Default | Meaning |
|---|---|---|
| `VITE_APP_NAME` | `LiveCaps` | Name shown in the header |
| `VITE_DETECTION_CONFIDENCE` | `0.5` | Minimum score to draw a track (landmarks for people, boxes for animals) |
| `VITE_FACE_MATCH_THRESHOLD` | `0.55` | Starting face similarity; then auto-tuned per camera |
| `VITE_PET_MATCH_THRESHOLD` | `0.75` | Starting pet similarity; then auto-tuned per camera |
| `VITE_MIN_FACE_SIZE_PX` | `80` | Faces narrower than this are not matched |
| `VITE_MEDIAPIPE_WASM_URL` | pinned to `@mediapipe/tasks-vision@1.2.3` | Must match `package.json` |
| `VITE_MEDIAPIPE_OBJECT_MODEL_URL` | EfficientDet-Lite0 float16 | Detector model |
| `VITE_MEDIAPIPE_EMBEDDER_MODEL_URL` | MobileNetV3-small | Pet image embeddings |
| `VITE_HUMAN_MODELS_PATH` | pinned Human 3.3.6 CDN | Face models. Set `/models` for offline use |

The two thresholds are also sliders on the **Settings** page. Values are saved in
`localStorage` **per camera**, keyed by the browser's `deviceId` (or `default` before a
camera has started). A slider value overrides the `.env` starting value for that camera;
**Reset this camera to defaults** clears its samples and restores automatic tuning. That
matters because lighting and drivers are per-device: tune the phone you actually use.

### Choosing a camera (including DroidCam)

The **Live** page has a **Camera** picker. Device labels only appear after the browser
has camera permission, so if the list looks empty, allow the camera and use **Retry**.

1. Install and start the DroidCam client on the PC and the phone app, and connect them.
2. Reload the Live page. **DroidCam** appears in the picker next to the built-in camera.
3. Pick it. LiveCaps loads that camera's own threshold profile.
4. If the preview is solid green, tick **Compatibility mode**. It asks the browser for
   `{ video: true }` instead of requesting 1280×720 or a facing direction, which is the
   usual fix for virtual-camera drivers.
5. The **Debug** panel shows the active device label, resolution, frame rate, mode and
   the share of green pixels. The green-frame banner also offers a one-click switch to
   compatibility mode.

If a saved camera is unplugged, the app falls back to the default camera and says so.
The picker refreshes automatically when cameras are connected or removed.

### Tuning a threshold with the Debug panel

1. Open **Live**, press **Debug**.
2. Stand in front of the camera. Read the **Best** score for your own track.
3. Show a different person. Read their **Best** score.
4. Leave it to automatic tuning, or put the threshold between the two numbers in
   **Settings** to take manual control.
5. Watch the **Runner-up** column: if it is close to the best score, the two enrolled
   identities look alike to the model — add clearer photos or raise the threshold.

The Debug header shows how many samples each threshold has and whether it is `auto` or
`manual`. Automatic tuning needs 6 named and 3 unknown tracks on the active camera; until
then it keeps the current value.

> Every `VITE_` value is compiled into the browser bundle and is public.
> Never put a private key in one.

> **A note on the rename:** the app is called **LiveCaps**, but the IndexedDB database is
> still named `moments`, and the `moments.theme`, `moments.settings` and
> `moments.consent.v1` localStorage keys keep their original names. They are internal
> identifiers, never shown in the UI, and keeping them means people you already enrolled
> and your tuned thresholds survive the rename. A saved capture is still called a
> "moment".

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "This site can't be reached" on `localhost:5173` | The dev server is not running. Run `npm run dev` **inside the `moments` folder** and keep that terminal open |
| `127.0.0.1` refused but `localhost` works | Old IPv6-only binding. This project now binds `::` (dual-stack), so both work — restart `npm run dev` after pulling changes |
| Port 5173 already in use | Another dev server is running. Close it, or open the port Vite prints (e.g. 5174) |
| "Camera permission was denied" | Allow the camera in the browser's site settings, then tap **Retry camera** |
| "Camera access needs HTTPS or localhost" | You opened the LAN IP over `http://`. Use `npm run dev:https` or a tunnel |
| "The camera is already being used…" | Another tab/app (Zoom, Teams, Camera) holds the camera. Close it and retry |
| The preview is solid green | A virtual camera driver (often DroidCam) is not delivering real frames to Chromium. Tick **Compatibility mode**, reconnect the camera, restart its driver, or check it in the Windows Camera app first |
| The camera picker is empty or shows "Camera 1" | Labels appear only after permission. Allow the camera, then press **Retry**. Replug USB cameras and reload |
| My phone camera is not in the picker | Start the DroidCam (or similar) client on the PC, make sure the phone is connected, then reload the Live page |
| "The selected camera is not available" | The saved device was unplugged. The app switched to the default camera; choose another one in the picker |
| Face/pet thresholds differ between cameras | Expected: every camera keeps its own profile and samples. Open **Settings** to see the active camera's values |
| The threshold never moves by itself | Automatic tuning needs 6 named and 3 unknown tracks on that camera, with a clear gap between the two groups. Manual mode also stops it — press **Use automatic tuning** |
| "Model failed" / nothing detected | The CDN is blocked or offline. Check the network and reload. The model is ~7 MB |
| "The landmark tracking models could not load" | Pose, hand or face (~18 MB total) could not download. Check the network and reload; the other models keep working meanwhile |
| Pose, hands or face are never drawn | The subject is too small or turned away. Pose needs most of the body, hands need visible fingers, and the face needs a clear view. Debug shows the live count per model |
| Landmarks lag behind the preview | The landmark models share the main thread with detection. Close other heavy tabs; a smaller camera resolution helps. The overlay still reads the same frame, so it cannot drift |
| "Faces failed" / "Faces loading…" forever | Human's face models (~7.5 MB) could not download. Check the network; they load once and are cached |
| "Pets failed" / "Pets loading…" forever | The MobileNetV3 embedder (~4 MB) could not download |
| A person is never named, Debug says `no-face` | The crop has no detectable face. Move closer, face the camera, avoid backlight |
| Debug says `multiple-faces` | Two people are inside one person box. Move apart |
| Debug says `small-face` | The face is below `VITE_MIN_FACE_SIZE_PX`. Move closer |
| A name appears then disappears | The track was lost (person left the frame for >1.5 s). It is re-confirmed after 3 new votes |
| A stranger gets an enrolled name | The threshold is too low. Raise the face threshold, or re-enroll with clearer photos |
| Enrolling a pet says "Could not analyze" | The photo is unreadable or not an image. Use JPG/PNG/WebP |
| Landmarks or boxes are offset | The preview and the overlay must share the same box. Do not add `object-fit: cover` or `max-height` to the `<video>` |

## 8. What's next

- **Stage 2** — Environment & APIs: a status table for every setting, masked values and
  per-service connection tests.
- **Stage 3** — Capture, gallery, detail view, geocoding. The `moments` and `detections`
  tables already exist in the database, so no migration is needed.
- **Stage 7** — Clear data, export/import, and the remaining privacy controls.

Known limitations of the current stages:

- Pet matching uses a **generic image embedding**, not a pet-face model. Two tabbies on
  the same sofa can score close together; raise the pet threshold or enroll more angles.
- The pose model **infers joints it cannot see** (for example legs below a chest-up
  crop), so the skeleton can extend past the visible body. That is model behaviour, not
  a coordinate-mapping bug. Hands and faces also need enough pixels: at a distance the
  Debug counts can stay at 0 even though the person is detected.
- Automatic tuning learns from finished tracks on the **active camera**. A busy scene
  collects unknown samples faster than a quiet one; if a value feels wrong, move the
  slider to take manual control.
- A pet track is only matched against pets of the **same detected species** (a `Cat`
  track never matches a `Dog` enrollment).
- `small-face` tracks are re-tried up to 12 times, then labelled `Unknown` and left
  alone. Walking closer creates a new track, which is scanned again.
- Recognition quality depends on lighting. Re-enroll in the light you actually use.
- The gallery placeholder, geocoding and cloud backup are not built yet.
