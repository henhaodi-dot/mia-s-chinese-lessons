#!/usr/bin/env python3
"""
Batch-generate character illustrations for Hanzi Garden using Gemini.

Usage:
  python scripts/generate_illustrations.py --api-key YOUR_KEY
  python scripts/generate_illustrations.py --api-key YOUR_KEY --only 水,火,山
  python scripts/generate_illustrations.py --api-key YOUR_KEY --redo bad_list.txt
"""

import argparse
import json
import sys
import time
from pathlib import Path
from io import BytesIO

from google import genai
from google.genai import types
from PIL import Image

# This script prints Chinese characters as it goes ("[12/80] 水 (water)...
# OK"), which crashes on Windows consoles whose default codepage isn't
# UTF-8. Force UTF-8 output so this runs the same everywhere — same fix as
# scripts/generate_audio.py.
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

# --- Config ---
PROJECT_ROOT = Path(__file__).resolve().parent.parent
CHARACTERS_FILE = PROJECT_ROOT / "data" / "characters.json"
OUTPUT_DIR = PROJECT_ROOT / "assets" / "img"
REVIEW_FILE = PROJECT_ROOT / "review" / "illustration-review.html"
IMAGE_SIZE = 512  # px, square

# The style prompt is the single most important thing in this script.
# Every image must look like it belongs in the same app, so the style
# instructions are detailed and rigid. Tweak here if the overall look
# isn't right — don't tweak per-character.
STYLE_PROMPT = """
You are illustrating a Chinese character learning app for a 7-year-old girl.

Style rules (follow every one exactly):
- Simple, cute, flat illustration style — similar to a modern children's picture book
- Bright but not neon colors, soft edges, no outlines or harsh black lines
- White or very light solid background so it works on any app screen
- One clear central subject filling most of the frame
- No text, no letters, no characters, no numbers, no labels anywhere in the image
- No watermarks, no borders, no decorative frames
- The subject should be instantly recognizable to a young child
- Friendly and warm — nothing scary, no sharp objects, no sad expressions
- Consistent proportions: the main subject takes up roughly 70-80% of the frame
"""


def load_characters(path: Path) -> list[dict]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def needs_illustration(char_entry: dict, output_dir: Path, only: set | None, redo: set | None) -> bool:
    ch = char_entry["char"]

    # If --only or --redo specified, respect that list regardless of other flags
    if only is not None:
        return ch in only
    if redo is not None:
        return ch in redo

    # Normal mode: skip non-picturable, skip already generated.
    #
    # characters.json only marks the exceptions ("picturable": false on pure
    # grammatical particles / measure words / demonstratives that have no
    # concrete subject to draw) — everything else defaults to picturable, so
    # a missing field means "yes, generate it."
    if not char_entry.get("picturable", True):
        return False
    if (output_dir / f"{ch}.png").exists():
        return False
    return True


def generate_one(client, char_entry: dict, output_dir: Path) -> tuple[str, bool, str]:
    """Generate illustration for one character. Returns (char, success, message)."""
    ch = char_entry["char"]
    meaning = char_entry.get("meaning", "")
    word = char_entry.get("word", "")
    word_meaning = char_entry.get("wordMeaning", "")

    # A manual override for characters whose meaning is too abstract for the
    # default prompt to draw well — see characters.json's "illustrationHint".
    hint = char_entry.get("illustrationHint", "")
    if hint:
        subject_prompt = f"""
Draw: {hint}

Context: This image represents the Chinese character {ch} (meaning: {meaning}).
"""
    else:
        subject_prompt = f"""
Draw: {meaning}

Context: This image represents the Chinese character {ch} (meaning: {meaning}).
The character is used in the word {word} (meaning: {word_meaning}).

Draw a single, clear illustration of "{meaning}" that a 7-year-old would
immediately point at and say the word. If the meaning is abstract, pick
the most concrete, child-friendly visual that captures it.
"""

    full_prompt = STYLE_PROMPT + "\n" + subject_prompt

    try:
        response = client.models.generate_images(
            model="imagen-3.0-generate-002",
            prompt=full_prompt,
            config=types.GenerateImagesConfig(
                number_of_images=1,
                aspect_ratio="1:1",
                safety_filter_level="BLOCK_ONLY_HIGH",
            ),
        )

        if not response.generated_images:
            return (ch, False, "No image returned — possibly blocked by safety filter")

        image_bytes = response.generated_images[0].image.image_bytes
        img = Image.open(BytesIO(image_bytes))
        img = img.resize((IMAGE_SIZE, IMAGE_SIZE), Image.LANCZOS)

        output_dir.mkdir(parents=True, exist_ok=True)
        out_path = output_dir / f"{ch}.png"
        img.save(out_path, "PNG", optimize=True)
        return (ch, True, str(out_path))

    except Exception as e:
        return (ch, False, str(e))


def generate_review_html(characters: list[dict], output_dir: Path, review_path: Path):
    """Generate an HTML page showing all illustrations in a grid for quick review."""
    review_path.parent.mkdir(parents=True, exist_ok=True)

    picturable = [c for c in characters if c.get("picturable", True)]
    has_image = [c for c in picturable if (output_dir / f"{c['char']}.png").exists()]
    missing = [c for c in picturable if not (output_dir / f"{c['char']}.png").exists()]

    cards_html = ""
    for c in has_image:
        ch = c["char"]
        img_path = f"../assets/img/{ch}.png"
        cards_html += f"""
    <div class="card">
      <img src="{img_path}" alt="{ch}">
      <div class="label">{ch}</div>
      <div class="meaning">{c.get('meaning', '')}</div>
    </div>"""

    missing_html = ""
    if missing:
        missing_chars = " ".join(c["char"] for c in missing)
        missing_html = f"""
    <div class="missing">
      <h3>Still need illustrations ({len(missing)}):</h3>
      <p class="chars">{missing_chars}</p>
    </div>"""

    html = f"""<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>Illustration Review</title>
<style>
  body {{ font-family: system-ui, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #fafafa; }}
  h1 {{ text-align: center; }}
  .stats {{ text-align: center; color: #666; margin-bottom: 20px; }}
  .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 16px; }}
  .card {{ background: white; border-radius: 12px; padding: 12px; text-align: center;
           box-shadow: 0 2px 8px rgba(0,0,0,0.08); cursor: pointer; transition: outline 0.15s; }}
  .card:hover {{ outline: 3px solid #f44; }}
  .card img {{ width: 120px; height: 120px; object-fit: contain; }}
  .label {{ font-size: 28px; margin-top: 4px; }}
  .meaning {{ font-size: 13px; color: #888; }}
  .missing {{ margin-top: 30px; padding: 20px; background: #fff3e0; border-radius: 12px; }}
  .missing .chars {{ font-size: 24px; letter-spacing: 4px; }}
  .bad-list {{ margin-top: 30px; padding: 20px; background: #e8f5e9; border-radius: 12px; }}
  .bad-list textarea {{ width: 100%; height: 60px; font-size: 18px; }}
  .instructions {{ text-align: center; color: #999; font-size: 14px; margin-bottom: 20px; }}
</style>
</head>
<body>
<h1>Illustration Review — 汉字花园</h1>
<p class="stats">{len(has_image)} illustrated · {len(missing)} missing · {len(picturable)} total picturable</p>
<p class="instructions">Click any card that looks wrong. Clicked cards turn red. Copy the bad list at the bottom and re-run the script with --redo.</p>
<div class="grid">{cards_html}</div>
{missing_html}
<div class="bad-list">
  <h3>Bad illustrations (click cards above, they appear here):</h3>
  <textarea id="badlist" readonly placeholder="Click bad cards above..."></textarea>
</div>
<script>
  const bad = new Set();
  const textarea = document.getElementById('badlist');
  document.querySelectorAll('.card').forEach(card => {{
    card.addEventListener('click', () => {{
      const ch = card.querySelector('.label').textContent;
      if (bad.has(ch)) {{ bad.delete(ch); card.style.outline = ''; }}
      else {{ bad.add(ch); card.style.outline = '3px solid #f44'; }}
      textarea.value = [...bad].join('');
    }});
  }});
</script>
</body>
</html>"""

    with open(review_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"\nReview page: {review_path}")
    print("Open it in your browser, click any bad images, copy the characters from the text box.\n")


def main():
    parser = argparse.ArgumentParser(description="Generate Hanzi Garden illustrations")
    parser.add_argument("--api-key", required=True, help="Gemini API key")
    parser.add_argument("--only", help="Comma-separated characters to generate (skip all others)")
    parser.add_argument("--redo", help="Path to a text file of characters to regenerate (overwrites existing)")
    parser.add_argument("--delay", type=float, default=4.0, help="Seconds between API calls (default 4)")
    parser.add_argument("--review-only", action="store_true", help="Just regenerate the review HTML, no API calls")
    args = parser.parse_args()

    if not CHARACTERS_FILE.exists():
        print(f"Cannot find characters.json at {CHARACTERS_FILE}")
        sys.exit(1)

    characters = load_characters(CHARACTERS_FILE)
    print(f"Loaded {len(characters)} characters from {CHARACTERS_FILE}")

    if args.review_only:
        generate_review_html(characters, OUTPUT_DIR, REVIEW_FILE)
        return

    only_set = set(args.only.split(",")) if args.only else None
    redo_set = None
    if args.redo:
        redo_path = Path(args.redo)
        if redo_path.exists():
            redo_text = redo_path.read_text(encoding="utf-8").strip()
        else:
            # Treat the argument itself as a string of characters
            redo_text = args.redo
        redo_set = set(ch for ch in redo_text if '一' <= ch <= '鿿')
        print(f"Redo mode: {len(redo_set)} characters")

    to_generate = [c for c in characters if needs_illustration(c, OUTPUT_DIR, only_set, redo_set)]

    if not to_generate:
        print("Nothing to generate. All picturable characters already have images.")
        generate_review_html(characters, OUTPUT_DIR, REVIEW_FILE)
        return

    print(f"Generating {len(to_generate)} illustrations...\n")

    client = genai.Client(api_key=args.api_key)

    results = {"success": [], "failed": []}

    for i, char_entry in enumerate(to_generate):
        ch = char_entry["char"]
        print(f"[{i+1}/{len(to_generate)}] {ch} ({char_entry.get('meaning', '')})... ", end="", flush=True)

        char_result, success, message = generate_one(client, char_entry, OUTPUT_DIR)

        if success:
            print(f"OK -> {message}")
            results["success"].append(ch)
        else:
            print(f"FAILED - {message}")
            results["failed"].append((ch, message))

        if i < len(to_generate) - 1:
            time.sleep(args.delay)

    print(f"\n{'='*40}")
    print(f"Done: {len(results['success'])} generated, {len(results['failed'])} failed")

    if results["failed"]:
        failed_chars = "".join(ch for ch, _ in results["failed"])
        print(f"\nFailed characters: {failed_chars}")
        print("Re-run with: --redo " + failed_chars)
        for ch, msg in results["failed"]:
            print(f"  {ch}: {msg}")

    generate_review_html(characters, OUTPUT_DIR, REVIEW_FILE)


if __name__ == "__main__":
    main()
