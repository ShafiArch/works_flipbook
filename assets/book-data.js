/* Shared by the viewer and the page order tool.

   content/book.json   the order: a list of items, each a file in pages/ or a blank
                       (label names a section for the contents list; labelRight
                       names the right page of a spread)
   pages/manifest.json every file in pages/ with its size (written by tools/pages.py)

   An item whose image is about twice as wide as a page is a spread: it takes two
   page numbers, left then right. Anything else takes one. Pages are then paired
   into spreads for the two-page view: with coverAlone the first page stands on its
   own on the right, like a closed book, and pages 2 and 3 face each other.

   window.BookData:
     load()                      Promise of { book, manifest }
     pages(book, manifest)       [{ n, file, half, blank, item, label, w, h }]
     spreads(pages, coverAlone)  [{ i, left, right, first, last }]
     isSpread(item, book, manifest)
     src(file, half)             { web, thumb, full, m }
     ratio(book)                 width divided by height of one page */
(function () {
  "use strict";

  function getJSON(path) {
    if (window.GH && window.GH.connected && window.GH.connected() && document.body.classList.contains("page-manage")) {
      return window.GH.read(path).then(function (t) { if (t == null) throw new Error(path + " is not in the repository."); return JSON.parse(t); });
    }
    return fetch(path, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("Could not load " + path + " (" + r.status + ").");
      return r.json();
    });
  }

  function load() {
    return Promise.all([getJSON("content/book.json"), getJSON("pages/manifest.json").catch(function () { return { files: {} }; })])
      .then(function (r) { return { book: r[0], manifest: r[1] }; });
  }

  function ratio(book) { var r = parseFloat(book && book.pageRatio); return r > 0 ? r : 1.414; }

  function isSpread(item, book, manifest) {
    if (!item || item.blank || !item.file) return false;
    if (typeof item.spread === "boolean") return item.spread;
    var m = manifest && manifest.files && manifest.files[item.file];
    if (m && m.w && m.h) return m.w / m.h > ratio(book) * 1.5;
    return /\d\d[-_]\d\d(\.|$)/.test(item.file);  // a name like name-01-02.webp while the manifest catches up
  }

  function pages(book, manifest) {
    var out = [], items = (book && book.pages) || [];
    items.forEach(function (item, idx) {
      if (!item) return;
      var m = manifest && manifest.files && manifest.files[item.file] || {};
      if (item.blank || !item.file) { out.push({ n: out.length + 1, blank: true, item: idx, label: item.label || "" }); return; }
      if (isSpread(item, book, manifest)) {
        out.push({ n: out.length + 1, file: item.file, half: "L", item: idx, label: item.label || "", w: m.w, h: m.h });
        out.push({ n: out.length + 1, file: item.file, half: "R", item: idx, label: item.labelRight || "", w: m.w, h: m.h });
      } else {
        out.push({ n: out.length + 1, file: item.file, half: "", item: idx, label: item.label || "", w: m.w, h: m.h });
      }
    });
    return out;
  }

  function spreads(list, coverAlone) {
    var out = [], i = 0;
    if (coverAlone !== false && list.length) { out.push({ i: 0, left: null, right: list[0] }); i = 1; }
    for (; i < list.length; i += 2) out.push({ i: out.length, left: list[i], right: list[i + 1] || null });
    out.forEach(function (s) { s.first = (s.left || s.right).n; s.last = (s.right || s.left).n; });
    return out;
  }

  /* half: "L" or "R" for one side of a spread; the phone copy (m) is already cut to that side */
  function src(file, half) {
    var stem = file.replace(/\.[^.]+$/, "");
    var enc = function (p) { return p.split("/").map(encodeURIComponent).join("/"); };
    return { full: enc("pages/" + file), web: enc("pages/web/" + stem + ".webp"), thumb: enc("pages/thumb/" + stem + ".webp"),
      m: enc("pages/m/" + stem + (half ? "-" + half : "") + ".webp") };
  }

  window.BookData = { load: load, pages: pages, spreads: spreads, isSpread: isSpread, src: src, ratio: ratio };
})();
