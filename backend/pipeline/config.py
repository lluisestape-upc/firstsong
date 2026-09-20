"""Paths and environment for the FirstSong pipeline.

Everything the pipeline writes lands under CACHE_DIR/<world_id>/ so the frontend
can fetch a single world.json plus its stems and .glb files from one place.
"""
import os
import pathlib

try:
    from dotenv import load_dotenv
    load_dotenv(pathlib.Path(__file__).resolve().parents[2] / ".env")
except ImportError:
    pass

ROOT = pathlib.Path(__file__).resolve().parents[2]
CACHE_DIR = pathlib.Path(os.getenv("FIRSTSONG_CACHE", ROOT / "backend" / "cache"))
ASSETS_DIR = ROOT / "assets"

TRIPO_API_KEY = os.getenv("TRIPO_API_KEY", "")
TRIPO_MODEL_VERSION = os.getenv("TRIPO_MODEL_VERSION", "v3.1-20260211")

WORLDLABS_API_KEY = os.getenv("WORLDLABS_API_KEY", "")
WORLDLABS_ENDPOINT = os.getenv("WORLDLABS_ENDPOINT", "")

DEMUCS_MODEL = os.getenv("DEMUCS_MODEL", "htdemucs")

# Stems we know how to place, in layout order. htdemucs gives the first four;
# htdemucs_6s adds guitar and piano, which is worth it on arrangements where
# "other" would otherwise swallow a whole orchestra.
STEMS = ["drums", "bass", "other", "vocals", "guitar", "piano"]

CACHE_DIR.mkdir(parents=True, exist_ok=True)
