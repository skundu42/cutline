import type { Command, EditOp } from "../core/types";
import { FALSE_START, SILENCE_REGIONS, WEAK_TAKE } from "./transcript";

export const GOLDEN_BRANCH_A_NAME = "Branch A";
export const GOLDEN_BRANCH_B_NAME = "Branch B";

const silencesAfterWeak = [...SILENCE_REGIONS]
  .filter((range) => range.startMs >= WEAK_TAKE.endMs)
  .sort((a, b) => b.startMs - a.startMs);

const silencesBeforeWeak = [...SILENCE_REGIONS]
  .filter((range) => range.endMs <= WEAK_TAKE.startMs)
  .sort((a, b) => b.startMs - a.startMs);

export const GOLDEN_CUT_OPS: EditOp[] = [
  ...silencesAfterWeak.map((range) => ({
    op: "ripple_delete" as const,
    range: { startMs: range.startMs, endMs: range.endMs },
    required: true,
  })),
  {
    op: "replace_range",
    trackId: "v1",
    range: { startMs: WEAK_TAKE.startMs, endMs: WEAK_TAKE.endMs },
    assetId: "take_2",
    source: { inMs: 0, endMs: 11000 },
    transition: "cut",
    required: true,
  },
  ...silencesBeforeWeak.map((range) => ({
    op: "ripple_delete" as const,
    range: { startMs: range.startMs, endMs: range.endMs },
    required: true,
  })),
  {
    op: "ripple_delete",
    range: { startMs: FALSE_START.startMs, endMs: FALSE_START.endMs },
    required: true,
  },
];

export function createBranchACommands(baseBranchId: string, expectedBaseVersion: number): Command[] {
  return [
    {
      type: "CreateBranch",
      actor: { type: "agent", surface: "webmcp" },
      payload: {
        baseBranchId,
        expectedBaseVersion,
        name: GOLDEN_BRANCH_A_NAME,
        purpose: "35s vertical rough cut",
      },
    },
  ];
}

export const GOLDEN_POLISH_OPS_AFTER_CUTS = {
  broll: { startMs: 12000, endMs: 17000 },
  diagram: { startMs: 22000, endMs: 27000 },
} as const;
