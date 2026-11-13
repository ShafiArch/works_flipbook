/* Page order tool.
   Edits content/book.json (the order, labels and settings) and pages/manifest.json
   (sizes of the files in pages/). New pages are read in the browser, their web and
   thumbnail copies are made here too, and everything goes out either as a zip to
   upload or straight to GitHub with Publish (assets/github.js).

   The draft (order and settings, not the new image files) is kept in this
   browser until it is published or discarded. */
(function () {
  "use strict";
  var D = window.BookData, GH = window.GH;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return [].slice.call((el || document).querySelectorAll(s)); };
  var DRAFT = "flipbook-draft-v1";
  var WEB_PAGE = 1600, THUMB_PAGE = 200;

  var book = null, manifest = null, baseline = "", baseManifest = "";
  var added = {};        // file name -> { orig: Blob, web: Blob, thumb: Blob, urlWeb, urlThumb }
  var removed = {};      // file name -> true (delete from the repository on publish)
  var insertAt = null;   // row index for "insert after" file adds

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pretty(o) { return JSON.stringify(o, null, 2) + "\n"; }
  function toast(text, bad) { var t = document.createElement("div"); t.className = "m-toast" + (bad ? " is-bad" : ""); t.textContent = text; document.body.appendChild(t); setTimeout(function () { t.classList.add("out"); }, 3400); setTimeout(function () { t.remove(); }, 4000); }
  function cleanName(name) {
    var m = name.match(/^(.*?)(\.[^.]+)?$/), base = m[1], ext = (m[2] || "").toLowerCase();
    base = base.replace(/\s*copy(\s*\d+)?$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "page";
    if (ext === ".jpeg") ext = ".jpg";
    if (ext !== ".webp" && ext !== ".jpg" && ext !== ".png") ext = ".webp";
    return base + ext;
  }
  function stem(f) { return f.replace(/\.[^.]+$/, ""); }
  function thumbURL(file) { return added[file] ? added[file].urlThumb : D.src(file).thumb; }
  function status() {
    var changed = pretty(book) !== baseline || pretty(manifest) !== baseManifest || Object.keys(added).length || Object.keys(removed).length;
    var el = $("[data-status]");
    el.textContent = changed ? "Unpublished changes" : "No changes";
    el.classList.toggle("has-changes", !!changed);
    $("[data-reset]").disabled = !changed;
    return !!changed;
  }
  function saveDraft() {
    try { localStorage.setItem(DRAFT, JSON.stringify({ book: book, manifest: manifest, removed: removed, baseline: baseline, baseManifest: baseManifest })); } catch (e) {}
    status();
  }
  function loadDraft() { try { return JSON.parse(localStorage.getItem(DRAFT) || "null"); } catch (e) { return null; } }

  /* ---------- load ---------- */
  function start() {
    GH.setFallbackRepo("ShafiArch/works_flipbook");
    GH.button($("[data-gh]"));
    $("[data-theme-switch]").appendChild(window.BOOK_THEMES.switchEl());
    D.load().then(function (r) {
      baseline = pretty(r.book); baseManifest = pretty(r.manifest);
      var d = loadDraft();
      if (d && d.book && (pretty(d.book) !== d.baseline || pretty(d.manifest) !== d.baseManifest || (d.removed && Object.keys(d.removed).length))) {
        book = d.book; manifest = d.manifest; removed = d.removed || {};
        if (d.baseline !== baseline || d.baseManifest !== baseManifest) banner("The book changed on GitHub since this draft was saved. Your draft is shown; Discard changes loads the current version.");
      } else { book = r.book; manifest = r.manifest; }
      if (!Array.isArray(book.pages)) book.pages = [];
      if (!manifest.files) manifest.files = {};
      render(); renderSettings(); status();
    }).catch(function (e) { $("[data-rows]").innerHTML = '<li class="m-error">' + esc(e.message) + "</li>"; });
  }
  function banner(text) { var b = $("[data-banner]"); b.textContent = text; b.hidden = false; }

  /* ---------- rows ---------- */
  function pageList() { return D.pages(book, manifest); }
  function spreadList() { return D.spreads(pageList(), book.coverAlone); }
  function rowInfo() {
    /* per item: first and last page number, kind, alignment problem */
    var pages = pageList(), info = [];
    book.pages.forEach(function (item, i) {
      var mine = pages.filter(function (p) { return p.item === i; });
      var spread = mine.length === 2;
      var bad = spread && book.coverAlone !== false && mine[0].n % 2 === 1 || spread && book.coverAlone === false && mine[0].n % 2 === 0;
      info.push({ first: mine[0] ? mine[0].n : 0, last: mine.length ? mine[mine.length - 1].n : 0, spread: spread, bad: bad });
    });
    return info;
  }

  function render() {
    var rows = $("[data-rows]"), info = rowInfo();
    rows.innerHTML = "";
    if (!book.pages.length) rows.innerHTML = '<li class="m-row m-muted">No pages yet. Add pages from files.</li>';
    book.pages.forEach(function (item, i) {
      var li = document.createElement("li"), r = info[i];
      li.className = "m-row" + (r.bad ? " is-bad" : "") + (item.file && added[item.file] ? " is-new" : "");
      li.draggable = true; li.dataset.i = i;
      var thumb;
      if (item.blank || !item.file) thumb = '<div class="m-thumb blank"></div>';
      else if (r.spread) thumb = '<div class="m-thumb"><div class="L" style="background-image:url(' + thumbURL(item.file) + ')"></div><div class="R" style="background-image:url(' + thumbURL(item.file) + ')"></div></div>';
      else thumb = '<div class="m-thumb"><div style="background-image:url(' + thumbURL(item.file) + ')"></div></div>';
      var missing = item.file && !manifest.files[item.file] && !added[item.file];
      li.innerHTML =
        '<span class="m-grip" title="Drag to reorder">||||</span>' +
        '<span class="m-n">' + (r.spread ? r.first + " to " + r.last : r.first) + "</span>" + thumb +
        '<div class="m-main-cell"><div><span class="m-name">' + esc(item.blank || !item.file ? "Blank page" : item.file) + '</span><span class="m-kind">' +
        (item.blank || !item.file ? "takes one page number" : r.spread ? "spread, two pages" : "single page") + (missing ? ". Not in pages/ (missing file)" : "") + "</span></div>" +
        '<div class="m-labels"><input type="text" data-label placeholder="' + (r.spread ? "Section name (left page)" : "Section name, for the contents list") + '" value="' + esc(item.label || "") + '">' +
        (r.spread ? '<input type="text" data-label-right placeholder="Section name (right page)" value="' + esc(item.labelRight || "") + '">' : "") + "</div>" +
        (r.bad ? '<span class="m-warn">This spread would start on a ' + (book.coverAlone !== false ? "right" : "left") + '-hand page and be split across two views. Add a blank page before it, or move a single page.</span>' : "") + "</div>" +
        '<div class="m-row-btns">' +
        '<button type="button" class="m-icon" data-up aria-label="Move up" title="Move up"' + (i === 0 ? " disabled" : "") + ">&#8593;</button>" +
        '<button type="button" class="m-icon" data-down aria-label="Move down" title="Move down"' + (i === book.pages.length - 1 ? " disabled" : "") + ">&#8595;</button>" +
        '<span class="m-menu"><button type="button" class="m-icon" data-menu aria-label="More" title="More">&#8230;</button><div class="m-menu-list" hidden>' +
        '<button type="button" data-blank-before>Blank page before</button><button type="button" data-blank-after>Blank page after</button>' +
        '<button type="button" data-files-after>Pages from files after</button>' +
        '<button type="button" data-open>Open the book here</button>' +
        '<button type="button" class="is-bad" data-remove>' + (item.blank || !item.file ? "Remove" : "Take out of the book") + "</button></div></span></div>";
      rows.appendChild(li);
      $("[data-label]", li).oninput = function () { item.label = this.value; saveDraft(); };
      var lr = $("[data-label-right]", li); if (lr) lr.oninput = function () { item.labelRight = this.value; saveDraft(); };
      $("[data-up]", li).onclick = function () { move(i, i - 1); };
      $("[data-down]", li).onclick = function () { move(i, i + 1); };
      $("[data-blank-before]", li).onclick = function () { book.pages.splice(i, 0, { blank: true }); rerender(); };
      $("[data-blank-after]", li).onclick = function () { book.pages.splice(i + 1, 0, { blank: true }); rerender(); };
      $("[data-files-after]", li).onclick = function () { insertAt = i + 1; $("[data-file-input]").click(); };
      $("[data-open]", li).onclick = function () { window.open("./#p=" + r.first, "_blank"); };
      $("[data-remove]", li).onclick = function () { book.pages.splice(i, 1); rerender(); };
      var mb = $("[data-menu]", li), ml = $(".m-menu-list", li);
      mb.onclick = function (e) { e.stopPropagation(); var open = ml.hidden; $$(".m-menu-list").forEach(function (m) { m.hidden = true; }); ml.hidden = !open; };
    });
    dragAndDrop(rows);
    renderPreview(info);
    renderUnused();
  }
  document.addEventListener("click", function () { $$(".m-menu-list").forEach(function (m) { m.hidden = true; }); });

  function rerender() { saveDraft(); render(); }
  function move(from, to) {
    if (to < 0 || to >= book.pages.length) return;
    var it = book.pages.splice(from, 1)[0]; book.pages.splice(to, 0, it); rerender();
  }
  function dragAndDrop(list) {
    var dragI = null;
    $$(".m-row[draggable]", list).forEach(function (li) {
      li.addEventListener("dragstart", function (e) { dragI = +li.dataset.i; li.classList.add("is-drag"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", String(dragI)); } catch (x) {} });
      li.addEventListener("dragend", function () { li.classList.remove("is-drag"); $$(".is-over", list).forEach(function (x) { x.classList.remove("is-over"); }); });
      li.addEventListener("dragover", function (e) { e.preventDefault(); li.classList.add("is-over"); });
      li.addEventListener("dragleave", function () { li.classList.remove("is-over"); });
      li.addEventListener("drop", function (e) {
        e.preventDefault(); var to = +li.dataset.i;
        if (dragI == null || dragI === to) return;
        var it = book.pages.splice(dragI, 1)[0]; book.pages.splice(to, 0, it); dragI = null; rerender();
      });
    });
  }

  /* ---------- pairing preview ---------- */
  function renderPreview(info) {
    var box = $("[data-preview]"); box.innerHTML = "";
    spreadList().forEach(function (s) {
      var c = document.createElement("button"); c.type = "button"; c.className = "m-cell";
      var bad = [s.left, s.right].some(function (p) { return p && info[p.item] && info[p.item].bad; });
      if (bad) c.classList.add("is-bad");
      var pair = document.createElement("div"); pair.className = "pair";
      [["L", s.left], ["R", s.right]].forEach(function (x) {
        var d = document.createElement("div"); d.className = x[0] + (x[1] ? (x[1].blank ? " blank" : "") : " none");
        if (x[1] && x[1].file) { d.style.backgroundImage = "url(" + thumbURL(x[1].file) + ")"; if (!x[1].half) d.style.backgroundPosition = "center"; }
        pair.appendChild(d);
      });
      var small = document.createElement("small"); small.textContent = s.left && s.right ? s.left.n + " to " + s.right.n : String(s.first);
      c.appendChild(pair); c.appendChild(small);
      c.onclick = function () { var row = $('.m-row[data-i="' + (s.left || s.right).item + '"]'); if (row) { row.scrollIntoView({ block: "center", behavior: "smooth" }); row.style.outline = "2px solid var(--accent)"; setTimeout(function () { row.style.outline = ""; }, 1200); } };
      box.appendChild(c);
    });
  }

  /* ---------- files not in the book ---------- */
  function renderUnused() {
    var used = {}; book.pages.forEach(function (p) { if (p.file) used[p.file] = true; });
    var names = Object.keys(manifest.files).filter(function (f) { return !used[f]; }).sort();
    var sec = $("[data-unused-sec]"), ul = $("[data-unused]");
    sec.hidden = !names.length; ul.innerHTML = "";
    names.forEach(function (f) {
      var li = document.createElement("li"); li.className = "m-row";
      var m = manifest.files[f], spread = D.isSpread({ file: f }, book, manifest);
      li.innerHTML = '<div class="m-thumb">' + (spread ? '<div class="L" style="background-image:url(' + thumbURL(f) + ')"></div><div class="R" style="background-image:url(' + thumbURL(f) + ')"></div>' : '<div style="background-image:url(' + thumbURL(f) + ')"></div>') + "</div>" +
        '<div class="m-main-cell"><div><span class="m-name">' + esc(f) + '</span><span class="m-kind">' + (spread ? "spread" : "single page") + (m && m.w ? ", " + m.w + " by " + m.h + " px" : "") + (removed[f] ? ". Will be deleted on publish" : "") + "</span></div></div>" +
        '<div class="m-row-btns"><button type="button" class="m-btn m-small" data-add>Add to the end</button>' +
        (removed[f] ? '<button type="button" class="m-btn m-small" data-keep>Keep</button>' : '<button type="button" class="m-btn m-small m-ghost-bad" data-del>Delete from repository</button>') + "</div>";
      $("[data-add]", li).onclick = function () { delete removed[f]; book.pages.push({ file: f }); rerender(); };
      var del = $("[data-del]", li); if (del) del.onclick = function () {
        if (del.dataset.sure !== "1") { del.dataset.sure = "1"; del.textContent = "Really delete?"; setTimeout(function () { del.dataset.sure = ""; del.textContent = "Delete from repository"; }, 2500); return; }
        removed[f] = true; rerender();
      };
      var keep = $("[data-keep]", li); if (keep) keep.onclick = function () { delete removed[f]; rerender(); };
      ul.appendChild(li);
    });
  }

  /* ---------- settings ---------- */
  function renderSettings() {
    var f = $("[data-settings]");
    f.title.value = book.title || ""; f.author.value = book.author || "";
    f.coverAlone.checked = book.coverAlone !== false; f.hires.checked = book.hires !== false;
    f.oninput = function () {
      book.title = f.title.value; book.author = f.author.value;
      var ca = f.coverAlone.checked; book.coverAlone = ca; book.hires = f.hires.checked;
      saveDraft(); render();
    };
    renderLinks();
    $("[data-add-link]").onclick = function () { (book.links = book.links || []).push({ label: "", href: "" }); saveDraft(); renderLinks(); };
  }
  function renderLinks() {
    var box = $("[data-links]"); box.innerHTML = "";
    (book.links || []).forEach(function (l, i) {
      var row = document.createElement("div"); row.className = "m-link-row";
      row.innerHTML = '<input placeholder="Label" value="' + esc(l.label) + '"><input placeholder="https://" value="' + esc(l.href) + '"><button type="button" class="m-icon" aria-label="Remove">&#215;</button>';
      var ins = $$("input", row);
      ins[0].oninput = function () { l.label = this.value; saveDraft(); };
      ins[1].oninput = function () { l.href = this.value; saveDraft(); };
      $("button", row).onclick = function () { book.links.splice(i, 1); saveDraft(); renderLinks(); };
      box.appendChild(row);
    });
  }

  /* ---------- adding pages from files ---------- */
  $("[data-add-blank]").onclick = function () { book.pages.push({ blank: true }); rerender(); };
  $("[data-add-files]").onclick = function () { insertAt = null; $("[data-file-input]").click(); };
  $("[data-file-input]").onchange = function () {
    var files = [].slice.call(this.files); this.value = "";
    if (!files.length) return;
    var at = insertAt == null ? book.pages.length : insertAt, n = 0;
    toast("Reading " + files.length + " file" + (files.length > 1 ? "s" : ""));
    files.reduce(function (p, file) {
      return p.then(function () { return prepare(file).then(function (name) { book.pages.splice(at + n, 0, { file: name }); n++; }); })
        .catch(function (e) { toast(file.name + ": " + e.message, true); });
    }, Promise.resolve()).then(function () { rerender(); if (n) toast(n + " page file" + (n > 1 ? "s" : "") + " added"); });
  };

  /* read an image, make its web and thumbnail copies, register it in the manifest */
  function prepare(file) {
    var name = cleanName(file.name), base = stem(name), k = 1;
    while (manifest.files[name] && !added[name]) { name = base + "-" + (++k) + name.slice(name.lastIndexOf(".")); }
    return createImageBitmap(file).catch(function () { throw new Error("not an image the browser can read (use WebP, JPG or PNG)"); }).then(function (bmp) {
      var w = bmp.width, h = bmp.height, spread = w / h > D.ratio(book) * 1.5, per = spread ? 2 : 1;
      var mob = spread ? [halfOf(bmp, 0), halfOf(bmp, 1)] : [shrinkW(bmp, 0, 0, w, h, 0.76)];
      return Promise.all([shrink(bmp, WEB_PAGE * per, 0.8), shrink(bmp, THUMB_PAGE * per, 0.7)].concat(mob)).then(function (r) {
        bmp.close && bmp.close();
        var orig = /\.(webp|jpe?g|png)$/i.test(file.name) ? file : null;
        var p = orig ? Promise.resolve(orig) : shrink(bmp, Math.max(w, h), 0.92);
        return p.then(function (origBlob) {
          added[name] = { orig: origBlob, web: r[0], thumb: r[1], m: r.slice(2), urlWeb: URL.createObjectURL(r[0]), urlThumb: URL.createObjectURL(r[1]) };
          manifest.files[name] = { w: w, h: h, spread: spread };
          return name;
        });
      });
    });
  }
  /* phone copies: one page per file, 1100 px wide; a spread is cut into its halves */
  function halfOf(bmp, side) { var hw = Math.floor(bmp.width / 2); return shrinkW(bmp, side ? hw : 0, 0, side ? bmp.width - hw : hw, bmp.height, 0.76); }
  function shrinkW(bmp, sx, sy, sw, sh, q) {
    var s = Math.min(1, 1100 / sw), c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(sw * s)); c.height = Math.max(1, Math.round(sh * s));
    var ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = "high"; ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return new Promise(function (res, rej) { c.toBlob(function (b) { if (b) res(b); else rej(new Error("could not encode the image")); }, "image/webp", q); });
  }
  function shrink(bmp, longest, q) {
    var s = Math.min(1, longest / Math.max(bmp.width, bmp.height));
    var c = document.createElement("canvas"); c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
    var ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = "high"; ctx.drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise(function (res, rej) { c.toBlob(function (b) { if (b) res(b); else rej(new Error("could not encode the image")); }, "image/webp", q); });
  }

  /* ---------- discard, zip, publish ---------- */
  $("[data-reset]").onclick = function () {
    if (!confirm("Discard the unpublished changes and reload the book as it is on GitHub?")) return;
    try { localStorage.removeItem(DRAFT); } catch (e) {}
    Object.keys(added).forEach(function (k) { URL.revokeObjectURL(added[k].urlWeb); URL.revokeObjectURL(added[k].urlThumb); });
    added = {}; removed = {}; location.reload();
  };
  window.addEventListener("beforeunload", function (e) { if (Object.keys(added).length) { e.preventDefault(); e.returnValue = ""; } });

  function changedFiles(remoteBook, remoteManifest) {
    /* what to write: book.json and manifest.json if they differ from what is there, plus new and deleted image files */
    var files = [];
    var m = JSON.parse(JSON.stringify(remoteManifest || { files: {} }));
    m.files = m.files || {};
    Object.keys(manifest.files).forEach(function (f) { if (added[f]) m.files[f] = manifest.files[f]; });
    Object.keys(removed).forEach(function (f) { delete m.files[f]; });
    if (remoteBook === null || pretty(book) !== pretty(remoteBook)) files.push({ path: "content/book.json", text: pretty(book), why: "page order and settings" });
    if (remoteManifest === null || pretty(m) !== pretty(remoteManifest)) files.push({ path: "pages/manifest.json", text: pretty(m), why: "file sizes" });
    Object.keys(added).forEach(function (f) {
      files.push({ path: "pages/" + f, blob: added[f].orig, why: "original" });
      files.push({ path: "pages/web/" + stem(f) + ".webp", blob: added[f].web, why: "web copy" });
      files.push({ path: "pages/thumb/" + stem(f) + ".webp", blob: added[f].thumb, why: "thumbnail" });
      var m = added[f].m || [];
      if (m.length === 2) { files.push({ path: "pages/m/" + stem(f) + "-L.webp", blob: m[0], why: "phone copy" }); files.push({ path: "pages/m/" + stem(f) + "-R.webp", blob: m[1], why: "phone copy" }); }
      else if (m.length === 1) files.push({ path: "pages/m/" + stem(f) + ".webp", blob: m[0], why: "phone copy" });
    });
    Object.keys(removed).forEach(function (f) {
      files.push({ path: "pages/" + f, remove: true }); files.push({ path: "pages/web/" + stem(f) + ".webp", remove: true }); files.push({ path: "pages/thumb/" + stem(f) + ".webp", remove: true });
      (manifest.files[f] && manifest.files[f].spread ? ["-L", "-R"] : [""]).forEach(function (x) { files.push({ path: "pages/m/" + stem(f) + x + ".webp", remove: true }); });
    });
    return { files: files, manifest: m };
  }

  $("[data-download]").onclick = function () {
    var plan = changedFiles(JSON.parse(baseline), JSON.parse(baseManifest));
    var keep = plan.files.filter(function (f) { return !f.remove; });
    if (!keep.length) { toast("Nothing has changed."); return; }
    Promise.all(keep.map(function (f) {
      if (f.text) return Promise.resolve({ name: f.path, data: new TextEncoder().encode(f.text) });
      return f.blob.arrayBuffer().then(function (b) { return { name: f.path, data: new Uint8Array(b) }; });
    })).then(function (entries) {
      var dels = plan.files.filter(function (f) { return f.remove; }).map(function (f) { return f.path; });
      entries.push({ name: "README-upload.txt", data: new TextEncoder().encode(
        "Unzip and upload these files into the works_flipbook repository, keeping the folders.\n" +
        "Existing files with the same names are replaced.\n" + (dels.length ? "\nAlso delete by hand:\n" + dels.join("\n") + "\n" : "")) });
      var blob = window.Zip.make(entries), a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "flipbook-update.zip"; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    });
  };

  $("[data-publish]").onclick = function () {
    GH.publish({
      title: "Publish the page order", message: "Update the page order",
      build: function () {
        return Promise.all([GH.read("content/book.json"), GH.read("pages/manifest.json")]).then(function (r) {
          var remoteBook = r[0] ? JSON.parse(r[0]) : null, remoteManifest = r[1] ? JSON.parse(r[1]) : null;
          var plan = changedFiles(remoteBook, remoteManifest), conflicts = [], notes = [];
          if (remoteBook && pretty(remoteBook) !== baseline) conflicts.push("content/book.json (the order or settings) was changed on GitHub after you opened this tool.");
          if (Object.keys(added).length) notes.push(Object.keys(added).length + " new page file(s) will be uploaded with their web and thumbnail copies.");
          if (Object.keys(removed).length) notes.push(Object.keys(removed).length + " file(s) will be deleted from pages/.");
          return { files: plan.files, conflicts: conflicts, notes: notes, manifest: plan.manifest };
        });
      },
      done: function (c, plan) {
        baseline = pretty(book); manifest = plan.manifest; baseManifest = pretty(manifest);
        added = {}; removed = {};
        try { localStorage.removeItem(DRAFT); } catch (e) {}
        render(); status();
      }
    });
  };

  start();
})();
