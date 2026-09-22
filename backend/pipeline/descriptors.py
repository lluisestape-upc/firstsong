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


def _fold_tempo(bpm: float, lo: float = 60.0, hi: float = 140.0) -> tuple[float, int]:
    """Beat trackers routinely report a double or half of the felt tempo, which
    on a rubato ballad is the usual case rather than the exception. Fold the
    estimate into the range people actually count in, and report the factor so
    the beat instants can be folded the same way.

    Returns (bpm, factor) where factor > 1 means the tracker was counting
    subdivisions and only every `factor`-th instant is a felt beat.
    """
    if bpm <= 0:
        return 0.0, 1
    factor = 1
    while bpm > hi:
        bpm /= 2
        factor *= 2
    while bpm < lo:
        bpm *= 2
        factor = max(1, factor // 2)
    return bpm, factor


def analyse_mix(path: pathlib.Path, sr: int = 22050) -> dict:
    """Song-level descriptors, taken from the original mix."""
    y, sr = librosa.load(str(path), sr=sr, mono=True)
    tempo_raw, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    tempo_raw = float(np.atleast_1d(tempo_raw)[0])
    tempo, factor = _fold_tempo(tempo_raw)

    # The actual beat instants, not just a rate: the world needs to know when
    # the pulse lands, and a constant 60/BPM grid drifts on anything played by
    # humans. Decimated by the same factor the tempo was folded by, or the
    # world would ask you to jump on every subdivision. Rounded to
    # milliseconds to keep the manifest small.
    instants = librosa.frames_to_time(beat_frames, sr=sr)
    beats = [round(float(t), 3) for t in instants[::factor]]

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr).mean(axis=1)
    key = PITCH_CLASSES[int(np.argmax(chroma))]

    centroid = float(librosa.feature.spectral_centroid(y=y, sr=sr).mean())

    return {
        "tempo": round(tempo, 1),
        "tempo_raw": round(tempo_raw, 1),
        "beats": beats,
        "key": key,
        "duration": round(float(len(y) / sr), 2),
        "brightness": round(_log_norm(centroid, CENTROID_MIN_HZ, CENTROID_MAX_HZ), 3),
    }


def relativise(per_stem: dict, keys=("density", "noisiness")) -> dict:
    """Rescale the named descriptors across the stems of ONE song.

    Absolute scales are calibrated on band music; on a ballad every stem lands
    in the same band and every monument gets the same adjective. What the world
    needs is not "how dense is this in absolute terms" but "which of these six
    is the busiest". Rank-based, so a single outlier cannot squash the rest.

    The absolute value is kept alongside as <key>_abs.
    """
    names = [n for n, f in per_stem.items() if not f.get("silent")]
    if len(names) < 2:
        return per_stem

    for key in keys:
        order = sorted(names, key=lambda n: per_stem[n].get(key, 0.0))
        last = len(order) - 1
        for rank, name in enumerate(order):
            features = per_stem[name]
            features[f"{key}_abs"] = features.get(key, 0.0)
            # Spread over 0.08..0.95 so the top and bottom bands are reachable.
            features[key] = round(0.08 + 0.87 * (rank / last), 3)
    return per_stem
