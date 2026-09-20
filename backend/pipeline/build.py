"""Orchestrator: one audio file in, one playable world out.

    world = build_world("song.mp3", title="Yellow")

Writes backend/cache/<id>/
    source.<ext>        the original upload
    stems/<name>.mp3    mono, spatialisable stems
    models/<name>.glb   Tripo meshes (absent if TRIPO_API_KEY is unset)
    world.json          everything the frontend needs
    status.json         progress, for the server to poll
"""
import json
import pathlib
import re
import shutil
import time
import traceback

import numpy as np
import soundfile as sf

from . import config, descriptors, prompts, separate, worldlabs

STEM_ORDER = config.STEMS
EXPORT_SR = 44100


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or f"world-{int(time.time())}"


def _write_status(world_dir: pathlib.Path, state: str, step: str, pct: int, error: str = ""):
    (world_dir / "status.json").write_text(
        json.dumps({"state": state, "step": step, "progress": pct, "error": error}),
        encoding="utf-8",
    )


def _encode_mono_mp3(src: pathlib.Path, dest: pathlib.Path) -> float:
    """Sum to mono and encode. A PannerNode wants a mono source: feeding it
    stereo makes the spatialisation ambiguous, and mono halves the download."""
    data, sr = sf.read(str(src), dtype="float32", always_2d=True)
    mono = data.mean(axis=1)

    peak = float(np.abs(mono).max())
    if peak > 0:
        mono = mono / peak * 0.89

    if sr != EXPORT_SR:
        import librosa
        mono = librosa.resample(mono, orig_sr=sr, target_sr=EXPORT_SR)

    dest.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(dest), mono, EXPORT_SR, format="MP3")
    return round(len(mono) / EXPORT_SR, 2)


def build_world(source: str | pathlib.Path,
                title: str | None = None,
                world_id: str | None = None,
                use_tripo: bool = True,
                environment_provider: str = "auto",
                reuse_stems: pathlib.Path | None = None,
                dedication: str = "",
                demucs_model: str | None = None,
                quiet_floor: float = 0.08,
                log=print) -> dict:
    source = pathlib.Path(source)
    title = title or source.stem
    world_id = world_id or slugify(title)

    world_dir = config.CACHE_DIR / world_id
    work_dir = world_dir / "_work"
    for sub in ("stems", "models", "_work"):
        (world_dir / sub).mkdir(parents=True, exist_ok=True)

    try:
        _write_status(world_dir, "running", "copying source", 2)
        source_copy = world_dir / f"source{source.suffix.lower()}"
        if source.resolve() != source_copy.resolve():
            shutil.copy2(source, source_copy)

        # 1. stems ---------------------------------------------------------
        if reuse_stems:
            log(f"[1/5] reusing stems from {reuse_stems}")
            _write_status(world_dir, "running", "reusing stems", 10)
            separate.copy_existing(pathlib.Path(reuse_stems), work_dir)
        else:
            model = demucs_model or config.DEMUCS_MODEL
            log(f"[1/5] separating stems with demucs {model} (slow, CPU)")
            _write_status(world_dir, "running", "separating stems", 10)
            separate.separate(source_copy, work_dir, model_name=model)

        # 2. analysis ------------------------------------------------------
        log("[2/5] analysing")
        _write_status(world_dir, "running", "analysing audio", 45)
        mix = descriptors.analyse_mix(source_copy)
        log(f"      {mix['tempo']} BPM, key {mix['key']}, {mix['duration']}s")

        vocab = prompts.load_vocabulary()
        stems = []
        present = [s for s in STEM_ORDER if (work_dir / f"{s}.wav").exists()]

        # Analyse everything first: the size and condition adjectives are
        # decided by how the stems compare to EACH OTHER, not to a constant.
        analysed = {}
        for name in present:
            features = descriptors.analyse_stem(work_dir / f"{name}.wav")
            if features.get("silent"):
                log(f"      {name}: silent, skipped")
                continue
            analysed[name] = features

        # A stem far quieter than the loudest one is never audible in the mix:
        # its monument would occupy a slot, add download weight and never
        # react. Drop it rather than ship a dead object. --keep-quiet disables.
        if analysed and quiet_floor > 0:
            loudest = max(f["loudness"] for f in analysed.values())
            for name in list(analysed):
                ratio = analysed[name]["loudness"] / loudest if loudest else 1.0
                if ratio < quiet_floor:
                    log(f"      {name}: dropped, {ratio:.1%} of the loudest stem")
                    del analysed[name]

        descriptors.relativise(analysed)

        for index, (name, features) in enumerate(analysed.items()):
            raw = work_dir / f"{name}.wav"
            duration = _encode_mono_mp3(raw, world_dir / "stems" / f"{name}.mp3")
            prompt = prompts.build_prompt(name, features, title, vocab)
            placement = prompts.place(name, index, len(analysed), features, mix["key"])

            stems.append({
                "name": name,
                "audio": f"stems/{name}.mp3",
                "duration": duration,
                "features": features,
                "colour": prompts.colour(name, features, vocab),
                "model": None,
                **prompt,
                **placement,
            })
            log(f"      {name}: {prompt['prompt'].split(',')[0]}")

        # 3. meshes --------------------------------------------------------
        if use_tripo and config.TRIPO_API_KEY:
            from .tripo import TripoClient, TripoError, CREDITS_PER_USD, estimate_credits
            client = TripoClient()
            each = estimate_credits(client.model_version)
            total = each * len(stems)
            log(f"[3/5] generating {len(stems)} meshes with Tripo {client.model_version}")
            log(f"      ~{each} credits each, ~{total} total "
                f"(about ${total / CREDITS_PER_USD:.2f})")
            for i, stem in enumerate(stems):
                _write_status(world_dir, "running", f"tripo: {stem['name']}",
                              50 + int(35 * i / max(len(stems), 1)))
                dest = world_dir / "models" / f"{stem['name']}.glb"
                try:
                    client.generate(
                        stem["prompt"], dest,
                        negative_prompt=stem["negative_prompt"],
                        on_progress=lambda s, p, n=stem["name"]: log(f"      {n}: {s} {p}%"),
                    )
                    stem["model"] = f"models/{stem['name']}.glb"
                except TripoError as exc:
                    log(f"      {stem['name']}: FAILED ({exc}), using placeholder")
        else:
            log("[3/5] no TRIPO_API_KEY, skipping meshes (frontend draws placeholders)")

        # 4. environment ---------------------------------------------------
        log("[4/5] building environment")
        _write_status(world_dir, "running", "environment", 90)
        environment = worldlabs.build(mix, title, provider=environment_provider)
        log(f"      provider: {environment['provider']}")

        # 5. manifest ------------------------------------------------------
        world = {
            "id": world_id,
            "title": title,
            "dedication": dedication or "for the kid I used to be",
            "created": int(time.time()),
            "mix": mix,
            "environment": environment,
            "stems": stems,
            "spawn": [0, 1.7, 0],
        }
        (world_dir / "world.json").write_text(json.dumps(world, indent=2), encoding="utf-8")
        _write_status(world_dir, "done", "ready", 100)
        log(f"[5/5] {world_dir / 'world.json'}")
        return world

    except Exception as exc:
        _write_status(world_dir, "error", "failed", 0, f"{exc}\n{traceback.format_exc()}")
        raise
