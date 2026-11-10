/* Theme switchboard for the flipbook.
   Colours live in one CSS file per theme in this folder; the layout
   (assets/book.css) only reads the tokens, so a theme can be added, changed or
   removed without touching anything else.

   DEFAULT : the theme the book always opens in.
   THEMES  : file name (without .css) and the label on the switch, in order.

   The book always opens in DEFAULT; the switch changes the theme for that visit
   only. ?theme=dark in the address opens the book in that theme. */

window.BOOK_THEMES = {
  DEFAULT: "white",
  THEMES: {
    white: "White",
    dark: "Dark",
    clay: "Clay"
  }
};

(function () {
  var T = window.BOOK_THEMES, name = T.DEFAULT;
  var asked = new URLSearchParams(location.search).get("theme");
  try { localStorage.removeItem("flipbook-theme"); } catch (e) {}  // older versions remembered the choice
  if (asked && T.THEMES[asked]) name = asked;
  var base = document.currentScript.src.replace(/themes\.js.*$/, "");
  T.current = name;
  document.write('<link rel="stylesheet" id="theme-css" href="' + base + name + '.css">');
  document.documentElement.setAttribute("data-theme", name);

  /* Switch in place: load the new sheet, then drop the old one, so the page
     never shows unstyled. Fires "book-theme" on window when done. */
  T.set = function (next) {
    if (!T.THEMES[next] || next === T.current) return;
    T.current = next;
    var old = document.getElementById("theme-css");
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = base + next + ".css";
    link.onload = link.onerror = function () {
      if (old && old.parentNode) old.parentNode.removeChild(old);
      link.id = "theme-css";
      document.documentElement.setAttribute("data-theme", next);
      window.dispatchEvent(new CustomEvent("book-theme", { detail: next }));
    };
    old.parentNode.insertBefore(link, old.nextSibling);
  };

  /* A segmented switch, used by the viewer and the tool */
  T.switchEl = function () {
    var wrap = document.createElement("div");
    wrap.className = "theme-switch";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Theme");
    Object.keys(T.THEMES).forEach(function (k) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = T.THEMES[k]; b.dataset.theme = k;
      b.setAttribute("aria-pressed", k === T.current ? "true" : "false");
      b.onclick = function () { T.set(k); };
      wrap.appendChild(b);
    });
    window.addEventListener("book-theme", function () {
      [].forEach.call(wrap.children, function (b) { b.setAttribute("aria-pressed", b.dataset.theme === T.current ? "true" : "false"); });
    });
    return wrap;
  };
})();
