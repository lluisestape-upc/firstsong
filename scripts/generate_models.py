"""Run only the Tripo step, on worlds that already exist.

build_world.py does everything from an mp3, and its slow part is demucs. Once
a world is built the prompts are already sitting in its world.json, so filling
in the meshes later is just a matter of spending credits on them:

    python scripts/generate_models.py get-lucky --dry-run   # prompts and cost
    python scripts/generate_models.py get-lucky --only drums
    python scripts/generate_models.py get-lucky
    python scripts/generate_models.py --all

world.json is rewritten after every success, so a run that dies halfway keeps
what it paid for, and a second run picks up the stems that are still missing.
"""
import argparse
import json
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from requests.exceptions import RequestException

from backend.pipeline import config
from backend.pipeline.prompts import build_prompt, load_vocabulary
from backend.pipeline.tripo import TripoClient, TripoError, estimate_credits


def refresh_prompts(world: dict) -> int:
    """Re-derive every prompt from the current vocabulary.json.

    The prompts are written into world.json when a world is first built, so
    editing the vocabulary afterwards changes nothing until they are rebuilt.
    The descriptors stay as they were measured: only the words move.
    """
    vocab = load_vocabulary()
    changed = 0
    for stem in world["stems"]:
        fresh = build_prompt(stem["name"], stem["features"], world["title"], vocab)
        if fresh["prompt"] != stem.get("prompt"):
            changed += 1
        stem.update(fresh)
    return changed


def worlds_in_cache() -> list[str]:
    return sorted(
        path.parent.name
        for path in config.CACHE_DIR.glob("*/world.json")
    )


def pending(world: dict, only: list[str] | None, force: bool) -> list[dict]:
    out = []
    for stem in world["stems"]:
        if only and stem["name"] not in only:
            continue
        if stem.get("model") and not force:
            continue
        out.append(stem)
    return out


def generate_for(world_id: str, client: TripoClient, only, force, dry_run,
                 refresh: bool = False) -> int:
    world_dir = config.CACHE_DIR / world_id
    manifest = world_dir / "world.json"
    world = json.loads(manifest.read_text(encoding="utf-8"))

    each = estimate_credits(client.model_version)
    print(f"\n=== {world_id} · {world['title']} ===")

    if refresh:
        changed = refresh_prompts(world)
        if not dry_run:
            manifest.write_text(json.dumps(world, indent=2), encoding="utf-8")
        print(f"  {changed} prompt(s) rewritten from the current vocabulary")

    todo = pending(world, only, force)
    if not todo:
        print("  nothing to do, every stem already has a mesh")
        return 0
    print(f"  {len(todo)} mesh(es) × {each} credits = {len(todo) * each}")

    if dry_run:
        for stem in todo:
            print(f"\n  {stem['name']}:\n    {stem['prompt']}")
        return 0

    spent = 0
    for index, stem in enumerate(todo, 1):
        name = stem["name"]
        dest = world_dir / "models" / f"{name}.glb"
        started = time.time()
        print(f"  [{index}/{len(todo)}] {name}: {stem['parts']['subject']}", flush=True)

        def progress(status, percent, _name=name):
            print(f"      {status} {percent}%", end="\r", flush=True)

        # One retry: a run of fifteen of these takes half an hour, and losing
        # the lot to a blink of the wifi is not worth being strict about.
        done = False
        for attempt in (1, 2):
            try:
                client.generate(
                    stem["prompt"], dest,
                    negative_prompt=stem.get("negative_prompt", ""),
                    on_progress=progress,
                )
                done = True
                break
            except (TripoError, RequestException) as exc:
                print(f"      attempt {attempt} failed: {str(exc)[:140]}")
                if attempt == 1:
                    time.sleep(20)
        if not done:
            continue

        # A slimmed mesh keeps the full-size one beside it. That backup belongs
        # to the model that has just been replaced, so it goes with it.
        dest.with_suffix(".full.glb").unlink(missing_ok=True)

        stem["model"] = f"models/{name}.glb"
        manifest.write_text(json.dumps(world, indent=2), encoding="utf-8")
        spent += each
        size = dest.stat().st_size / 1e6
        print(f"      done in {time.time() - started:.0f}s · {size:.1f} MB · {dest.name}")

    return spent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("world", nargs="?", help="world id, e.g. get-lucky")
    parser.add_argument("--all", action="store_true", help="every world in the cache")
    parser.add_argument("--only", default=None,
                        help="comma separated stem names, e.g. drums,bass")
    parser.add_argument("--force", action="store_true",
                        help="regenerate meshes that already exist")
    parser.add_argument("--dry-run", action="store_true",
                        help="print the prompts and what they would cost")
    parser.add_argument("--refresh-prompts", action="store_true",
                        help="rebuild the prompts from vocabulary.json first, "
                             "for when the vocabulary has changed since the "
                             "world was built")
    args = parser.parse_args()

    if not args.world and not args.all:
        parser.error("name a world, or pass --all")

    ids = worlds_in_cache() if args.all else [args.world]
    missing = [w for w in ids if not (config.CACHE_DIR / w / "world.json").exists()]
    if missing:
        parser.error(f"no such world(s): {', '.join(missing)}. "
                     f"have: {', '.join(worlds_in_cache())}")

    client = TripoClient()
    only = args.only.split(",") if args.only else None

    before = client.balance().get("balance")
    print(f"tripo {client.model_version} · balance {before:,.0f} credits")

    spent = sum(generate_for(w, client, only, args.force, args.dry_run,
                             args.refresh_prompts) for w in ids)

    if not args.dry_run:
        after = client.balance().get("balance")
        print(f"\nestimated {spent} credits · actually spent {before - after:,.0f} "
              f"· {after:,.0f} left")


if __name__ == "__main__":
    main()
