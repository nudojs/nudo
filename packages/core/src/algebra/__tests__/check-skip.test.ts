import { describe, it, expect } from "vitest";
import { checkSource, formatShape, pTrue } from "../index.ts";
import type { Abs } from "../abs.ts";
import { withStdImport, stdOpts } from "./nudo-constraints.ts";

/**
 * `@nudo:skip [returnsExpr]`（host 解析后经 CheckOptions.skips 下传）：
 * body 不评估 → 不产生 unknown-inference 噪音；签名按声明返回上屏（无声明 any）；
 * 参数位/调用点 L1 义务不解除。
 *
 * body 用 `eval(data)`：B-path 下会折真 unknown（引擎债）。未定义调用
 * （如 processData）在新引擎是精确 `never`（ReferenceError 必抛），不能
 * 当作 unknown-inference 对照。
 */
describe("nudo check — @nudo:skip", () => {
  const numAbs: Abs = { shape: { k: "prim", type: "number" }, conf: "exact" };

  it("skipped fn: no body evaluation, no engine-debt warning", () => {
    const src = `
function heavy(data) {
  return eval(data);
}
`;
    const report = checkSource("t.js", src, pTrue, { skips: new Map([["heavy", null]]) });
    const sig = report.signatures.find((s) => s.name === "heavy");
    expect(sig).toBeDefined();
    expect(sig!.paramTypes).toEqual(["any"]);
    expect(formatShape(sig!.abs)).toBe("any");
    expect(report.issues.some((i) => i.code === "nudo:unknown-inference")).toBe(false);
  });

  it("without skips the same body reports unknown-inference (control)", () => {
    const src = `
function heavy(data) {
  return eval(data);
}
`;
    const report = checkSource("t.js", src, pTrue, {});
    const sig = report.signatures.find((s) => s.name === "heavy");
    expect(formatShape(sig!.abs)).toBe("unknown");
    expect(report.issues.some((i) => i.code === "nudo:unknown-inference")).toBe(true);
  });

  it("declared return type is used as the signature return", () => {
    const src = `
function heavy(data) {
  return eval(data);
}
`;
    const report = checkSource("t.js", src, pTrue, { skips: new Map([["heavy", numAbs]]) });
    const sig = report.signatures.find((s) => s.name === "heavy");
    expect(formatShape(sig!.abs)).toBe("number");
    expect(report.issues.some((i) => i.code === "nudo:unknown-inference")).toBe(false);
  });

  it("call-site L1 obligation stays enforced for skipped fns", () => {
    const src = `
/**
 * @nudo:contract x positive
 */
function needsPositive(x) {
  return heavyNative(x);
}
const r = needsPositive(-1);
`;
    const report = checkSource("t.js", withStdImport(src), pTrue, {
      ...stdOpts,
      skips: new Map([["needsPositive", null]]),
    });
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(true);
  });
});
