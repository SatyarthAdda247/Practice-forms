import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { withPageMeta } from "./routeMeta.js";

// Apply each route's own <title>, description and canonical to the HTML the DEV
// server sends, exactly as server.js does in production.
//
// Without this, `npm run dev` serves index.html verbatim, so view-source on
// /image-resizer shows the OMR GradePro portal defaults — the tool's real tags
// only appear once React mounts and usePageMeta swaps them in. The rendered page
// looks right, which is what makes it misleading: view-source, curl and any
// crawler that does not run JS all see the portal instead of the product.
//
// Dev only. In a build there is no request URL to key off — one index.html is
// emitted and server.js rewrites it per request at runtime — so the built file
// keeps the portal defaults and this hook stays out of the way.
function routeMeta() {
  return {
    name: "route-meta",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        if (!ctx.server) return html;
        return withPageMeta(html, (ctx.originalUrl || "/").split("?")[0]);
      },
    },
  };
}

// The dev server proxies /api to the Flask backend so the frontend can use
// same-origin relative URLs in development.
export default defineConfig({
  plugins: [react(), routeMeta()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
});
