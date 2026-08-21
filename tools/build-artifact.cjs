// ============================================================================
// RETIRED. DO NOT RUN.
//
// This script builds section 2's example document out of Sift's OWN library, which
// means it publishes a real, named, third-party video: that video's transcript, its
// source URL, its uploader, and full-size copies of its slides, all into web/assets/
// where a deploy serves them. The page says, in three places, that the talk shown is
// invented and that nobody's words are being borrowed. Running this makes the page
// lie, and it also overwrites the hand-drawn example slides in
// web/assets/doc/example/ with photographs of somebody else's work.
//
// The material this last produced now lives OUTSIDE the publish directory, in
// _private/web-doc-source/. It is kept, not deleted, and it is not published.
//
// To bring this back it needs two things it does not have: a talk Dawid has the right
// to quote at that length, and a run record whose every figure is read off that run.
// Until then the guard below stays.
// ============================================================================
if (require.main === module) {
  console.error(
    "build-artifact.cjs is retired: it republishes third-party material the page says it does not use.\n" +
      "See the note at the top of this file. Nothing was run.",
  );
  process.exit(1);
}

// Build ASSET-DOC — the real exported document the site's section 2 is about.
// Not shipped — a build-time asset tool.
//
//   node web/tools/build-artifact.cjs [mediaId]
//
// Reads Sift's OWN library (%APPDATA%/Sift/sift.db + %APPDATA%/Sift/frames) and
// reproduces the RAW (no-AI) export for one media row, exactly as
// packages/core/src/frames/document.ts `buildDocumentBlocks` does it: transcript
// segments and the SELECTED slide frames merged onto one timeline, then runs of
// adjacent segments coalesced into a paragraph. At an exact tie the slide comes
// after the narration at that moment.
//
// Nothing here is written by hand. The words are the transcript Sift stored, the
// slides are the frames Sift kept, and the order is the order they happened in.
//
// Writes:
//   web/assets/doc/artifact.json         the blocks, checked in so the page can be rebuilt
//   web/assets/doc/slides/slide-NN.jpg   the kept frames, copied out of Sift's app data
//   web/assets/doc/gen/slide-NN-{384,640}.{webp,png}
//   and splices the rendered fragment into index.html between the ARTIFACT markers.
"use strict";
const { DatabaseSync } = require("node:sqlite");
const { chromium } = require("playwright");
const { resolve, join } = require("node:path");
const {
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  rmSync,
  existsSync,
} = require("node:fs");

const WEB = resolve(__dirname, "..");
const DOC = join(WEB, "assets", "doc");
const SLIDES = join(DOC, "slides");
const GEN = join(DOC, "gen");

const APPDATA = process.env.APPDATA || "";
const SIFT_DB = join(APPDATA, "Sift", "sift.db");
const MEDIA_ID = Number(process.argv[2] || 44);

/** `12.5` s → `00:12` (or `1:02:03` past an hour). Same as document.ts. */
function formatTs(seconds) {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Verbatim port of buildDocumentBlocks (packages/core/src/frames/document.ts). */
function buildDocumentBlocks(segments, frames) {
  const timeline = [
    ...segments.map((s) => ({
      t: s.start,
      order: 0,
      block: { kind: "text", text: s.text },
    })),
    ...frames.map((f) => ({
      t: f.tsMs / 1000,
      order: 1,
      block: { kind: "frame", src: f.src, tsMs: f.tsMs },
    })),
  ];
  timeline.sort((a, b) => a.t - b.t || a.order - b.order);
  const out = [];
  for (const { block } of timeline) {
    const last = out[out.length - 1];
    if (block.kind === "text" && last?.kind === "text")
      last.text = `${last.text} ${block.text}`.trim();
    else out.push(block.kind === "text" ? { ...block } : block);
  }
  return out;
}

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** The transcript is a caption track: it carries `>>` speaker turns and the odd
 *  stray marker. Nothing is reworded — this only turns the caption convention
 *  into a typographic one. */
function tidy(text) {
  return text
    .replace(/\s*>>\s*/g, " — ")
    .replace(/\s+/g, " ")
    .replace(/^\s*—\s*/, "")
    .trim();
}

/** First readable line of the OCR Sift ran on the frame, for the alt text. */
function ocrLead(ocr) {
  if (!ocr) return "";
  const line = String(ocr)
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 3 && /[a-z]/i.test(l))[0];
  return line ? line.replace(/\s+/g, " ").slice(0, 90) : "";
}

async function main() {
  if (!existsSync(SIFT_DB))
    throw new Error(`no Sift library at ${SIFT_DB} — nothing to export from`);

  // Read a copy: the app may have the real file open.
  const snapshot = join(
    process.env.TEMP || process.env.TMP || ".",
    "sift-artifact-read.db",
  );
  copyFileSync(SIFT_DB, snapshot);
  const db = new DatabaseSync(snapshot, { readOnly: true });

  const media = db.prepare("select * from media where id = ?").get(MEDIA_ID);
  if (!media) throw new Error(`no media row ${MEDIA_ID}`);
  const transcript = db
    .prepare("select * from transcript where media_id = ?")
    .get(MEDIA_ID);
  if (!transcript) throw new Error(`media ${MEDIA_ID} has no transcript`);
  const frameRows = db
    .prepare(
      "select ts_ms, image_path, ocr_text from frame where media_id = ? and included = 1 order by ts_ms",
    )
    .all(MEDIA_ID);
  if (!frameRows.length)
    throw new Error(`media ${MEDIA_ID} has no kept frames`);

  const segments = JSON.parse(transcript.segments_json).map((s) => ({
    start: s.start,
    text: s.text,
  }));

  // Copy the kept frames out of Sift's app-data folder under stable names.
  rmSync(SLIDES, { recursive: true, force: true });
  mkdirSync(SLIDES, { recursive: true });
  const frames = frameRows.map((f, i) => {
    const name = `slide-${String(i + 1).padStart(2, "0")}`;
    copyFileSync(f.image_path, join(SLIDES, `${name}.jpg`));
    return { tsMs: f.ts_ms, src: name, ocr: ocrLead(f.ocr_text) };
  });

  const blocks = buildDocumentBlocks(segments, frames).map((b) =>
    b.kind === "text"
      ? { kind: "text", text: tidy(b.text) }
      : {
          kind: "frame",
          slide: b.src,
          tsMs: b.tsMs,
          ts: formatTs(b.tsMs / 1000),
          ocr: frames.find((f) => f.src === b.src)?.ocr || "",
        },
  );

  const artifact = {
    generatedFrom: "Sift's own library — raw (no-AI) export",
    mediaId: MEDIA_ID,
    title: media.title,
    uploader: media.uploader,
    sourceUrl: media.source_url,
    durationS: media.duration_s,
    transcriptProvider: transcript.provider_id,
    slides: frames.length,
    blocks,
  };
  mkdirSync(DOC, { recursive: true });
  writeFileSync(
    join(DOC, "artifact.json"),
    `${JSON.stringify(artifact, null, 1)}\n`,
  );

  // --- derived slide variants ------------------------------------------------
  mkdirSync(GEN, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("about:blank");
  let bytes = 0;
  for (const f of frames) {
    const url = `data:image/jpeg;base64,${readFileSync(join(SLIDES, `${f.src}.jpg`)).toString("base64")}`;
    const outs = await page.evaluate(
      async ({ url, plan }) => {
        const img = new Image();
        img.src = url;
        await img.decode();
        const out = [];
        for (const { type, widths } of plan)
          for (const w of widths) {
            const scale = Math.min(1, w / img.naturalWidth);
            const cw = Math.round(img.naturalWidth * scale);
            const ch = Math.round(img.naturalHeight * scale);
            const c = document.createElement("canvas");
            c.width = cw;
            c.height = ch;
            const ctx = c.getContext("2d");
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(img, 0, 0, cw, ch);
            out.push({
              ext: type.split("/")[1],
              w: cw,
              h: ch,
              data: c.toDataURL(type, 0.86).split(",")[1],
            });
          }
        return out;
      },
      {
        url,
        plan: [
          { type: "image/webp", widths: [768, 384] },
          // The <img> fallback for browsers without WebP. A derived 384 — never
          // the 1732px original, which would cost such a browser ~2 MB.
          { type: "image/jpeg", widths: [384] },
        ],
      },
    );
    for (const v of outs) {
      const file = join(GEN, `${f.src}-${v.w}.${v.ext}`);
      const buf = Buffer.from(v.data, "base64");
      writeFileSync(file, buf);
      bytes += buf.length;
      if (v.w === 384 && v.ext === "jpeg") {
        f.pw = v.w;
        f.ph = v.h;
      }
    }
  }
  await browser.close();

  // --- the fragment ----------------------------------------------------------
  const byName = Object.fromEntries(frames.map((f) => [f.src, f]));
  const parts = [];
  // The title is INSIDE the timeline grid so its left edge and its rule line
  // up with the paragraph measure rather than hanging 104px to the left of it.
  parts.push(`<div class="doc-body">`);
  parts.push(`<p class="doc-title">${esc(media.title)}</p>`);
  let seen = 0;
  for (const b of blocks) {
    if (b.kind === "text") {
      parts.push(`<p class="doc-p">${esc(b.text)}</p>`);
      continue;
    }
    seen += 1;
    const f = byName[b.slide];
    const alt = b.ocr
      ? `Slide at ${b.ts} of the talk, headed “${b.ocr}”.`
      : `Slide shown at ${b.ts} of the talk.`;
    parts.push(
      `<figure class="doc-slide">
<span class="doc-time">${b.ts}</span>
<picture>
<source type="image/webp" srcset="assets/doc/gen/${b.slide}-384.webp 384w, assets/doc/gen/${b.slide}-768.webp 768w" sizes="(min-width: 40rem) 384px, calc(100vw - 4rem)" />
<img src="assets/doc/gen/${b.slide}-384.jpeg" width="${f.pw}" height="${f.ph}"${seen > 1 ? ' loading="lazy"' : ""} decoding="async" alt="${esc(alt)}" />
</picture>
</figure>`,
    );
  }
  parts.push(`</div>`);
  const fragment = parts.join("\n");

  const indexPath = join(WEB, "index.html");
  const html = readFileSync(indexPath, "utf8");
  const BEGIN = "<!-- ARTIFACT:BEGIN -->";
  const END = "<!-- ARTIFACT:END -->";
  if (html.includes(BEGIN) && html.includes(END)) {
    const a = html.indexOf(BEGIN) + BEGIN.length;
    const b = html.indexOf(END);
    writeFileSync(
      indexPath,
      `${html.slice(0, a)}\n${fragment}\n${html.slice(b)}`,
    );
    console.log("spliced into index.html");
  } else {
    writeFileSync(join(DOC, "artifact.fragment.html"), fragment);
    console.log("markers not found — wrote assets/doc/artifact.fragment.html");
  }

  console.log(
    `${media.title}\n  ${media.source_url}\n  ${Math.round(media.duration_s / 60)} min · ${frames.length} slides · ${blocks.filter((b) => b.kind === "text").length} paragraphs · transcript from ${transcript.provider_id}\n  derived slides: ${Math.round(bytes / 1024)} KB of WebP`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
