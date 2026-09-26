import { describe, it, expect } from "vitest";
import {
  actionsForIssue,
  serializeCheckJson,
  type CheckReport,
} from "../check-report.ts";

function reportWith(issues: CheckReport["issues"]): CheckReport {
  return {
    file: "/t/a.js",
    issues,
    ok: false,
    signatures: [],
    summary: { errors: 1, warnings: 0, infos: 0, functions: 0 },
  };
}

describe("AI1 structured actions in CheckJson", () => {
  it("constraint-violated offers callsite + relax + draft", () => {
    const acts = actionsForIssue({
      code: "nudo:constraint-violated",
      expected: "ms > 0",
    });
    expect(acts.map((a) => a.kind)).toEqual(["callsite", "relax", "draft"]);
    const draft = acts.find((a) => a.kind === "draft")!;
    expect(draft.command).toBe("nudo contract --draft");
    expect(acts.find((a) => a.kind === "callsite")!.hint).toBe("ms > 0");
  });

  it("entry-may-throw offers ignore-throws command", () => {
    const acts = actionsForIssue({ code: "nudo:entry-may-throw", fn: "getName" });
    const ign = acts.find((a) => a.kind === "ignore-throws");
    expect(ign?.command).toContain("--ignore-throws");
  });

  it("serializeCheckJson embeds actions on each issue", () => {
    const json = serializeCheckJson(
      reportWith([
        {
          severity: "error",
          code: "nudo:constraint-violated",
          message: "argument ⊭ precondition",
          actual: "0  #exact",
          expected: "ms > 0",
          suggestion: "use a value satisfying ms > 0",
        },
      ]),
    );
    const iss = json.issues[0]!;
    expect(iss.actions).toBeDefined();
    expect(iss.actions!.length).toBeGreaterThanOrEqual(3);
    expect(iss.actions!.some((a) => a.kind === "draft")).toBe(true);
  });

  it("unknown-inference suggests mock / assume (not fake green)", () => {
    const acts = actionsForIssue({ code: "nudo:unknown-inference" });
    expect(acts.map((a) => a.kind)).toContain("mock");
    expect(acts.map((a) => a.kind)).toContain("assume");
  });
});
