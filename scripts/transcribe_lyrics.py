"""Hear the words in a vocal stem, with the moment each one is sung.

    python scripts/transcribe_lyrics.py billie-jean
    python scripts/transcribe_lyrics.py --all --model medium

Runs faster-whisper on the separated vocals (not the mix: without the band
underneath it hears far more) and keeps word-level timestamps. spaCy then
marks the nouns, which are the candidates for becoming objects in the world.

Whisper mishears sung words. That is left in on purpose: every kid got the
lyrics wrong, and a world built from what was heard is closer to the theme
than one built from the printed sheet.

The transcript is written to <world>/_work/lyrics.json, which is never
exported: the site gets objects and times, not the text of anybody's song.
"""
import argparse
import json
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from backend.pipeline import config


def transcribe(vocals: pathlib.Path, model_size: str):
    from faster_whisper import WhisperModel

    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        str(vocals),
        language="en",
        word_timestamps=True,
        vad_filter=True,
        beam_size=5,
        # A song repeats itself by design; without this whisper tends to
        # decide the chorus is a loop it is stuck in and stops listening.
        condition_on_previous_text=False,
    )
    words = []
    for segment in segments:
        for word in segment.words or []:
            words.append({
                "word": word.word,
                "start": round(word.start, 3),
                "end": round(word.end, 3),
                "p": round(word.probability, 3),
            })
    return words, info


def mark_nouns(words: list[dict]) -> list[dict]:
    """Tag each heard word with its part of speech and lemma."""
    import spacy

    nlp = spacy.load("en_core_web_sm")
    text, spans = "", []
    for word in words:
        start = len(text)
        text += word["word"]
        spans.append((start, len(text)))

    doc = nlp(text)
    for token in doc:
        # The whisper word whose characters this token starts in.
        for index, (start, end) in enumerate(spans):
            if start <= token.idx < end:
                if token.is_alpha and not token.is_stop:
                    words[index]["pos"] = token.pos_
                    words[index]["lemma"] = token.lemma_.lower()
                break
    return words


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("world", nargs="?")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--model", default="small",
                        help="whisper size: small is quick, medium hears more")
    args = parser.parse_args()
    if not args.world and not args.all:
        parser.error("name a world, or pass --all")

    ids = ([p.parent.name for p in sorted(config.CACHE_DIR.glob("*/world.json"))]
           if args.all else [args.world])

    for world_id in ids:
        world_dir = config.CACHE_DIR / world_id
        vocals = world_dir / "stems" / "vocals.mp3"
        if not vocals.exists():
            print(f"{world_id}: no vocal stem, skipped")
            continue

        started = time.time()
        words, info = transcribe(vocals, args.model)
        words = mark_nouns(words)
        took = time.time() - started

        out = world_dir / "_work" / "lyrics.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps({
            "model": args.model, "duration": round(info.duration, 2),
            "words": words,
        }, indent=1), encoding="utf-8")

        nouns = [w for w in words if w.get("pos") in ("NOUN", "PROPN")]
        unique = sorted({w["lemma"] for w in nouns})
        confident = [w for w in words if w["p"] >= 0.6]
        mean_p = sum(w["p"] for w in words) / max(len(words), 1)
        print(f"\n=== {world_id} · whisper {args.model} · {took:.0f}s for "
              f"{info.duration:.0f}s of audio ===")
        print(f"  words heard      {len(words)}  (mean confidence {mean_p:.2f}, "
              f"{len(confident)} above 0.6)")
        print(f"  noun occurrences {len(nouns)}")
        print(f"  distinct nouns   {len(unique)}")
        if nouns:
            print(f"  first noun at    {nouns[0]['start']:.1f}s")
        print(f"  written to       {out.relative_to(config.ROOT)}")


if __name__ == "__main__":
    main()
