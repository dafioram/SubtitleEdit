const fs = require("fs");
const { test, expect, openApp, openSubtitle, cueTexts, cueTimes, lastToast } = require("./helpers");

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

async function download(page, trigger) {
  const [file] = await Promise.all([page.waitForEvent("download"), trigger()]);
  return { name: file.suggestedFilename(), text: fs.readFileSync(await file.path(), "utf8") };
}

test("opens .ass files, keeping italics and commas inside the text", async ({ page }) => {
  await openSubtitle(page, "styled.ass", 2);
  expect(await cueTexts(page)).toEqual(["<i>Hello,</i> world\nsecond line", "Comma, inside, text"]);
  expect(await cueTimes(page)).toEqual(["00:00:01,500 > 00:00:04,000", "00:00:05,000 > 00:00:07,250"]);
  await expect(page.locator("#status-file")).toHaveText("styled.ass (ASS)");
});

test("opens .vtt files, skipping notes and decoding entities", async ({ page }) => {
  await openSubtitle(page, "basic.vtt", 2);
  expect(await cueTexts(page)).toEqual(["Hi & bye", "Second"]);
  expect(await cueTimes(page)).toEqual(["00:00:01,000 > 00:00:03,500", "00:00:04,000 > 00:00:06,000"]);
});

test("detects a Windows-1252 file and can re-read it with another encoding", async ({ page }) => {
  await openSubtitle(page, "latin1.srt", 2);
  expect(await cueTexts(page)).toEqual(["Café crème", "naïve"]);
  await expect(lastToast(page)).toContainText("Windows-1252");
  await expect(page.locator('#encoding-select option[value="auto"]')).toHaveText("Auto (Western (Windows-1252))");

  await page.selectOption("#encoding-select", "windows-1251");
  await expect.poll(() => cueTexts(page)).toEqual(["Cafй crиme", "naпve"]);

  await page.locator(".toast-action").last().click(); // Undo
  await expect.poll(() => cueTexts(page)).toEqual(["Café crème", "naïve"]);
});

test("exports .ass, .vtt and .srt", async ({ page }) => {
  await openSubtitle(page, "latin1.srt", 2);
  const exportAs = (format) =>
    download(page, async () => {
      await page.click("#btn-export");
      await page.click(`[data-format="${format}"]`);
    });

  const ass = await exportAs("ass");
  expect(ass.name).toBe("latin1.ass");
  expect(ass.text).toContain("[Events]");
  expect(ass.text).toContain("Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Café crème");

  const vtt = await exportAs("vtt");
  expect(vtt.text.startsWith("WEBVTT")).toBe(true);
  expect(vtt.text).toContain("00:00:03.000 --> 00:00:04.000\nnaïve");

  const srt = await exportAs("srt");
  expect(srt.text).toBe("1\n00:00:01,000 --> 00:00:02,000\nCafé crème\n\n2\n00:00:03,000 --> 00:00:04,000\nnaïve\n");
});

test("Ctrl+S exports in the format the file was opened in", async ({ page }) => {
  await openSubtitle(page, "styled.ass", 2);
  const file = await download(page, () => page.keyboard.press("Control+s"));
  expect(file.name).toBe("styled.ass");
  expect(file.text).toContain("{\\i1}Hello,{\\i0} world\\Nsecond line");
});

test("opens a subtitle file dropped on the window", async ({ page }) => {
  const dt = await page.evaluateHandle(() => {
    const t = new DataTransfer();
    t.items.add(new File(["1\n00:00:01,000 --> 00:00:02,000\nDropped in\n"], "drop.srt", { type: "text/plain" }));
    return t;
  });
  await page.dispatchEvent("body", "drop", { dataTransfer: dt });
  await expect(page.locator(".cue-row")).toHaveCount(1);
  expect(await cueTexts(page)).toEqual(["Dropped in"]);
});

test("shows an in-page error for a file with no subtitles", async ({ page }) => {
  await page.setInputFiles("#input-srt", { name: "empty.srt", mimeType: "text/plain", buffer: Buffer.from("not a subtitle file") });
  await expect(lastToast(page)).toContainText("No subtitles found in empty.srt");
});
