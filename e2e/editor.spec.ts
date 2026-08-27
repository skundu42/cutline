import { expect, test } from "@playwright/test";
import { stat } from "node:fs/promises";

test("starts as a content-agnostic local workspace", async ({ page }) => {
  await page.goto("/?debug=1");

  await expect(page.getByText("Cutline", { exact: true })).toBeVisible();
  await expect(page.getByText("Make your first cut")).toBeVisible();
  await expect(page.getByTestId("viewer-upload-media")).toBeAttached();
  await expect(page.getByLabel("Project name")).toHaveValue("Untitled cut");
  await expect(page.getByText("Your files stay in this browser")).toBeVisible();
  await expect(page.getByTestId("export-button")).toBeDisabled();

  const catalog = await page.getByTestId("tool-catalog").innerText();
  expect(catalog).toContain("apply_edit_batch");
  expect(catalog).toContain("place_clip");
  expect(catalog).not.toContain("export,");
  expect(catalog.includes(" accept_branch")).toBeFalsy();

  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(page.getByText("Local workspace")).toBeVisible();
  await expect(page.getByText("OPFS", { exact: true })).toBeVisible();
});

test("uploads, edits, and persists local media", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("upload-media").setInputFiles("public/demo/brand_sting.mp4");

  await expect(page.getByText("brand_sting").first()).toBeVisible();
  await expect(page.getByLabel("Project name")).toHaveValue("brand_sting");
  await page.getByRole("button", { name: "Add to timeline" }).click();
  await expect(page.getByRole("button", { name: "brand_sting, 00:00.000 to 00:02.000" })).toHaveCount(2);
  await expect(page.getByTestId("export-button")).toBeEnabled();

  await page.getByRole("button", { name: "9:16" }).click();
  await expect(page.getByRole("button", { name: "9:16" })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.getByRole("button", { name: "brand_sting, 00:00.000 to 00:02.000" }).first()).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByText("Project", { exact: true }).click();
  await page.getByTestId("new-project").click();
  await expect(page.getByLabel("Project name")).toHaveValue("Untitled cut");
  await expect(page.getByText("Make your first cut")).toBeVisible();
});

test("renders the current timeline to a local downloadable video", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("upload-media").setInputFiles("public/demo/brand_sting.mp4");
  await page.getByRole("button", { name: "Add to timeline" }).click();

  await page.getByTestId("export-button").click();
  await expect(page.getByText("Rendered entirely on this device")).toBeVisible();
  await page.getByTestId("render-export").click();
  await expect(page.getByText("Render complete")).toBeVisible({ timeout: 20_000 });

  const download = page.getByTestId("download-export");
  await expect(download).toBeVisible();
  await expect(download).toHaveAttribute("download", /\.webm$/);
  await expect(download).toHaveAttribute("href", /^blob:/);
  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    download.click(),
  ]);
  expect(saved.suggestedFilename()).toMatch(/\.webm$/);
  const savedPath = await saved.path();
  expect(savedPath).not.toBeNull();
  expect((await stat(savedPath!)).size).toBeGreaterThan(1000);
});

test("collapses review and exposes focused mobile workspace modes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Collapse review panel" }).click();
  await expect(page.getByRole("button", { name: "Expand review panel" })).toBeVisible();

  await page.setViewportSize({ width: 700, height: 760 });
  await expect(page.getByRole("navigation", { name: "Workspace view" })).toBeVisible();
  await page.getByRole("button", { name: "media", exact: true }).click();
  await expect(page.getByText("Choose local files")).toBeVisible();
  await page.getByRole("button", { name: "timeline", exact: true }).click();
  await expect(page.getByLabel("Timeline editor")).toBeVisible();
});

test("attaches and collapses a local transcript", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Transcript/ })).toHaveAttribute("aria-expanded", "false");
  await page.getByTestId("upload-transcript").setInputFiles({
    name: "sample.srt",
    mimeType: "application/x-subrip",
    buffer: Buffer.from("1\n00:00:00,000 --> 00:00:01,500\nLocal captions stay here"),
  });
  await expect(page.getByText("Local captions stay here")).toBeVisible();
  await expect(page.getByRole("button", { name: /Transcript/ })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: /Transcript/ }).click();
  await expect(page.getByText("Local captions stay here")).toBeHidden();
});
