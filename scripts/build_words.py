"""Turn the words a song was heard to sing into objects in its world.

    python scripts/build_words.py --all --dry-run     # what, where, and cost
    python scripts/build_words.py billie-jean
    python scripts/build_words.py --all --workers 6

Needs <world>/_work/lyrics.json from transcribe_lyrics.py.

Meshes live in one shared cache, backend/cache/_lexicon/<object>.glb, and are
copied into each world that uses them: a heart is the same heart in every
song, so it is paid for once. Generation runs in parallel, because one at a
time a song's worth of objects takes most of an hour and in parallel it
takes a few minutes.

Word objects are asked for lighter than the monuments (fewer faces, 512 px
textures after slimming): there are four times as many of them and they are
seen smaller.
"""
import argparse
import json
import pathlib
import shutil
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from requests.exceptions import RequestException

from backend.pipeline import config
from backend.pipeline.lyrics import layout, load_lexicon, objects_from_words
from backend.pipeline.tripo import TripoClient, TripoError, estimate_credits
from scripts.slim_models import slim

CACHE = config.CACHE_DIR / "_lexicon"
FACE_LIMIT = 6000
TEXTURE_SIZE = 512


def objects_for(world_id: str, lexicon: dict) -> tuple[dict, list[dict]]:
    world_dir = config.CACHE_DIR / world_id
    world = json.loads((world_dir / "world.json").read_text(encoding="utf-8"))
    lyrics_path = world_dir / "_work" / "lyrics.json"
    if not lyrics_path.exists():
        raise SystemExit(f"{world_id}: no lyrics yet. "
                         f"Run: python scripts/transcribe_lyrics.py {world_id}")
    words = json.loads(lyrics_path.read_text(encoding="utf-8"))["words"]
    objects = objects_from_words(words, lexicon)
    layout(objects, world["stems"], world_id)
    return world, objects


def generate_one(key: str, prompt: str, negative: str) -> tuple[str, str]:
    """Runs in a worker thread, with its own client and session."""
    client = TripoClient()
    dest = CACHE / f"{key}.glb"
    last_error = ""
    for attempt in (1, 2):
        try:
            client.generate(prompt, dest, negative_prompt=negative,
                            face_limit=FACE_LIMIT)
            slim(dest, TEXTURE_SIZE, 85, dry_run=False)
            return key, "ok"
        except (TripoError, RequestException) as exc:
            last_error = str(exc)[:140]
            if attempt == 1:
                time.sleep(20)
    return key, f"failed: {last_error}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("world", nargs="?")
    parser.add_argument("--all", action="store_true",
                        help="every world with a lyrics.json")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--no-tripo", action="store_true",
                        help="write objects and layout only; the frontend draws "
                             "placeholders for anything without a mesh")
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()
    if not args.world and not args.all:
        parser.error("name a world, or pass --all")

    ids = ([p.parent.parent.name for p in sorted(config.CACHE_DIR.glob("*/_work/lyrics.json"))]
           if args.all else [args.world])
    lexicon = load_lexicon()
    CACHE.mkdir(parents=True, exist_ok=True)

    plans = {}
    wanted = {}
    for world_id in ids:
        world, objects = objects_for(world_id, lexicon)
        plans[world_id] = (world, objects)
        print(f"\n=== {world_id} · {len(objects)} objects ===")
        for obj in objects:
            cached = (CACHE / f"{obj['key']}.glb").exists()
            print(f"  {obj['times'][0]:6.1f}s  x{len(obj['times']):<3} "
                  f"{obj['size']:4.1f} m  {obj['key']:12} "
                  f"{'cached ' if cached else 'new    '}"
                  f"<- {', '.join(obj['heard'])}")
            if not cached:
                wanted[obj["key"]] = obj

    each = estimate_credits(config.TRIPO_MODEL_VERSION)
    print(f"\n{len(wanted)} new mesh(es) to generate, {len(wanted) * each} credits "
          f"(shared objects are paid for once)")

    if args.dry_run:
        return

    if wanted and not args.no_tripo:
        client = TripoClient()
        before = client.balance().get("balance")
        print(f"balance {before:,.0f} · {args.workers} at a time")
        started = time.time()
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            jobs = [pool.submit(generate_one, key, obj["prompt"], obj["negative_prompt"])
                    for key, obj in wanted.items()]
            for done, job in enumerate(as_completed(jobs), 1):
                key, outcome = job.result()
                print(f"  [{done}/{len(jobs)}] {key}: {outcome} "
                      f"({time.time() - started:.0f}s)", flush=True)
        after = client.balance().get("balance")
        print(f"spent {before - after:,.0f} credits · {after:,.0f} left")

    for world_id, (world, objects) in plans.items():
        world_dir = config.CACHE_DIR / world_id
        target = world_dir / "models" / "words"
        target.mkdir(parents=True, exist_ok=True)

        entries = []
        for obj in objects:
            source = CACHE / f"{obj['key']}.glb"
            model = None
            if source.exists():
                shutil.copy2(source, target / source.name)
                model = f"models/words/{source.name}"
            # Single nouns and the times they are sung: never the lines
            # themselves, so the published manifest carries no lyrics.
            entries.append({
                "key": obj["key"],
                "phrase": obj["phrase"],
                "heard": obj["heard"],
                "times": obj["times"],
                "size": obj["size"],
                "position": obj["position"],
                "model": model,
            })

        world["words"] = entries
        (world_dir / "world.json").write_text(json.dumps(world, indent=2), encoding="utf-8")
        with_mesh = sum(1 for e in entries if e["model"])
        print(f"{world_id}: {len(entries)} objects written, {with_mesh} with a mesh")


if __name__ == "__main__":
    main()
