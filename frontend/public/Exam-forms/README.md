# IBPS PO Practice Registration Form (by Adda247)

A static, front-end-only **practice replica** of the IBPS PO "Basic Information"
registration step, for exam-prep rehearsal. No backend, no data submission —
all validation runs client-side in the browser and nothing is stored or sent
anywhere.

## Structure

```
index.html   entry page (the practice form)
css/         bootstrap, custom styles, icon font, images CSS pulled from the source site
images/      logo asset
```

## Run locally

Just open `index.html` in a browser, or serve the folder:

```bash
npx serve .
# or
python3 -m http.server 8080
```

## Deploy

This is a static site — any static host works with zero config:

- **Netlify**: drag-and-drop this folder, or `netlify deploy` from inside it.
- **Vercel**: `vercel` from inside this folder (framework preset: "Other").
- **GitHub Pages**: push this folder to a repo and enable Pages on the branch/root.
- **Any static bucket** (S3 + CloudFront, Cloudflare Pages, etc.): upload as-is.

No environment variables or build step are required.
