# First Song

**A world as a gift, for the kid I used to be.**

Give it a song you loved as a child. It pulls the song apart into stems, reads
what each stem sounds like, and builds a place out of them: one monument per
stem, standing in a landscape coloured by the song's key and tempo.

Then it stops being a song. The four stems are four mono sources positioned in
3D, so **where you walk is the mix**. Stand by the drums and the drums are the
track. Walk to the far edge and the whole thing thins out to a bass line in the
distance. There is no stereo file playing at you.

Built for [Tripothon S1](https://developers.tripo3d.ai/en/events/tripothon-s1).
Direction Track: **App**. Tool Tracks: **Tripo** (every monument is a
text-to-3D generation), **World Labs** (environment, see below).

---

## Run it

Two processes. Backend on 8000, frontend on 5173, Vite proxies between them.

**1. Backend**

```bash
cd FirstSong && ./venv/Scripts/python.exe -m uvicorn backend.app:app --port 8000
```

The venv was created with `--system-site-packages` so it inherits torch, demucs
and librosa from the global Python 3.11 while shadowing the broken global
fastapi. To rebuild it:

```bash
python -m venv venv --system-site-packages && ./venv/Scripts/python.exe -m pip install -r backend/requirements.txt
```

**2. Frontend**

```bash
npm install --prefix frontend && npm run dev --prefix frontend
```

Then open http://localhost:5173.

**3. Build a world**

From an audio file, running the whole pipeline including Demucs (slow on CPU,
roughly real time):

```bash
python scripts/build_world.py "C:\music\song.mp3" --title "Yellow"
```

Reusing stems you already have (instant, and how the demo world was made):

```bash
python scripts/build_world.py assets/demo/infected.wav --title "Infected" --stems "..\AirStems\stems\Infected"
```

Add `--no-tripo` to skip mesh generation and let the frontend draw placeholder
geometry. Everything else works identically, which means **the piece is always
runnable, with or without API credit**.

Open a specific world with `http://localhost:5173/?world=<id>`; with no query
parameter it opens the most recently built one.

**4. Export the submittable build**

```bash
npm run build --prefix frontend
python scripts/export_static.py
python -m http.server 8080 --directory dist_static
```

`dist_static/` is the whole piece with no backend, no API key and no server
logic: the frontend probes `/api/worlds`, gets nothing, and falls back to
`worlds/<id>/world.json`. Drop it on any static host. This is what judges open.

---

## Keys

Copy `.env.example` to `.env`.

- `TRIPO_API_KEY` from https://platform.tripo3d.ai. Without it the pipeline
  skips mesh generation and the world uses placeholders.

  **Budget:** Tripothon hands out **25,000 API credits** to participants (claim
  them in the event Discord; pick API credits, not Studio credits, since this
  pipeline is entirely programmatic). 1 credit = $0.01, a textured
  `text_to_model` on v3.1 is 20 credits, so a four-stem world costs ~80 credits
  and the grant covers **about 310 complete worlds**. There is no reason to
  economise: use textures and PBR, and try `P1-20260311` (40 credits textured,
  still ~150 worlds) against `v3.1-20260211`. `build.py` prints the estimate
  before each run.
- `TRIPO_MODEL_VERSION` defaults to `v3.1-20260211`. Note the Tripo **V2 API
  endpoints retire 2026-11-01**; the REST path is still `/v2/openapi/task` and
  `model_version` is what selects a v3 model.
- `WORLDLABS_*` are optional, see below.

---

## How it works

```
song.mp3
   │
   ├─ separate.py      Demucs htdemucs -> drums / bass / other / vocals
   │
   ├─ descriptors.py   per stem: loudness, presence, brightness, width,
   │                   noisiness, density, dominant pitch class
   │                   per mix: tempo, key, duration
   │
   ├─ prompts.py       descriptors -> a Tripo prompt, a position, a colour
   │                     brightness -> material (rusted iron ... white enamel)
   │                     density    -> size     (solitary ... sprawling)
   │                     noisiness  -> condition(repaired ... half collapsed)
   │                     presence   -> radius from spawn + audible range
   │                     key        -> rotation of the whole floor plan
   │
   ├─ tripo.py         text_to_model -> poll -> download .glb
   │                   (output URLs expire ~5 min, so we download immediately)
   │
   ├─ worldlabs.py     the environment the monuments stand in
   │
   └─ world.json       one manifest the frontend consumes
```

The frontend reads that manifest and builds, per stem:

```
AudioBufferSource -> Gain -> Panner (HRTF) -> Analyser -> master -> out
```

All four sources start at one shared `currentTime`, so they stay sample-locked
no matter how long you wander. The `AudioListener` follows the camera every
frame. The analyser feeds a time-domain RMS back into the monument, so each
shape pulses with its own stem.

### Where the art lives

`backend/pipeline/vocabulary.json`. Subjects, materials, sizes, conditions and
the style suffix are all data. Iterating on how the worlds look does not mean
touching Python.

### World Labs

Integrated through Marble's **documented export formats**, not through a guessed
API shape, so it works from the web app alone:

```bash
# generate the world in the Marble web app, download the exports, then
python scripts/attach_environment.py my-way --from "C:\Downloads\marble-export"
python scripts/attach_environment.py my-way --detach        # back to procedural
```

The **equirectangular panorama** (2560x1280 png) becomes the sky and lights the
scene through `scene.environment`; the **collider mesh** (glb, 100-200k tris)
becomes the landscape. Not the high-quality mesh: that one is 600k-1M triangles,
takes an hour and is rate limited to 4/hour. Not splats either (SPZ/PLY, 2M
splats) since they need a renderer this project does not ship.

Marble exports in **OpenCV coordinates** (+y down, +z forward) while three.js is
OpenGL, so meshes are flipped on Y and Z by `openCVToOpenGL()` in
`environment.js`. Skip that and the landscape arrives upside down.

Both paths fall back to the procedural sky and disc if an asset fails to load,
and `world.json` always records which provider produced the environment, so the
Tool Track claim on the submission stays truthful either way.

`assets/fixtures/` holds a synthetic panorama and two small glbs (plus the
script that generates them) so the loader can be exercised without burning
credits.

---

## Deliberate decisions

**Mono stems, not stereo.** A `PannerNode` fed a stereo source spatialises
ambiguously. Summing to mono lets the panner do the whole job, and halves the
download. `build.py` does this on export.

**No `PointerLockControls`.** Pointer lock is refused inside iframes and in some
embedded browsers, and when it fails the whole piece is dead on arrival. `Stage`
implements look itself, capturing the cursor when allowed and falling back to
drag-to-look when not. Same movement maths in both modes.

**Time-domain RMS for levels, not a frequency-bin mean.** On real music most
bins sit near zero; a bin mean never leaves the bottom 1% and the meters look
broken.

**Placeholder geometry is a first-class path, not an error state.** Demo days
have bad wifi and rate limits.

**Disk:** `backend/cache/<id>/_work/` keeps the raw separated WAVs (~150 MB per
song) so you can re-run the analysis and the prompt mapping without paying for
Demucs again. Delete it once a world is final; nothing at runtime reads it.

---

## Submission checklist (Tripothon S1)

Deadline **5 October 2026, AoE (UTC−12)**. Barcelona Demo Day **17 October**.

- [ ] Playable demo the judges can try themselves: `python scripts/export_static.py`
      and host `dist_static/` anywhere (verified: 7.1 MB for one 3-minute song)
- [ ] Screen recording: a walkthrough of the world, not a trailer cut
- [ ] Visual asset board: key stills, monument turnarounds, environment frames
- [ ] Public build log (optional, but they amplify it): tag `@TripoAI`,
      hashtag `#Tripothon`
- [ ] Tool Track entries must demonstrably use the named tool, or they are
      disqualified from that track

Judging, Direction Track: creativity 30%, completeness 25%, theme fit 20%,
viral potential 15%, commercial value 10%.
