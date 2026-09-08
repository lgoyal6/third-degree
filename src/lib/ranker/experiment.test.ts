import { describe, expect, it } from "vitest";
import { assignArm, unitHash } from "./experiment";

describe("assignArm", () => {
  it("is deterministic for the same unit", () => {
    for (const unit of ["12345", "client-abc", "another"]) {
      expect(assignArm(unit)).toBe(assignArm(unit));
    }
  });

  it("splits units roughly in half", () => {
    let learned = 0;
    const n = 10000;
    for (let i = 0; i < n; i++) {
      if (assignArm(`unit-${i}`) === "learned") learned++;
    }
    expect(learned / n).toBeGreaterThan(0.45);
    expect(learned / n).toBeLessThan(0.55);
  });

  it("a different experiment name reshuffles the assignment", () => {
    const flipped = Array.from({ length: 200 }, (_, i) => `unit-${i}`).filter(
      (u) => assignArm(u) !== assignArm(u, "grill-ranking-v2"),
    );
    expect(flipped.length).toBeGreaterThan(0);
  });
});

describe("unitHash", () => {
  it("is stable and never the raw id", () => {
    expect(unitHash("user-1")).toBe(unitHash("user-1"));
    expect(unitHash("user-1")).not.toContain("user-1");
    expect(unitHash("user-1")).toHaveLength(12);
  });
});
