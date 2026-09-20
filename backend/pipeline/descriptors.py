"""Per-stem audio descriptors.

These numbers are the bridge between the song and the world: they decide what
each stem's monument looks like, how big it is, where it stands and what colour
it takes. Keep them few, cheap and interpretable so the mapping stays tweakable.
"""
import math
import pathlib

import librosa
import numpy as np

PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Sensible full-scale bounds so the 0..1 normalisations are stable across songs.
CENTROID_MIN_HZ = 150.0
CENTROID_MAX_HZ = 6000.0
ONSET_MAX_PER_SEC = 8.0


def _norm(value: float, lo: float, hi: float) -> float:
    return float(min(1.0, max(0.0, (value - lo) / (hi - lo))))


def _log_norm(value: float, lo: float, hi: float) -> float:
    value = max(value, 1e-6)
    return _norm(math.log(value), math.log(lo), math.log(hi))


def analyse_stem(path: pathlib.Path, sr: int = 22050) -> dict:
    y, sr = librosa.load(str(path), sr=sr, mono=True)
    if y.size == 0:
        return {"silent": True}

    rms = librosa.feature.rms(y=y)[0]
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
    bandwidth = librosa.feature.spectral_bandwidth(y=y, sr=sr)[0]
    flatness = librosa.feature.spectral_flatness(y=y)[0]

    onsets = librosa.onset.onset_detect(y=y, sr=sr, units="time")
    duration = float(len(y) / sr)
    onset_rate = len(onsets) / duration if duration > 0 else 0.0

    # How much of the track this stem actually occupies. A stem that is silent
    # for most of the song should not get a monument the size of the drums.
    loud_frames = rms > (rms.max() * 0.15 if rms.max() > 0 else 1.0)
    presence = float(loud_frames.mean())

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    pitch_class = PITCH_CLASSES[int(np.argmax(chroma.mean(axis=1)))]

    return {
        "silent": bool(rms.max() < 1e-4),
        "duration": round(duration, 2),
        "loudness": round(float(rms.mean()), 5),
        "peak": round(float(rms.max()), 5),
        "presence": round(presence, 3),
        "pitch_class": pitch_class,
        # normalised 0..1 drivers for the visual mapping
        "brightness": round(_log_norm(float(centroid.mean()), CENTROID_MIN_HZ, CENTROID_MAX_HZ), 3),
        "width": round(_log_norm(float(bandwidth.mean()), 200.0, 4000.0), 3),
        "noisiness": round(_norm(float(flatness.mean()), 0.0, 0.35), 3),
        "density": round(_norm(onset_rate, 0.0, ONSET_MAX_PER_SEC), 3),
        "raw": {
            "centroid_hz": round(float(centroid.mean()), 1),
            "bandwidth_hz": round(float(bandwidth.mean()), 1),
            "onsets_per_sec": round(onset_rate, 2),
        },
    }


def analyse_mix(path: pathlib.Path, sr: int = 22050) -> dict:
    """Song-level descriptors, taken from the original mix."""
    y, sr = librosa.load(str(path), sr=sr, mono=True)
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    tempo = float(np.atleast_1d(tempo)[0])

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr).mean(axis=1)
    key = PITCH_CLASSES[int(np.argmax(chroma))]

    centroid = float(librosa.feature.spectral_centroid(y=y, sr=sr).mean())

    return {
        "tempo": round(tempo, 1),
        "key": key,
        "duration": round(float(len(y) / sr), 2),
        "brightness": round(_log_norm(centroid, CENTROID_MIN_HZ, CENTROID_MAX_HZ), 3),
    }
