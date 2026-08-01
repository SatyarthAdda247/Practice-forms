// Per-route <head> tags for the built SPA, and the rewriting that applies them.
//
// Imported by BOTH the production server (server.js) and the dev server
// (vite.config.js), so `view-source:` shows the same tags in development as it
// does in production. It used to live in server.js alone, which meant vite
// served the raw index.html and every tool route looked like the portal until
// React mounted — invisible in the rendered page, but the only thing
// view-source, curl or a crawler ever sees.
//
// NOTE: server.js imports this file, so the Docker runtime stage must COPY it
// alongside server.js. Without that the container exits at startup with
// ERR_MODULE_NOT_FOUND — see frontend/Dockerfile.
//
// Deliberately dependency-free and framework-free: the production image installs
// no runtime packages, and this has to load in a bare `node server.js`.

// The origin the public tools are served from (DEPLOYMENT.md). Kept as one
// constant because this host has already moved once — it was
// aspirant-portal.adda247.com — and a stale canonical points crawlers at a URL
// that no longer resolves.
export const CANONICAL_ORIGIN = "https://tools.adda247.com";

// Public tool routes are meant to rank in search, so their title/description
// must be in the HTML we serve — crawlers and social unfurlers that do not run
// JS never see what React sets. Mirrors usePageMeta in each page; keep in sync.
//
// The Image Resizer, the Answer Key Checker and the OMR GradePro portal are
// three separate products that happen to share one bundle. So every public tool
// states its own title and description here rather than inheriting index.html's
// portal defaults — those defaults describe OMR GradePro, and serving them on a
// tool route makes the tool unfindable under its own name and unrecognisable
// when the link is shared.
//
// `canonical` is the single URL each product should rank under. It matters here
// more than on a normal site because the SPA fallback answers *any* unmatched
// path with this same HTML: /answerkey-checker/, /answerkey-checker?utm_source=…
// and a typo'd /answerkey-checkerx all render the tool, so without a
// self-referencing canonical a crawler is free to treat each as its own page and
// split the ranking between them.
export const PAGE_META = {
  "/image-resizer": {
    title: "Photo & Signature Image Resizer for Govt Exam Forms (Free)",
    description:
      "Resize your photo and signature to the exact pixel and KB limits for SSC, IBPS, " +
      "Railway, UPSC and NTA exam forms. Runs in your browser — nothing is uploaded.",
    canonical: `${CANONICAL_ORIGIN}/image-resizer`,
  },
  "/answerkey-checker": {
    title: "Answer Key Calculator for SSC, Railway & Govt Exams (Free)",
    description:
      "Calculate your expected score using the official answer key for SSC, Railway, " +
      "Defence, Teaching, State, and Central Government exams.",
    canonical: `${CANONICAL_ORIGIN}/answerkey-checker`,
  },
  "/exam-forms": {
    title: "Government Exam Registration Rehearsal Form (IBPS PO Replica)",
    description:
      "Practice completing multi-step government exam registration forms (Basic Info, Photo/Sig, Details, Uploads, Payment).",
    canonical: `${CANONICAL_ORIGIN}/exam-forms`,
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

/* Apply a route's tags to the index.html we are about to serve.
 *
 * `url` is the request path — a query string, if any, must already be stripped.
 * Routes not listed in PAGE_META are returned byte-for-byte unchanged, which is
 * what keeps the auth-gated portal pages exactly as they are.
 *
 * Each field is applied only when the route supplies it, so a route may state a
 * canonical without a title and keep index.html's own rather than having it
 * rewritten to "undefined".
 */
export function withPageMeta(html, url) {
  const meta = PAGE_META[url.replace(/\/+$/, "") || "/"];
  if (!meta) return html;

  let out = html.toString("utf8");
  if (meta.title) {
    const title = escapeAttr(meta.title);
    out = out.replace(/<title>[^<]*<\/title>/i, () => `<title>${title}</title>`);
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
