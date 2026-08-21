// A static file server for the review tools. Not shipped.
//
// Why the tools stopped using file:// — it lies about three things that matter
// here, and one of them cost a real defect:
//
//   1. CORS. Every file:// document is origin `null`, and fonts are fetched in
//      CORS mode, so a self-hosted @font-face — and a `rel=preload as=font
//      crossorigin`, which is the only correct way to preload one — is blocked.
//      Under file:// the page silently renders in the fallback face and the
//      preload reads as a network error.
//   2. Caching and protocol behaviour, which is what `networkidle` is timing.
//   3. Absolute-rooted paths, if any are ever introduced.
//
// The site ships as static files over HTTP, so the tools test it over HTTP.
// Node's own http module, no dependency.
"use strict";
const http = require("node:http");
const { createReadStream, statSync } = require("node:fs");
const { join, normalize, extname } = require("node:path");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

// Resolves to { url, close() }. Port 0 lets the OS pick, so two tools can run
// at once and neither has to own a port number.
function serve(root) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    // normalize() collapses any ../ before the join, so nothing outside root is
    // reachable even though this only ever serves a local review.
    const file = join(root, normalize(p).replace(/^(\.\.[/\\])+/, ""));
    try {
      const st = statSync(file);
      if (!st.isFile()) throw new Error("not a file");
      res.writeHead(200, {
        "Content-Type":
          TYPES[extname(file).toLowerCase()] || "application/octet-stream",
        "Content-Length": st.size,
        "Cache-Control": "no-store",
      });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 " + p);
    }
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

module.exports = { serve };
