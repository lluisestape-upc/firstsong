"""Map audio descriptors to a Tripo prompt, a position in the world and a colour.

This is the mapping the judges will actually be scoring, so it is deliberately
small and legible. All the vocabulary sits in vocabulary.json.
"""
import colorsys
import hashlib
import json
import math
import pathlib

_VOCAB_PATH = pathlib.Path(__file__).with_name("vocabulary.json")
PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def load_vocabulary() -> dict:
    return json.loads(_VOCAB_PATH.read_text(encoding="utf-8"))


def _stable_choice(options: list, seed_text: str):
    """Pick deterministically from `options` so a re-run gives the same world."""
    digest = hashlib.sha1(seed_text.encode("utf-8")).digest()
    return options[digest[0] % len(options)]


def _band_word(vocab: dict, band: str, value: float, seed_text: str) -> str:
    for entry in vocab["bands"][band]:
        if value < entry["max"]:
            return _stable_choice(entry["words"], seed_text + band)
    return vocab["bands"][band][-1]["words"][0]


def _article(word: str) -> str:
    return "an" if word[:1].lower() in "aeiou" else "a"


def build_prompt(stem: str, features: dict, song_title: str, vocab: dict | None = None) -> dict:
    vocab = vocab or load_vocabulary()
    role = vocab["roles"].get(stem) or vocab["roles"]["other"]
    seed = f"{song_title}:{stem}"

    # Subjects are bare noun phrases; size/material/condition are the knobs the
    # audio turns. Keeping them adjectives (not counts) is what stops the prompt
    # reading like "a lone the hull of a boat".
    subject = _stable_choice(role["subject"], seed)
    material = _band_word(vocab, "brightness", features.get("brightness", 0.5), seed)
    size = _band_word(vocab, "density", features.get("density", 0.5), seed)
    condition = _band_word(vocab, "noisiness", features.get("noisiness", 0.5), seed)

    template = vocab.get(
        "template",
        "{article} {size} {subject}, built from {material}, {condition}, {style}",
    )
    prompt = template.format(
        article=_article(size),
        size=size,
        subject=subject,
        material=material,
        condition=condition,
        style=vocab["style_suffix"],
    )

    return {
        "prompt": prompt[:1024],
        "negative_prompt": vocab["negative_prompt"][:255],
        "parts": {
            "subject": subject,
            "material": material,
            "size": size,
            "condition": condition,
        },
    }


def place(stem: str, index: int, total: int, features: dict, song_key: str) -> dict:
    """Where the monument stands, and how big it is.

    Angle: one slot per stem, rotated by the song's key so two songs in
    different keys do not produce the same floor plan.
    Radius: a present stem stands close to the listener spawn, a sparse one
    is pushed out to the edge, so walking towards the edge thins the mix.
    Height: brightness lifts the object off the ground.
    """
    key_offset = PITCH_CLASSES.index(song_key) if song_key in PITCH_CLASSES else 0
    angle = (2 * math.pi) * (index / max(total, 1)) + (key_offset / 12.0) * 2 * math.pi

    presence = features.get("presence", 0.5)
    radius = 7.0 + (1.0 - presence) * 11.0
    height = 0.4 + features.get("brightness", 0.5) * 3.5

    scale = 0.6 + features.get("width", 0.5) * 1.2

    return {
        "position": [
            round(math.cos(angle) * radius, 3),
            round(height, 3),
            round(math.sin(angle) * radius, 3),
        ],
        "radius": round(radius, 2),
        "scale": round(scale, 3),
        # Audible radius. Beyond maxDistance the stem fades out of the mix.
        "ref_distance": round(3.0 + presence * 4.0, 2),
        "max_distance": round(radius + 16.0, 2),
    }


def colour(stem: str, features: dict, vocab: dict | None = None) -> str:
    vocab = vocab or load_vocabulary()
    role = vocab["roles"].get(stem) or vocab["roles"]["other"]

    pitch = features.get("pitch_class", "C")
    pitch_shift = (PITCH_CLASSES.index(pitch) if pitch in PITCH_CLASSES else 0) * 6

    h = ((role["hue_base"] + pitch_shift) % 360) / 360.0
    s = 0.35 + features.get("presence", 0.5) * 0.45
    v = 0.35 + features.get("brightness", 0.5) * 0.5

    r, g, b = colorsys.hsv_to_rgb(h, s, v)
    return "#{:02x}{:02x}{:02x}".format(int(r * 255), int(g * 255), int(b * 255))
