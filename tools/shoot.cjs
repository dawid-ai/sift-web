// Screenshot the static site for visual review. Not shipped — a dev tool.
//
//   node web/tools/shoot.cjs [outDir]
//
// Writes, at 2x device pixel ratio:
//   desktop-full.png   full page,  1440 wide
//   desktop-fold.png   first fold, 1440x900  (same frame as the app screenshots)
//   desktop-NN.png     one frame per 900px of scroll, so a reviewer sees every section
//   mobile-full.png    full page,  390 wide
//
// ponytail: uses the playwright already installed for the app's e2e suite; no new dep.
"use strict";
const { chromium } = require("playwright");
const { join, resolve } = require("node:path");
const { mkdirSync, readdirSync, rmSync } = require("node:fs");
const { serve } = require("./serve.cjs");

const ROOT = resolve(__dirname, "..");
const OUT = resolve(
  process.argv[2] || join(__dirname, "..", "..", "web-shots"),
);

// The page's scroll reveals are short, but the chain diagram draws itself over
// ~1.4s. A fixed sleep either wastes time or catches that sequence half-drawn,
// so instead wait for the page to actually stop moving. Two things move:
//
//   1. the scroll itself — the stylesheet sets scroll-behavior: smooth, so
//      scrollTo() ANIMATES, and grabbing a frame mid-scroll catches the sticky
//      nav part-way through repositioning as well as reveals that haven't been
//      triggered yet. Smooth scrolling is not a Web Animation, so it has to be
//      waited on by watching scrollY settle.
//   2. transitions and CSS animations, both of which report a "running"
//      playState in getAnimations() for their whole delay + duration.
async function settle(page, cap = 3000) {
  // IntersectionObserver callbacks land a frame or two after the scroll, so
  // give them room before asking whether anything is animating — otherwise the
  // answer is "no" only because nothing has started yet.
  await page.waitForTimeout(200);
  await page
    .waitForFunction(
      () => {
        const w = window;
        const y = w.scrollY;
        if (w.__shootY !== y) {
          w.__shootY = y;
          return false;
        }
        return document.getAnimations().every((a) => a.playState !== "running");
      },
      null,
      { timeout: cap, polling: 100 },
    )
    .catch(() => {});
  await page.waitForTimeout(120);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  // EMPTY IT FIRST. The frame count tracks the page's length, so a run that
  // produces 25 frames leaves desktop-25/26 from a longer earlier page sitting
  // in the directory with older timestamps — and anyone told to "open every
  // frame" then reviews two frames of a page that no longer exists. Only this
  // tool's own output is removed.
  for (const name of readdirSync(OUT)) {
    if (/^(desktop|mobile)-[\w-]+\.png$/.test(name))
      rmSync(join(OUT, name), { force: true });
  }
  // Served over HTTP, not opened as a file: see web/tools/serve.cjs for why.
  const site = await serve(ROOT);
  const browser = await chromium.launch();

  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    // Motion is part of the design, so capture with it ON — but the page must still be
    // settled. Sections revealed by IntersectionObserver are scrolled into view below.
    reducedMotion: "no-preference",
  });
  const page = await desktop.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("requestfailed", (r) =>
    errors.push(`REQUEST FAILED ${r.url()} — ${r.failure()?.errorText}`),
  );

  await page.goto(site.url, { waitUntil: "networkidle" });
  await settle(page);
  await page.screenshot({ path: join(OUT, "desktop-fold.png") });

  // Walk the page so scroll-triggered reveals actually fire before the full-page grab,
  // and capture a readable frame per screenful on the way down.
  const height = await page.evaluate(() => document.body.scrollHeight);
  const frames = Math.ceil(height / 900);
  for (let i = 0; i < frames; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), i * 900);
    await settle(page);
    await page.screenshot({
      path: join(OUT, `desktop-${String(i).padStart(2, "0")}.png`),
    });
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page);
  await page.screenshot({
    path: join(OUT, "desktop-full.png"),
    fullPage: true,
  });

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const mp = await mobile.newPage();
  await mp.goto(site.url, { waitUntil: "networkidle" });
  await settle(mp);
  const mh = await mp.evaluate(() => document.body.scrollHeight);
  for (let i = 0; i < Math.ceil(mh / 844); i++) {
    await mp.evaluate((y) => window.scrollTo(0, y), i * 844);
    await settle(mp);
  }
  await mp.evaluate(() => window.scrollTo(0, 0));
  await settle(mp);
  await mp.screenshot({ path: join(OUT, "mobile-full.png"), fullPage: true });

  await browser.close();
  await site.close();

  console.log(`shots -> ${OUT}`);
  console.log(`page height: ${height}px, ${frames} desktop frames`);
  if (errors.length) {
    console.log(
      `\n!! ${errors.length} CONSOLE/NETWORK ERRORS — these are defects:`,
    );
    for (const e of new Set(errors)) console.log(`   ${e}`);
    process.exitCode = 1;
  } else {
    console.log("no console or network errors");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
