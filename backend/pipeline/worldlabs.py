"""The environment the monuments stand in.

Two providers behind one interface:

  procedural  (default, always works, zero keys)
      Derives a sky/fog/ground palette from the mix descriptors. The frontend
      renders it with a gradient sky and fog. Good enough to demo today.

  worldlabs   (opt-in)
      Calls a World Labs generation endpoint to turn a key frame into an
      explorable environment. Their API shape is NOT hardcoded here on purpose:
      set WORLDLABS_ENDPOINT and adapt _worldlabs() to the response you get.
      Until then the procedural path runs and the world.json records which
      provider produced it, so the Tool Track claim stays honest.
"""
import colorsys

import requests

from . import config

PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _hex(h: float, s: float, v: float) -> str:
    r, g, b = colorsys.hsv_to_rgb(h % 1.0, min(s, 1.0), min(v, 1.0))
    return "#{:02x}{:02x}{:02x}".format(int(r * 255), int(g * 255), int(b * 255))


def _procedural(mix: dict, title: str) -> dict:
    key = mix.get("key", "C")
    brightness = mix.get("brightness", 0.5)
    tempo = mix.get("tempo", 100.0)

    base_hue = (PITCH_CLASSES.index(key) if key in PITCH_CLASSES else 0) / 12.0
    # A slow song gets a wider, hazier world; a fast one a tighter, clearer one.
    haze = max(0.012, 0.055 - (tempo / 200.0) * 0.03)

    return {
        "provider": "procedural",
        "sky_top": _hex(base_hue + 0.55, 0.45, 0.20 + brightness * 0.35),
        "sky_bottom": _hex(base_hue, 0.35, 0.45 + brightness * 0.4),
        "fog_color": _hex(base_hue + 0.02, 0.25, 0.35 + brightness * 0.35),
        "fog_density": round(haze, 4),
        "ground_color": _hex(base_hue + 0.08, 0.22, 0.14 + brightness * 0.18),
        "ground_radius": 90,
        "note": f"palette derived from key {key} at {tempo} BPM",
    }


def _worldlabs(mix: dict, title: str, key_frame: str | None) -> dict:
    """Remote environment generation. Fill in to match the endpoint you get.

    Keep the returned dict shaped like the procedural one plus whatever asset
    you receive (an equirectangular image, a splat, a scene url) under `asset`,
    and teach frontend/src/environment.js to load it.
    """
    if not (config.WORLDLABS_API_KEY and config.WORLDLABS_ENDPOINT):
        raise RuntimeError("WORLDLABS_API_KEY / WORLDLABS_ENDPOINT not configured")

    payload = {"prompt": f"the world of the song {title}", "image": key_frame}
    response = requests.post(
        config.WORLDLABS_ENDPOINT,
        json=payload,
        headers={"Authorization": f"Bearer {config.WORLDLABS_API_KEY}"},
        timeout=300,
    )
    response.raise_for_status()
    data = response.json()

    env = _procedural(mix, title)
    env["provider"] = "worldlabs"
    env["asset"] = data          # adapt once the real response shape is known
    return env


def build(mix: dict, title: str, provider: str = "auto", key_frame: str | None = None) -> dict:
    if provider in ("auto", "worldlabs") and config.WORLDLABS_API_KEY and config.WORLDLABS_ENDPOINT:
        try:
            return _worldlabs(mix, title, key_frame)
        except Exception as exc:
            if provider == "worldlabs":
                raise
            print(f"  world labs unavailable ({exc}), falling back to procedural")
    return _procedural(mix, title)
