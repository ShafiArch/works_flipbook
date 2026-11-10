/* Publishing from the page order tool straight to GitHub.
   One fine-grained access token (Contents: read and write, this repository only)
   is kept in this browser. Reads use the contents API so tools always start from
   what is really in the repository; a publish is one atomic commit made with the
   git data API (blobs, tree, commit, then a fast-forward of main).

   window.GH:
     connected()            true when a token is stored
     repo()                 "Owner/name"
     readText(path)         Promise of file text, or null if it does not exist
     listDir(path)          Promise of [{ path, type, sha }]
     connectDialog(onDone)  explains and stores the token
     publish(opts)          the publish dialog (see below)
     button(el)             a "GitHub" status button in a tool's top bar */
(function () {
  "use strict";

  var KEY = "flipbook-gh-token", REPO_KEY = "flipbook-gh-repo", API = "https://api.github.com", BRANCH = "main";

  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function token() { return load(KEY); }
  function guessRepo() {
    var m = location.hostname.match(/^([^.]+)\.github\.io$/i), seg = location.pathname.split("/")[1];
    return m && seg ? m[1] + "/" + seg : "";
  }
  var fallbackRepo = "";
  function repo() { return load(REPO_KEY) || guessRepo() || fallbackRepo; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  function req(method, path, body) {
    var headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", Authorization: "Bearer " + token() };
    if (body) headers["Content-Type"] = "application/json";
    return fetch(API + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store" })
      .then(function (r) {
        if (r.ok) return r.status === 204 ? null : r.json();
        return r.text().then(function (t) {
          var m = ""; try { m = JSON.parse(t).message; } catch (e) { m = t.slice(0, 200); }
          var hint = r.status === 401 ? "The token is not valid or has expired. Connect again with a new token." :
            r.status === 403 ? "The token is not allowed to do this. It needs Contents: Read and write on " + repo() + "." :
            r.status === 404 ? "Not found. Check the repository name, and that the token can see it." :
            r.status === 409 || r.status === 422 ? "GitHub refused the change (" + m + "). Someone may have published at the same moment; try again." : m;
          var e = new Error(hint); e.status = r.status; e.detail = m; throw e;
        });
      });
  }
  function rp() { return "/repos/" + repo(); }
  function encPath(p) { return p.split("/").map(encodeURIComponent).join("/"); }

  function b64ToText(b64) {
    var bin = atob(b64.replace(/\s/g, "")), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function blobToB64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result).split(",")[1]); };
      r.onerror = rej; r.readAsDataURL(blob);
    });
  }

  function readText(path) {
    return req("GET", rp() + "/contents/" + encPath(path) + "?ref=" + BRANCH).then(function (f) {
      if (f.encoding === "base64" && f.content) return b64ToText(f.content);
      // files over 1 MB come without content; fetch the blob
      return req("GET", rp() + "/git/blobs/" + f.sha).then(function (b) { return b64ToText(b.content); });
    }).catch(function (e) { if (e.status === 404) return null; throw e; });
  }
  function listDir(path) {
    return req("GET", rp() + "/contents/" + encPath(path) + "?ref=" + BRANCH)
      .then(function (list) { return Array.isArray(list) ? list : []; })
      .catch(function (e) { if (e.status === 404) return []; throw e; });
  }
  /* every file under a folder, for deleting it */
  function listTree(prefix) {
    return req("GET", rp() + "/git/trees/" + BRANCH + "?recursive=1").then(function (t) {
      return (t.tree || []).filter(function (n) { return n.type === "blob" && n.path.indexOf(prefix) === 0; }).map(function (n) { return n.path; });
    });
  }

  /* One commit: files [{ path, text } | { path, blob } | { path, remove: true }] */
  function commit(files, message, progress) {
    progress = progress || function () {};
    var base, baseTree;
    progress("Reading the repository");
    return req("GET", rp() + "/git/ref/heads/" + BRANCH).then(function (ref) {
      base = ref.object.sha;
      return req("GET", rp() + "/git/commits/" + base);
    }).then(function (c) {
      baseTree = c.tree.sha;
      var n = 0, entries = [];
      return files.reduce(function (p, f) {
        return p.then(function () {
          if (f.remove) { entries.push({ path: f.path, mode: "100644", type: "blob", sha: null }); return; }
          progress("Uploading " + (++n) + " of " + files.filter(function (x) { return !x.remove; }).length + ": " + f.path);
          var body = f.blob ? blobToB64(f.blob).then(function (b) { return { content: b, encoding: "base64" }; }) : Promise.resolve({ content: f.text, encoding: "utf-8" });
          return body.then(function (b) { return req("POST", rp() + "/git/blobs", b); })
            .then(function (blob) { entries.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha }); });
        });
      }, Promise.resolve()).then(function () { return entries; });
    }).then(function (entries) {
      progress("Writing the commit");
      return req("POST", rp() + "/git/trees", { base_tree: baseTree, tree: entries });
    }).then(function (tree) {
      return req("POST", rp() + "/git/commits", { message: message, tree: tree.sha, parents: [base] });
    }).then(function (c) {
      progress("Updating main");
      return req("PATCH", rp() + "/git/refs/heads/" + BRANCH, { sha: c.sha, force: false }).then(function () { return c; });
    });
  }

  /* ---------- dialogs ---------- */
  function modal(html) {
    var wrap = document.createElement("div");
    wrap.className = "gh-modal";
    wrap.innerHTML = '<div class="gh-box" role="dialog" aria-modal="true">' + html + "</div>";
    document.body.appendChild(wrap);
    function close() { wrap.remove(); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", onKey);
    wrap.addEventListener("click", function (e) { if (e.target === wrap) close(); });
    [].forEach.call(wrap.querySelectorAll("[data-gh-close]"), function (b) { b.onclick = close; });
    return { el: wrap, close: close };
  }

  function connectDialog(onDone) {
    var has = !!token();
    var m = modal(
      '<div class="gh-head"><h2>Publish to GitHub</h2><button type="button" class="m-icon" data-gh-close aria-label="Close">&#215;</button></div>' +
      '<div class="gh-body">' +
      (has ? '<p class="gh-ok">Connected to <strong>' + esc(repo()) + "</strong>.</p>" : "<p>Connect once and the tools can publish straight to the repository: no zip, no upload.</p>") +
      '<ol class="m-steps">' +
      '<li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub, new fine-grained token</a> (signed in as the repository owner).</li>' +
      "<li>Name it <em>flipbook tools</em>. Choose an expiry; when it runs out, make a new one and paste it here.</li>" +
      "<li><strong>Repository access:</strong> Only select repositories, then <strong>" + esc(repo() || "your site repository") + "</strong>.</li>" +
      "<li><strong>Permissions:</strong> Repository permissions, <strong>Contents: Read and write</strong>. Nothing else is needed.</li>" +
      "<li>Generate the token, copy it, and paste it below.</li></ol>" +
      '<label class="m-field"><span class="m-label">Repository</span><input data-gh-repo value="' + esc(repo()) + '" placeholder="ShafiArch/works_flipbook" spellcheck="false"></label>' +
      '<label class="m-field"><span class="m-label">Token</span><input data-gh-token type="password" placeholder="' + (has ? "Stored. Paste a new one to replace it." : "github_pat_...") + '" spellcheck="false" autocomplete="off"></label>' +
      '<p class="m-hint">The token stays in this browser only and is sent only to api.github.com. Anyone using this browser profile could publish, so do not connect on a shared computer. Disconnect removes it.</p>' +
      '<p class="gh-msg" data-gh-msg></p></div>' +
      '<div class="gh-foot">' + (has ? '<button type="button" class="m-btn m-ghost-bad" data-gh-off>Disconnect</button>' : "") +
      '<span class="gh-grow"></span><button type="button" class="m-btn" data-gh-close>Cancel</button><button type="button" class="m-btn m-primary" data-gh-save>' + (has ? "Save" : "Connect") + "</button></div>");
    var el = m.el, msg = el.querySelector("[data-gh-msg]");
    var off = el.querySelector("[data-gh-off]");
    if (off) off.onclick = function () { store(KEY, null); m.close(); refreshButtons(); if (onDone) onDone(false); };
    el.querySelector("[data-gh-save]").onclick = function () {
      var t = el.querySelector("[data-gh-token]").value.trim(), r = el.querySelector("[data-gh-repo]").value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
      if (!/^[\w.-]+\/[\w.-]+$/.test(r)) { msg.textContent = "Enter the repository as Owner/name."; return; }
      if (!t && !has) { msg.textContent = "Paste the token."; return; }
      var oldT = token(), oldR = load(REPO_KEY);
      store(REPO_KEY, r); if (t) store(KEY, t);
      msg.textContent = "Checking...";
      req("GET", "/repos/" + r).then(function (info) {
        if (info.permissions && info.permissions.push === false) throw new Error("This GitHub account cannot write to " + r + ".");
        // a harmless read through the git data API, which publishing uses
        return req("GET", "/repos/" + r + "/git/ref/heads/" + BRANCH);
      }).then(function () {
        m.close(); refreshButtons(); toast("Connected to " + r); if (onDone) onDone(true);
      }).catch(function (e) {
        if (t) store(KEY, oldT || null); store(REPO_KEY, oldR || null);
        msg.textContent = e.message;
      });
    };
    setTimeout(function () { var i = el.querySelector("[data-gh-token]"); if (i) i.focus(); }, 30);
  }

  /* Publish dialog.
     opts.title, opts.message (default commit message)
     opts.build(): Promise of { files: [...], conflicts: ["..."], notes: ["..."] }
       built from fresh reads of the repository (GH.readText)
     opts.done(commit): called after success */
  function publish(opts) {
    if (!token()) { connectDialog(function (ok) { if (ok) publish(opts); }); return; }
    var m = modal(
      '<div class="gh-head"><h2>' + esc(opts.title || "Publish") + '</h2><button type="button" class="m-icon" data-gh-close aria-label="Close">&#215;</button></div>' +
      '<div class="gh-body" data-gh-body><p class="m-muted">Comparing with what is in ' + esc(repo()) + "...</p></div>" +
      '<div class="gh-foot"><span class="gh-grow gh-msg" data-gh-msg></span><button type="button" class="m-btn" data-gh-close>Cancel</button>' +
      '<button type="button" class="m-btn m-primary" data-gh-go disabled>Publish</button></div>');
    var el = m.el, body = el.querySelector("[data-gh-body]"), go = el.querySelector("[data-gh-go]"), msg = el.querySelector("[data-gh-msg]");
    opts.build().then(function (plan) {
      if (!plan.files.length) { body.innerHTML = "<p>Nothing to publish: the repository already has these changes.</p>"; return; }
      body.innerHTML =
        (plan.conflicts && plan.conflicts.length ? '<div class="m-alert is-bad"><strong>Changed on GitHub since you opened this tool</strong><ul>' +
          plan.conflicts.map(function (c) { return "<li>" + esc(c) + "</li>"; }).join("") + "</ul>" +
          "<p>Publishing now replaces those changes with yours. To keep them, cancel, discard your draft, reload, and make your changes again.</p>" +
          '<label class="m-check"><input type="checkbox" data-gh-force> Replace them with my version</label></div>' : "") +
        (plan.notes && plan.notes.length ? '<div class="m-alert"><ul>' + plan.notes.map(function (c) { return "<li>" + esc(c) + "</li>"; }).join("") + "</ul></div>" : "") +
        '<p class="m-label">Files</p><ul class="gh-files">' + plan.files.map(function (f) {
          return "<li><code>" + esc(f.path) + "</code>" + (f.remove ? ' <span class="gh-del">delete</span>' : f.why ? ' <span class="m-muted">' + esc(f.why) + "</span>" : "") + "</li>";
        }).join("") + "</ul>" +
        '<label class="m-field"><span class="m-label">Note for this change</span><input data-gh-message value="' + esc(opts.message || "Update the book") + '"></label>' +
        '<p class="m-hint">This becomes one commit on ' + esc(repo()) + ". The book updates about a minute later.</p>";
      var force = el.querySelector("[data-gh-force]");
      go.disabled = !!force;
      if (force) force.onchange = function () { go.disabled = !force.checked; };
      go.onclick = function () {
        go.disabled = true;
        var message = (el.querySelector("[data-gh-message]").value || "Update the book").trim();
        commit(plan.files, message, function (t) { msg.textContent = t; }).then(function (c) {
          m.close();
          toast("Published. The book updates in about a minute.");
          if (opts.done) opts.done(c, plan);
        }).catch(function (e) { msg.textContent = e.message; go.disabled = false; });
      };
    }).catch(function (e) {
      body.innerHTML = '<p class="m-error">' + esc(e.message) + "</p>";
    });
  }

  /* status button for a tool's top bar */
  var buttons = [];
  function refreshButtons() {
    buttons.forEach(function (b) {
      var on = !!token();
      b.textContent = on ? "GitHub: connected" : "Connect GitHub";
      b.classList.toggle("is-on", on);
      b.title = on ? "Publishing to " + repo() + ". Click to change or disconnect." : "Connect to publish straight to GitHub";
    });
  }
  function button(el) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "m-btn gh-btn";
    b.onclick = function () { connectDialog(); };
    el.appendChild(b); buttons.push(b); refreshButtons();
    return b;
  }

  function toast(text) {
    var t = document.createElement("div"); t.className = "m-toast"; t.textContent = text; document.body.appendChild(t);
    setTimeout(function () { t.classList.add("out"); }, 3400); setTimeout(function () { t.remove(); }, 4000);
  }

  /* Fresh read for the tools: from GitHub when connected (no waiting for the
     published site to catch up), otherwise from the site itself. null if missing. */
  function read(path) {
    if (token() && repo()) return readText(path);
    return fetch(path, { cache: "no-cache" }).then(function (r) { return r.ok ? r.text() : null; });
  }

  window.GH = {
    read: read,
    connected: function () { return !!token(); }, repo: repo, setFallbackRepo: function (r) { fallbackRepo = r || ""; },
    readText: readText, listDir: listDir, listTree: listTree, commit: commit,
    connectDialog: connectDialog, publish: publish, button: button
  };
})();
