const { test, expect, openApp, loadSample, row, cueTimes } = require("./helpers");

// one worker runs these in order, so the clip below is recorded only once
test.describe.configure({ mode: "default" });

// A short silent test clip, recorded once with Playwright's screen recorder.
let clip;
test.beforeAll(async ({ browser }, testInfo) => {
  const ctx = await browser.newContext({
    viewport: { width: 320, height: 180 },
    recordVideo: { dir: testInfo.outputPath("clip"), size: { width: 320, height: 180 } },
  });
  const page = await ctx.newPage();
  await page.setContent(
    '<body style="margin:0;background:#246"><h1 id="t" style="color:#fff;font:40px sans-serif;margin:60px">0</h1>' +
      "<script>let n = 0; setInterval(() => (t.textContent = ++n), 100)</script></body>"
  );
  await page.waitForTimeout(11_000);
  await ctx.close();
  clip = await page.video().path();
});

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await loadSample(page);
  await page.setInputFiles("#input-video", clip);
  await expect(page.locator("#app")).not.toHaveClass(/no-video/);
  await expect(page.locator("#time-duration")).not.toHaveText("00:00:00,000");
});

test("clicking a cue seeks the video to it", async ({ page }) => {
  await row(page, 2).locator(".cue-index").click();
  await expect(page.locator("#time-current")).toHaveText("00:00:06,600");
});

test("Ctrl+Space plays and pauses while typing, keeping the caret in place", async ({ page }) => {
  await row(page, 2).locator(".cue-text").click();
  await page.keyboard.press("Control+Space");
  await expect.poll(() => page.evaluate(() => !document.getElementById("video").paused)).toBe(true);
  expect(await page.evaluate(() => document.activeElement.tagName)).toBe("TEXTAREA");
  await page.keyboard.press("Control+Space");
  await expect.poll(() => page.evaluate(() => document.getElementById("video").paused)).toBe(true);
});

test("Split cuts the selected cue at the playhead", async ({ page }) => {
  await row(page, 2).locator(".cue-index").click();
  await page.evaluate(() => (document.getElementById("video").currentTime = 7.5));
  await expect(page.locator("#time-current")).toHaveText("00:00:07,500");
  await page.click("#btn-split");
  expect((await cueTimes(page)).slice(2, 4)).toEqual(["00:00:06,600 > 00:00:07,500", "00:00:07,500 > 00:00:09,000"]);
});
