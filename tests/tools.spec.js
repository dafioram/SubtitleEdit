const { test, expect, openApp, openSubtitle, loadSample, row, cueTexts, lastToast } = require("./helpers");

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

const openTool = async (page, tool) => {
  await page.click("#btn-tools");
  await page.click(`[data-tool="${tool}"]`);
};

test("the sample has no questionable text (no false alarms)", async ({ page }) => {
  await loadSample(page);
  await expect(page.locator("#warning-summary")).not.toContainText("questionable");
});

test("flags questionable text in the list and in the report", async ({ page }) => {
  await openSubtitle(page, "questionable.srt", 5);
  await expect(page.locator("#warning-summary")).toHaveText("4 questionable");
  const titles = await page.locator(".q-dot").evaluateAll((els) => els.map((d) => (d.hidden ? "" : d.title)));
  expect(titles).toEqual([
    "Questionable: Unusual character “|”; Double space",
    "Questionable: Lone “l” — should it be “I”?; Repeated word “the”; Space before punctuation",
    "Questionable: Unbalanced quote; Unusual character “/”",
    "",
    "Questionable: Digit “0” inside a word; Unusual character “_”",
  ]);

  await openTool(page, "questionable");
  await expect(page.locator("#q-summary")).toHaveText("4 cues flagged (9 findings). Click one to jump to it.");
  await expect(page.locator("#q-results li")).toHaveCount(4);

  // the character list is editable
  await page.fill("#q-chars", "/|");
  await expect(page.locator("#q-summary")).toContainText("4 cues flagged (8 findings)");

  await page.click("#q-show");
  await expect(page.locator("#cue-count")).toHaveText("4 / 5");
  expect(await cueTexts(page)).not.toContain("<i>This is fine</i>");
});

test("Fix common errors previews, applies and can be undone", async ({ page }) => {
  await openSubtitle(page, "questionable.srt", 5);
  await openTool(page, "fix");
  const counts = await page.locator(".fix-row").evaluateAll((rs) => rs.map((r) => r.textContent.replace(/\s+/g, " ").trim()));
  expect(counts).toContain("Collapse double spaces 1 cue");
  expect(counts).toContain("Replace “|” with “I” (common OCR error) 1 cue");
  expect(counts).toContain("Delete cues that have no text none");

  await page.click("#fix-apply");
  await expect(lastToast(page)).toHaveText("Fixed 2 cues.");
  expect((await cueTexts(page)).slice(0, 2)).toEqual(["It's a test with double space", "l think the the answer is 42."]);

  await page.locator(".toast-action").last().click();
  await expect.poll(async () => (await cueTexts(page))[0]).toBe("|t's a test  with double space");
});

test("find & replace: whole word, replace one, regex replace all", async ({ page }) => {
  await openSubtitle(page, "questionable.srt", 5);
  await page.keyboard.press("Control+f");
  await expect(page.locator("#find-bar")).toBeVisible();
  await page.keyboard.type("the");
  await expect(page.locator("#find-count")).toHaveText("1 of 2");
  await expect(row(page, 1)).toHaveClass(/primary/); // jumped to the first match

  await page.check("#find-word");
  await expect(page.locator("#find-count")).toHaveText("1 of 2");
  await page.fill("#replace-text", "THE");
  await page.click("#replace-one");
  expect((await cueTexts(page))[1]).toBe("l think THE the answer is 42 .");
  await expect(page.locator("#find-count")).toHaveText("2 of 2");

  await page.uncheck("#find-word");
  await page.check("#find-regex");
  await page.fill("#find-text", "\\b(\\w+)\\s+\\1\\b");
  await page.fill("#replace-text", "$1");
  await page.click("#replace-all");
  await expect(lastToast(page)).toHaveText("Replaced 1 match in 1 cue.");
  expect((await cueTexts(page))[1]).toBe("l think THE answer is 42 .");

  await page.keyboard.press("Escape");
  await expect(page.locator("#find-bar")).toBeHidden();
});

test("find can show only the matching cues", async ({ page }) => {
  await loadSample(page);
  await page.click("#btn-find");
  await page.keyboard.type("timeline");
  await expect(page.locator("#find-count")).toHaveText("1 of 1");
  await page.check("#find-only");
  await expect(page.locator("#cue-count")).toHaveText("1 / 8");
  await expect(page.locator(".cue-row:not([hidden])")).toHaveCount(1);
  await page.click("#find-close");
  await expect(page.locator(".cue-row:not([hidden])")).toHaveCount(8);
});
