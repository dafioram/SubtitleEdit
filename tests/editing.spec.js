const { test, expect, openApp, loadSample, row, cueTexts, cueTimes, selection, lastToast, nextFrame } = require("./helpers");

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await loadSample(page);
});

const focused = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    const r = a.closest && a.closest(".cue-row");
    return a.tagName + (a.id ? "#" + a.id : "") + (r ? " row" + ([...r.parentNode.children].indexOf(r) + 1) : "");
  });

test("Space after clicking a toolbar button plays instead of clicking it again", async ({ page }) => {
  expect(await focused(page)).toBe("BODY");
  await page.keyboard.press("Space");
  await expect(lastToast(page)).toHaveText("Open a video to play it.");
});

test("the timeline scrolls with the mouse wheel without a video", async ({ page }) => {
  const canvas = page.locator("#timeline-canvas");
  const before = await canvas.screenshot();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 300, box.y + 60);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 200);
  await nextFrame(page);
  expect((await canvas.screenshot()).equals(before)).toBe(false);
});

test("arrow keys, Shift-click and Ctrl-click select cues; merge needs neighbours", async ({ page }) => {
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  expect(await selection(page)).toBe("[2]");
  await row(page, 3).locator(".cue-duration").click({ modifiers: ["Shift"] });
  expect(await selection(page)).toBe("(2)(3)[4]");
  await row(page, 5).locator(".cue-index").click({ modifiers: ["Control"] });
  expect(await selection(page)).toBe("(2)(3)(4)[6]");

  await page.click("#btn-merge");
  await expect(lastToast(page)).toContainText("Only neighbouring cues can be merged");

  await row(page, 5).locator(".cue-index").click({ modifiers: ["Control"] });
  await page.click("#btn-merge");
  await expect(page.locator(".cue-row")).toHaveCount(6);
  expect((await cueTexts(page))[1].split("\n")).toHaveLength(6);

  await page.keyboard.press("Control+z");
  await expect(page.locator(".cue-row")).toHaveCount(8);
});

test("Backspace never deletes a cue; Delete does and can be undone", async ({ page }) => {
  await row(page, 0).locator(".cue-index").click();
  await page.keyboard.press("Backspace");
  await expect(page.locator(".cue-row")).toHaveCount(8);
  await page.keyboard.press("Delete");
  await expect(page.locator(".cue-row")).toHaveCount(7);
  await expect(lastToast(page)).toHaveText("Deleted 1 cue.");
  expect(await selection(page)).toBe("[1]"); // the next cue is selected
  await page.locator(".toast-action").last().click();
  await expect(page.locator(".cue-row")).toHaveCount(8);
});

test("shortcuts work while typing in a cue", async ({ page }) => {
  await row(page, 1).locator(".cue-index").click();
  await page.keyboard.press("Enter");
  await expect.poll(() => focused(page)).toBe("TEXTAREA row2");

  await page.keyboard.type(" EXTRA");
  expect((await cueTexts(page))[1].endsWith(" EXTRA")).toBe(true);

  // app undo, without kicking the caret out of the text box
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await cueTexts(page))[1]).toBe("Open a video file and an .srt file\nto get started.");
  expect(await focused(page)).toBe("TEXTAREA row2");

  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(() => focused(page)).toBe("TEXTAREA row3");
  expect(await selection(page)).toBe("[3]");

  // Ctrl+Enter adds a cue right after the selected one and puts the caret in it
  await page.keyboard.press("Control+Enter");
  await expect(page.locator(".cue-row")).toHaveCount(9);
  await expect.poll(() => focused(page)).toBe("TEXTAREA row4");
  expect((await cueTimes(page))[3]).toBe("00:00:09,000 > 00:00:09,300");
});

test("Split without a video divides the time by text length", async ({ page }) => {
  await row(page, 0).locator(".cue-index").click();
  await page.click("#btn-split");
  await expect(page.locator(".cue-row")).toHaveCount(9);
  expect((await cueTexts(page)).slice(0, 2)).toEqual(["Welcome to Caption, a subtitle editor", "that runs entirely in your browser."]);
  expect((await cueTimes(page)).slice(0, 2)).toEqual(["00:00:00,500 > 00:00:01,887", "00:00:01,887 > 00:00:03,200"]);
});

test("the editor panel edits the selected cue", async ({ page }) => {
  await page.click("#btn-toggle-editor");
  await row(page, 0).locator(".cue-index").click();
  await expect(page.locator("#editor-label")).toHaveText("#1");
  await page.fill("#editor-duration", "1.25");
  await expect(row(page, 0).locator('[data-field="end"]')).toHaveValue("00:00:01,750");
  await page.fill("#editor-text", "Changed in the editor");
  expect((await cueTexts(page))[0]).toBe("Changed in the editor");
});

test("New asks for confirmation in the page, and Escape cancels", async ({ page }) => {
  await page.click("#btn-new");
  await expect(page.locator("#modal-confirm")).toBeVisible();
  await expect(page.locator("#confirm-title")).toHaveText("Start a new project?");
  await page.keyboard.press("Escape");
  await expect(page.locator("#modal-confirm")).toBeHidden();
  await expect(page.locator(".cue-row")).toHaveCount(8);

  await page.click("#btn-new");
  await page.click("#confirm-ok");
  await expect(page.locator(".cue-row")).toHaveCount(0);
});

test("edits survive a page reload", async ({ page }) => {
  await row(page, 0).locator(".cue-text").fill("Saved locally");
  await expect(page.locator("#status-autosave")).toContainText("Saved");
  await page.reload();
  await expect(page.locator(".cue-row")).toHaveCount(8);
  expect((await cueTexts(page))[0]).toBe("Saved locally");
});
