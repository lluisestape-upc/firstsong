"""Shrink Tripo's .glb files for the web.

A mesh comes back from Tripo at about 4.2 MB, and 3.5 MB of that is three
2048-pixel textures: colour, ORM and a normal map. The geometry is 0.7 MB.

Six of those is 25 MB of monuments against 12 MB of music, which is the wrong
way round for a piece whose whole argument is the audio. Halving each texture
to 1024 is a four-fold saving in pixels and is invisible at the distance these
things are seen from, in fog, in the dark.

    python scripts/slim_models.py --all --dry-run
    python scripts/slim_models.py get-lucky
    python scripts/slim_models.py --all --size 1024

Originals are kept beside the slimmed file as <name>.full.glb the first time a
model is touched, so this is never a one-way door and never re-slims an
already slimmed file.
"""
import argparse
import io
import json
import pathlib
import struct
import sys

from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from backend.pipeline import config

JSON_CHUNK = b"JSON"
BIN_CHUNK = b"BIN\x00"


def read_glb(path: pathlib.Path) -> tuple[dict, bytearray]:
    data = path.read_bytes()
    magic, version, _ = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF" or version != 2:
        raise ValueError(f"{path.name} is not a glTF 2 binary")

    offset = 12
    gltf, binary = None, bytearray()
    while offset < len(data):
        length, kind = struct.unpack_from("<I4s", data, offset)
        body = data[offset + 8: offset + 8 + length]
        if kind == JSON_CHUNK:
            gltf = json.loads(body)
        elif kind == BIN_CHUNK:
            binary = bytearray(body)
        offset += 8 + length + (-length % 4)
    if gltf is None:
        raise ValueError(f"{path.name} has no JSON chunk")
    return gltf, binary


def write_glb(path: pathlib.Path, gltf: dict, binary: bytes) -> None:
    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_bytes += b" " * (-len(json_bytes) % 4)
    binary = bytes(binary) + b"\x00" * (-len(binary) % 4)

    total = 12 + 8 + len(json_bytes) + (8 + len(binary) if binary else 0)
    out = bytearray()
    out += struct.pack("<4sII", b"glTF", 2, total)
    out += struct.pack("<I4s", len(json_bytes), JSON_CHUNK) + json_bytes
    if binary:
        out += struct.pack("<I4s", len(binary), BIN_CHUNK) + binary
    path.write_bytes(out)


def shrink(source: bytes, mime: str, size: int, quality: int) -> tuple[bytes, str] | None:
    """Return smaller bytes for one texture, or None to leave it alone."""
    image = Image.open(io.BytesIO(source))
    if max(image.size) <= size:
        return None

    ratio = size / max(image.size)
    image = image.resize(
        (max(1, round(image.width * ratio)), max(1, round(image.height * ratio))),
        Image.LANCZOS,
    )

    buffer = io.BytesIO()
    if mime == "image/png":
        # Normal maps stay PNG: jpeg ringing on a normal map shows up as
        # shimmer across a flat surface, which is exactly what it is for.
        image.save(buffer, format="PNG", optimize=True)
        return buffer.getvalue(), "image/png"
    image.convert("RGB").save(buffer, format="JPEG", quality=quality, optimize=True)
    return buffer.getvalue(), "image/jpeg"


def slim(path: pathlib.Path, size: int, quality: int, dry_run: bool) -> tuple[int, int]:
    before = path.stat().st_size
    backup = path.with_suffix(".full.glb")
    gltf, binary = read_glb(path)

    views = gltf.get("bufferViews", [])
    images = gltf.get("images", [])
    if not images:
        return before, before

    # Rebuild the binary chunk: every view is copied across in order, with the
    # image ones replaced. Offsets change, so they are all rewritten.
    replacements = {}
    for image in images:
        index = image.get("bufferView")
        if index is None:
            continue
        view = views[index]
        start = view.get("byteOffset", 0)
        source = bytes(binary[start: start + view["byteLength"]])
        smaller = shrink(source, image.get("mimeType", ""), size, quality)
        if smaller and len(smaller[0]) < len(source):
            replacements[index] = smaller
            image["mimeType"] = smaller[1]

    if not replacements:
        return before, before
    if dry_run:
        saved = sum(views[i]["byteLength"] - len(new[0]) for i, new in replacements.items())
        return before, before - saved

    rebuilt = bytearray()
    for index, view in enumerate(views):
        if index in replacements:
            payload = replacements[index][0]
        else:
            start = view.get("byteOffset", 0)
            payload = bytes(binary[start: start + view["byteLength"]])
        rebuilt += b"\x00" * (-len(rebuilt) % 4)
        view["byteOffset"] = len(rebuilt)
        view["byteLength"] = len(payload)
        rebuilt += payload

    gltf["buffers"] = [{"byteLength": len(rebuilt)}]
    if not backup.exists():
        backup.write_bytes(path.read_bytes())
    write_glb(path, gltf, rebuilt)
    return before, path.stat().st_size


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("world", nargs="?")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--size", type=int, default=1024, help="longest texture edge")
    parser.add_argument("--quality", type=int, default=88, help="jpeg quality")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not args.world and not args.all:
        parser.error("name a world, or pass --all")

    ids = ([p.parent.name for p in sorted(config.CACHE_DIR.glob("*/world.json"))]
           if args.all else [args.world])

    total_before = total_after = 0
    for world_id in ids:
        models = sorted((config.CACHE_DIR / world_id / "models").glob("*.glb"))
        models = [m for m in models if not m.name.endswith(".full.glb")]
        if not models:
            continue
        print(f"\n=== {world_id} ===")
        for model in models:
            before, after = slim(model, args.size, args.quality, args.dry_run)
            total_before += before
            total_after += after
            cut = 100 * (1 - after / before) if before else 0
            print(f"  {model.name:12} {before/1e6:5.2f} -> {after/1e6:5.2f} MB  ({cut:4.1f}% off)")

    if total_before:
        print(f"\ntotal {total_before/1e6:.1f} -> {total_after/1e6:.1f} MB "
              f"({100 * (1 - total_after / total_before):.0f}% smaller)"
              + ("  [dry run]" if args.dry_run else ""))


if __name__ == "__main__":
    main()
