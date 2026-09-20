"""Stem separation with Demucs, loaded through soundfile so no ffmpeg or
torchcodec is needed. Adapted from the AirStems separate_local.py path.

Writes <out_dir>/{drums,bass,other,vocals}.wav and returns the folder.
"""
import pathlib
import shutil

import numpy as np
import soundfile as sf

from . import config


def _to_stereo(wav: np.ndarray) -> np.ndarray:
    """wav is (n, ch) from soundfile. Return (2, n)."""
    x = wav.T
    if x.shape[0] == 1:
        return np.repeat(x, 2, axis=0)
    if x.shape[0] > 2:
        return x[:2]
    return x


def separate(path: str | pathlib.Path, out_dir: pathlib.Path,
             model_name: str | None = None) -> pathlib.Path:
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    out_dir.mkdir(parents=True, exist_ok=True)
    model_name = model_name or config.DEMUCS_MODEL

    model = get_model(model_name)
    model.eval()

    wav, sr = sf.read(str(path), dtype="float32", always_2d=True)
    x = torch.from_numpy(np.ascontiguousarray(_to_stereo(wav)))

    if sr != model.samplerate:
        import librosa
        x = torch.from_numpy(
            librosa.resample(x.numpy(), orig_sr=sr, target_sr=model.samplerate)
        )
        sr = model.samplerate

    ref = x.mean(0)
    x = (x - ref.mean()) / (ref.std() + 1e-8)

    with torch.no_grad():
        sources = apply_model(model, x[None], device="cpu", progress=True)[0]
    sources = sources * ref.std() + ref.mean()

    for name, source in zip(model.sources, sources):
        sf.write(out_dir / f"{name}.wav", source.numpy().T, sr)

    return out_dir


def copy_existing(stem_dir: pathlib.Path, out_dir: pathlib.Path) -> pathlib.Path:
    """Reuse a folder of stems that already exists (e.g. from AirStems, or a
    previous run's own _work dir when re-analysing without re-separating)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    if stem_dir.resolve() == out_dir.resolve():
        return out_dir            # already in place, nothing to copy

    for name in config.STEMS:
        for ext in (".wav", ".flac", ".mp3"):
            src = stem_dir / f"{name}{ext}"
            if src.exists():
                shutil.copy2(src, out_dir / src.name)
                break
    return out_dir
