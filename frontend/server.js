// Minimal zero-dependency static file server for the built SPA.
// - Serves /app/dist with correct content-types and asset caching.
// - SPA fallback: unknown paths return index.html (client-side routing).
// - GET /healthz -> 200 "ok" (liveness/readiness probe).
// Listens on $PORT (from the K8s ConfigMap), default 8080, on 0.0.0.0.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = join(fileURLToPath(new URL(".", import.meta.url)), "dist");
const PORT = process.env.PORT || 8080;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

// Public tool routes are meant to rank in search, so their title/description
// must be in the HTML we serve — crawlers and social unfurlers that do not run
// JS never see what React sets. Mirrors usePageMeta in each page; keep in sync.
const PAGE_META = {
  "/answerkey-checker": {
    title: "Answer Key Calculator for SSC, Railway & Govt Exams (Free)",
    description:
      "Calculate your expected score using the official answer key for SSC, Railway, " +
      "Defence, Teaching, State, and Central Government exams.",
  },
};

const escapeAttr = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Rewrite the content="" of the <meta> tag identified by attr="name". Matches
// either attribute order, since the formatter sorts attributes alphabetically.
function setMetaContent(html, attr, name, content) {
  return html.replace(new RegExp(`<meta\\b[^>]*\\b${attr}="${name}"[^>]*>`, "i"), (tag) =>
    tag.replace(/\bcontent="[^"]*"/i, `content="${content}"`)
  );
}

function withPageMeta(html, url) {
  const meta = PAGE_META[url.replace(/\/+$/, "") || "/"];
  if (!meta) return html;

  const title = escapeAttr(meta.title);
  const description = escapeAttr(meta.description);
  let out = html.toString("utf8").replace(/<title>[^<]*<\/title>/i, `<title>${title}</title>`);
  out = setMetaContent(out, "name", "description", description);
  out = setMetaContent(out, "property", "og:title", title);
  return setMetaContent(out, "property", "og:description", description);
}

const server = createServer(async (req, res) => {
  try {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);

    if (url === "/healthz") {
      return send(res, 200, "ok", { "Content-Type": "text/plain" });
    }

    // Resolve the requested path safely inside DIST (block path traversal).
    const rel = normalize(url).replace(/^(\.\.[/\\])+/, "");
    let filePath = join(DIST, rel);
    if (!filePath.startsWith(DIST)) return send(res, 403, "forbidden");

    let info = await stat(filePath).catch(() => null);
    if (info && info.isDirectory()) {
      filePath = join(filePath, "index.html");
      info = await stat(filePath).catch(() => null);
    }

    if (info && info.isFile()) {
      const ext = extname(filePath).toLowerCase();
      const cache = url.startsWith("/assets/")
        ? "public, max-age=31536000, immutable" // fingerprinted build assets
        : "no-cache"; // index.html / health.json must always revalidate
      return send(res, 200, await readFile(filePath), {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Cache-Control": cache,
      });
    }

    // SPA fallback -> index.html
    const index = await readFile(join(DIST, "index.html")).catch(() => null);
    if (index) {
      return send(res, 200, withPageMeta(index, url), {
        "Content-Type": MIME[".html"],
        "Cache-Control": "no-cache",
      });
    }
    return send(res, 404, "not found");
  } catch {
    return send(res, 500, "internal error");
  }
});

server.listen(PORT, "0.0.0.0", () => console.log(`frontend listening on :${PORT}`));
