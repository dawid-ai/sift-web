// Render web/tools/og.html to web/assets/og.png at exactly 1200x630.
// Not shipped — a build-time asset tool. Re-run it if the H1 or SHOT-SLIDES
// changes, because the card carries both.
//
//   node web/tools/make-og.cjs
//
// Uses the Chromium Playwright already installs for the app's e2e suite.
"use strict";
const { chromium } = require("playwright");
const { pathToFileURL } = require("node:url");
const { resolve, join } = require("node:path");
const { statSync } = require("node:fs");

const SRC = resolve(__dirname, "og.html");
const OUT = resolve(__dirname, "..", "assets", "og.png");

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("requestfailed", (r) => errors.push(r.url()));
  await page.goto(pathToFileURL(SRC).href, { waitUntil: "networkidle" });
  // The card is entirely local, but the webfaces still need a beat to swap in;
  // a card screenshotted mid-swap ships with the fallback metrics baked in.
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: OUT,
    clip: { x: 0, y: 0, width: 1200, height: 630 },
  });
  await browser.close();

  if (errors.length) {
    console.error("assets failed to load:", errors);
    process.exit(1);
  }
  console.log(`${OUT}  1200x630  ${Math.round(statSync(OUT).size / 1024)} KB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
