# sift.dawid.ai

Marketing site for [Sift](https://github.com/dawid-ai/sift) — a static, hand-written
page with no build step. GitHub Pages serves this repo's root at
**https://sift.dawid.ai**.

## Deploying

Push to `master`. Pages publishes within a minute or two.

- `CNAME` pins the custom domain. Deleting it drops the site back to
  `dawid-ai.github.io/sift-web`.
- `.nojekyll` turns off Jekyll. Without it Pages refuses to serve anything whose path
  starts with `_`, which silently hides `tools/_probe.cjs`.

## Keeping the version current

`tools/sync-release.cjs` rewrites the version, date, and release list in `index.html`
from Sift's `UPDATES.md`. It reads that file **two directories up**, so it only runs
with this repo checked out at `web/` inside a Sift checkout:

```
C:\88_CODE\sift\          ← dawid-ai/sift
  UPDATES.md
  web\                    ← this repo (gitignored by the parent)
```

`/release-update` in the Sift repo runs it and pushes both repos.
