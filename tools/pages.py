#!/usr/bin/env python3
"""Prepare the page images for the flipbook.

Run from anywhere:  python3 tools/pages.py [--check]

What it does, in order:
1. Moves image files left in the repository root into pages/, then tidies file
   names in pages/ (lower case, hyphens, no " copy" suffix). References in
   content/book.json are updated to match.
2. Makes the two smaller copies the viewer needs for every original in pages/:
   pages/web/<name>.webp   up to 1600 px per page (3200 for a spread), what the viewer shows
   pages/thumb/<name>.webp up to 200 px per page, for the thumbnail strip and the tool
   Originals stay untouched at full size; the viewer loads them when zoomed in.
3. Writes pages/manifest.json: every original with its size, so the viewer and the
   tool know which files are spreads (about twice as wide as tall) without loading them.

The GitHub workflow (.github/workflows/book.yml) runs this after every push, so a
file dropped into pages/ by any route is ready a minute later. --check only reports
what would change (exit code 1 when something is missing); it writes nothing.
"""
import json
import os
import re
import sys

from PIL import Image

Image.MAX_IMAGE_PIXELS = None  # the spreads are about 35 megapixels

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PAGES = os.path.join(ROOT, "pages")
WEB = os.path.join(PAGES, "web")
THUMB = os.path.join(PAGES, "thumb")
BOOK = os.path.join(ROOT, "content", "book.json")
MANIFEST = os.path.join(PAGES, "manifest.json")
EXT = (".webp", ".jpg", ".jpeg", ".png", ".tif", ".tiff")
WEB_PAGE = 1600     # longest side of one page in the web copy
THUMB_PAGE = 200
WEB_Q = 80
THUMB_Q = 70

CHECK = "--check" in sys.argv
problems = []


def clean_name(name):
    base, ext = os.path.splitext(name)
    base = re.sub(r"\s*copy(\s*\d+)?$", "", base, flags=re.I)
    base = re.sub(r"[^a-z0-9]+", "-", base.lower()).strip("-") or "page"
    ext = ext.lower()
    if ext in (".jpeg",):
        ext = ".jpg"
    if ext in (".tif", ".tiff"):
        ext = ".webp"  # converted below
    return base + ext


def load_book():
    try:
        with open(BOOK, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def originals():
    return sorted(n for n in os.listdir(PAGES) if n.lower().endswith(EXT) and os.path.isfile(os.path.join(PAGES, n)))


def sweep_root():
    """Image files dropped in the repository root belong in pages/."""
    for name in sorted(os.listdir(ROOT)):
        src = os.path.join(ROOT, name)
        if not os.path.isfile(src) or not name.lower().endswith(EXT) or name.startswith("."):
            continue
        if CHECK:
            problems.append(f"{name} is in the repository root; it belongs in pages/ (run tools/pages.py).")
            continue
        dest = os.path.join(PAGES, name)
        if os.path.exists(dest):
            problems.append(f"{name} is in the root and also in pages/. Delete one by hand.")
            continue
        os.rename(src, dest)
        print(f"moved    {name}  ->  pages/{name}")


def tidy_names():
    """Rename untidy files and fix book.json to match. Returns {old: new}."""
    renamed = {}
    taken = set(originals())
    for name in originals():
        new = clean_name(name)
        if new == name:
            continue
        if new in taken:
            problems.append(f"pages/{name} would become pages/{new}, which already exists. Rename one of them by hand.")
            continue
        if CHECK:
            problems.append(f"pages/{name} should be renamed to pages/{new}.")
            continue
        src = os.path.join(PAGES, name)
        if name.lower().endswith((".tif", ".tiff")):
            Image.open(src).convert("RGB").save(os.path.join(PAGES, new), "WEBP", quality=100, method=4)
            os.remove(src)
        else:
            os.rename(src, os.path.join(PAGES, new))
        taken.discard(name)
        taken.add(new)
        renamed[name] = new
        print(f"renamed  {name}  ->  {new}")
    if renamed:
        book = load_book()
        if book:
            for item in book.get("pages", []):
                if item.get("file") in renamed:
                    item["file"] = renamed[item["file"]]
            save_json(BOOK, book)
    return renamed


def fit(im, longest):
    w, h = im.size
    scale = min(1.0, longest / max(w, h))
    if scale >= 1.0:
        return im
    return im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)


def is_spread(w, h, page_ratio):
    return w / h > page_ratio * 1.5


def derive(page_ratio):
    os.makedirs(WEB, exist_ok=True)
    os.makedirs(THUMB, exist_ok=True)
    manifest = {}
    for name in originals():
        src = os.path.join(PAGES, name)
        stem = os.path.splitext(name)[0]
        web = os.path.join(WEB, stem + ".webp")
        thumb = os.path.join(THUMB, stem + ".webp")
        try:
            with Image.open(src) as im:
                w, h = im.size
                spread = is_spread(w, h, page_ratio)
                manifest[name] = {"w": w, "h": h, "spread": spread}
                need = [p for p in (web, thumb) if not os.path.exists(p)]
                if not need:
                    continue
                if CHECK:
                    problems.append(f"pages/{name} has no web or thumb copy yet (run tools/pages.py).")
                    continue
                rgb = im.convert("RGB")
                per = 2 if spread else 1
                if web in need:
                    fit(rgb, WEB_PAGE * per).save(web, "WEBP", quality=WEB_Q, method=4)
                if thumb in need:
                    fit(rgb, THUMB_PAGE * per).save(thumb, "WEBP", quality=THUMB_Q, method=4)
                print(f"prepared {name}  ({w}x{h}, {'spread' if spread else 'single'})")
        except Exception as e:  # unreadable file
            problems.append(f"pages/{name} could not be read as an image ({e}).")
    # drop copies whose original is gone
    for folder in (WEB, THUMB):
        for n in os.listdir(folder):
            stem = os.path.splitext(n)[0]
            if not any(os.path.splitext(o)[0] == stem for o in manifest):
                if CHECK:
                    problems.append(f"{os.path.relpath(os.path.join(folder, n), ROOT)} has no original any more.")
                else:
                    os.remove(os.path.join(folder, n))
                    print(f"removed  {os.path.relpath(os.path.join(folder, n), ROOT)}")
    return manifest


def main():
    os.makedirs(PAGES, exist_ok=True)
    book = load_book() or {}
    page_ratio = float(book.get("pageRatio") or 1.414)
    sweep_root()
    tidy_names()
    manifest = derive(page_ratio)
    data = {"note": "Written by tools/pages.py. Lists every original in pages/ with its size.", "files": manifest}
    current = None
    try:
        with open(MANIFEST, encoding="utf-8") as f:
            current = json.load(f).get("files")
    except (FileNotFoundError, ValueError):
        pass
    if current != manifest:
        if CHECK:
            problems.append("pages/manifest.json is out of date (run tools/pages.py).")
        else:
            save_json(MANIFEST, data)
            print("wrote    pages/manifest.json")
    for p in problems:
        print("problem  " + p)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
