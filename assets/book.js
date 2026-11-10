/* The flipbook viewer.
   Pages turn like paper (the page-flip engine in assets/vendor, MIT). Two pages
   side by side when the window is wider than it is tall, the same pair one above
   the other on a phone held upright, or one page at a time with the "1 page"
   button. Mouse wheel, swipe, click on a page, arrow keys, the slider, the
   thumbnail strip and the contents list all turn pages; pinch, Ctrl+wheel, the
   zoom buttons or a double click zoom in, and a zoomed page loads the full-size
   original on computers. #p=12 in the address opens at page 12. */
(function () {
  "use strict";
  var D = window.BookData;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return [].slice.call((el || document).querySelectorAll(s)); };

  var stage = $("[data-stage]"), zoomer = $("[data-zoomer]"), bookEl = $("[data-book]"), panLayer = $("[data-pan]");
  var book, manifest, P = [], S = [], RATIO = 1.414;
  var mode = "", modePref = "auto";   // mode: spread (side by side), stack (one above the other), single
  var cur = 1;                         // current page number (first page of the current view)
  var pf = null;                       // the page-flip engine
  var items = [];                      // page elements handed to the engine, in order
  var Z = { s: 1, tx: 0, ty: 0 }, bw = 0, bh = 0, left0 = 0, top0 = 0;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var FLIP_MS = reduced ? 1 : 800;
  var hiresOK = true;

  /* ---------- load ---------- */
  D.load().then(function (r) {
    book = r.book; manifest = r.manifest; RATIO = D.ratio(book);
    document.documentElement.style.setProperty("--page-ratio", RATIO);
    P = D.pages(book, manifest);
    S = D.spreads(P, book.coverAlone);
    // full-size originals (about 35 megapixels) only on computers and large tablets; phones stay on the web copies
    hiresOK = book.hires !== false && (window.matchMedia("(pointer: fine)").matches || Math.max(screen.width, screen.height) >= 1400);
    if (!P.length) throw new Error("The book has no pages yet. Add some in the page order tool.");
    chrome();
    cur = clamp(pageFromHash() || 1);
    $("[data-loading]").hidden = true;
    fit(true);
    window.addEventListener("hashchange", function () { var n = pageFromHash(); if (n && spreadOf(n) !== spreadOf(cur)) go(n); });
  }).catch(function (e) {
    stage.classList.add("is-error");
    $("[data-loading]").textContent = e.message;
  });

  function clamp(n) { return Math.min(P.length, Math.max(1, n | 0)); }
  function pageFromHash() { var m = location.hash.match(/#(?:p=)?(\d+)/); return m ? +m[1] : 0; }
  function spreadOf(n) { for (var i = 0; i < S.length; i++) if (n >= S[i].first && n <= S[i].last) return i; return 0; }

  /* ---------- chrome ---------- */
  function chrome() {
    document.title = (book.title || "Portfolio") + (book.author ? " · " + book.author : "");
    $("[data-title]").textContent = book.title || "Portfolio";
    $("[data-author]").textContent = book.author || "";
    var links = $("[data-links]");
    links.innerHTML = "";
    (book.links || []).forEach(function (l) {
      if (!l || !l.href || !l.label) return;
      var a = document.createElement("a"); a.href = l.href; a.textContent = l.label;
      if (/^https?:/.test(l.href)) { a.target = "_blank"; a.rel = "noopener"; }
      links.appendChild(a);
    });
    $("[data-theme-switch]").appendChild(window.BOOK_THEMES.switchEl());
    var slider = $("[data-slider]"); slider.max = P.length;
    slider.oninput = function () { showPos(+slider.value); };
    slider.onchange = function () { go(+slider.value); };
    $("[data-prev]").onclick = $("[data-prev2]").onclick = prev;
    $("[data-next]").onclick = $("[data-next2]").onclick = next;
    $("[data-zoom-in]").onclick = function () { zoomTo(Z.s * 1.5); };
    $("[data-zoom-out]").onclick = function () { zoomTo(Z.s / 1.5); };
    $("[data-zoom-reset]").onclick = function () { zoomTo(1); };
    $("[data-mode]").onclick = function () { modePref = mode === "single" ? "two" : "one"; fit(true); };
    $("[data-thumbs]").onclick = function () { toggleStrip(); };
    $("[data-contents]").onclick = function () { toggleContents(); };
    var fs = $("[data-fullscreen]");
    if (!document.documentElement.requestFullscreen) fs.hidden = true;
    fs.onclick = toggleFullscreen;
    buildStrip(); buildContents();
    document.addEventListener("keydown", onKey);
    if (window.ResizeObserver) new ResizeObserver(function () { fit(); }).observe(stage);
    else window.addEventListener("resize", function () { fit(); });
    gestures();
    document.addEventListener("click", function (e) {
      if (!$("[data-contents-panel]").hidden && !e.target.closest("[data-contents-panel], [data-contents]")) toggleContents(false);
    });
  }

  function viewText(n) {
    var s = S[spreadOf(n)];
    if (mode !== "single" && s.left && s.right) return s.left.n + " to " + s.right.n + " of " + P.length;
    return n + " of " + P.length;
  }
  function showPos(n) { $("[data-pos]").textContent = viewText(n); }
  function syncChrome() {
    showPos(cur);
    $("[data-slider]").value = cur;
    var si = spreadOf(cur);
    var atStart = cur <= 1, atEnd = mode !== "single" ? si >= S.length - 1 : cur >= P.length;
    $("[data-prev]").disabled = $("[data-prev2]").disabled = atStart;
    $("[data-next]").disabled = $("[data-next2]").disabled = atEnd;
    $("[data-mode]").textContent = mode !== "single" ? "1 page" : "2 pages";
    $("[data-mode]").title = mode !== "single" ? "Show one page at a time" : "Show two pages";
    $("[data-zoom-reset]").textContent = Math.round(Z.s * 100) + "%";
    $$(".cell", $("[data-strip]")).forEach(function (c, i) {
      var on = i === si; c.setAttribute("aria-current", on ? "true" : "false");
      if (on && !$("[data-strip]").hidden) c.scrollIntoView({ block: "nearest", inline: "center", behavior: reduced ? "auto" : "smooth" });
    });
    $$("button", $("[data-contents-panel]")).forEach(function (b) {
      var n = +b.dataset.n;
      b.setAttribute("aria-current", (mode !== "single" ? spreadOf(n) === si : n === cur) ? "true" : "false");
    });
    var h = "#p=" + cur;
    if (location.hash !== h) history.replaceState(null, "", h);
  }

  /* ---------- size and mode ---------- */
  function fit(rebuild) {
    var W = stage.clientWidth, H = stage.clientHeight;
    if (!W || !H) return;
    var two = W / H < 1.05 ? "stack" : "spread";
    var want = modePref === "one" ? "single" : two;
    var changed = want !== mode;
    mode = want;
    // the book fills the width; a little room above and below
    var padY = Math.min(16, H * 0.02), aw = W, ah = H - padY * 2;
    if (mode === "spread") { bw = Math.min(aw, ah * RATIO * 2); bh = bw / (RATIO * 2); }
    else if (mode === "stack") { bw = Math.min(aw, ah / 2 * RATIO); bh = 2 * bw / RATIO; }
    else { bw = Math.min(aw, ah * RATIO); bh = bw / RATIO; }
    bw = Math.floor(bw); bh = Math.floor(bh);
    left0 = Math.floor((W - bw) / 2); top0 = Math.floor((H - bh) / 2);
    zoomer.style.width = bw + "px"; zoomer.style.height = bh + "px";
    zoomer.style.left = left0 + "px"; zoomer.style.top = top0 + "px";
    if (changed || rebuild || !pf) build();
    else { zoomTo(1, null, true); pf.update(); }
  }

  /* ---------- page elements ---------- */
  function pageEl(page, side) {
    var el = document.createElement("div");
    el.className = "page " + (side || "");
    var inner = document.createElement("div"); inner.className = "ph";
    el.appendChild(inner);
    if (!page) { el.className += " none"; return el; }
    if (page.blank) { el.className += " blank"; return el; }
    var src = D.src(page.file);
    el.className += page.half ? " " + page.half : " full";
    inner.style.backgroundImage = "url(" + src.thumb + ")";
    var img = document.createElement("img");
    img.className = "pimg"; img.alt = page.label || ""; img.decoding = "async"; img.draggable = false;
    img.dataset.full = src.full; img.dataset.web = src.web;
    img.onload = function () { img.classList.add("is-loaded"); };
    inner.appendChild(img);
    return el;
  }
  /* a stacked pair for the portrait view: left page above the right page */
  function stackEl(s) {
    var el = document.createElement("div"); el.className = "page stackpair";
    el.appendChild(pageEl(s.left, "L")); el.appendChild(pageEl(s.right, "R"));
    return el;
  }

  /* the engine keeps every page in the document; images are only requested near the current view */
  function loadNear() {
    var idx = engineIndex(cur), span = mode === "stack" ? 3 : 6;
    items.forEach(function (el, i) {
      var near = Math.abs(i - idx) <= span;
      $$(".pimg", el).forEach(function (img) {
        if (near && !img.getAttribute("src")) img.src = img.dataset.web;
      });
    });
  }

  /* engine page index for a page number, and back */
  function engineIndex(n) { return mode === "stack" ? spreadOf(n) : n - 1; }
  function pageNumber(i) { return mode === "stack" ? (S[i] ? S[i].first : 1) : i + 1; }

  function build() {
    // the engine removes its root element when destroyed, so the book element is made fresh each time
    if (pf) { try { pf.destroy(); } catch (e) {} pf = null; }
    if (bookEl && bookEl.parentNode) bookEl.remove();
    bookEl = document.createElement("div"); bookEl.setAttribute("aria-live", "polite");
    bookEl.className = "book " + mode;
    zoomer.appendChild(bookEl);
    items = mode === "stack" ? S.map(stackEl) : P.map(function (p) { return pageEl(p, p.half || ""); });
    items.forEach(function (el) { bookEl.appendChild(el); });
    var portrait = mode !== "spread";
    var pageW = portrait ? bw : bw / 2, pageH = bh;
    pf = new window.St.PageFlip(bookEl, {
      width: pageW, height: pageH, size: "stretch",
      // the engine goes portrait when the block is narrower than twice minWidth
      minWidth: portrait ? Math.ceil(bw / 2) + 2 : 1, maxWidth: 100000, minHeight: 1, maxHeight: 100000,
      usePortrait: true, showCover: mode === "spread" && book.coverAlone !== false,
      flippingTime: FLIP_MS, maxShadowOpacity: 0.45, drawShadow: !reduced,
      useMouseEvents: false, autoSize: false, startPage: engineIndex(cur), mobileScrollSupport: false
    });
    pf.loadFromHTML(items);
    bookEl.style.minWidth = ""; bookEl.style.minHeight = "";
    pf.on("flip", function (e) { cur = clamp(pageNumber(e.data)); syncChrome(); loadNear(); applyHires(); });
    zoomTo(1, null, true);
    syncChrome(); loadNear();
  }

  /* ---------- turning ---------- */
  function busy() { return pf && pf.getState && pf.getState() !== "read"; }
  function next() { if (!pf || busy()) return; if (Z.s !== 1) zoomTo(1, null, true); pf.flipNext(); }
  function prev() { if (!pf || busy()) return; if (Z.s !== 1) zoomTo(1, null, true); pf.flipPrev(); }
  function go(n) {
    n = clamp(n);
    if (!pf || busy()) return;
    if (Z.s !== 1) zoomTo(1, null, true);
    var from = spreadOf(cur), to = spreadOf(n);
    if (mode !== "single" ? from === to : n === cur) { cur = n; syncChrome(); return; }
    if (Math.abs(to - from) === 1 || mode === "single" && Math.abs(n - cur) === 1) { if (n > cur) pf.flipNext(); else pf.flipPrev(); return; }
    pf.flip(engineIndex(n));
  }

  /* ---------- zoom ---------- */
  function applyZoom() {
    var W = stage.clientWidth, H = stage.clientHeight, cw = bw * Z.s, ch = bh * Z.s;
    if (cw <= W) Z.tx = (W - cw) / 2 - left0; else Z.tx = Math.min(-left0, Math.max(W - left0 - cw, Z.tx));
    if (ch <= H) Z.ty = (H - ch) / 2 - top0; else Z.ty = Math.min(-top0, Math.max(H - top0 - ch, Z.ty));
    zoomer.style.transform = "translate(" + Z.tx + "px," + Z.ty + "px) scale(" + Z.s + ")";
    var on = Z.s > 1.001;
    stage.classList.toggle("is-zoomed", on);
    panLayer.hidden = !on;
    $("[data-zoom-reset]").textContent = Math.round(Z.s * 100) + "%";
    applyHires();
  }
  /* zoom to scale s keeping the stage point (px, py) fixed */
  function zoomTo(s, at, instant) {
    s = Math.min(6, Math.max(1, s));
    if (s === 1) { Z = { s: 1, tx: 0, ty: 0 }; dropHires(); }
    else {
      var px = at ? at.x : stage.clientWidth / 2, py = at ? at.y : stage.clientHeight / 2;
      var ux = (px - left0 - Z.tx) / Z.s, uy = (py - top0 - Z.ty) / Z.s;
      Z.tx = px - left0 - ux * s; Z.ty = py - top0 - uy * s; Z.s = s;
    }
    if (!instant && !reduced) { zoomer.style.transition = "transform 0.25s"; setTimeout(function () { zoomer.style.transition = ""; }, 260); }
    applyZoom();
  }
  var hiresTimer = null;
  function applyHires() {
    if (!hiresOK) return;
    clearTimeout(hiresTimer);
    if (Z.s < 1.5) return;
    hiresTimer = setTimeout(function () {
      $$(".pimg:not(.hi)", bookEl).forEach(function (img) {
        if (img.dataset.hires || !img.dataset.full || !img.offsetParent) return;
        img.dataset.hires = "1";
        // the original is decoded first and then laid over the web copy, so nothing goes blank meanwhile
        var big = new Image(); big.decoding = "async"; big.className = "pimg hi"; big.alt = ""; big.draggable = false;
        big.src = img.dataset.full;
        var show = function () { if (Z.s >= 1.5 && img.isConnected) img.parentNode.appendChild(big); else delete img.dataset.hires; };
        if (big.decode) big.decode().then(show, function () { delete img.dataset.hires; }); else { big.onload = show; big.onerror = function () { delete img.dataset.hires; }; }
      });
    }, 250);
  }
  function dropHires() {
    $$(".pimg.hi", bookEl).forEach(function (b) { b.remove(); });
    $$(".pimg[data-hires]", bookEl).forEach(function (i) { delete i.dataset.hires; });
  }

  /* ---------- pointer: swipe, tap, pan, pinch, wheel ---------- */
  function gestures() {
    var ptrs = new Map(), g = null, lastTap = 0, tapTimer = null;
    function pt(e) { var r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    function mid() { var a = [].slice.call(ptrs.values()); return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 }; }
    function dist() { var a = [].slice.call(ptrs.values()); return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); }
    stage.addEventListener("pointerdown", function (e) {
      if (e.target.closest("button, input, .strip, .contents")) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      ptrs.set(e.pointerId, pt(e));
      try { stage.setPointerCapture(e.pointerId); } catch (x) {}
      if (ptrs.size === 1) g = { type: Z.s > 1.001 ? "pan" : "swipe", x: ptrs.get(e.pointerId).x, y: ptrs.get(e.pointerId).y, tx: Z.tx, ty: Z.ty, t: Date.now(), moved: 0, pointerType: e.pointerType };
      else if (ptrs.size === 2) { var m = mid(); g = { type: "pinch", d: dist(), s: Z.s, mx: m.x, my: m.y, tx: Z.tx, ty: Z.ty, moved: 99 }; }
    });
    stage.addEventListener("pointermove", function (e) {
      if (!ptrs.has(e.pointerId) || !g) return;
      ptrs.set(e.pointerId, pt(e));
      var p = ptrs.get(e.pointerId);
      if (g.type === "pinch" && ptrs.size === 2) {
        var m = mid(), s = Math.min(6, Math.max(1, g.s * dist() / g.d));
        var ux = (g.mx - left0 - g.tx) / g.s, uy = (g.my - top0 - g.ty) / g.s;
        Z.s = s; Z.tx = m.x - left0 - ux * s; Z.ty = m.y - top0 - uy * s;
        applyZoom();
      } else if (g.type === "pan") {
        Z.tx = g.tx + (p.x - g.x); Z.ty = g.ty + (p.y - g.y); g.moved = Math.max(g.moved, Math.hypot(p.x - g.x, p.y - g.y)); applyZoom();
      } else if (g.type === "swipe") {
        g.moved = Math.max(g.moved, Math.hypot(p.x - g.x, p.y - g.y));
      }
    });
    function up(e) {
      if (!ptrs.has(e.pointerId)) return;
      var p = ptrs.get(e.pointerId); ptrs.delete(e.pointerId);
      if (!g) return;
      if (g.type === "swipe" && ptrs.size === 0) {
        var dx = p.x - g.x, dy = p.y - g.y, dt = Date.now() - g.t;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2 && dt < 1200) { if (dx < 0) next(); else prev(); }
        else if (g.moved < 8 && dt < 350) tap(p, g.pointerType);
      }
      if (ptrs.size === 0) g = null;
      else if (ptrs.size === 1) { var r = [].slice.call(ptrs.values())[0]; g = { type: Z.s > 1.001 ? "pan" : "swipe", x: r.x, y: r.y, tx: Z.tx, ty: Z.ty, t: Date.now(), moved: 99, pointerType: "touch" }; }
    }
    stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up);
    /* a tap or click on the page turns it: left part back, right part forward; two quick taps zoom */
    function tap(p, type) {
      var now = Date.now();
      if (now - lastTap < 320) { clearTimeout(tapTimer); lastTap = 0; zoomTo(Z.s > 1.001 ? 1 : 2.5, p); return; }
      lastTap = now;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(function () {
        if (Z.s > 1.001) return;
        var W = stage.clientWidth;
        if (mode === "spread") { if (p.x < W / 2) prev(); else next(); }
        else { if (p.x < W * 0.35) prev(); else if (p.x > W * 0.65) next(); }
      }, 330);
      void type;
    }
    stage.addEventListener("dblclick", function (e) { e.preventDefault(); });

    /* wheel: turns pages (one turn per gesture), Ctrl or pinch on a trackpad zooms, and when zoomed it pans */
    var acc = 0, lastWheel = 0, wheelDone = false;
    stage.addEventListener("wheel", function (e) {
      if (e.target.closest(".strip, .contents")) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) { zoomTo(Z.s * Math.exp(-e.deltaY * 0.01), pt(e), true); return; }
      if (Z.s > 1.001) { Z.tx -= e.deltaX; Z.ty -= e.deltaY; applyZoom(); return; }
      // one turn per wheel gesture: events closer than 250 ms apart (including trackpad inertia) belong to the same gesture
      var now = Date.now();
      if (now - lastWheel > 250) { acc = 0; wheelDone = false; }
      lastWheel = now;
      if (wheelDone) return;
      acc += Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (Math.abs(acc) >= 40) { wheelDone = true; if (acc > 0) next(); else prev(); }
    }, { passive: false });
  }

  /* ---------- keys ---------- */
  function onKey(e) {
    if (e.target.matches("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case "ArrowRight": case "PageDown": case " ": next(); break;
      case "ArrowLeft": case "PageUp": prev(); break;
      case "Home": go(1); break;
      case "End": go(P.length); break;
      case "+": case "=": zoomTo(Z.s * 1.5); break;
      case "-": case "_": zoomTo(Z.s / 1.5); break;
      case "0": zoomTo(1); break;
      case "f": toggleFullscreen(); break;
      case "t": toggleStrip(); break;
      case "c": toggleContents(); break;
      case "Escape": toggleContents(false); if (!$("[data-strip]").hidden) toggleStrip(false); break;
      default: return;
    }
    e.preventDefault();
  }

  /* ---------- strip, contents, fullscreen ---------- */
  function buildStrip() {
    var strip = $("[data-strip]"); strip.innerHTML = "";
    S.forEach(function (s, i) {
      var c = document.createElement("button"); c.type = "button"; c.className = "cell"; c.dataset.s = i;
      var pair = document.createElement("div"); pair.className = "pair";
      [["L", s.left], ["R", s.right]].forEach(function (x) {
        var t = document.createElement("div"); t.className = "t " + x[0] + (x[1] ? (x[1].blank ? " blank" : "") : " none");
        if (x[1] && x[1].file) t.style.backgroundImage = "url(" + D.src(x[1].file).thumb + ")";
        if (x[1] && !x[1].half) t.style.backgroundPosition = "center";
        pair.appendChild(t);
      });
      var small = document.createElement("small"); small.textContent = s.left && s.right ? s.left.n + " to " + s.right.n : String(s.first);
      c.appendChild(pair); c.appendChild(small);
      c.onclick = function () { go(s.first); };
      strip.appendChild(c);
    });
  }
  function toggleStrip(show) {
    var strip = $("[data-strip]"), on = show == null ? strip.hidden : show;
    strip.hidden = !on; $("[data-thumbs]").setAttribute("aria-expanded", on ? "true" : "false");
    if (on) syncChrome();
  }
  function buildContents() {
    var box = $("[data-contents-panel]"); box.innerHTML = "";
    var any = false;
    P.forEach(function (p) {
      if (!p.label) return; any = true;
      var b = document.createElement("button"); b.type = "button"; b.dataset.n = p.n;
      b.innerHTML = "<strong></strong><span></span>";
      $("strong", b).textContent = p.label; $("span", b).textContent = "page " + p.n;
      b.onclick = function () { toggleContents(false); go(p.n); };
      box.appendChild(b);
    });
    if (!any) box.innerHTML = '<p class="empty">No sections named yet.</p>';
  }
  function toggleContents(show) {
    var box = $("[data-contents-panel]"), on = show == null ? box.hidden : show;
    box.hidden = !on; $("[data-contents]").setAttribute("aria-expanded", on ? "true" : "false");
  }
  function toggleFullscreen() {
    if (!document.documentElement.requestFullscreen) return;
    if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(function () {});
  }
})();
