// Rewrite the version-dependent parts of web/index.html from UPDATES.md.
//
//   node web/tools/sync-release.cjs
//
// Not shipped — a build-time tool. Run it as part of publishing, and after every
// `/release-update`, or the page quietly starts advertising an old version in four
// places at once while its own argument is "look how actively this is maintained".
//
// What it rewrites, all of it marked in the HTML so nothing is matched by prose:
//
//   [data-release-date]      the date it went out, e.g. "17 August 2026"
//   [data-release-count]     how many releases there have been, spelt out
//   [data-release-first]     the date of the first one
//   [data-release-list]      the five most recent, as
//                            <li><span>date</span><span>what changed</span>
//                            NO VERSION NUMBERS ANYWHERE A READER LOOKS. A
//                            version string is developer surface: to a reader
//                            who does not parse it, it is noise in a column; to
//                            a reader who does, "v0.5.0" says "below 1.0, not
//                            finished" — the opposite of what this section is
//                            arguing. The date carries the "steadily looked
//                            after" claim on its own, and a short note says the
//                            thing the reader actually wants to know. The
//                            version still travels in the page's structured
//                            data, which is machine surface, not reader surface.
//
// ADDING A RELEASE: put one line in NOTES below, keyed by version. The run
// exits non-zero if any of the five shown releases has no note, rather than
// quietly publishing a blank column.
//
// Exits non-zero if UPDATES.md cannot be parsed or a marker is missing, so a broken
// run is loud rather than silent.
"use strict";
const { readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");

const ROOT = resolve(__dirname, "..", "..");
const UPDATES = join(ROOT, "UPDATES.md");
const PAGE = join(ROOT, "web", "index.html");
const SHOWN = 5;

/* One short, lower-case, human note per release — what a reader would say the
   update was, not what the changelog calls it. Lower case on purpose: the row
   is a caption, not a heading, and Title Case here reads as a product name. */
const NOTES = {
  "v0.6.2": "real channel counts, clickable thumbnails",
  "v0.6.1": "readable update notes",
  "v0.6.0": "search that finds things",
  "v0.5.0": "a new look, everywhere",
  "v0.4.0": "files you already have",
  "v0.3.0": "library filters",
  "v0.2.1": "a new icon, tidier settings",
  "v0.2.0": "slide documents",
  "v0.1.0": "slides out of a talk",
  "v0.0.15": "the queue",
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const WORDS = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
  "Twenty",
];

/** "Twenty-one", "Thirty-four", … — a count in a sentence should read as a word. */
function spell(n) {
  if (n <= 20) return WORDS[n];
  const tens = [
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
  ];
  if (n < 100) {
    const t = tens[Math.floor(n / 10)];
    const u = n % 10;
    return u === 0 ? t : `${t}-${WORDS[u].toLowerCase()}`;
  }
  return String(n);
}

const releases = [];
for (const line of readFileSync(UPDATES, "utf8").split(/\r?\n/)) {
  const m = line.match(/^##\s+(v[\d.]+)\s+—\s+(\d{4})-(\d{2})-(\d{2})\s*$/);
  if (m) {
    releases.push({
      version: m[1],
      y: Number(m[2]),
      m: Number(m[3]),
      d: Number(m[4]),
    });
  }
}
if (releases.length === 0) {
  console.error(
    `sync-release: no "## vX.Y.Z — YYYY-MM-DD" headings found in ${UPDATES}`,
  );
  process.exit(1);
}

const long = (r) => `${r.d} ${MONTHS[r.m - 1]} ${r.y}`;
const short = (r) => `${r.d} ${SHORT[r.m - 1]} ${r.y}`;

const latest = releases[0];
const first = releases[releases.length - 1];

let html = readFileSync(PAGE, "utf8");
const before = html;
// The page is edited on Windows and git may hand it back with CRLF, so every
// pattern below has to tolerate both. Matching a bare LF is how this script came
// to report data-release-list as *missing* while the marker sat right there in
// the file — that line simply ended CRLF.
const EOL = html.includes("\r\n") ? "\r\n" : "\n";
const misses = [];

function fill(attr, value) {
  const re = new RegExp(`(<span ${attr}>)([\\s\\S]*?)(</span>)`, "g");
  if (!re.test(html)) {
    misses.push(attr);
    return;
  }
  html = html.replace(
    new RegExp(`(<span ${attr}>)([\\s\\S]*?)(</span>)`, "g"),
    `$1${value}$3`,
  );
}

fill("data-release-date", long(latest));
fill("data-release-count", spell(releases.length));
fill("data-release-first", long(first));

const shown = releases.slice(0, SHOWN);
const unnoted = shown.filter((r) => !NOTES[r.version]).map((r) => r.version);
if (unnoted.length) {
  console.error(
    `sync-release: no NOTES entry for ${unnoted.join(", ")} — ` +
      `add one line per release to NOTES in this file.`,
  );
  process.exit(1);
}
const rows = shown
  .map(
    (r) =>
      `                <li>${EOL}` +
      `                  <span class="rel-d">${short(r)}</span${EOL}` +
      `                  ><span class="rel-n">${NOTES[r.version]}</span>${EOL}` +
      `                </li>`,
  )
  .join(EOL);
const listRe =
  /(<ol class="release-list" data-release-list>\r?\n)([\s\S]*?)(\r?\n[ \t]*<\/ol>)/;
if (listRe.test(html)) html = html.replace(listRe, `$1${rows}$3`);
else misses.push("data-release-list");

// The structured-data version travels with the page, not with the release notes.
html = html.replace(
  /("softwareVersion":\s*")[^"]*(")/,
  `$1${latest.version.replace(/^v/, "")}$2`,
);

if (misses.length) {
  console.error(
    `sync-release: markers missing from index.html: ${misses.join(", ")}`,
  );
  process.exit(1);
}

writeFileSync(PAGE, html);
console.log(
  `sync-release: ${latest.version} (${long(latest)}), ` +
    `${releases.length} releases since ${long(first)}` +
    (html === before ? " — already up to date" : " — index.html rewritten"),
);
