const { test, expect, openApp, loadSample, row } = require("./helpers");

test("uses the bundled fonts and makes no requests to other sites", async ({ page }) => {
  const external = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://localhost")) external.push(r.url());
  });
  await openApp(page);
  await loadSample(page);
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() =>
    [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, ""))
  );
  expect(loaded).toContain("Space Grotesk");
  expect(loaded).toContain("JetBrains Mono");
  expect(external).toEqual([]);
});

test("hides the video pane until a video is loaded", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("#app")).toHaveClass(/no-video/);
  await expect(page.locator(".video-pane")).toBeHidden();
});

for (const noFieldSizing of [false, true]) {
  test(`long lines wrap instead of being clipped${noFieldSizing ? " (JavaScript sizing fallback)" : ""}`, async ({ page }) => {
    await openApp(page, { noFieldSizing });
    await loadSample(page);
    // narrow the list so even short lines wrap
    await page.setViewportSize({ width: 700, height: 800 });
    await expect
      .poll(() => page.locator(".cue-text").evaluateAll((els) => els.slice(0, 6).map((t) => t.scrollHeight - t.clientHeight)))
      .toEqual([0, 0, 0, 0, 0, 0]);
  });
}

test("with no video, each cue is laid out as a single row", async ({ page }) => {
  await openApp(page);
  await loadSample(page);
  const times = await row(page, 0).locator(".cue-times").boundingBox();
  const text = await row(page, 0).locator(".cue-text").boundingBox();
  expect(text.x).toBeGreaterThan(times.x + times.width);
  expect(Math.abs(text.y + text.height / 2 - (times.y + times.height / 2))).toBeLessThan(20);
});

test("rows stay visible and clickable after the list narrows", async ({ page }) => {
  await openApp(page);
  await loadSample(page);
  // the same layout change as opening a video, without one
  await page.evaluate(() => document.getElementById("app").classList.remove("no-video"));
  await row(page, 2).locator(".cue-index").click();
  await expect(row(page, 2)).toHaveClass(/primary/);
});

test("the editor panel is off by default and remembers being turned on", async ({ page }) => {
  await openApp(page);
  await loadSample(page);
  await expect(page.locator("#cue-editor")).toBeHidden();
  await page.click("#btn-toggle-editor");
  await expect(page.locator("#cue-editor")).toBeVisible();
  await page.reload();
  await expect(page.locator("#cue-editor")).toBeVisible();
});
