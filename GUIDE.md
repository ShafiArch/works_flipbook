# Flipbook: owner's guide

The portfolio as a book you page through, at https://shafiarch.github.io/works_flipbook/.
Plain HTML, CSS and JavaScript on GitHub Pages; no build step. Everything the book
shows comes from two files and one folder:

| What | Where |
| --- | --- |
| The order of the pages, section names, title, links, settings | `content/book.json` |
| The page images, full size, exactly as exported from Photoshop | `pages/` |
| Smaller copies the viewer loads (made for you) | `pages/web/` and `pages/thumb/` |
| Sizes of the files in `pages/` (made for you) | `pages/manifest.json` |
| The viewer | `index.html`, `assets/book.js`, `assets/book.css`, the page-turn engine in `assets/vendor/` |
| The page order tool | `manage.html`, `assets/manage.js` |
| Themes | `themes/white.css`, `themes/dark.css`, `themes/clay.css`, `themes/themes.js` |
| The robot that prepares pages and checks the book | `.github/workflows/book.yml`, `tools/pages.py`, `tools/health.mjs` |

## 1. How pages work

Each file in `pages/` is either a single page (about 1.41 times as wide as tall, A3
landscape) or a spread (twice that: two pages side by side). A spread takes two page
numbers, left then right. The viewer pairs pages the way a printed book does: page 1
(the cover) stands alone on the right, pages 2 and 3 face each other, 4 and 5, and so on.

A spread must therefore start on an even page number. When a single page would push a
spread onto an odd number, add a blank page before the spread (the page order tool
tells you where). A single page always gets a blank half next to it, unless another
single page follows it: `metal-roofing-05` and `metal-roofing-06-filler` are two singles
that sit together as one view.

The viewer shows two pages side by side, edge to edge, when the window is wider than it
is tall, and the same two pages one above the other on a phone held upright. The "1 page"
button switches to a single page at a time. Pages turn like paper: mouse wheel, a click
on a page (left half back, right half forward), swipe, arrow keys, the slider, the
thumbnail strip and the Contents list. Pinch, Ctrl+wheel, the zoom buttons or a double
click (or two taps) zoom in; when zoomed, the wheel and dragging pan. On a computer the
zoomed page loads the full-size original for crisp text.

## 2. Adding, removing and reordering pages: the page order tool

Open https://shafiarch.github.io/works_flipbook/manage.html

- Drag a row, or use the arrows, to reorder.
- The `...` menu on a row: blank page before or after, pages from files after this one,
  open the book at this page, take the page out of the book.
- "Add pages from files" reads WebP, JPG or PNG straight from your computer, makes the
  web and thumbnail copies in the browser, and adds the pages at the end. Spread or
  single is detected from the image size.
- Section names: the first box names the page (or the left page of a spread) in the
  Contents list of the viewer; the second box names the right page of a spread.
- "How the pages pair" on the right shows every view with its page numbers; a cell with
  a red outline holds a spread that is split. Click a cell to jump to its row.
- "Files not in the book" lists files in `pages/` that are not used. Add one back, or
  delete it from the repository.
- Book settings: title, author, whether the first page stands alone, whether zoomed
  pages load the full-size original, and the links in the top bar.

Then either:

- **Publish** (recommended): one commit straight to GitHub. The first time, connect with a
  fine-grained token for this repository (Contents: read and write); the dialog walks
  through it. The token stays in your browser.
- **Download zip**: a zip of the changed files. Unzip it and upload the files into the
  repository, keeping the folders.

The draft stays in your browser until it is published or discarded. New image files are
not kept in the draft, so publish in the same sitting when you add pages.

## 3. Adding pages without the tool

Export from Photoshop at full size (the `Webp_Save` action) and upload the files to
`pages/` on GitHub, or even to the repository root. About a minute later the robot
(Actions tab, "Book upkeep") moves them into `pages/`, tidies the names (lower case,
hyphens, no "copy"), makes the web and thumbnail copies and updates the manifest. Then
open the page order tool: the new files are under "Files not in the book"; add them and
publish.

Locally the same step is `python3 tools/pages.py` (needs Pillow: `pip install pillow`).

## 4. Themes

Three themes, switched in the top bar and remembered by the visitor's browser: White,
Dark, and Clay (an e-ink look; its `--page-filter` tones the page images slightly, set it
to `none` to show them exactly as exported). Colours live in `themes/*.css`; the theme a
first-time visitor sees is `DEFAULT` in `themes/themes.js`. `?theme=dark` in the address
opens the book in a theme.

## 5. Links

`#p=12` at the end of the address opens the book at page 12 (the viewer keeps this up to
date as you turn pages, so any page can be linked). The "Works" link in the top bar is set
in Book settings.

## 6. Keys

Right arrow, space or Page Down: next. Left arrow or Page Up: previous. Home, End. Plus,
minus and 0 for zoom. f: full screen. t: thumbnails. c: contents. Escape closes panels.

## 7. The health check

After every push and every Monday the robot checks the book: pages pointing at missing
files, missing web copies, a spread that starts on a right-hand page, files that are
too big, long dashes in text. Problems open an issue labelled `book-health` (GitHub
emails it); it closes itself when a later check is clear. Locally: `node tools/health.mjs`.

## 8. When a .js or .css file changes

Raise the number in `?v=1` on every script and stylesheet tag in both `index.html` and
`manage.html` (the same number everywhere). Otherwise visitors' browsers keep old files.

## 9. Writing rule

No em dashes or en dashes anywhere (text, code comments, JSON). Commas, semicolons,
parentheses or periods. The health check flags them.
