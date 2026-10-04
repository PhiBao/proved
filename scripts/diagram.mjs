/**
 * Render the architecture diagram to SVG, and inline it into the README.
 *
 * Why a build step for one diagram: a hand-drawn picture of a state machine is a
 * picture of a state machine as of the moment it was drawn. This one is generated
 * from `docs/architecture.mmd`, and `pnpm run diagram:check` fails if the
 * committed SVG is stale — so the diagram cannot quietly disagree with the
 * contract it depicts.
 *
 * Mermaid ships as an ES module only, so it cannot be pulled in with
 * `addScriptTag` and a global. The page is therefore served over HTTP from a
 * throwaway local server and imports it as a module, which is what the format
 * requires. Serving it from disk with a `file://` page leaves the import blocked
 * by the browser's own module rules.
 *
 * Dev-only. `mermaid` and `playwright` are never shipped to the browser: this is
 * a build tool for one image in a README, not a runtime dependency of the app.
 */
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const src = join(repo, "docs", "architecture.mmd");
const out = join(repo, "docs", "architecture.svg");
const readme = join(repo, "README.md");
const check = process.argv.includes("--check");

const MERMAID = join(repo, "node_modules", "mermaid", "dist", "mermaid.min.js");
for (const f of [src, MERMAID]) {
  if (!existsSync(f)) {
    console.error(`missing ${f}`);
    process.exit(1);
  }
}

const definition = readFileSync(src, "utf8");

// mermaid.min.js is a self-contained bundle that assigns itself to
// globalThis.mermaid, so it loads as an ordinary script. The ESM entry
// (mermaid.core.mjs) exports named bindings instead and needs an import map to
// reach its own chunks, which is more machinery than one diagram justifies.
const page_html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script src="/mermaid.js"></script>
<script>
  mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "loose" });
  mermaid.render("arch", ${JSON.stringify(definition)}).then(function (r) {
    document.body.innerHTML = r.svg;
    document.body.dataset.done = "1";
  }).catch(function (e) {
    document.body.dataset.error = String(e);
    document.body.dataset.done = "1";
  });
</script>
</body></html>`;

const server = createServer((req, res) => {
  if (req.url === "/mermaid.js") {
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    res.end(readFileSync(MERMAID));
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page_html);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const { chromium } = await import("playwright");
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
await page
  .waitForFunction(() => document.body.dataset.done === "1", { timeout: 30_000 })
  .catch(() => {
    console.error("mermaid did not render:", errors.join("; ") || "no error captured");
    process.exit(1);
  });

const mermaidError = await page.evaluate(() => document.body.dataset.error ?? "");
if (mermaidError) {
  console.error("mermaid rejected the diagram:", mermaidError);
  process.exit(1);
}

const svg = (await page.content()).match(/<svg[\s\S]*<\/svg>/)?.[0];
await browser.close();
server.close();

if (!svg) {
  console.error("no <svg> in the rendered output");
  process.exit(1);
}
if (errors.length) {
  console.error("page errors during render:", errors.join("; "));
}

// Mermaid emits HTML-flavoured SVG: its `<br>` is a void element in HTML, which
// is correct there and invalid in XML. Browsers parse a standalone .svg as XML,
// so the file is silently not rendered at all. Rewriting the HTML void tags to
// their self-closing form is the fix.
//
// Deliberately restricted to a known list. A blanket "<x>" -> "<x/>" pass would
// also rewrite void SVG elements such as `<path ... />` and destroy the drawing;
// these four only ever appear inside `foreignObject` text nodes.
const HTML_VOID = ["br", "hr", "img", "input", "wbr"];
function closeVoidElements(markup) {
  let out = markup;
  for (const tag of HTML_VOID) {
    out = out.replace(new RegExp(`<${tag}(\\s[^>]*?)?>`, "g"), (all, attrs) =>
      /\/\s*$/.test(all) ? all : `<${tag}${attrs ?? ""}/>`,
    );
  }
  return out;
}

// Make the SVG scale to the README's column. Both `width` and `style` are
// rewritten rather than appended: mermaid already emits a `style` and a `role`,
// and adding a second of either makes the file invalid XML, which browsers
// refuse to render at all.
const responsive = closeVoidElements(svg).replace(/<svg\b([^>]*)>/, (_all, attrs) => {
  let a = attrs
    .replace(/\swidth="[^"]*"/, "")
    .replace(/\sstyle="[^"]*"/, "")
    .trim();
  return `<svg ${a} style="max-width:100%;height:auto;background:transparent">`;
});

const existing = (() => {
  try {
    return readFileSync(out, "utf8");
  } catch {
    return null;
  }
})();

// The comparison must use the exact string that gets written. Comparing against
// the un-newlined form meant --check reported "stale" immediately after a
// successful generate, every time.
const expected = responsive + "\n";

if (check) {
  if (existing !== expected) {
    console.error("docs/architecture.svg is stale — run: pnpm run diagram");
    process.exit(1);
  }
  console.log("docs/architecture.svg is up to date");
} else {
  writeFileSync(out, expected);

  const block = [
    "<!-- architecture: generated by `pnpm run diagram` from docs/architecture.mmd.",
    "     Do not edit the SVG or the block below by hand. -->",
    "<p align=\"center\">",
    '<img src="docs/architecture.svg" alt="The Proved job lifecycle. A payer commits to a file hash and funds; the freelancer delivers; submit() releases in the same transaction if the artifact matches, or leaves the money held if not. Contesting costs 15 basis points and is adjudicated by the contract. Both terminal states, Released and Settled, have no path back to the payer." width="880">',
    "</p>",
  ].join("\n");

  let text = readFileSync(readme, "utf8");
  const marker = /<!-- architecture:[\s\S]*?<\/p>\n?/;
  text = marker.test(text)
    ? text.replace(marker, block + "\n")
    : text.replace("## Architecture\n", `## Architecture\n\n${block}\n`);
  writeFileSync(readme, text);
  console.log(`wrote docs/architecture.svg (${responsive.length} bytes) and inlined it into README.md`);
}