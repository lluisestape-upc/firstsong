"""Build a world from the command line, no server needed.

    python scripts/build_world.py "C:\music\song.mp3" --title "Yellow"
    python scripts/build_world.py song.mp3 --no-tripo          # placeholders only
    python scripts/build_world.py song.mp3 --stems ../AirStems/stems/Infected

Use the GLOBAL Python 3.11 (it has torch + demucs + librosa + soundfile).
"""
import argparse
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from backend.pipeline.build import build_world


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("audio")
    parser.add_argument("--title", default=None)
    parser.add_argument("--id", default=None)
    parser.add_argument("--dedication", default="")
    parser.add_argument("--stems", default=None,
                        help="reuse an existing folder of {drums,bass,other,vocals} files")
    parser.add_argument("--no-tripo", action="store_true",
                        help="skip mesh generation, frontend draws placeholders")
    parser.add_argument("--model", default=None,
                        help="demucs model: htdemucs (4 stems) or htdemucs_6s "
                             "(adds guitar + piano, better on orchestral tracks)")
    parser.add_argument("--keep-quiet", action="store_true",
                        help="keep stems that are near-silent relative to the "
                             "loudest one (dropped by default)")
    parser.add_argument("--environment", default="auto",
                        choices=["auto", "procedural", "worldlabs"])
    args = parser.parse_args()

    build_world(
        args.audio,
        title=args.title,
        world_id=args.id,
        use_tripo=not args.no_tripo,
        environment_provider=args.environment,
        reuse_stems=pathlib.Path(args.stems) if args.stems else None,
        dedication=args.dedication,
        demucs_model=args.model,
        quiet_floor=0.0 if args.keep_quiet else 0.08,
    )


if __name__ == "__main__":
    main()
