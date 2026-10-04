// Guards against the slowdowns fixed in the "fast on long files" change.
// Limits are deliberately generous so slower CI machines pass; before the
// fix a keystroke took ~200ms with 2,000 cues, so a regression still fails.
const fs = require("fs");
const { test, expect, openApp, openSubtitle, row, bigSrt } = require("./helpers");

const COUNT = 2000;

test.describe("a 2,000-cue file", () => {
  let file;
  test.beforeAll(async ({}, testInfo) => {
    file = testInfo.outputPath("big.srt");
    fs.writeFileSync(file, bigSrt(COUNT));
  });

  test("opens in a few seconds", async ({ page }) => {
    await openApp(page);
    const t0 = Date.now();
    await openSubtitle(page, file, COUNT);
    expect(Date.now() - t0).toBeLessThan(8000);
  });

  test("handles each keystroke quickly", async ({ page }) => {
    await openApp(page);
    await openSubtitle(page, file, COUNT);
    await row(page, 5).locator(".cue-text").click();
    const median = await page.evaluate(() => {
      const ta = document.activeElement;
      const times = [];
      for (let i = 0; i < 21; i++) {
        const t0 = performance.now();
        ta.value += "x";
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        times.push(performance.now() - t0);
      }
      return times.sort((a, b) => a - b)[10];
    });
    expect(median).toBeLessThan(25);
    // the list-wide pass still runs once typing pauses
    await expect(row(page, 5).locator(".cue-text")).toHaveValue(/x{21}$/);
  });

  test("sizes rows correctly when scrolled to, with the JavaScript sizing fallback", async ({ page }) => {
    await openApp(page, { noFieldSizing: true });
    await openSubtitle(page, file, COUNT);
    await page.evaluate(() => document.querySelectorAll(".cue-row")[1000].scrollIntoView({ block: "center" }));
    await expect
      .poll(() =>
        page.locator(".cue-row").evaluateAll((els) =>
          els.slice(995, 1005).map((r) => {
            const t = r.querySelector(".cue-text");
            return t.scrollHeight - t.clientHeight;
          })
        )
      )
      .toEqual(new Array(10).fill(0));
  });
});
