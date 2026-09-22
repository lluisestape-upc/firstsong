"""Attach a Marble (World Labs) export to a world already built.

Generate the world in the Marble web app, download the exports, then:

    python scripts/attach_environment.py my-way --from "C:\Downloads\marble-export"
    python scripts/attach_environment.py my-way --panorama pano.png --mesh collider.glb
    python scripts/attach_environment.py my-way --detach      # back to procedural

Copies the files into the world's environment/ folder and records them in
world.json, so the frontend picks them up with no code change.

Use the COLLIDER mesh (100-200k triangles), not the high-quality one: the HQ
export is 600k-1M triangles and takes an hour to generate. Splats (SPZ/PLY) are
not supported, they need a renderer this project does not ship.
"""
import argparse
import json
import pathlib
import shutil
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from backend.pipeline import config  # noqa: E402

PANO_HINTS = ("pano", "panorama", "equirect", "360")
MESH_HINTS = ("collider", "coarse", "physics")


def _guess(folder: pathlib.Path, suffixes, hints):
    """Marble's filenames vary; prefer a hinted name, else the only candidate."""
    files = [f for f in folder.iterdir() if f.suffix.lower() in suffixes]
    if not files:
        return None
    hinted = [f for f in files if any(h in f.name.lower() for h in hints)]
    if hinted:
        return min(hinted, key=lambda f: f.stat().st_size)
    if len(files) == 1:
        return files[0]
    # Several meshes and none hinted: the collider is the smallest.
    return min(files, key=lambda f: f.stat().st_size)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("world_id")
    parser.add_argument("--from", dest="folder", default=None,
                        help="a folder of Marble exports, files detected by name")
    parser.add_argument("--panorama", default=None, help="equirectangular png")
    parser.add_argument("--mesh", default=None, help="collider mesh glb")
    parser.add_argument("--detach", action="store_true",
                        help="remove the assets and go back to procedural")
    args = parser.parse_args()

    world_dir = config.CACHE_DIR / args.world_id
    manifest = world_dir / "world.json"
    if not manifest.exists():
        raise SystemExit(f"no world called {args.world_id} - build it first")

    world = json.loads(manifest.read_text(encoding="utf-8"))
    env = world["environment"]

    if args.detach:
        env.pop("asset", None)
        env["provider"] = "procedural"
        shutil.rmtree(world_dir / "environment", ignore_errors=True)
        manifest.write_text(json.dumps(world, indent=2), encoding="utf-8")
        print(f"{args.world_id}: back to procedural")
        return

    panorama, mesh = args.panorama, args.mesh
    if args.folder:
        folder = pathlib.Path(args.folder)
        if not folder.is_dir():
            raise SystemExit(f"{folder} is not a folder")
        panorama = panorama or _guess(folder, {".png", ".jpg", ".jpeg"}, PANO_HINTS)
        mesh = mesh or _guess(folder, {".glb", ".gltf"}, MESH_HINTS)

    if not (panorama or mesh):
        raise SystemExit("nothing to attach: pass --from, or --panorama / --mesh")

    out = world_dir / "environment"
    out.mkdir(parents=True, exist_ok=True)
    asset = env.get("asset", {}) if isinstance(env.get("asset"), dict) else {}

    for label, src, key in (("panorama", panorama, "panorama"),
                            ("collider mesh", mesh, "collider_mesh")):
        if not src:
            continue
        src = pathlib.Path(src)
        if not src.exists():
            raise SystemExit(f"{src} does not exist")
        dest = out / f"{key}{src.suffix.lower()}"
        shutil.copy2(src, dest)
        asset[key] = f"environment/{dest.name}"
        print(f"  {label:14s} {src.name}  ->  {asset[key]}  ({src.stat().st_size/1e6:.1f} MB)")

    env["asset"] = asset
    env["provider"] = "worldlabs"
    env["note"] = "Marble export; panorama as sky, collider mesh as landscape"
    manifest.write_text(json.dumps(world, indent=2), encoding="utf-8")
    print(f"\n{args.world_id}: provider is now worldlabs")


if __name__ == "__main__":
    main()
