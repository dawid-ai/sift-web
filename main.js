/* ============================================================================
   Sift — website behaviour.

   Progressive enhancement only. Everything on this page reads, navigates and
   opens with JavaScript switched off; this file adds six conveniences and
   nothing else:

     1. the mobile nav panel
     2. an active-state marker on the nav anchor for the section you're in
        (aria-current, which the stylesheet is allowed to paint coral — an
        active state is one of the two things coral is spent on)
     3. keeping the nav CTA quiet while EITHER page CTA is on screen, so the
        page never carries two coral objects at once
     4. the artifact frame's expand / collapse control
     5. the scroll-reveal system
     6. the chain diagram drawing itself when it first comes into view

   THE CONTRACT FOR 4 AND 5. The stylesheet hides revealable content only under
   `html.motion`, and the head bootstrap sets that class only when this browser
   has IntersectionObserver and the reader has not asked for reduced motion. It
   also arms a 2s failsafe that takes the class back off unless this file marks
   itself ready. So: JS off, JS broken, old browser, reduced motion — every one
   of those paints the page in full. There is no path where a reveal leaves
   content invisible.

   No dependencies, no network, no storage. Every hook is optional: if an
   element isn't on the page, the block that wants it does nothing.
   ============================================================================ */

(function () {
  "use strict";

  var root = document.documentElement;
  var motionQuery =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
  var reduceMotion = !!(motionQuery && motionQuery.matches);

  /* --- 1. Mobile nav ------------------------------------------------------ */

  var toggle = document.querySelector(".nav-toggle");
  var links = document.getElementById("nav-links");

  if (toggle && links) {
    var setOpen = function (open) {
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) links.setAttribute("data-open", "true");
      else links.removeAttribute("data-open");
    };

    toggle.addEventListener("click", function () {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });

    links.addEventListener("click", function (event) {
      if (event.target.closest("a")) setOpen(false);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") setOpen(false);
    });
  }

  /* --- 2. Which section am I in ------------------------------------------- */

  var navAnchors = links
    ? Array.prototype.slice.call(links.querySelectorAll('a[href^="#"]'))
    : [];

  if (navAnchors.length && "IntersectionObserver" in window) {
    var watched = [];

    navAnchors.forEach(function (anchor) {
      var id = anchor.getAttribute("href").slice(1);
      var section = document.getElementById(id);
      if (!section) return;
      watched.push(section);
    });

    var visible = Object.create(null);

    var paint = function () {
      var current = null;
      for (var i = 0; i < watched.length; i++) {
        if (visible[watched[i].id]) {
          current = watched[i].id;
          break;
        }
      }
      navAnchors.forEach(function (anchor) {
        var id = anchor.getAttribute("href").slice(1);
        if (id === current) anchor.setAttribute("aria-current", "true");
        else anchor.removeAttribute("aria-current");
      });
    };

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          visible[entry.target.id] = entry.isIntersecting;
        });
        paint();
      },
      // Ignore the strip under the sticky bar, and treat the top half of the
      // viewport as "where you are".
      { rootMargin: "-20% 0px -55% 0px", threshold: 0 },
    );

    watched.forEach(function (section) {
      observer.observe(section);
    });
  }

  /* --- 2b. One coral object on screen ------------------------------------- */
  // The header's Download pill and the page's two Download buttons are the same
  // request in the same colour. The nav one starts quiet and is promoted to the
  // primary treatment only while NEITHER of the real CTAs is on screen, so the
  // page never carries two saturated objects at the same time.
  //
  // Watching the hero alone was not enough: the closing band's "Download for
  // Windows — free" slab is the other one, and at the exact moment the page
  // makes its ask the coral nav pill was lit beside it — worse on mobile, where
  // the two sit about 200px apart.

  var pageCtas = [
    document.querySelector(".cta-row .btn-primary"),
    document.querySelector("#download .btn-primary"),
  ].filter(Boolean);
  var navCta = document.querySelector(".nav-cta");

  if (pageCtas.length && navCta && "IntersectionObserver" in window) {
    var onScreen = new Set();
    var ctaObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) onScreen.add(entry.target);
          else onScreen.delete(entry.target);
        });
        var alone = onScreen.size === 0;
        navCta.classList.toggle("btn-primary", alone);
        navCta.classList.toggle("btn-quiet", !alone);
      },
      { threshold: 0 },
    );
    pageCtas.forEach(function (cta) {
      ctaObserver.observe(cta);
    });
  }

  /* --- 3. The artifact frame ---------------------------------------------- */

  var expander = document.querySelector(".artifact-expand");
  var viewport = document.getElementById("asset-doc-viewport");

  if (expander && viewport) {
    expander.addEventListener("click", function () {
      var expanded = viewport.getAttribute("data-expanded") === "true";
      var next = !expanded;

      if (next) viewport.setAttribute("data-expanded", "true");
      else viewport.removeAttribute("data-expanded");

      // data-, not aria-expanded: the collapsed document is clipped by
      // overflow:hidden only, so every word of it stays in the accessibility
      // tree. Asserting "collapsed" to a screen reader that is about to read
      // the whole thing is a lie the DOM contradicts. The button label already
      // says what it does.
      expander.setAttribute("data-expanded", next ? "true" : "false");
      expander.textContent = next
        ? expander.getAttribute("data-label-expanded") || "Collapse"
        : expander.getAttribute("data-label-collapsed") ||
          "Read the whole thing";

      // Collapsing from far down the document would otherwise leave the reader
      // stranded below the frame.
      if (!next) {
        var frame = document.getElementById("asset-doc");
        if (frame && frame.getBoundingClientRect().top < 0) {
          frame.scrollIntoView({
            behavior: reduceMotion ? "auto" : "smooth",
            block: "start",
          });
        }
      }
    });
  }

  /* --- 4. The nav firms up once you're off the top ------------------------ */

  var nav = document.querySelector(".nav");
  if (nav) {
    var pending = false;
    var syncNav = function () {
      pending = false;
      if (window.pageYOffset > 6) nav.setAttribute("data-scrolled", "true");
      else nav.removeAttribute("data-scrolled");
    };
    window.addEventListener(
      "scroll",
      function () {
        if (pending) return;
        pending = true;
        window.requestAnimationFrame(syncNav);
      },
      { passive: true },
    );
    syncNav();
  }

  /* --- 4b. Two print fixes CSS cannot make -------------------------------- */

  // A closed <details> is not reliably printable from a stylesheet — engines
  // hide the non-summary children through the UA's own mechanism rather than a
  // display rule you can override. So every answer is opened for the print and
  // put back exactly as the reader left it afterwards.
  var reopen = [];
  window.addEventListener("beforeprint", function () {
    reopen = [];
    var all = document.querySelectorAll("details");
    for (var i = 0; i < all.length; i++) {
      if (!all[i].open) {
        reopen.push(all[i]);
        all[i].open = true;
      }
    }
    // The artifact is NOT expanded for print any more: it is the real export of
    // a 70-minute lecture, and printing it whole is ~80 sheets. The print
    // stylesheet keeps it as the window it is on screen.
  });
  window.addEventListener("afterprint", function () {
    reopen.forEach(function (d) {
      d.open = false;
    });
    reopen = [];
  });

  /* --- 4c. The comparison table's scroll region --------------------------- */

  // The wide table lives in a labelled, focusable scroll region so it can be
  // panned from the keyboard. Below 56rem the table destacks into cards and
  // there is nothing left to pan, and a focus stop that does nothing is a stop
  // a keyboard reader has to work out the purpose of. So the tabindex tracks
  // whether the region can actually scroll. With JS off it stays as authored,
  // which is the safe direction: focusable and scrollable.
  var scroller = document.querySelector(".table-scroll");
  if (scroller) {
    var syncScroller = function () {
      if (scroller.scrollWidth > scroller.clientWidth + 1)
        scroller.setAttribute("tabindex", "0");
      else scroller.removeAttribute("tabindex");
    };
    syncScroller();
    if ("ResizeObserver" in window)
      new ResizeObserver(syncScroller).observe(scroller);
    else window.addEventListener("resize", syncScroller);
  }

  /* --- 4d. The Mac list ---------------------------------------------------

     REMOVED. There was a two-field signup form here posting to a third-party
     list service, and ~200 lines of validation, send and endpoint-guard code
     for it. The endpoint was never set, the submit shipped disabled, and a
     visibly dead form was the only thing on the site that asked the visitor
     for anything. The section is a link to the repo instead, which needs no
     script. Both the markup and this code are in git history. */

  /* --- 5. Scroll reveal + the chain draw ----------------------------------

     MIRRORS the :where() list in styles.css section 11A. If you add a target
     in one file you must add it in the other, or it reveals without ever
     having been hidden (harmless) or hides without ever being revealed (not). */

  var REVEAL_SELECTOR = [
    ".hero-copy > *",
    ".hero-stage",
    ".section-head > *",
    ".prose",
    ".pullquote",
    ".honest-note",
    ".cards > .card",
    ".ai-options",
    ".cost-line",
    ".platform-row",
    ".platform-note",
    ".platform-status",
    ".microcopy",
    ".shot:not(.shot-hero)",
    ".artifact-frame",
    ".note-caption",
    ".run-record",
    ".release-log",
    ".chain-diagram",
    ".chain-closing",
    ".two-col > .col",
    ".stat-row > .stat",
    ".subsection > .subhead",
    ".install-list > li",
    ".faq",
    ".after-link",
    ".author-link",
    ".download-title",
    ".section-download .btn-lg",
    ".signup",
    ".link-row",
    ".footer-cols > .footer-col",
    ".footer-base",
  ].join(",");

  // Cadence. Short and tight: the stagger is there to give a group an order,
  // not to make anyone wait for the fourth card.
  var STEP = 70; // ms between siblings arriving together
  var STEP_MAX = 5; // …capped, so a big batch never trails off
  var INTRO_STEP = 40; // the above-the-fold intro runs quicker
  var CHAIN_LEAD = 220; // let the diagram's frame land before the line starts

  var revealAll = function (nodes) {
    nodes.forEach(function (el) {
      el.classList.add("is-in");
    });
  };

  var drawChain = function (diagram, after) {
    var canvas = diagram.querySelector(".chain-canvas");
    if (!canvas || canvas.classList.contains("is-drawn")) return;
    window.setTimeout(function () {
      canvas.classList.add("is-drawn");
    }, after);
  };

  var reveal = function (el, delay, intro) {
    if (delay) {
      el.style.transitionDelay = delay + "ms";
      // Inline delay is one-shot: leaving it on would also delay this element's
      // hover transition for the rest of the session.
      window.setTimeout(function () {
        el.style.transitionDelay = "";
      }, delay + 900);
    }
    if (intro) el.classList.add("is-intro");
    el.classList.add("is-in");
    if (el.classList.contains("chain-diagram"))
      drawChain(el, delay + CHAIN_LEAD);
  };

  var inDocOrder = function (a, b) {
    if (a === b) return 0;
    return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
      ? -1
      : 1;
  };

  var wireReveals = function () {
    // The bootstrap's failsafe is disarmed the moment we know we can finish
    // the job — before a single element is touched.
    root.setAttribute("data-reveal-ready", "");
    if (!root.classList.contains("motion")) return;

    var targets = Array.prototype.slice.call(
      document.querySelectorAll(REVEAL_SELECTOR),
    );
    if (!targets.length) return;

    // Anything already on screen is an intro, not a reveal. Playing it through
    // the observer would work, but the observer's first callback is a frame
    // late and the fold is the one place that shows.
    var fold = window.innerHeight * 0.95;
    var intro = [];
    var rest = [];
    targets.forEach(function (el) {
      var box = el.getBoundingClientRect();
      if (box.top < fold && box.bottom > 0) intro.push(el);
      else rest.push(el);
    });

    intro.sort(inDocOrder).forEach(function (el, i) {
      reveal(el, Math.min(i, STEP_MAX + 1) * INTRO_STEP, true);
    });

    if (!rest.length) return;

    var io = new IntersectionObserver(
      function (entries, self) {
        var batch = [];
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          batch.push(entry.target);
          self.unobserve(entry.target);
        });
        if (!batch.length) return;
        // Everything that crossed in the same tick genuinely arrived together,
        // so the stagger is read off document order within that batch — never
        // off a fixed index, which would make a lone late element wait.
        batch.sort(inDocOrder).forEach(function (el, i) {
          reveal(el, Math.min(i, STEP_MAX) * STEP, false);
        });
      },
      // Trigger on FIRST CONTACT with the viewport, with no inset. An inset
      // here reads well until you stop scrolling with something half in frame:
      // that element sits in the dead band, invisible, and looks like a bug
      // rather than like restraint. Elements enter from the bottom while the
      // reader is still moving, so a 480ms arrival is seen either way.
      { rootMargin: "0px", threshold: 0 },
    );

    rest.forEach(function (el) {
      io.observe(el);
    });

    // If the reader turns reduced motion on mid-session, drop the gate class:
    // every pre-roll state in the stylesheet is scoped to it, so the page
    // resolves to fully painted with no transition to sit through.
    if (motionQuery && motionQuery.addEventListener) {
      motionQuery.addEventListener("change", function (event) {
        if (!event.matches) return;
        io.disconnect();
        root.classList.remove("motion");
        revealAll(rest);
      });
    }
  };

  wireReveals();
})();

/* ---------------------------------------------------------------------------
   Mac notify-me — Tally popup, loaded on demand.

   The anchor's href is the real Tally form, so with JS off the button is just a
   link and still works. With JS on we intercept the click, pull in Tally's
   embed script, and open the modal instead.

   Loading it lazily rather than in <head> is the point: the rest of this page
   makes no third-party requests at all, and a visitor who never opens the form
   shouldn't be introduced to one.
   --------------------------------------------------------------------------- */
(function macTally() {
  const trigger = document.getElementById("mac-tally");
  if (!trigger) return;

  const FORM_ID = trigger.dataset.tallyOpen;
  const SRC = "https://tally.so/widgets/embed.js";
  let loading = null;

  const load = () =>
    (loading ||= new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = SRC;
      el.async = true;
      el.onload = resolve;
      el.onerror = reject;
      document.body.appendChild(el);
    }));

  const open = () =>
    window.Tally &&
    window.Tally.openPopup(FORM_ID, {
      layout: "modal",
      width: 460,
      overlay: true,
      emoji: { text: trigger.dataset.tallyEmojiText || "\u{1F44B}", animation: "wave" },
    });

  // Warm the script on hover/focus so the click feels instant, but never before
  // the visitor has shown intent.
  ["pointerenter", "focus"].forEach((e) =>
    trigger.addEventListener(e, () => load().catch(() => {}), { once: true }),
  );

  trigger.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await load();
      open();
    } catch {
      // Script blocked or offline: fall back to the plain link rather than
      // leaving a dead button.
      window.location.href = trigger.href;
    }
  });
})();
