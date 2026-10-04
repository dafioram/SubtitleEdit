// Shared test setup. Every test fails if the page throws, logs a console
// error (which includes failed requests such as a missing font) or opens a
// native alert/confirm dialog — the app is meant to use in-page notices.
const base = require("@playwright/test");
const path = require("path");

const FIXTURES = path.join(__dirname, "fixtures");

const test = base.test.extend({
  page: async ({ page }, use) => {
    const problems = [];
    page.on("pageerror", (e) => problems.push("page error: " + e.message));
    page.on("console", (m) => {
      if (m.type() === "error") problems.push("console error: " + m.text());
    });
    page.on("dialog", (d) => {
      problems.push(`native ${d.type()}(): ${d.message()}`);
      d.dismiss().catch(() => {});
    });
    await use(page);
    base.expect(problems, "page errors, console errors or native dialogs").toEqual([]);
  },
});
const expect = base.expect;

// noFieldSizing simulates browsers without CSS `field-sizing` so the
// JavaScript textarea-sizing fallback is exercised.
async function openApp(page, opts = {}) {
  if (opts.noFieldSizing) {
    await page.addInitScript(() => {
      const supports = CSS.supports.bind(CSS);
      CSS.supports = (a, v) => (a === "field-sizing" ? false : supports(a, v));
    });
  }
  await page.goto("/");
}

async function openSubtitle(page, fileName, expectedCount) {
  const file = path.isAbsolute(fileName) ? fileName : path.join(FIXTURES, fileName);
  await page.setInputFiles("#input-srt", file);
  if (expectedCount !== undefined) await expect(page.locator(".cue-row")).toHaveCount(expectedCount, { timeout: 20_000 });
}

async function loadSample(page) {
  await page.click("#btn-sample");
  await expect(page.locator(".cue-row")).toHaveCount(8);
}

const rows = (page) => page.locator(".cue-row");
const row = (page, i) => page.locator(".cue-row").nth(i);

// text of every cue currently shown in the list
const cueTexts = (page) =>
  page.locator(".cue-row").evaluateAll((els) => els.filter((r) => !r.hidden).map((r) => r.querySelector(".cue-text").value));

const cueTimes = (page) =>
  page
    .locator(".cue-row")
    .evaluateAll((els) => els.map((r) => r.querySelector('[data-field="start"]').value + " > " + r.querySelector('[data-field="end"]').value));

// "[n]" = primary selection, "(n)" = also selected (1-based)
const selection = (page) =>
  page
    .locator(".cue-row")
    .evaluateAll((els) =>
      els.map((r, i) => (r.classList.contains("primary") ? `[${i + 1}]` : r.classList.contains("selected") ? `(${i + 1})` : "")).join("")
    );

const lastToast = (page) => page.locator(".toast-text").last();

// waits for the next rendered frame
const nextFrame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))));

// a generated file with `count` two-line cues, 2.5s apart
function bigSrt(count) {
  const tc = (ms) => {
    const p = (n, l = 2) => String(n).padStart(l, "0");
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  const out = [];
  for (let i = 0; i < count; i++) {
    const s = i * 2500 + 500;
    out.push(`${i + 1}\n${tc(s)} --> ${tc(s + 2000)}\nLine number ${i} of a fairly typical subtitle\nwith a second line here.\n`);
  }
  return out.join("\n");
}

module.exports = {
  test, expect, FIXTURES, openApp, openSubtitle, loadSample,
  rows, row, cueTexts, cueTimes, selection, lastToast, nextFrame, bigSrt,
};
