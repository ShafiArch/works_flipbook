/* The flipbook viewer.
   Two pages side by side when the window is wider than it is tall, one page
   otherwise (or by choice with the "2 pages / 1 page" button). Pages turn with a
   3D leaf. Swipe, arrow keys, the slider, the thumbnail strip and the contents
   list all move through the book; pinch, wheel or double click zoom in, and zoomed
   pages load the full-size original for crisp text. #p=12 in the address opens
   at page 12. */
(function () {
  "use strict";
  var D = window.BookData;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return [].slice.call((el || document).querySelectorAll(s)); };

  var stage = $("[data-stage]"), viewport = $("[data-viewport]"), bookEl = $("[data-book]");
  var book, manifest, P = [], S = [], RATIO = 1.414;
  var mode = "spread", modePref = "auto";   // mode: spread (side by side), stack (one above the other), single
  var cur = 1;                 // current page number
  var busy = false;            // a flip is running
  var Z = { s: 1, tx: 0, ty: 0 }, bw = 0, bh = 0, left0 = 0, top0 = 0;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var DUR = reduced ? 0 : 700;
  var hiresOK = true;
  var cache = {};              // preloaded web images, by url

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
    fit(); render(); preload();
    window.addEventListener("hashchange", function () { var n = pageFromHash(); if (n && n !== cur && !busy) go(n); });
  }).catch(function (e) {
    stage.classList.add("is-error");
    $("[data-loading]").textContent = e.message;
  });

  function clamp(n) { return Math.min(P.length, Math.max(1, n | 0)); }
  function pageFromHash() { var m = location.hash.match(/#(?:p=)?(\d+)/); return m ? +m[1] : 0; }
  function spreadOf(n) { for (var i = 0; i < S.length; i++) if (n >= S[i].first && n <= S[i].last) return i; return 0; }
  function currentSpread() { return S[spreadOf(cur)]; }

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
    window.addEventListener("resize", function () { fit(); });
    if (window.ResizeObserver) new ResizeObserver(function () { fit(); }).observe(stage);
    gestures();
    document.addEventListener("click", function (e) {
      if (!$("[data-contents-panel]").hidden && !e.target.closest("[data-contents-panel], [data-contents]")) toggleContents(false);
    });
  }

  function showPos(n) {
    var s = S[spreadOf(n)], text;
    if (mode !== "single" && s.left && s.right) text = s.left.n + " to " + s.right.n + " of " + P.length;
    else text = n + " of " + P.length;
    $("[data-pos]").textContent = text;
  }
  function syncChrome() {
    showPos(cur);
    $("[data-slider]").value = cur;
    var atStart = cur <= 1, atEnd = mode !== "single" ? spreadOf(cur) >= S.length - 1 : cur >= P.length;
    $("[data-prev]").disabled = $("[data-prev2]").disabled = atStart;
    $("[data-next]").disabled = $("[data-next2]").disabled = atEnd;
    $("[data-mode]").textContent = mode !== "single" ? "1 page" : "2 pages";
    $("[data-mode]").title = mode !== "single" ? "Show one page at a time" : "Show two pages";
    $("[data-zoom-reset]").textContent = Math.round(Z.s * 100) + "%";
    var si = spreadOf(cur);
    $$(".cell", $("[data-strip]")).forEach(function (c, i) {
      var on = i === si; c.setAttribute("aria-current", on ? "true" : "false");
      if (on && !$("[data-strip]").hidden) c.scrollIntoView({ block: "nearest", inline: "center", behavior: reduced ? "auto" : "smooth" });
    });
    $$("button", $("[data-contents-panel]")).forEach(function (b) {
      var n = +b.dataset.n, s = S[spreadOf(n)];
      b.setAttribute("aria-current", (mode !== "single" ? spreadOf(n) === si : n === cur) ? "true" : "false");
      void s;
    });
    var h = "#p=" + cur;
    if (location.hash !== h) history.replaceState(null, "", h);
  }

  /* ---------- size and mode ---------- */
  function fit(force) {
    var W = stage.clientWidth, H = stage.clientHeight;
    if (!W || !H) return;
    var two = W / H < 1.05 ? "stack" : "spread";
    var want = modePref === "one" ? "single" : two;
    var changed = want !== mode;
    mode = want;
    bookEl.classList.remove("single", "stack", "spread"); bookEl.classList.add(mode);
    var pad = Math.max(12, Math.min(40, W * 0.035));
    if (mode === "spread") { bw = Math.min(W - pad * 2, (H - pad * 2) * RATIO * 2); bh = bw / (RATIO * 2); }
    else if (mode === "stack") { bw = Math.min(W - pad * 2, (H - pad * 2) / 2 * RATIO); bh = 2 * bw / RATIO; }
    else { bw = Math.min(W - pad * 2, (H - pad * 2) * RATIO); bh = bw / RATIO; }
    left0 = (W - bw) / 2; top0 = (H - bh) / 2;
    bookEl.style.width = bw + "px"; bookEl.style.height = bh + "px";
    bookEl.style.left = left0 + "px"; bookEl.style.top = top0 + "px";
    var layers = $(".layers", bookEl); if (layers) layers.style.perspective = persp() + "px";
    if (changed || force) { zoomTo(1, null, true); if (P.length) render(); }
    else applyZoom();
  }

  function persp() { return Math.round(mode === "spread" ? bw * 1.3 : mode === "stack" ? bh * 1.6 : bw * 2.2); }

  /* ---------- rendering ---------- */
  function pageEl(page, side) {
    var el = document.createElement("div");
    el.className = "page " + (side || "");
    if (!page) { el.className += " none"; return el; }
    if (page.blank) { el.className += " blank"; return el; }
    var src = D.src(page.file);
    el.className += page.half ? " " + page.half : " full";
    el.style.backgroundImage = "url(" + src.thumb + ")";
    var img = document.createElement("img");
    img.className = "pimg"; img.alt = page.label || ""; img.decoding = "async"; img.draggable = false;
    img.dataset.full = src.full; img.dataset.web = src.web;
    img.onload = function () { img.classList.add("is-loaded"); };
    img.src = src.web;
    if (cache[src.web] && cache[src.web].complete) img.classList.add("is-loaded");
    el.appendChild(img);
    var fold = document.createElement("div"); fold.className = "fold"; el.appendChild(fold);
    var cast = document.createElement("div"); cast.className = "cast"; el.appendChild(cast);
    return el;
  }

  function render() {
    var s = currentSpread();
    bookEl.innerHTML = "";
    var layers = document.createElement("div"); layers.className = "layers";
    layers.style.perspective = persp() + "px";
    var base = document.createElement("div"); base.className = "base";
    fill(base, s);
    var leaf = document.createElement("div"); leaf.className = "leaf";
    leaf.innerHTML = '<div class="face front"></div><div class="face back"></div><div class="shade"></div>';
    layers.appendChild(base); layers.appendChild(leaf);
    bookEl.appendChild(layers);
    syncChrome(); applyHires();
  }

  /* put the pages of spread s (or, in single mode, the current page) into el */
  function fill(el, s, n) {
    el.innerHTML = "";
    if (mode === "single") el.appendChild(pageEl(P[(n || cur) - 1], ""));
    else { el.appendChild(pageEl(s.left, "L")); el.appendChild(pageEl(s.right, "R")); }
  }

  function preload() {
    var si = spreadOf(cur), want = [];
    [1, -1, 2, -2, 3].forEach(function (d) { var s = S[si + d]; if (s) { if (s.left && s.left.file) want.push(s.left.file); if (s.right && s.right.file) want.push(s.right.file); } });
    want.forEach(function (f) { var u = D.src(f).web; if (!cache[u]) { var im = new Image(); im.decoding = "async"; im.src = u; cache[u] = im; } });
  }

  /* ---------- turning ---------- */
  function next() { if (busy) return; if (mode !== "single") { var i = spreadOf(cur); if (i < S.length - 1) go(S[i + 1].first); } else if (cur < P.length) go(cur + 1); }
  function prev() { if (busy) return; if (mode !== "single") { var i = spreadOf(cur); if (i > 0) go(S[i - 1].first); } else if (cur > 1) go(cur - 1); }

  function go(n) {
    n = clamp(n);
    if (busy) return;
    if (Z.s !== 1) zoomTo(1, null, true);
    var from = cur, fi = spreadOf(from), ti = spreadOf(n);
    if (mode !== "single" ? fi === ti : n === from) { cur = n; syncChrome(); return; }
    var fwd = n > from;
    cur = n;
    try { sessionStorage.setItem("hint-done", "1"); } catch (e) {}
    if (DUR === 0) { render(); preload(); return; }
    busy = true;
    var base = $(".base", bookEl), leaf = $(".leaf", bookEl), front = $(".face.front", leaf), back = $(".face.back", leaf), shade = $(".shade", leaf);
    var anim;
    if (mode === "spread") {
      var A = S[fi], B = S[ti];
      base.innerHTML = "";
      if (fwd) {
        base.appendChild(pageEl(A.left, "L")); base.appendChild(pageEl(B.right, "R"));
        front.innerHTML = ""; front.appendChild(pageEl(A.right, "R"));
        back.innerHTML = ""; back.appendChild(pageEl(B.left, "L"));
        leaf.className = "leaf on from-right";
        anim = leaf.animate([{ transform: "rotateY(0deg)" }, { transform: "rotateY(-180deg)" }], { duration: DUR, easing: "cubic-bezier(.45,.05,.35,1)", fill: "forwards" });
        castOn(base.lastChild);
      } else {
        base.appendChild(pageEl(B.left, "L")); base.appendChild(pageEl(A.right, "R"));
        front.innerHTML = ""; front.appendChild(pageEl(A.left, "L"));
        back.innerHTML = ""; back.appendChild(pageEl(B.right, "R"));
        leaf.className = "leaf on from-left";
        anim = leaf.animate([{ transform: "rotateY(0deg)" }, { transform: "rotateY(180deg)" }], { duration: DUR, easing: "cubic-bezier(.45,.05,.35,1)", fill: "forwards" });
        castOn(base.firstChild);
      }
      shade.animate([{ opacity: 0 }, { opacity: 0.5, offset: 0.5 }, { opacity: 0 }], { duration: DUR });
    } else {
      var A1 = S[fi], B1 = S[ti];
      leaf.className = "leaf on";
      if (fwd) {
        fill(base, B1, n);
        fill(front, A1, from);
        back.innerHTML = "";
        anim = leaf.animate([{ transform: "rotateY(0deg)", opacity: 1 }, { transform: "rotateY(-90deg)", opacity: 1, offset: 0.5 }, { transform: "rotateY(-180deg)", opacity: 0 }], { duration: DUR, easing: "cubic-bezier(.45,.05,.35,1)", fill: "forwards" });
      } else {
        fill(base, A1, from);
        fill(front, B1, n);
        back.innerHTML = "";
        anim = leaf.animate([{ transform: "rotateY(-180deg)", opacity: 0 }, { transform: "rotateY(-90deg)", opacity: 1, offset: 0.5 }, { transform: "rotateY(0deg)", opacity: 1 }], { duration: DUR, easing: "cubic-bezier(.45,.05,.35,1)", fill: "forwards" });
      }
      shade.animate([{ opacity: 0 }, { opacity: 0.4, offset: 0.5 }, { opacity: 0 }], { duration: DUR });
    }
    syncChrome();
    var done = function () { busy = false; render(); preload(); };
    if (anim && anim.finished) anim.finished.then(done, done); else setTimeout(done, DUR + 20);
  }
  function castOn(pageEl) {
    var c = pageEl && $(".cast", pageEl);
    if (c) c.animate([{ opacity: 0.6 }, { opacity: 0, offset: 0.55 }, { opacity: 0 }], { duration: DUR });
  }

  /* ---------- zoom ---------- */
  function applyZoom() {
    var W = stage.clientWidth, H = stage.clientHeight, cw = bw * Z.s, ch = bh * Z.s;
    if (cw <= W) Z.tx = (W - cw) / 2 - left0; else Z.tx = Math.min(-left0, Math.max(W - left0 - cw, Z.tx));
    if (ch <= H) Z.ty = (H - ch) / 2 - top0; else Z.ty = Math.min(-top0, Math.max(H - top0 - ch, Z.ty));
    bookEl.style.transform = "translate(" + Z.tx + "px," + Z.ty + "px) scale(" + Z.s + ")";
    bookEl.classList.toggle("is-zoomed", Z.s > 1.001);
    $("[data-zoom-reset]").textContent = Math.round(Z.s * 100) + "%";
    applyHires();
  }
  /* zoom to scale s keeping the viewport point (px, py) fixed */
  function zoomTo(s, at, instant) {
    s = Math.min(6, Math.max(1, s));
    if (s === 1) { Z = { s: 1, tx: 0, ty: 0 }; }
    else {
      var px = at ? at.x : stage.clientWidth / 2, py = at ? at.y : stage.clientHeight / 2;
      var ux = (px - left0 - Z.tx) / Z.s, uy = (py - top0 - Z.ty) / Z.s;
      Z.tx = px - left0 - ux * s; Z.ty = py - top0 - uy * s; Z.s = s;
    }
    if (!instant && !reduced) { bookEl.style.transition = "transform 0.25s"; setTimeout(function () { bookEl.style.transition = ""; }, 260); }
    applyZoom();
  }
  var hiresTimer = null;
  function applyHires() {
    if (!hiresOK) return;
    clearTimeout(hiresTimer);
    if (Z.s < 1.5) return;
    hiresTimer = setTimeout(function () {
      $$(".base .pimg", bookEl).forEach(function (img) {
        if (img.dataset.hires || !img.dataset.full) return;
        img.dataset.hires = "1";
        var big = new Image(); big.decoding = "async";
        big.onload = function () { if (Z.s >= 1.5 && img.isConnected) img.src = big.src; };
        big.onerror = function () { delete img.dataset.hires; };
        big.src = img.dataset.full;
      });
    }, 250);
  }

  /* ---------- pointer: swipe, pan, pinch, taps ---------- */
  function gestures() {
    var ptrs = new Map(), g = null, lastTap = 0, tapTimer = null;
    function pt(e) { var r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    function mid() { var a = [].slice.call(ptrs.values()); return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 }; }
    function dist() { var a = [].slice.call(ptrs.values()); return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); }
    stage.addEventListener("pointerdown", function (e) {
      if (e.target.closest("button, input, .strip, .contents")) return;
      ptrs.set(e.pointerId, pt(e));
      stage.setPointerCapture && stage.setPointerCapture(e.pointerId);
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
        else if (g.moved < 8 && dt < 350 && g.pointerType === "touch") tap(p);
      }
      if (ptrs.size === 0) g = null;
      else if (ptrs.size === 1) { var r = [].slice.call(ptrs.values())[0]; g = { type: Z.s > 1.001 ? "pan" : "swipe", x: r.x, y: r.y, tx: Z.tx, ty: Z.ty, t: Date.now(), moved: 99, pointerType: "touch" }; }
    }
    stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up);
    function tap(p) {
      var now = Date.now();
      if (now - lastTap < 320) { clearTimeout(tapTimer); lastTap = 0; zoomTo(Z.s > 1.001 ? 1 : 2.5, p); return; }
      lastTap = now;
      tapTimer = setTimeout(function () {
        if (Z.s > 1.001) return;
        var W = stage.clientWidth;
        if (p.x < W * 0.3) prev(); else if (p.x > W * 0.7) next();
      }, 330);
    }
    stage.addEventListener("dblclick", function (e) { if (e.target.closest("button, input")) return; zoomTo(Z.s > 1.001 ? 1 : 2.5, pt(e)); });
    stage.addEventListener("wheel", function (e) {
      if (e.target.closest(".strip, .contents")) return;
      e.preventDefault();
      var k = e.ctrlKey ? 0.01 : 0.0022;
      zoomTo(Z.s * Math.exp(-e.deltaY * k), pt(e), true);
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
