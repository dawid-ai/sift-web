// Measure the static site instead of guessing at it. Not shipped — a dev tool.
//
//   node web/tools/audit.cjs
//
// Across every width in WIDTHS it reports, as real numbers:
//   - horizontal overflow (measured off element boxes, because body has
//     overflow-x: hidden and would otherwise hide exactly what we are looking
//     for from document.scrollWidth)
//   - rendered text under 14px, including SVG <text>, whose effective size is
//     its declared size times the viewBox scale
//   - interactive elements whose hit box is under 44x44
//   - SVG text that runs outside its own viewBox and is therefore clipped
//   - heading order, landmarks, images missing alt or intrinsic size
//   - contrast of every text node against its composited background
//   - transferred bytes, by type
"use strict";
const { chromium } = require("playwright");
const { resolve } = require("node:path");
const { serve } = require("./serve.cjs");

const ROOT = resolve(__dirname, "..");
const WIDTHS = [320, 390, 768, 1024, 1440, 1920, 2560];

const MIN_TEXT = 14;
const MIN_TAP = 44;
const MIN_CONTRAST = 4.5;

/* ---------- the in-page probe ------------------------------------------- */

function probe({ MIN_TEXT, MIN_TAP, MIN_CONTRAST }) {
  const out = {
    overflow: [],
    smallText: [],
    smallTap: [],
    svgClipped: [],
    lowContrast: [],
  };
  const vw = window.innerWidth;

  const name = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    if (el.classList.length) s += "." + [...el.classList].slice(0, 2).join(".");
    return s;
  };
  const label = (el) =>
    (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 46);

  // getComputedStyle(el).display on a descendant of a display:none ancestor
  // reports the descendant's OWN display, not "none" — so checking the element
  // alone counted every string inside the hidden chain diagram, the hidden
  // mobile nav panel and the sr-only chain flow. checkVisibility walks the
  // ancestors, which is the question actually being asked.
  const shown = (el) =>
    el.checkVisibility
      ? el.checkVisibility({
          contentVisibilityAuto: true,
          visibilityProperty: true,
        })
      : !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

  /* --- horizontal overflow.
     body { overflow-x: hidden } means documentElement.scrollWidth can never
     exceed the viewport, so the only honest measurement is element boxes. */
  for (const el of document.querySelectorAll("body *")) {
    if (!shown(el)) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    // Deliberate off-canvas: the sr-only pattern and the skip link parked above
    // the fold are not overflow.
    if (r.width <= 1 && r.height <= 1) continue;
    if (cs.position === "fixed") continue;
    if (r.right > vw + 1 || r.left < -1) {
      out.overflow.push({
        el: name(el),
        left: Math.round(r.left),
        right: Math.round(r.right),
        over: Math.round(Math.max(r.right - vw, -r.left)),
      });
    }
  }

  /* --- text size. HTML first. */
  const seen = new Set();
  for (const el of document.querySelectorAll("body *")) {
    // SVG <text> is measured separately below, in viewBox units.
    if (el.namespaceURI === "http://www.w3.org/2000/svg") continue;
    if (!shown(el)) continue;
    const cs = getComputedStyle(el);
    let hasText = false;
    for (const n of el.childNodes)
      if (n.nodeType === 3 && n.textContent.trim()) hasText = true;
    if (!hasText) continue;
    const px = parseFloat(cs.fontSize);
    if (px < MIN_TEXT - 0.01) {
      const k = name(el) + "|" + px;
      if (seen.has(k)) continue;
      seen.add(k);
      out.smallText.push({ el: name(el), px: +px.toFixed(2), text: label(el) });
    }
  }
  // SVG <text>: the declared size is in viewBox units, so what lands on screen
  // is declared * (rendered width / viewBox width).
  for (const svg of document.querySelectorAll("svg")) {
    if (!shown(svg)) continue;
    const box = svg.getBoundingClientRect();
    if (!box.width) continue;
    const vb = svg.viewBox.baseVal;
    if (!vb || !vb.width) continue;
    const scale = box.width / vb.width;
    for (const t of svg.querySelectorAll("text")) {
      const declared = parseFloat(getComputedStyle(t).fontSize);
      const eff = declared * scale;
      if (eff < MIN_TEXT - 0.01)
        out.smallText.push({
          el: "svg text." + (t.getAttribute("class") || "?"),
          px: +eff.toFixed(2),
          text: label(t),
          note: `declared ${declared} x scale ${scale.toFixed(3)}`,
        });
      // clipped by the viewBox?
      let ext = 0;
      try {
        const b = t.getBBox();
        ext = b.x + b.width;
      } catch (e) {}
      if (ext > vb.x + vb.width)
        out.svgClipped.push({
          el: t.getAttribute("class"),
          endsAt: Math.round(ext),
          viewBoxEnds: vb.x + vb.width,
          text: label(t),
        });
    }
  }

  /* --- tap targets */
  const INTERACTIVE =
    "a[href], button, summary, input, select, [tabindex]:not([tabindex='-1'])";
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    if (!shown(el)) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    // Links inside a running paragraph are exempt from the target-size rule.
    const p = el.closest("p, li, td, th, .prose, .faq-body");
    const inline =
      p && cs.display.startsWith("inline") && !el.classList.contains("btn");
    const standalone =
      el.closest(
        ".cta-row, .nav-links, .link-row, .footer-col, .after-link, .author-link, .nav-inner",
      ) ||
      el.tagName === "BUTTON" ||
      el.tagName === "SUMMARY";
    if (inline && !standalone) continue;
    if (r.width < MIN_TAP - 0.5 || r.height < MIN_TAP - 0.5)
      out.smallTap.push({
        el: name(el),
        w: Math.round(r.width),
        h: Math.round(r.height),
        text: label(el),
      });
  }

  /* --- contrast. Composites the ancestor chain to find the real backdrop. */
  const parse = (c) => {
    const m = c.match(/[\d.]+/g);
    if (!m) return null;
    return [+m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3]];
  };
  const lum = ([r, g, b]) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const over = (fg, bg) => {
    const a = fg[3];
    return [
      fg[0] * a + bg[0] * (1 - a),
      fg[1] * a + bg[1] * (1 - a),
      fg[2] * a + bg[2] * (1 - a),
      1,
    ];
  };
  const backdrop = (el) => {
    const stack = [];
    let n = el;
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c[3] > 0) stack.push(c);
      n = n.parentElement;
    }
    stack.push([11, 10, 9, 1]); // --background #0B0A09, the page ground
    let acc = stack[stack.length - 1];
    for (let i = stack.length - 2; i >= 0; i--) acc = over(stack[i], acc);
    return acc;
  };

  const contrastSeen = new Set();

  // SVG text paints with `fill`, not `color`, and its backdrop is a <rect>
  // sibling rather than an ancestor — so the ancestor walk below sees neither.
  // The chain diagram is a whole figure of text, and one of its labels was
  // failing at 4.25:1 with nothing to catch it. The backdrop is named per
  // class here because it is knowable and short: the panel is --surface and the
  // input chip and node discs are --surface-2.
  const SVG_BACKDROP = {
    "cd-kicker": [46, 43, 40], // --surface-2, the input chip
    "cd-num": [46, 43, 40], // --surface-2, the node disc
  };
  const SVG_PANEL = [32, 29, 27]; // --surface, the .chain-diagram panel
  for (const svg of document.querySelectorAll("svg")) {
    if (!shown(svg)) continue;
    const scale =
      svg.getBoundingClientRect().width / (svg.viewBox.baseVal.width || 1);
    for (const t of svg.querySelectorAll("text")) {
      const cs = getComputedStyle(t);
      const fg = parse(cs.fill);
      if (!fg) continue;
      const cls = (t.getAttribute("class") || "").split(/\s+/);
      const bg = [
        ...(cls.map((c) => SVG_BACKDROP[c]).find(Boolean) || SVG_PANEL),
        1,
      ];
      const f = lum(over(fg, bg));
      const b = lum(bg);
      const ratio = (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05);
      const px = parseFloat(cs.fontSize) * scale;
      const large = px >= 24 || (px >= 18.66 && (+cs.fontWeight || 400) >= 700);
      const need = large ? 3 : MIN_CONTRAST;
      if (ratio < need - 0.01)
        out.lowContrast.push({
          el: "svg text." + cls[0],
          ratio: +ratio.toFixed(2),
          need,
          color: cs.fill,
          text: label(t),
        });
    }
  }

  for (const el of document.querySelectorAll("body *")) {
    if (!shown(el)) continue;
    if (el.namespaceURI === "http://www.w3.org/2000/svg") continue;
    const cs = getComputedStyle(el);
    let text = "";
    for (const n of el.childNodes) if (n.nodeType === 3) text += n.textContent;
    if (!text.trim()) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = backdrop(el);
    const f = lum(over(fg, bg));
    const b = lum(bg);
    const ratio = (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05);
    const px = parseFloat(cs.fontSize);
    const weight = +cs.fontWeight || 400;
    const large = px >= 24 || (px >= 18.66 && weight >= 700);
    const need = large ? 3 : MIN_CONTRAST;
    if (ratio < need - 0.01) {
      const k = name(el) + "|" + cs.color;
      if (contrastSeen.has(k)) continue;
      contrastSeen.add(k);
      out.lowContrast.push({
        el: name(el),
        ratio: +ratio.toFixed(2),
        need,
        color: cs.color,
        text: label(el),
      });
    }
  }

  return out;
}

/* ---------- structural checks, run once --------------------------------- */

function structure() {
  const out = { headings: [], problems: [], images: [], landmarks: {} };
  let last = 0;
  let h1 = 0;
  for (const h of document.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
    const lvl = +h.tagName[1];
    if (lvl === 1) h1++;
    if (last && lvl > last + 1)
      out.problems.push(
        `heading jump h${last} -> h${lvl}: "${h.textContent.trim().slice(0, 50)}"`,
      );
    last = lvl;
    out.headings.push(
      `${"  ".repeat(lvl - 1)}h${lvl} ${h.textContent.trim().slice(0, 58)}`,
    );
  }
  if (h1 !== 1) out.problems.push(`${h1} <h1> elements`);

  for (const img of document.querySelectorAll("img")) {
    const rec = {
      src: img.getAttribute("src"),
      alt: img.getAttribute("alt"),
      w: img.getAttribute("width"),
      h: img.getAttribute("height"),
      natural: img.naturalWidth + "x" + img.naturalHeight,
      loading: img.getAttribute("loading") || "eager",
      current: img.currentSrc.split("/").pop(),
    };
    if (rec.alt === null) out.problems.push(`img with no alt: ${rec.src}`);
    if (!rec.w || !rec.h)
      out.problems.push(`img with no intrinsic size: ${rec.src}`);
    else if (img.naturalWidth) {
      const declared = +rec.w / +rec.h;
      const real = img.naturalWidth / img.naturalHeight;
      if (Math.abs(declared - real) / real > 0.01)
        out.problems.push(
          `img aspect mismatch ${rec.src}: declared ${rec.w}x${rec.h} (${declared.toFixed(3)}) vs real ${rec.natural} (${real.toFixed(3)})`,
        );
    }
    out.images.push(rec);
  }

  out.landmarks = {
    main: document.querySelectorAll("main").length,
    banner: document.querySelectorAll("body > header").length,
    contentinfo: document.querySelectorAll("body > footer").length,
    nav: document.querySelectorAll("nav").length,
    lang: document.documentElement.lang,
    title: document.title,
  };

  // Anchors that go nowhere.
  for (const a of document.querySelectorAll('a[href^="#"]')) {
    const id = a.getAttribute("href").slice(1);
    if (id && !document.getElementById(id))
      out.problems.push(`dead anchor: ${a.getAttribute("href")}`);
  }

  // JSON-LD parses?
  for (const s of document.querySelectorAll(
    'script[type="application/ld+json"]',
  )) {
    try {
      JSON.parse(s.textContent);
    } catch (e) {
      out.problems.push("JSON-LD does not parse: " + e.message);
    }
  }
  return out;
}

/* ---------- driver ------------------------------------------------------ */

// Scroll the whole page in instant steps and wait for every image to settle.
// Everything on this page that matters below the fold is lazy, so nothing is
// measurable until the walk has actually happened.
async function walk(page) {
  const h = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < h + 800; y += 700) {
    await page.evaluate(
      (v) => window.scrollTo({ top: v, behavior: "instant" }),
      y,
    );
    await page.waitForTimeout(70);
  }
  await page
    .waitForFunction(
      () => [...document.querySelectorAll("img")].every((i) => i.complete),
      null,
      { timeout: 15000 },
    )
    .catch(() => {});
}

async function main() {
  const site = await serve(ROOT);
  const browser = await chromium.launch();
  const bytes = { total: 0, byType: {} };
  const failed = [];
  const consoleErrors = [];

  // Weight is measured once, at the width that asks for the most: the widest
  // srcset rung the layout can select.
  const weighCtx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const wp = await weighCtx.newPage();
  wp.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  wp.on("pageerror", (e) => consoleErrors.push(String(e)));
  wp.on("requestfailed", (r) => failed.push(r.url()));
  wp.on("response", async (res) => {
    try {
      const b = (await res.body()).length;
      const t = (res.request().resourceType() || "other").toString();
      bytes.total += b;
      bytes.byType[t] = (bytes.byType[t] || 0) + b;
    } catch (e) {}
  });
  await wp.goto(site.url, { waitUntil: "networkidle" });
  // Walk it so lazy images below the fold actually load, which is what a reader
  // who reads the page transfers.
  //
  // behavior: "instant" is load-bearing. The stylesheet sets
  // scroll-behavior: smooth on <html>, so a plain scrollTo ANIMATES — and with
  // a short wait between steps the walk never actually arrives anywhere. That
  // silently under-reported page weight by every below-the-fold screenshot on
  // the page, which is most of the image budget.
  await walk(wp);
  await wp.waitForLoadState("networkidle");
  const stragglers = await wp.evaluate(() =>
    [...document.querySelectorAll("img")]
      .filter((i) => !i.complete || !i.naturalWidth)
      .map((i) => i.getAttribute("src")),
  );
  if (stragglers.length) console.log("IMAGES THAT NEVER LOADED:", stragglers);
  const struct = await wp.evaluate(structure);

  console.log("=== STRUCTURE ===");
  console.log(struct.landmarks);
  console.log("\n--- heading outline ---");
  console.log(struct.headings.join("\n"));
  console.log("\n--- structural problems ---");
  console.log(struct.problems.length ? struct.problems.join("\n") : "none");
  console.log("\n--- images ---");
  console.table(struct.images);

  console.log("\n=== WEIGHT (1440x900 @2dpr, whole page scrolled) ===");
  console.log(`total ${(bytes.total / 1024).toFixed(0)} KB`);
  for (const [k, v] of Object.entries(bytes.byType).sort((a, b) => b[1] - a[1]))
    console.log(`  ${k.padEnd(12)} ${(v / 1024).toFixed(0)} KB`);
  console.log("failed requests:", failed.length ? failed : "none");
  console.log("console errors:", consoleErrors.length ? consoleErrors : "none");
  await weighCtx.close();

  console.log("\n=== PER WIDTH ===");
  let clean = true;
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    await page.goto(site.url, { waitUntil: "networkidle" });
    await walk(page);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForTimeout(150);
    const r = await page.evaluate(probe, { MIN_TEXT, MIN_TAP, MIN_CONTRAST });
    const counts = Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, v.length]),
    );
    const bad = Object.values(counts).some((n) => n > 0);
    if (bad) clean = false;
    console.log(`\n--- ${width}px --- ${bad ? "" : "clean"}`);
    for (const [k, v] of Object.entries(r)) {
      if (!v.length) continue;
      console.log(` ${k} (${v.length}):`);
      console.table(v.slice(0, 14));
    }
    await ctx.close();
  }

  await browser.close();
  await site.close();
  if (!clean || struct.problems.length || failed.length || consoleErrors.length)
    process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
