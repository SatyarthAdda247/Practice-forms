// Per-route <title> and description for the SPA.
//
// Two layers, because this is a static SPA with a single index.html:
//  1. server.js rewrites the tags in the HTML it serves, so crawlers and social
//     unfurlers that never run JS still get the right ones (see PAGE_META there).
//  2. this hook applies them in the browser, which covers client-side navigation
//     and the dev server, and restores the previous values on unmount so a
//     public tool's title never sticks to the portal pages.
// Keep the two in sync when a page's copy changes.
import { useEffect } from "react";

// The <meta> tag for `attr="name"`, created in <head> if the document lacks it.
function metaTag(attr, name) {
  const selector = `meta[${attr}="${name}"]`;
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  return el;
}

// The <link rel="canonical"> tag. Returns [element, created] — index.html ships
// without a canonical, so the caller has to know whether it is restoring an
// existing tag or removing one this hook added.
function canonicalTag() {
  const existing = document.head.querySelector('link[rel="canonical"]');
  if (existing) return [existing, false];
  const el = document.createElement("link");
  el.setAttribute("rel", "canonical");
  document.head.appendChild(el);
  return [el, true];
}

// Every field is optional and only the ones supplied are touched: the image
// resizer declares a canonical and nothing else, so blanking the title and
// description it never set would be a regression, not a reset.
export default function usePageMeta({ title, description, canonical }) {
  useEffect(() => {
    const tags = [
      title !== undefined && [metaTag("property", "og:title"), title],
      description !== undefined && [metaTag("name", "description"), description],
      description !== undefined && [metaTag("property", "og:description"), description],
    ].filter(Boolean);
    const previousTitle = document.title;
    const previousContent = tags.map(([el]) => el.content);

    if (title !== undefined) document.title = title;
    for (const [el, content] of tags) el.content = content;

    // A canonical created here is removed again on unmount rather than restored,
    // so a public tool's URL is never left declared on the portal page that
    // renders after it.
    let link = null;
    let created = false;
    let previousHref = "";
    if (canonical) {
      [link, created] = canonicalTag();
      previousHref = link.getAttribute("href") || "";
      link.setAttribute("href", canonical);
    }

    return () => {
      if (title !== undefined) document.title = previousTitle;
      tags.forEach(([el], i) => {
        el.content = previousContent[i];
      });
      if (created) link.remove();
      else if (link) link.setAttribute("href", previousHref);
    };
  }, [title, description, canonical]);
}
