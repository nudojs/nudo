/**
 * Bug 333 —— 「prim + 界」契约（`number().gt(0)` / `string().max(3)`）实例化时
 * **丢掉 prim 的类型义务**：`instantiateConstraint` 只在 `preds.length === 0`
 * 时补 `typeof` 谓词 ⇒ 有界契约的实例化结果里没有类型义务 ⇒ 执法层无从判类型。
 *
 * 修法（core/algebra/constraint.ts `instantiateConstraint`）：
 * 只要约束带 `prim`，就把 `typeof` 谓词与界谓词**合取**（不再二选一）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { instantiateConstraint, number, string } from "../constraint.ts";
import { predToString } from "../pred.ts";
import { sidecarOpts } from "./nudo-constraints.ts";

describe("Bug 333：prim + 界契约实例化保留 typeof 类型义务", () => {
  it("number().gt(0) 实例化 = typeof 义务 ∧ 数值界", () => {
    const p = predToString(instantiateConstraint(number().gt(0), "ms"));
    expect(p).toContain('typeof ms = "number"');
    expect(p).toContain("ms > 0");
  });

  it("string().max(3) 实例化 = typeof 义务 ∧ 长度界", () => {
    const p = predToString(instantiateConstraint(string().max(3), "s"));
    expect(p).toContain('typeof s = "string"');
    expect(p).toContain("length(s) ≤ 3");
  });

  it("裸 prim 契约口径不变（仍是单条 typeof）", () => {
    expect(predToString(instantiateConstraint(number(), "ms"))).toBe(
      'typeof ms = "number"',
    );
  });

  it("产品面：类型错配的实参被抓住（此前零诊断静默放行）", () => {
    const opts = sidecarOpts(
      "std.nudo.js",
      `export const positive = number().gt(0);`,
    );
    const r = checkSource(
      "/t/f.js",
      `/// @nudo:import { positive } from "./std.nudo.js"
/** @nudo:contract x positive */
function needsPos(x) { return x; }
needsPos("a");
`,
      pTrue,
      opts,
    );
    const errs = r.issues.filter(
      (i) => i.severity === "error" && i.code === "nudo:constraint-violated",
    );
    expect(errs.length).toBeGreaterThan(0);
    expect(
      errs.some((i) => (i.expected ?? "").includes('typeof x = "number"')),
    ).toBe(true);
  });
});
