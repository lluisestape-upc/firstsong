"""From the words a song was heard to sing, to the things that stand in it.

Three steps, all deterministic so a rebuild gives the same world:

  objects  every heard noun is sent through lyric_lexicon.json: abstract
           words become the symbol a child would draw, synonyms collapse
           onto one object, and words with no honest picture are dropped.
  size     an object grows with every time it is sung. A chorus word ends
           up the biggest thing in the world, which is the song's own
           emphasis made visible.
  layout   a golden-angle spiral from the centre outwards, in the order the
           words first arrive, kept clear of the monuments and of each
           other at their final size.
"""
import hashlib
import json
import math
import pathlib

_LEXICON_PATH = pathlib.Path(__file__).with_name("lyric_lexicon.json")

GOLDEN_ANGLE = math.pi * (3 - math.sqrt(5))
PAD_CLEAR = 4.0          # the reset pad in the middle stays free
MONUMENT_CLEAR = 3.6     # room around each instrument, plus the object's half-size
GAP = 1.0                # between two word objects at their final size


def load_lexicon() -> dict:
    return json.loads(_LEXICON_PATH.read_text(encoding="utf-8"))


def size_for(count: int) -> float:
    """Largest dimension in metres after `count` times sung."""
    return round(1.3 + 0.8 * math.sqrt(max(count, 1)), 3)


def objects_from_words(words: list[dict], lexicon: dict | None = None) -> list[dict]:
    lexicon = lexicon or load_lexicon()
    floor = lexicon.get("min_confidence", 0.3)
    skip = set(lexicon.get("skip", []))
    mapping = lexicon.get("map", {})
    phrases = lexicon.get("objects", {})

    found: dict[str, dict] = {}
    for word in words:
        if word.get("pos") not in ("NOUN", "PROPN"):
            continue
        if word.get("p", 0) < floor:
            continue
        lemma = word.get("lemma", "")
        if not lemma or lemma in skip or len(lemma) < 3:
            continue

        key = mapping.get(lemma, lemma)
        entry = found.setdefault(key, {
            "key": key,
            "phrase": phrases.get(key, key),
            "heard": set(),
            "times": [],
            "confidence": [],
        })
        entry["heard"].add(lemma)
        entry["times"].append(round(word["start"], 3))
        entry["confidence"].append(word["p"])

    objects = []
    for entry in found.values():
        entry["heard"] = sorted(entry["heard"])
        entry["times"] = sorted(entry["times"])
        entry["confidence"] = round(sum(entry["confidence"]) / len(entry["confidence"]), 3)
        entry["size"] = size_for(len(entry["times"]))
        entry["prompt"] = lexicon["style"].format(phrase=entry["phrase"])[:1024]
        entry["negative_prompt"] = lexicon["negative_prompt"][:255]
        objects.append(entry)

    # Arrival order: the first thing sung is the first thing placed.
    objects.sort(key=lambda o: o["times"][0])
    return objects


def layout(objects: list[dict], monuments: list[dict], seed_text: str) -> list[dict]:
    """Give every object a place. `monuments` are world.json stems."""
    digest = hashlib.sha1(seed_text.encode("utf-8")).digest()
    turn = (digest[0] / 255.0) * 2 * math.pi

    placed = []
    candidate = 0
    for obj in objects:
        half = obj["size"] / 2
        while True:
            if candidate > 4000:
                raise RuntimeError("could not find room for every object")
            radius = 4.5 + 2.6 * math.sqrt(candidate)
            angle = turn + candidate * GOLDEN_ANGLE
            candidate += 1
            x, z = math.cos(angle) * radius, math.sin(angle) * radius

            if radius - half < PAD_CLEAR:
                continue
            if any(math.hypot(x - m["position"][0], z - m["position"][2])
                   < MONUMENT_CLEAR + half for m in monuments):
                continue
            if any(math.hypot(x - p["position"][0], z - p["position"][2])
                   < half + p["size"] / 2 + GAP for p in placed):
                continue
            break

        # Stood just off the ground; the frontend puts the foot here.
        obj["position"] = [round(x, 3), 0.15, round(z, 3)]
        placed.append(obj)
    return objects
