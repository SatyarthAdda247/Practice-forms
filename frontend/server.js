// Minimal zero-dependency static file server for the built SPA.
// - Serves /app/dist with correct content-types and asset caching.
// - SPA fallback: unknown paths return index.html (client-side routing).
// - GET /healthz -> 200 "ok" (liveness/readiness probe).
// Listens on $PORT (from the K8s ConfigMap), default 8080, on 0.0.0.0.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
// Per-route <head> tags, shared with the dev server so view-source agrees in
// both. This file must be present in the runtime image — see frontend/Dockerfile.
import { withPageMeta } from "./routeMeta.js";

const DIST = join(fileURLToPath(new URL(".", import.meta.url)), "dist");
const PORT = process.env.PORT || 8080;

// Every extension Vite can emit into dist/ needs an entry here. Browsers refuse
// a module script served as anything but a JavaScript type, so a missing entry
// is not a cosmetic problem: ".mjs" falling through to application/octet-stream
// is what stopped the pdf.js worker from loading and made every PDF upload in
// the Answer Key Checker fail with "Could not read that file".
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".pdf": "application/pdf",
  // pdf.js character maps and standard fonts, if they are ever copied in.
  ".bcmap": "application/octet-stream",
  ".pfb": "application/octet-stream",
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
