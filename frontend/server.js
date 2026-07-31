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

// Google Identity Services signs the user in through a popup that postMessages
// the credential back to this page. Chrome severs that opener link — logging
// "Cross-Origin-Opener-Policy policy would block the window.postMessage call"
// — unless the document hosting GIS opts popups back in. Only HTML needs it.
const HTML_SECURITY_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
};

// The origin the public tools are served from (DEPLOYMENT.md). Kept as one
// constant because this host has already moved once — it was
// aspirant-portal.adda247.com — and a stale canonical points crawlers at a URL
// that no longer resolves.
const CANONICAL_ORIGIN = "https://tools.adda247.com";

// Public tool routes are meant to rank in search, so their title/description
// must be in the HTML we serve — crawlers and social unfurlers that do not run
// JS never see what React sets. Mirrors usePageMeta in each page; keep in sync.
//
// `canonical` is the single URL each tool should rank under. It matters here
// more than on a normal site because the SPA fallback answers *any* unmatched
// path with this same HTML: /answerkey-checker/, /answerkey-checker?utm_source=…
// and a typo'd /answerkey-checkerx all render the tool, so without a
// self-referencing canonical a crawler is free to treat each as its own page and
// split the ranking between them.
const PAGE_META = {
  "/image-resizer": {
    // Title and description are deliberately absent: this route has never
    // declared its own, and inventing search copy for it is a separate change
    // from giving it a canonical.
    canonical: `${CANONICAL_ORIGIN}/image-resizer`,
  },
  "/answerkey-checker": {
    title: "Answer Key Calculator for SSC, Railway & Govt Exams (Free)",
    description:
      "Calculate your expected score using the official answer key for SSC, Railway, " +
      "Defence, Teaching, State, and Central Government exams.",
    canonical: `${CANONICAL_ORIGIN}/answerkey-checker`,
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

const CANONICAL_TAG = /<link\b[^>]*\brel="canonical"[^>]*>/i;

// Add or rewrite <link rel="canonical">. index.html ships without one, because
// the portal routes behind it are auth-gated and have no business declaring a
// canonical URL — so the tag is inserted only for the routes listed above, and
// every other route's HTML is served exactly as before.
function withCanonical(html, href) {
  const tag = `<link href="${escapeAttr(href)}" rel="canonical" />`;
  // Replacement passed as a function, so a "$" in the URL is never read as a
  // capture-group reference.
  if (CANONICAL_TAG.test(html)) return html.replace(CANONICAL_TAG, () => tag);
  return html.replace(/<\/head>/i, () => `  ${tag}\n  </head>`);
}

// Each field is applied only when the route supplies it: /image-resizer sets a
// canonical and nothing else, and must keep the portal's default title and
// description rather than having them rewritten to "undefined".
function withPageMeta(html, url) {
  const meta = PAGE_META[url.replace(/\/+$/, "") || "/"];
  if (!meta) return html;

  let out = html.toString("utf8");
  if (meta.title) {
    const title = escapeAttr(meta.title);
    out = out.replace(/<title>[^<]*<\/title>/i, `<title>${title}</title>`);
    out = setMetaContent(out, "property", "og:title", title);
  }
  if (meta.description) {
    const description = escapeAttr(meta.description);
    out = setMetaContent(out, "name", "description", description);
    out = setMetaContent(out, "property", "og:description", description);
  }
  if (meta.canonical) out = withCanonical(out, meta.canonical);
  return out;
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
        ...(ext === ".html" ? HTML_SECURITY_HEADERS : {}),
      });
    }

    // SPA fallback -> index.html
    const index = await readFile(join(DIST, "index.html")).catch(() => null);
    if (index) {
      return send(res, 200, withPageMeta(index, url), {
        "Content-Type": MIME[".html"],
        "Cache-Control": "no-cache",
        ...HTML_SECURITY_HEADERS,
      });
    }
    return send(res, 404, "not found");
  } catch {
    return send(res, 500, "internal error");
  }
});

server.listen(PORT, "0.0.0.0", () => console.log(`frontend listening on :${PORT}`));
