# Handoff: the flipbook

Read this first when continuing work on this repository in a new session. The
owner's manual is `GUIDE.md`; keep it in step with any change.

## What this is

Shafiul Islam's architecture portfolio as a page-turning book, published with GitHub
Pages from the `main` branch, root folder: https://shafiarch.github.io/works_flipbook/.
It is the companion of the works site (`ShafiArch/works_shafi`,
https://shafiarch.github.io/works_shafi/), which will link to it.

Owner: Shafiul Islam (Shafi), GitHub `ShafiArch`. The page images are double-bleed
A3 spreads exported from Photoshop as WebP at full size (9922 by 3508 for a spread,
4961 by 3508 for a single page). He does not want them downsized; the viewer makes
its own smaller copies.

## Rules

- No em dashes or en dashes anywhere (code comments, docs, JSON, site text); commas,
  semicolons, parentheses or periods. The health check flags them.
- Plain files, no build step. The one browser dependency is the page-turn engine
  `assets/vendor/page-flip.js` (StPageFlip 2.0.7, MIT, licence beside it), vendored so
  the book never depends on a CDN. Node and Python are used only by the robot (`tools/`).
- Whenever a `.js` or `.css` file changes, raise `?v=N` on every script and stylesheet
  tag in `index.html` and `manage.html` to the same number.
- Archivo (Google Fonts) throughout, matching the works site.

## Data model

`content/book.json`

```json
{
  "title": "Portfolio", "author": "Shafiul Islam",
  "pageRatio": 1.414, "coverAlone": true, "hires": true,
  "links": [{ "label": "Works", "href": "https://shafiarch.github.io/works_shafi/" }],
  "pages": [
    { "file": "cover-page.webp", "label": "Cover" },
    { "blank": true },
    { "file": "plastic-city-01-02.webp", "label": "Legocity", "labelRight": "" , "spread": true }
  ]
}
```

- `pages` is the order. An item is a file in `pages/` or `{ "blank": true }`.
- A file is a spread when its width divided by height is more than `pageRatio` times
  1.5 (read from `pages/manifest.json`); `"spread": true/false` on an item overrides.
- `label` names a section in the Contents list (the item's first page); `labelRight`
  names the right page of a spread.
- `coverAlone`: page 1 stands alone on the right; pages 2 and 3 face each other.
- `hires`: zoomed pages load the full-size original (only on devices with a fine pointer
  or a screen at least 1400 px wide; phones stay on the web copies).

`pages/manifest.json`: `{ "files": { "name.webp": { "w": 9922, "h": 3508, "spread": true } } }`,
written by `tools/pages.py` and by the page order tool when it adds files.

`pages/web/<stem>.webp` (up to 1600 px per page, quality 80) is what the viewer shows;
`pages/thumb/<stem>.webp` (200 px per page) for the strip and the tool. Both are made by
`tools/pages.py` (Pillow) and, for files added in the browser, by `assets/manage.js`
(canvas). The originals in `pages/` are never changed except for renaming.

## Code map

- `assets/book-data.js`: `BookData.load()`, `pages()` (items to numbered pages, L/R
  halves), `spreads()` (pages to views), `isSpread()`, `src()`. Shared by viewer and tool.
- `assets/book.js`: the viewer. Modes: `spread` (side by side, window wider than tall),
  `stack` (same pair one above the other, portrait), `single`. `fit()` sizes the book to
  the full stage width (height-bound when needed) and `build()` hands page elements to
  the engine (`new St.PageFlip(bookEl, settings)`, `loadFromHTML(items)`): every page
  of `P` in spread and single modes, one stacked pair per view of `S` in stack mode.
  Orientation is forced through `minWidth` (the engine goes portrait when the block is
  narrower than twice minWidth); `showCover` gives the lone cover. `useMouseEvents` is
  off: `gestures()` does swipe, tap or click (delayed 330 ms to allow a double), pinch,
  pan and wheel (one turn per wheel gesture, Ctrl+wheel zooms, wheel pans when zoomed).
  The engine removes its root element on `destroy()`, so `build()` makes a fresh
  `.book` inside `.zoomer` each time. Zoom is a transform on `.zoomer`; `.pan` overlays
  the book while zoomed so the engine never sees scaled coordinates. `loadNear()` sets
  image sources only near the current view (the engine keeps every page in the DOM).
  `applyHires()` lays the decoded original over the web copy at 1.5x and more;
  `dropHires()` removes them on reset. `#p=N` in the address is kept up to date.
- `assets/book.css`: layout only; tokens come from `themes/*.css` (`--bg`, `--ink`,
  `--ink-2`, `--rule`, `--accent`, `--font`, `--paper`, `--page-edge`, `--page-shadow`,
  `--page-filter`, `--spine-shade`, `--bar-bg`, `--thumb-ring`).
- `themes/themes.js`: `BOOK_THEMES` (DEFAULT, THEMES, `set()`, `switchEl()`), writes the
  stylesheet before paint; stored in `localStorage` as `flipbook-theme`; `?theme=`.
- `assets/manage.js` + `manage.css`: the page order tool. Draft in `localStorage`
  (`flipbook-draft-v1`). `changedFiles()` builds the list of files to write (book.json,
  manifest.json, new originals plus copies, deletions). `prepare()` makes copies with
  `createImageBitmap` and canvas `toBlob("image/webp")`.
- `assets/github.js`: same publishing module as the works site, keys `flipbook-gh-token`
  and `flipbook-gh-repo`; atomic commit through the git data API, fast-forward only.
- `assets/zip.js`: minimal stored zip writer for Download zip.
- `tools/pages.py`: sweep root images into `pages/`, tidy names, make copies, write the
  manifest. `--check` only reports.
- `tools/health.mjs`: checks (see GUIDE.md section 7).
- `.github/workflows/book.yml`: runs pages.py, commits what it made, requests a Pages
  build, then runs the health check and keeps the `book-health` issue.

## The order (from the printed Index page)

Cover (1), blank (2), Index (3), Legocity 4 to 12, blanks 13 and 14, Handloom 15 to 21,
Flyover 22 to 25, Metal Roofing 26 to 31 (30 and the dark filler 31 are two singles),
Architect's Center 32 to 33, Workshop Sessions 34 to 37, IDA Interior and Natural
Healing 38 to 39, Sundar Bari 40, blank 41, Sentience 42 to 44, Parametric Screening
45, Residences 46 to 55 (Shakharia, Residence, Golf Hotel), Interiors 56 to 57, Hasan
Residence with Awards and Sketches 58 to 59 (one spread, so it must stay last).

Two files are not in the book because they duplicate halves of the
`filler-tamayouz-interior` spread: `filler-page-tamayouz.webp` and
`filler-page-interior-design-competition.webp`. They show under "Files not in the book".

## Testing

Serve the folder (`python3 -m http.server 8766`) and use Playwright (pre-installed in the
cloud workspace) to screenshot `index.html` at desktop, iPhone portrait and landscape and
iPad sizes, and `manage.html`; publishing was tested against a mocked `api.github.com`
(route `https://api.github.com/**`).

## History

1. First build (November 2026): viewer with spread, stack and single modes, three
   themes, zoom with hi-res swap, strip, contents, deep links; page order tool with
   publish and zip; pages.py and health check in one workflow; order taken from the
   Index page.
2. Shafi's review of the first deploy: no fold shading at the spine (seamless spread),
   wheel turns pages, book fills the width, and paper-like page turns instead of a
   rigid leaf. Replaced the home-made leaf with the vendored page-flip engine (v=2).

## Open items

- Add the flipbook link to the works site (a Website book on the shelf or a top bar
  link) once Shafi has uploaded the remaining projects there.
- The Index page's page numbers (printed) differ slightly from the book after page 55,
  because Hasan Residence shares its spread with the Awards page.
