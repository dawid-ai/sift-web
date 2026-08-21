"use strict";
const { chromium } = require("playwright");
const { serve } = require("C:/88_CODE/sift/web/tools/serve.cjs");

(async () => {
  const site = await serve("C:/88_CODE/sift/web");
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto(site.url, { waitUntil: "networkidle" });

  const out = await p.evaluate(() => {
    const res = {};
    const cs = (el, ...props) => {
      const c = getComputedStyle(el);
      const o = {};
      for (const pr of props) o[pr] = c.getPropertyValue(pr);
      return o;
    };
    // 1. every element whose computed color/background/border is close to coral
    const coral = [];
    const violet = [];
    const toRGB = (s) => {
      const m = s.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
      return m ? [ +m[1], +m[2], +m[3], m[4]===undefined?1:+m[4] ] : null;
    };
    const isCoral = (s) => { const c = toRGB(s); if(!c) return false; if (c[3] < 0.05) return false;
      return c[0] > 180 && c[1] > 60 && c[1] < 175 && c[2] < 120 && (c[0]-c[2]) > 90 && (c[0]-c[1]) > 55; };
    const isViolet = (s) => { const c = toRGB(s); if(!c) return false; if (c[3] < 0.05) return false;
      return c[2] > 180 && c[0] > 90 && c[0] < 200 && c[1] < 160 && (c[2]-c[1]) > 60; };
    const walk = (el, pseudo) => {
      const c = getComputedStyle(el, pseudo || null);
      const props = ["color","background-color","border-top-color","border-right-color","border-bottom-color","border-left-color","outline-color","fill","stroke","-webkit-text-fill-color"];
      const bw = { "border-top-color":"border-top-width","border-right-color":"border-right-width","border-bottom-color":"border-bottom-width","border-left-color":"border-left-width" };
      for (const pr of props) {
        const v = c.getPropertyValue(pr);
        if (bw[pr] && parseFloat(c.getPropertyValue(bw[pr])) === 0) continue;
        if (pr === "color" && !(el.textContent||"").trim() && !pseudo) continue;
        if (pr === "background-color" && pseudo && c.content === "none") continue;
        const path = (el.tagName.toLowerCase()) + (el.id?"#"+el.id:"") + (el.className && typeof el.className === "string" ? "."+el.className.trim().split(/\s+/).join(".") : "") + (pseudo||"");
        if (isCoral(v)) coral.push({ path, pr, v, text: (el.textContent||"").trim().slice(0,50) });
        if (isViolet(v)) violet.push({ path, pr, v, text: (el.textContent||"").trim().slice(0,50) });
      }
      // background-image gradients
      const bi = c.getPropertyValue("background-image");
      if (bi && bi !== "none") {
        const path = (el.tagName.toLowerCase()) + (el.className && typeof el.className === "string" ? "."+el.className.trim().split(/\s+/).join(".") : "") + (pseudo||"");
        const parts = bi.split(/rgba?\(/).slice(1).map(s=>"rgb("+s.split(")")[0]+")");
        for (const q of parts) { if (isCoral(q)) coral.push({path, pr:"bg-image", v:q}); if (isViolet(q)) violet.push({path, pr:"bg-image", v:q}); }
      }
      const bs = c.getPropertyValue("box-shadow");
      if (bs && bs !== "none") {
        const path = (el.tagName.toLowerCase()) + (el.className && typeof el.className === "string" ? "."+el.className.trim().split(/\s+/).join(".") : "") + (pseudo||"");
        if (isCoral(bs)) coral.push({path, pr:"box-shadow", v:bs.slice(0,80)});
      }
    };
    document.querySelectorAll("*").forEach(el => { walk(el, null); walk(el, "::before"); walk(el, "::after"); });
    res.coral = coral; res.violet = violet;
    return res;
  });
  console.log(JSON.stringify(out, null, 1));
  await b.close(); site.close && site.close();
  process.exit(0);
})();
