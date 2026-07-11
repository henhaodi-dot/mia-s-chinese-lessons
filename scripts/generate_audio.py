#!/usr/bin/env python3
"""Generates all spoken-audio MP3s for Hanzi Garden.

Requirements:
    pip install edge-tts

Usage:
    python scripts/generate_audio.py

Reads data/characters.json and data/ui_lines.json, and writes one MP3 per
line into assets/audio/, named by a stable key. That stable key is what lets
you override any single line: drop a file with the same name into
assets/audio/custom/ and the app will play that instead of the generated one.

Safe to re-run: skips any MP3 that already exists on disk, so adding new
characters later is just "edit characters.json, run this again".
"""

import asyncio
import json
import sys
from pathlib import Path

import edge_tts

# Status messages below include the Chinese characters themselves (e.g.
# "generated char_我"), which crashes on Windows consoles whose default
# codepage isn't UTF-8. Force UTF-8 output so this runs the same everywhere.
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
CHARACTERS_FILE = ROOT / "data" / "characters.json"
UI_LINES_FILE = ROOT / "data" / "ui_lines.json"
AUDIO_DIR = ROOT / "assets" / "audio"

# Every line in this app is spoken to a 7-year-old, so one gentle,
# slightly-slowed voice is used throughout.
VOICE = "zh-CN-XiaoxiaoNeural"
RATE = "-10%"


def collect_lines():
    """Returns a list of (stable_key, text) pairs for every line we need audio for."""
    lines = []

    characters = json.loads(CHARACTERS_FILE.read_text(encoding="utf-8"))
    for entry in characters:
        char = entry["char"]
        # A single character with no surrounding text gives the TTS engine
        # no sentence context, so it often clips the tone short instead of
        # letting it fall naturally. Appending a full stop (spoken silently,
        # not audible as a word) gives it a normal sentence-final contour.
        lines.append((f"char_{char}", entry["char"] + "。"))
        lines.append((f"word_{char}", entry["word"]))
        lines.append((f"sentence_{char}", entry["sentence"]))

    ui_lines = json.loads(UI_LINES_FILE.read_text(encoding="utf-8"))
    for key, entry in ui_lines.items():
        lines.append((key, entry["text"]))

    return lines


async def generate_one(key, text):
    out_path = AUDIO_DIR / f"{key}.mp3"
    # Check size, not just existence — a transient TTS failure can leave a
    # zero-byte file behind, which would otherwise be "skipped" forever.
    if out_path.exists() and out_path.stat().st_size > 0:
        return "skipped"

    communicate = edge_tts.Communicate(text, voice=VOICE, rate=RATE)
    await communicate.save(str(out_path))
    return "generated"


async def main():
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    lines = collect_lines()
    print(f"Found {len(lines)} lines to check.\n")

    generated = 0
    skipped = 0
    failed = []

    for key, text in lines:
        try:
            result = await generate_one(key, text)
            if result == "generated":
                generated += 1
                print(f"  generated {key}")
            else:
                skipped += 1
        except Exception as err:  # noqa: BLE001 - report and keep going
            failed.append(key)
            print(f"  FAILED {key}: {err}")

    print("\n--- Summary ---")
    print(f"Generated: {generated}")
    print(f"Skipped (already existed): {skipped}")
    print(f"Failed: {len(failed)}")
    if failed:
        print(f"  {' '.join(failed)}")


if __name__ == "__main__":
    asyncio.run(main())
