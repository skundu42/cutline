import { expect, test } from "@playwright/test";

test("golden judge loop", async ({ page }) => {
  await page.goto("/?debug=1");
  await expect(page.getByText("Cutline")).toBeVisible();
  await expect(page.getByText("A-roll take 1")).toBeVisible();

  await page.getByTestId("replay-golden").click();
  await expect(page.getByTestId("branch-Branch A")).toBeVisible();
  await expect(page.getByText(/Applied \d+ of/)).toBeVisible();

  await page.getByTestId("comment-input").fill("Keep this pause; it sells the point");
  await page.getByTestId("pin-comment").click();
  await expect(page.getByText("Keep this pause; it sells the point")).toBeVisible();

  await page.getByTestId("lock-range").click();
  await expect(page.getByText("Keep pause")).toBeVisible();

  await page.getByTestId("replay-revision").click();
  await expect(page.getByTestId("branch-Branch B")).toBeVisible();
  await expect(page.getByText(/LOCKED_RANGE|Skipped/)).toBeVisible();

  await page.getByTestId("accept-branch").click();
  await expect(page.getByTestId("branch-Branch B")).toContainText("final");

  await page.getByTestId("export-button").click();
  await expect(page.getByText("Only you can export")).toBeVisible();
  await expect(page.getByTestId("download-export")).toBeVisible();

  const catalog = await page.getByTestId("tool-catalog").innerText();
  expect(catalog).toContain("apply_edit_batch");
  expect(catalog).toContain("import_media");
  expect(catalog).toContain("place_audio");
  expect(catalog).toContain("set_transition");
  expect(catalog).not.toContain("export,");
  expect(catalog.includes(" accept_branch")).toBeFalsy();
});

test("reset restores source", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("replay-golden").click();
  await expect(page.getByTestId("branch-Branch A")).toBeVisible();
  await page.getByTestId("reset-demo").click();
  await expect(page.getByTestId("branch-Source")).toBeVisible();
});

test("upload media and add sound on A2", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("A-roll take 1")).toBeVisible();
  await page.getByTestId("upload-media").setInputFiles("public/demo/cache_diagram.svg");
  await expect(page.getByText("cache_diagram").first()).toBeVisible();
  await page.getByRole("button", { name: "Add sound" }).first().click();
  await expect(page.getByText(/Placed .* on A2/)).toBeVisible();
  await page.getByRole("button", { name: "Add clip" }).first().click();
  await expect(page.getByText(/Placed .* on V2/)).toBeVisible();
});
