"""Bundle a submittable, fully static build: no backend, no API key, no server.

    npm run build --prefix frontend
    python scripts/export_static.py                 # every built world
    python scripts/export_static.py --only infected

Produces dist_static/
    index.html, assets/...        the Vite build
    worlds/index.json             the world list the frontend falls back to
    worlds/<id>/world.json        manifest
    worlds/<id>/stems/*.mp3
    worlds/<id>/models/*.glb

Drop that folder on any static host. Open ?world=<id> to pick one.
"""
import argparse
import json
import pathlib
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.pipeline import config  # noqa: E402

DIST = ROOT / "frontend" / "dist"
OUT = ROOT / "dist_static"
COPY_SUBDIRS = ("stems", "models")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="*", default=None,
                        help="world ids to include (default: all built worlds)")
    parser.add_argument("--out", default=str(OUT))
    args = parser.parse_args()

    if not (DIST / "index.html").exists():
        raise SystemExit("frontend/dist is missing - run: npm run build --prefix frontend")

    out = pathlib.Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(DIST, out)

    index = []
    for manifest in sorted(config.CACHE_DIR.glob("*/world.json")):
        world = json.loads(manifest.read_text(encoding="utf-8"))
        if args.only and world["id"] not in args.only:
            continue

        target = out / "worlds" / world["id"]
        target.mkdir(parents=True, exist_ok=True)
        shutil.copy2(manifest, target / "world.json")

        for sub in COPY_SUBDIRS:
            source = manifest.parent / sub
            if source.is_dir():
                # slim_models.py keeps the full-size mesh next to the slimmed
                # one. Shipping both would double the download for nothing.
                shutil.copytree(source, target / sub, dirs_exist_ok=True,
                                ignore=shutil.ignore_patterns("*.full.glb"))

        index.append({
            "id": world["id"],
            "title": world["title"],
            "dedication": world.get("dedication", ""),
            "created": world.get("created", 0),
            "stems": len(world.get("stems", [])),
        })
        print(f"  + {world['id']} ({len(world.get('stems', []))} stems)")

    if not index:
        raise SystemExit("no worlds found - run scripts/build_world.py first")

    index.sort(key=lambda w: w["created"], reverse=True)
    (out / "worlds" / "index.json").write_text(json.dumps(index, indent=2), encoding="utf-8")

    total = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    print(f"\n{out}  ({total / 1e6:.1f} MB, {len(index)} world(s))")
    print("Serve it with:  python -m http.server 8080 --directory dist_static")


if __name__ == "__main__":
    main()
