import { describe, expect, it } from "vitest";
import { getRenderSize } from "./export";

describe("local render sizing", () => {
  it("maps timeline aspect ratios to 720p output frames", () => {
    expect(getRenderSize("16:9")).toEqual({ width: 1280, height: 720 });
    expect(getRenderSize("9:16")).toEqual({ width: 720, height: 1280 });
    expect(getRenderSize("1:1")).toEqual({ width: 720, height: 720 });
  });

  it("offers smaller 480p output frames", () => {
    expect(getRenderSize("16:9", "480p")).toEqual({ width: 854, height: 480 });
    expect(getRenderSize("9:16", "480p")).toEqual({ width: 480, height: 854 });
    expect(getRenderSize("1:1", "480p")).toEqual({ width: 480, height: 480 });
  });
});
