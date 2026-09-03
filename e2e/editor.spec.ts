import { expect, test, type Page } from "@playwright/test";
import { stat } from "node:fs/promises";

async function inspectWorkspace(page: Page) {
  return page.evaluate(async () => {
    const tools = (window as typeof window & { __cutlineTools: Record<string, { execute: (input: unknown) => Promise<unknown> }> }).__cutlineTools;
    const status = await tools.project_status.execute({}) as { projectId: string };
    return await tools.inspect_project.execute({ projectId: status.projectId }) as {
      project: { id: string; activeBranchId: string; durationMs: number; stateDigest: string };
      branches: { branchId: string; name: string; branchVersion: number; status: string }[];
      tracks: { trackId: string; itemCount: number }[];
      locks: { lockId: string }[];
    };
  });
}

async function openLocalFixture(page: Page, add = true) {
  await installWebMcpHost(page);
  await page.goto("/");
  await page.getByTestId("upload-media").setInputFiles("public/demo/brand_sting.mp4");
  await expect(page.getByRole("button", { name: "Add to timeline", includeHidden: true })).toBeAttached();
  if (add) await page.getByRole("button", { name: "Add to timeline" }).click();
}

async function installWebMcpHost(page: Page) {
  await page.addInitScript(() => {
    const registry: Record<string, { execute: (input: unknown) => Promise<unknown> }> = {};
    Object.defineProperty(window, "__cutlineTools", { value: registry, configurable: true });
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool: async (tool: { name: string; execute: (input: unknown) => Promise<unknown> }, options?: { signal?: AbortSignal }) => {
          registry[tool.name] = tool;
          options?.signal?.addEventListener("abort", () => { delete registry[tool.name]; }, { once: true });
        },
      },
    });
  });
}

test("starts as a content-agnostic local workspace", async ({ page }) => {
  await page.goto("/?debug=1");

  await expect(page.getByText("Cutline", { exact: true })).toBeVisible();
  await expect(page.getByText("Make your first cut")).toBeVisible();
  await expect(page.getByTestId("viewer-upload-media")).toBeAttached();
  await expect(page.getByRole("button", { name: /sample/i })).toHaveCount(0);
  await expect(page.getByLabel("Project name")).toHaveValue("Untitled cut");
  await expect(page.getByText("Your files stay in this browser")).toHaveCount(0);
  await expect(page.getByTestId("export-button")).toBeDisabled();

  const catalog = await page.getByTestId("tool-catalog").innerText();
  expect(catalog).toContain("apply_edit_batch");
  expect(catalog).toContain("place_clip");
  expect(catalog).toContain("export");
  expect(catalog).toContain("accept_branch");
  expect(catalog).toContain("lock_range");
  expect(catalog).toContain("delete_project");

  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(page.getByText("Local workspace")).toBeVisible();
  await expect(page.getByText("OPFS", { exact: true })).toBeVisible();
});

test("uploads, edits, and persists local media", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("upload-media").setInputFiles("public/demo/brand_sting.mp4");

  await expect(page.locator(".asset-card").getByText("brand_sting", { exact: true })).toBeVisible();
  await expect(page.getByText("Recent imports")).toHaveCount(0);
  await expect(page.getByLabel("Project name")).toHaveValue("brand_sting");
  await page.getByRole("button", { name: "Add to timeline" }).click();
  await expect(page.getByRole("button", { name: "brand_sting, 00:00.000 to 00:02.000" })).toHaveCount(2);
  await expect(page.getByTestId("export-button")).toBeEnabled();

  await page.getByRole("button", { name: "9:16" }).click();
  await expect(page.getByRole("button", { name: "9:16" })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.getByRole("button", { name: "brand_sting, 00:00.000 to 00:02.000" }).first()).toBeVisible();

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
  const mediaPanel = page.locator(".asset-panel");
  const mediaBefore = await mediaPanel.boundingBox();
  const mediaResizer = await page.locator(".pane-resizer.is-media").boundingBox();
  expect(mediaBefore).not.toBeNull();
  expect(mediaResizer).not.toBeNull();
  await page.mouse.move(mediaResizer!.x + mediaResizer!.width / 2, mediaResizer!.y + 80);
  await page.mouse.down();
  await page.mouse.move(mediaResizer!.x + 48, mediaResizer!.y + 80);
  await page.mouse.up();
  await expect.poll(async () => (await mediaPanel.boundingBox())?.width ?? 0).toBeGreaterThan(mediaBefore!.width + 30);
  const resizedWidth = (await mediaPanel.boundingBox())!.width;
  await page.reload();
  await expect.poll(async () => (await mediaPanel.boundingBox())?.width ?? 0).toBeGreaterThan(resizedWidth - 2);

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

test("an agent can plan, branch, edit, verify, compare, and accept a cut", async ({ page }) => {
  await openLocalFixture(page);
  await expect(page.getByText("WebMCP ready")).toBeVisible();

  const result = await page.evaluate(async () => {
    const tools = (window as typeof window & { __cutlineTools: Record<string, { execute: (input: unknown) => Promise<unknown> }> }).__cutlineTools;
    const status = await tools.project_status.execute({}) as { projectId: string };
    const inspected = await tools.inspect_project.execute({ projectId: status.projectId }) as { project: { activeBranchId: string } };
    const timeline = await tools.get_timeline.execute({ projectId: status.projectId, branchId: inspected.project.activeBranchId }) as { branchVersion: number; tracks: { trackId: string; items: { itemId: string }[] }[] };
    const itemId = timeline.tracks.find((track) => track.trackId === "v1")!.items[0].itemId;
    const created = await tools.create_cut_branch.execute({ projectId: status.projectId, baseBranchId: inspected.project.activeBranchId, expectedBaseVersion: timeline.branchVersion, name: "Browser agent cut" }) as { branchId: string };
    const operations = [{ op: "ripple_delete", range: { startMs: 1500, endMs: 2000 } }];
    const plan = await tools.plan_edit.execute({ projectId: status.projectId, branchId: created.branchId, expectedBranchVersion: 0, rationale: "Shorten the tail", operations }) as { committed: boolean; projectedStateDigest: string };
    const applied = await tools.apply_edit_batch.execute({ projectId: status.projectId, branchId: created.branchId, expectedBranchVersion: 0, rationale: "Shorten the tail", operations }) as { stateDigest: string; branchVersion: number };
    const preview = await tools.preview_range.execute({ projectId: status.projectId, branchId: created.branchId, stateDigest: applied.stateDigest, startMs: 1000, endMs: 1500 });
    const locked = await tools.lock_range.execute({ projectId: status.projectId, branchId: created.branchId, expectedBranchVersion: 1, range: { startMs: 100, endMs: 200 }, label: "Approved opening" }) as { branchVersion: number };
    const lockedPlan = await tools.plan_edit.execute({ projectId: status.projectId, branchId: created.branchId, expectedBranchVersion: locked.branchVersion, operations: [{ op: "split", itemId, atMs: 150 }] });
    const compared = await tools.compare_cuts.execute({ projectId: status.projectId, leftBranchId: inspected.project.activeBranchId, rightBranchId: created.branchId });
    const accepted = await tools.accept_branch.execute({ projectId: status.projectId, branchId: created.branchId, expectedBranchVersion: locked.branchVersion });
    return { plan, applied, preview, lockedPlan, compared, accepted, branchId: created.branchId };
  });

  expect(result.plan).toMatchObject({ committed: false });
  expect(result.applied).toMatchObject({ branchVersion: 1 });
  expect(result.preview).toMatchObject({ mode: "shared_viewer", startMs: 1000, endMs: 1500 });
  expect(result.lockedPlan).toMatchObject({ error: { code: "LOCKED_RANGE" } });
  expect(result.compared).toHaveProperty("delta.durationDeltaMs", -500);
  expect(result.accepted).toMatchObject({ selectedFinalBranchId: result.branchId });
  await expect(page.getByTestId("branch-Browser agent cut")).toBeVisible();
});

test("project bundles round-trip media and the local project library", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("upload-media").setInputFiles("public/demo/brand_sting.mp4");
  await page.getByRole("button", { name: "Add to timeline" }).click();
  await page.getByText("Project", { exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export project bundle" }).click(),
  ]);
  const bundlePath = await download.path();
  expect(bundlePath).not.toBeNull();

  await page.getByTestId("new-project").click();
  await expect(page.getByLabel("Project name")).toHaveValue("Untitled cut");
  await expect(page.locator(".project-switcher").getByRole("button", { name: /brand_sting/ })).toBeVisible();
  await page.getByTestId("import-project").setInputFiles(bundlePath!);
  await expect(page.getByLabel("Project name")).toHaveValue("brand_sting (imported)");
  await expect(page.getByRole("button", { name: "brand_sting, 00:00.000 to 00:02.000" }).first()).toBeVisible();
});

test("keyboard and toolbar split linked picture and audio identically", async ({ page }) => {
  await openLocalFixture(page);
  const selectMidpoint = async () => {
    await page.locator(".timeline-clip").first().click();
    await page.locator(".timeline-clip").first().focus();
    for (let frame = 0; frame < 30; frame += 1) await page.keyboard.press("ArrowRight");
  };
  await selectMidpoint();
  await page.keyboard.press("s");
  await expect(page.locator(".timeline-clip")).toHaveCount(4);
  const keyboard = await page.locator(".timeline-clip").evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label")));
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".timeline-clip")).toHaveCount(2);
  await selectMidpoint();
  await page.getByTestId("split-selected").click();
  await expect(page.locator(".timeline-clip")).toHaveCount(4);
  expect(await page.locator(".timeline-clip").evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label")))).toEqual(keyboard);
});

test("manually creates a version without a comparison control", async ({ page }) => {
  await openLocalFixture(page);
  await page.locator(".version-menu > summary").click();
  await page.getByLabel("Version name").fill("Manual cut");
  await page.getByRole("button", { name: "Create version", exact: true }).click();
  await expect(page.getByTestId("branch-Manual cut")).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Compare versions" })).toHaveCount(0);
});

test("unprotects a selected lock and can undo the removal", async ({ page }) => {
  await openLocalFixture(page);
  await page.locator(".timeline-clip").first().click();
  await page.getByTestId("lock-range").click();
  await expect(page.locator(".lock-band")).toHaveCount(1);
  await page.locator(".protected-ranges > summary").click();
  await page.getByRole("button", { name: "Unprotect", exact: true }).click();
  await expect(page.locator(".lock-band")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".lock-band")).toHaveCount(1);
});

test("source preview is non-mutating and places only the marked range", async ({ page }) => {
  await openLocalFixture(page, false);
  const before = await inspectWorkspace(page);
  await page.getByRole("button", { name: "Preview brand_sting", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Source", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByLabel("Source in (ms)").fill("500");
  await page.getByLabel("Source out (ms)").fill("1500");
  await page.getByLabel("Source monitor", { exact: true }).focus();
  await page.keyboard.press("s");
  expect((await inspectWorkspace(page)).project.stateDigest).toBe(before.project.stateDigest);
  await page.keyboard.press("Space");
  await expect.poll(() => page.locator(".source-stage video").evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await page.getByRole("tab", { name: "Timeline", exact: true }).click();
  await expect.poll(() => page.locator(".source-stage video").evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  await page.getByRole("tab", { name: "Source", exact: true }).click();
  await page.getByRole("button", { name: "Place selection" }).click();
  await expect(page.getByRole("tab", { name: "Timeline", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "brand_sting, 00:00.000 to 00:01.000", exact: true })).toHaveCount(2);
  expect((await inspectWorkspace(page)).project.durationMs).toBe(1000);
});

test("whole-clip replacement is explicit and respects protection outside the insertion", async ({ page }) => {
  await openLocalFixture(page);
  const inspected = await inspectWorkspace(page);
  await page.evaluate(async (project) => {
    const tools = (window as typeof window & { __cutlineTools: Record<string, { execute: (input: unknown) => Promise<unknown> }> }).__cutlineTools;
    await tools.lock_range.execute({ projectId: project.project.id, branchId: project.project.activeBranchId, expectedBranchVersion: project.branches[0].branchVersion, range: { startMs: 1500, endMs: 1800 }, label: "Protected tail" });
  }, inspected);
  await page.getByRole("button", { name: "Preview brand_sting", exact: true }).click();
  await page.getByLabel("Source out (ms)").fill("1000");
  await page.getByLabel("Source position").selectOption("playhead");
  await expect(page.getByRole("button", { name: "Place selection" })).toBeDisabled();
  await expect(page.locator(".source-conflicts li")).toHaveCount(2);
  await page.getByLabel("Replace entire overlapping clips").check();
  const before = await inspectWorkspace(page);
  await page.getByRole("button", { name: "Place selection" }).click();
  await expect(page.locator(".source-placement").getByRole("alert")).toContainText("Unprotect the range in Review");
  expect((await inspectWorkspace(page)).project.stateDigest).toBe(before.project.stateDigest);
  await page.locator(".protected-ranges > summary").click();
  await page.getByRole("button", { name: "Unprotect", exact: true }).click();
  await expect(page.getByLabel("Replace entire overlapping clips")).not.toBeChecked();
  await page.getByLabel("Replace entire overlapping clips").check();
  await page.getByRole("button", { name: "Place selection" }).click();
  await expect(page.locator(".timeline-clip")).toHaveCount(2);
  expect((await inspectWorkspace(page)).project.durationMs).toBe(1000);
});

test("places audio-only and adjustable still holds through the source controls", async ({ page }) => {
  await installWebMcpHost(page);
  await page.goto("/");
  await page.getByTestId("upload-media").setInputFiles("public/demo/take_2.mp4");
  await page.getByRole("button", { name: "Preview take_2", exact: true }).click();
  await expect(page.getByLabel("Source out (ms)")).toHaveValue("11000");
  await page.getByLabel("Source destination").selectOption("a2");
  await page.getByRole("button", { name: "Place selection" }).click();
  const audio = await inspectWorkspace(page);
  expect(audio.tracks.find((track) => track.trackId === "v1")?.itemCount).toBe(0);
  expect(audio.tracks.find((track) => track.trackId === "a2")?.itemCount).toBe(1);
  expect(audio.project.durationMs).toBe(11000);
  await page.getByTestId("upload-media").setInputFiles({ name: "card.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#102923"/></svg>') });
  await page.getByRole("button", { name: "Preview card", exact: true }).click();
  await expect(page.getByLabel("Still hold (ms)")).toHaveValue("5000");
  await page.getByLabel("Still hold (ms)").fill("7000");
  await page.getByLabel("Source destination").selectOption("v2");
  await page.getByRole("button", { name: "Place selection" }).click();
  expect((await inspectWorkspace(page)).project.durationMs).toBe(18000);
});

test("defaults to unused version names and explains the eight-version limit", async ({ page }) => {
  await openLocalFixture(page, false);
  for (let index = 1; index <= 7; index += 1) {
    await page.locator(".version-menu > summary").click();
    await expect(page.getByLabel("Version name")).toHaveValue(`Version ${index}`);
    await page.getByRole("button", { name: "Create version", exact: true }).click();
  }
  await expect(page.locator(".version-menu > summary")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText("8-version limit reached", { exact: true })).toBeVisible();
  expect((await inspectWorkspace(page)).branches).toHaveLength(8);
});

test("remapped shortcuts honor labels and form or dialog focus", async ({ page }) => {
  await openLocalFixture(page);
  await page.getByText("Project", { exact: true }).click();
  await page.getByLabel("Split shortcut").fill("x");
  await page.getByText("Project", { exact: true }).click();
  await page.locator(".timeline-clip").first().click();
  await page.locator(".timeline-clip").first().focus();
  for (let frame = 0; frame < 30; frame += 1) await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("split-selected")).toHaveAttribute("title", /\(X\)/);
  await page.keyboard.press("s");
  await expect(page.locator(".timeline-clip")).toHaveCount(2);
  await page.getByLabel("Comment", { exact: true }).focus();
  await page.keyboard.press("x");
  await expect(page.getByLabel("Comment", { exact: true })).toHaveValue("x");
  await expect(page.locator(".timeline-clip")).toHaveCount(2);
  await page.getByTestId("export-button").click();
  await page.keyboard.press("x");
  await expect(page.locator(".timeline-clip")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await page.locator(".timeline-clip").first().focus();
  await page.keyboard.press("x");
  await expect(page.locator(".timeline-clip")).toHaveCount(4);
});

test("source and version controls remain usable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLocalFixture(page, false);
  await page.getByRole("button", { name: "media", exact: true }).click();
  await page.getByRole("button", { name: "Preview brand_sting", exact: true }).click();
  await expect(page.getByLabel("Source monitor", { exact: true })).toBeVisible();
  await page.getByLabel("Source out (ms)").fill("1000");
  await page.getByRole("button", { name: "Place selection" }).click();
  await expect(page.getByLabel("Program monitor")).toBeVisible();
  await expect(page.locator(".version-menu > summary")).not.toHaveCSS("color", "rgba(0, 0, 0, 0)");
  await page.locator(".version-menu > summary").click();
  await expect(page.getByLabel("Version name")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
