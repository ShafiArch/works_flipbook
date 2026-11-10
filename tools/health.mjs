#!/usr/bin/env node
/* Flipbook health check. Runs on GitHub (.github/workflows/book.yml) after every
   push and every Monday; also runs locally:  node tools/health.mjs

   Errors (the book is or will be broken): unreadable JSON, pages pointing at
   files that do not exist, missing web or thumbnail copies, pages that load
   different script versions, files too big for GitHub.
   Warnings (worth fixing): a spread that starts on a right-hand page (it would
   be split across two views), the same file used twice, files in pages/ that are
   not in the book, long dashes in text.

   Writes a Markdown report (--report file) and, on GitHub, sets the output
   "status" to ok, warnings or errors. Exit code 1 when there are errors. */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2);
const REPORT = args.includes("--report") ? args[args.indexOf("--report") + 1] : null;

const errors = [], warnings = [], notes = [];
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const exists = (p) => fs.existsSync(path.join(ROOT, p));
function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8")); }
  catch (e) { errors.push(`\`${p}\` is not valid JSON (${e.message.split("\n")[0]}). The book cannot open.`); return null; }
}
function walk(dir, out = []) {
  for (const n of fs.readdirSync(dir)) {
    if (n === ".git" || n === "node_modules") continue;
    const p = path.join(dir, n), s = fs.statSync(p);
    if (s.isDirectory()) walk(p, out); else out.push({ path: rel(p), size: s.size });
  }
  return out;
}

/* ---------- book.json and manifest.json ---------- */
const book = readJSON("content/book.json");
const manifest = exists("pages/manifest.json") ? readJSON("pages/manifest.json") : null;
if (!manifest) warnings.push("`pages/manifest.json` is missing; run `python3 tools/pages.py` (the workflow does this after a push).");
const files = (manifest && manifest.files) || {};
const ratio = (book && parseFloat(book.pageRatio)) || 1.414;
const stem = (f) => f.replace(/\.[^.]+$/, "");

if (book) {
  const items = Array.isArray(book.pages) ? book.pages : (errors.push("`content/book.json` has no `pages` list."), []);
  const seen = new Map();
  let n = 0;
  items.forEach((it, i) => {
    const where = `item ${i + 1}`;
    if (!it || typeof it !== "object") { errors.push(`${where} in \`content/book.json\` is empty.`); return; }
    if (it.blank || !it.file) { n += 1; return; }
    const f = it.file;
    if (!exists(`pages/${f}`)) errors.push(`\`${f}\` (${where}) is in the book but \`pages/${f}\` does not exist. That page shows empty.`);
    if (!exists(`pages/web/${stem(f)}.webp`) || !exists(`pages/thumb/${stem(f)}.webp`)) errors.push(`\`${f}\` has no web or thumbnail copy in \`pages/web/\` and \`pages/thumb/\`. Run \`python3 tools/pages.py\` (the workflow does this after a push).`);
    const m = files[f];
    if (!m) warnings.push(`\`${f}\` is not in \`pages/manifest.json\`; its size is guessed from the name until \`tools/pages.py\` runs.`);
    const spread = typeof it.spread === "boolean" ? it.spread : m ? m.w / m.h > ratio * 1.5 : /\d\d[-_]\d\d(\.|$)/.test(f);
    if (seen.has(f)) warnings.push(`\`${f}\` appears twice in the book (items ${seen.get(f) + 1} and ${i + 1}).`);
    seen.set(f, i);
    const first = n + 1;
    if (spread) {
      const coverAlone = book.coverAlone !== false;
      if (coverAlone ? first % 2 === 1 : first % 2 === 0) warnings.push(`\`${f}\` (pages ${first} to ${first + 1}) starts on a right-hand page, so its two halves show in different views. Add a blank page before it in the page order tool.`);
      n += 2;
    } else n += 1;
  });
  notes.push(`${items.length} items, ${n} pages.`);
  (book.links || []).forEach((l, i) => { if (!l || !l.label || !l.href) errors.push(`Top bar link ${i + 1} needs both a label and an address.`); });
  Object.keys(files).filter((f) => !seen.has(f)).forEach((f) => notes.push(`\`pages/${f}\` is not in the book (fine if it is kept for later; the page order tool can add or delete it).`));
}

/* ---------- files: root images, sizes, dashes, versions ---------- */
const all = walk(ROOT);
all.filter((f) => /^[^/]+\.(webp|jpe?g|png|tiff?)$/i.test(f.path)).forEach((f) => warnings.push(`\`${f.path}\` is in the repository root; the workflow moves it into \`pages/\` (or run \`python3 tools/pages.py\`).`));
const total = all.reduce((s, f) => s + f.size, 0);
const MB = (x) => (x / 1048576).toFixed(1) + " MB";
if (total > 900 * 1048576) errors.push(`The repository is ${MB(total)}. GitHub Pages stops at 1 GB.`);
else if (total > 700 * 1048576) warnings.push(`The repository is ${MB(total)}, nearing the 1 GB GitHub Pages limit.`);
notes.push(`Repository size: ${MB(total)} of the 1 GB GitHub Pages limit.`);
all.filter((f) => f.size > 50 * 1048576).forEach((f) => errors.push(`\`${f.path}\` is ${MB(f.size)}; GitHub refuses files over 100 MB and warns above 50 MB.`));
all.filter((f) => /^pages\/web\//.test(f.path) && f.size > 1.5 * 1048576).forEach((f) => warnings.push(`\`${f.path}\` is ${MB(f.size)}, heavy for a web copy.`));

const dashFiles = all.filter((f) => /\.(json|md|html|js|css|mjs|py|yml)$/i.test(f.path)).filter((f) => /[\u2013\u2014]/.test(fs.readFileSync(path.join(ROOT, f.path), "utf8")));
if (dashFiles.length) warnings.push(`Long dashes (en or em) appear in ${dashFiles.map((f) => "`" + f.path + "`").join(", ")}. The writing rule is commas, semicolons, parentheses or periods.`);

const pages = all.filter((f) => /^[^/]+\.html$/.test(f.path));
const versions = new Map();
pages.forEach((f) => { const v = new Set([...fs.readFileSync(path.join(ROOT, f.path), "utf8").matchAll(/\?v=(\d+)/g)].map((m) => m[1])); versions.set(f.path, [...v]); });
const allV = new Set([...versions.values()].flat());
if (allV.size > 1) errors.push(`Pages load different script versions (${[...versions].map(([p, v]) => `${p}: ${v.join("/")}`).join("; ")}). Raise \`?v=\` to the same number everywhere, or some visitors get old files.`);

/* ---------- report ---------- */
const status = errors.length ? "errors" : warnings.length ? "warnings" : "ok";
const list = (xs) => xs.map((x) => `- ${x}`).join("\n");
const report = [
  `## Book health: ${status === "ok" ? "all clear" : status === "warnings" ? "warnings" : "problems found"}`,
  "",
  errors.length ? `### Errors (${errors.length})\nThese break part of the book.\n\n${list(errors)}\n` : "",
  warnings.length ? `### Warnings (${warnings.length})\n\n${list(warnings)}\n` : "",
  notes.length ? `### Notes\n\n${list(notes)}\n` : "",
  `_Checked ${all.length} files on ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC._`
].filter(Boolean).join("\n");

console.log(report);
if (REPORT) fs.writeFileSync(REPORT, report + "\n");
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + "\n");
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `status=${status}\n`);
process.exit(errors.length ? 1 : 0);
