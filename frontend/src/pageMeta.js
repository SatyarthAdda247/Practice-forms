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

export default function usePageMeta({ title, description }) {
  useEffect(() => {
    const tags = [
      [metaTag("name", "description"), description],
      [metaTag("property", "og:title"), title],
      [metaTag("property", "og:description"), description],
    ];
    const previousTitle = document.title;
    const previousContent = tags.map(([el]) => el.content);

    document.title = title;
    for (const [el, content] of tags) el.content = content;

    return () => {
      document.title = previousTitle;
      tags.forEach(([el], i) => {
        el.content = previousContent[i];
      });
    };
  }, [title, description]);
}
