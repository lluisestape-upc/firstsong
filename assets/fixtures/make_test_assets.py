"""Minimal glTF-2.0 binary writer + a test equirectangular panorama.

Only exists to exercise the GLB and panorama paths before the real Tripo and
World Labs assets arrive. Not part of the project.
"""
import json, struct, pathlib, math
import numpy as np

def write_glb(path, vertices, indices, colour=(0.8, 0.5, 0.2)):
    v = np.asarray(vertices, dtype=np.float32)
    i = np.asarray(indices, dtype=np.uint16)
    if i.size % 2:                       # BIN chunk needs 4-byte alignment
        i = np.append(i, np.uint16(0))

    vb, ib = v.tobytes(), i.tobytes()
    bin_blob = vb + ib

    gltf = {
        "asset": {"version": "2.0", "generator": "firstsong-test"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{
            "attributes": {"POSITION": 0}, "indices": 1, "material": 0}]}],
        "materials": [{"pbrMetallicRoughness": {
            "baseColorFactor": [*colour, 1.0],
            "metallicFactor": 0.1, "roughnessFactor": 0.8}}],
        "buffers": [{"byteLength": len(bin_blob)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(vb), "target": 34962},
            {"buffer": 0, "byteOffset": len(vb), "byteLength": len(ib), "target": 34963},
        ],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": len(v),
             "type": "VEC3",
             "min": v.min(axis=0).tolist(), "max": v.max(axis=0).tolist()},
            {"bufferView": 1, "componentType": 5123,
             "count": len(np.asarray(indices)), "type": "SCALAR"},
        ],
    }

    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    bn = bin_blob + b"\x00" * ((4 - len(bin_blob) % 4) % 4)

    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bn))
    out += struct.pack("<II", len(js), 0x4E4F534A) + js
    out += struct.pack("<II", len(bn), 0x004E4942) + bn
    pathlib.Path(path).write_bytes(out)
    return len(out)

# --- an obviously-oriented shape: a tall wedge, narrow at the top ---
verts = [(-1,0,-1), (1,0,-1), (1,0,1), (-1,0,1), (0,2.5,0)]
idx   = [0,1,2, 0,2,3, 0,4,1, 1,4,2, 2,4,3, 3,4,0]
n = write_glb("test_monument.glb", verts, idx, (0.85, 0.45, 0.15))
print(f"test_monument.glb  {n} bytes")

# --- a ground plane, stand-in for a World Labs collider mesh ---
g = 60.0
gv = [(-g,0,-g), (g,0,-g), (g,0,g), (-g,0,g)]
gi = [0,1,2, 0,2,3]
n = write_glb("test_collider.glb", gv, gi, (0.25, 0.28, 0.24))
print(f"test_collider.glb  {n} bytes")

# --- equirectangular panorama, 2560x1280, matching Marble's spec ---
from PIL import Image
W, H = 2560, 1280
y, x = np.mgrid[0:H, 0:W]
u, vv = x / W, y / H
sky = np.stack([
    0.15 + 0.55 * (1 - vv), 0.20 + 0.50 * (1 - vv), 0.45 + 0.35 * (1 - vv)], -1)
ground = np.stack([
    np.full_like(u, 0.22), np.full_like(u, 0.20), np.full_like(u, 0.17)], -1)
img = np.where((vv > 0.5)[..., None], ground, sky)
# Numbered markers every 90 degrees so orientation errors are unmistakable.
for k, cx in enumerate([0.125, 0.375, 0.625, 0.875]):
    band = (np.abs(u - cx) < 0.012) & (vv > 0.30) & (vv < 0.50)
    col = [(1,0.3,0.2),(0.3,1,0.3),(0.3,0.5,1),(1,1,0.3)][k]
    img[band] = col
horizon = np.abs(vv - 0.5) < 0.002
img[horizon] = (1, 1, 1)
Image.fromarray((img * 255).astype(np.uint8)).save("test_panorama.png")
print(f"test_panorama.png  {W}x{H}")
