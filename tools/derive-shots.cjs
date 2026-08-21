// Derive the responsive/cropped variants of every image the site ships.
// Not shipped — a build-time asset tool. Run it after re-capturing a screenshot.
//
//   node web/tools/derive-shots.cjs
//
// Writes into web/assets/shots/gen/ and web/assets/doc/gen/. Nothing here is a
// runtime dependency: the page only ever loads the PNGs this produced.
//
// Uses the Chromium that Playwright already installs for the app's e2e suite —
// canvas drawImage() with a source rect does the crop and the downscale in one
// step, so no new dependency enters the tree.
"use strict";
const { chromium } = require("playwright");
const { pathToFileURL } = require("node:url");
const { resolve, join, dirname } = require("node:path");
const { mkdirSync, writeFileSync, statSync, readFileSync } = require("node:fs");

const WEB = resolve(__dirname, "..");
const SHOTS = join(WEB, "assets", "shots");
const DOC = join(WEB, "assets", "doc");

// crop is [sx, sy, sw, sh] in SOURCE pixels; omit it to keep the whole frame.
// webp/png are the rendered variant widths, largest first.
//
// The page serves these through <picture>: the whole srcset ladder is WebP,
// and the <img> inside carries a single PNG as the fallback for the sliver of
// browsers that can't read WebP. That split is worth about 12x on this
// material — the 1400px rung of the library shot is 737 KB as PNG and 61 KB as
// WebP — and a full-width desktop pass over the page drops from roughly 6 MB
// of screenshots to well under one.
//
//   webp: every rung the page can actually ask for, up to 2x the widest slot
//         the layout gives the shot (the content column is 1184 CSS px).
//   png:  the <img> fallback. ALWAYS a derived 1x file, never the raw capture:
//         the captures are 2360-3192px wide and 0.6-2.1 MB each, and pointing
//         the fallback at one costs a non-WebP browser ~12 MB for a page whose
//         WebP path is under 1 MB. 1184 is the widest CSS slot the layout ever
//         gives a shot, so a 1184-wide PNG is the true 1x.
//
// ONE DEVICE ASPECT. Every shot presented inside the site's "Sift window"
// chrome is cropped to 1.60 — 1440x900, the aspect the deck specs and the
// aspect the app's own e2e captures are taken at. The captures themselves
// arrive at nine different shapes (1.21, 1.49, 1.60, 1.46, 1.08, 0.82, 1.19,
// 1.48, 1.43) because each was framed to the app surface it holds, and nine
// shapes inside identical chrome asserts nine different windows. The queue
// capture was the worst of it: 2344x2848 rendered as a PORTRAIT desktop
// application window 1.7 screenfuls tall.
//
// Where a surface is genuinely taller than 1.60 the crop picks the band the
// alt text is about (the queue's running list, the tracked-channel rows)
// rather than letting the frame go portrait. Every crop still only drops
// canvas or repeats-of-what-is-already-on-screen; none removes app UI that the
// alt text claims is visible, and the alt text was rewritten where the crop
// changed what is.
//
// There are two deliberate exceptions, and both carry NO window chrome, because
// a band is a different object from a window and is shaped like one:
// library-table-band, cut to a clean 2:1 because its toolbar and tag rail are
// the same pixels as the tiles shot directly above it; and detail-slides, which
// is captured as a 3.53 strip of the slides and their timestamps (see the job
// below and web-shots.spec.ts).
const JOBS = [
  // Hero. The old crop asked for 2040px of a 1800px-wide capture, so the
  // derived hero carried ~240px of empty canvas down its right edge. Now: from
  // just above the URL field to just below the tag row — the pasted URL, the
  // fetched preview, and the format options, which is exactly what the alt
  // text promises and nothing else.
  {
    src: join(SHOTS, "05-home-preview.png"),
    out: join(SHOTS, "gen", "hero-home"),
    crop: [0, 160, 1800, 1125],
    webp: [1680, 1100, 640],
    png: [1400],
  },
  // Library table, cut to a band: the toolbar and tag rail are pixel-identical
  // to the tiles shot it is paired with, so the pair shows them once and this
  // one is all rows. 2:1 exactly.
  {
    src: join(SHOTS, "02-library-table.png"),
    out: join(SHOTS, "gen", "library-table-band"),
    crop: [160, 428, 2660, 1330],
    webp: [2060, 1240, 660],
    png: [1042],
  },

  {
    src: join(SHOTS, "01-library-tiles.png"),
    out: join(SHOTS, "gen", "library-tiles"),
    crop: [0, 0, 3072, 1920],
    webp: [2368, 1400, 720],
    png: [1184],
  },
  {
    src: join(SHOTS, "03-media-detail-transcript.png"),
    out: join(SHOTS, "gen", "detail-transcript"),
    crop: [0, 0, 2880, 1800],
    webp: [2368, 1400, 720],
    png: [1184],
  },
  {
    src: join(SHOTS, "04-media-detail-summary.png"),
    out: join(SHOTS, "gen", "detail-summary"),
    crop: [0, 0, 2720, 1700],
    webp: [2368, 1400, 720],
    png: [1184],
  },
  // The queue's own list, not the whole scroll. The batch-entry panel above it
  // is the same "paste a stack of URLs" the section's heading already says.
  {
    src: join(SHOTS, "06-queue.png"),
    out: join(SHOTS, "gen", "queue"),
    crop: [0, 1380, 2344, 1465],
    webp: [2344, 1400, 720],
    png: [1184],
  },
  {
    src: join(SHOTS, "07-channels.png"),
    out: join(SHOTS, "gen", "channels"),
    crop: [0, 405, 2344, 1465],
    webp: [2344, 1400, 720],
    png: [1184],
  },
  // 08-settings-ai is captured for design QA and is NOT derived: the page no longer
  // shows a settings screen. Every readable string on that surface is the name of an AI
  // company, an account field or a key format, and the section it used to sit in says
  // "an account you already have" on purpose.
  // THE SECOND BAND. Like library-table-band, this one carries NO window chrome
  // and is not cut to 1.60: the capture itself is now framed on the "N of N
  // selected for the document" row and the filmstrip under it, with the
  // extraction toolbar scrolled out of the window (see web-shots.spec.ts). A
  // band is a different object from a window and is shaped like one — here 3.53
  // — and the whole capture is kept, so there is no crop rect at all.
  {
    src: join(SHOTS, "09-media-detail-slides.png"),
    out: join(SHOTS, "gen", "detail-slides"),
    webp: [2040, 1400, 720],
    png: [1184],
  },
];

// The exported document's slides are NOT derived here. They are real frames out
// of Sift's own library and they are produced, together with the document's
// markup, by web/tools/build-artifact.cjs.

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("about:blank");

  const rows = [];

  for (const job of JOBS) {
    // Handed in as a data: URL — a file:// image drawn into a file:// page's
    // canvas taints it, and toDataURL() would then throw.
    const url = `data:image/png;base64,${readFileSync(job.src).toString("base64")}`;
    const results = await page.evaluate(
      async ({ url, crop, plan }) => {
        const img = new Image();
        img.src = url;
        await img.decode();
        const [sx, sy, sw, sh] = crop || [
          0,
          0,
          img.naturalWidth,
          img.naturalHeight,
        ];
        const out = [];
        for (const { type, widths } of plan) {
          for (const w of widths) {
            const scale = Math.min(1, w / sw);
            const cw = Math.round(sw * scale);
            const ch = Math.round(sh * scale);
            const c = document.createElement("canvas");
            c.width = cw;
            c.height = ch;
            const ctx = c.getContext("2d");
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
            out.push({
              ext: type === "image/webp" ? "webp" : "png",
              w: cw,
              h: ch,
              data: c.toDataURL(type, 0.92).split(",")[1],
            });
          }
        }
        return { natural: [img.naturalWidth, img.naturalHeight], out };
      },
      {
        url,
        crop: job.crop || null,
        plan: [
          { type: "image/webp", widths: job.webp || [] },
          { type: "image/png", widths: job.png || [] },
        ],
      },
    );

    mkdirSync(dirname(job.out), { recursive: true });
    for (const v of results.out) {
      const file = `${job.out}-${v.w}.${v.ext}`;
      writeFileSync(file, Buffer.from(v.data, "base64"));
      rows.push({
        file: file.slice(WEB.length + 1).replace(/\\/g, "/"),
        px: `${v.w}x${v.h}`,
        kb: Math.round(statSync(file).size / 1024),
      });
    }
    // Paste-ready: index.html carries these on the <img> to reserve layout
    // space, so a re-capture at a new size means re-running this and copying
    // the numbers across. A stale pair only costs layout shift, not breakage.
    const [aw, ah] = job.crop ? [job.crop[2], job.crop[3]] : results.natural;
    console.log(
      `${job.src.slice(SHOTS.length + 1) || job.src} natural ${results.natural.join("x")}` +
        (job.crop ? ` crop ${job.crop.join(",")}` : "") +
        `  ->  width="${aw}" height="${ah}"`,
    );
  }

  await browser.close();
  console.table(rows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
