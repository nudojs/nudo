/**
 * case ⊄ refine → nudo:case-inconsistency
 * case 是契约的见证，不是另一套前置来源。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { withStdImport, stdOpts } from "./nudo-constraints.ts";

function issuesOf(src: string) {
  return checkSource("/t/case.js", withStdImport(src), pTrue, stdOpts);
}

describe("case vs refine", () => {
  it("ok: case 实参满足契约", () => {
    const r = issuesOf(`
/**
 * @nudo:contract x positive
 * @nudo:case "ok" (5)
 */
function needsPositive(x) {
  return x;
}
`);
    expect(r.issues.filter((i) => i.code === "nudo:case-inconsistency")).toEqual([]);
  });

  it("error: case 实参 ⊭ refine", () => {
    const r = issuesOf(`
/**
 * @nudo:contract x positive
 * @nudo:case "neg" (-1)
 */
function needsPositive(x) {
  return x;
}
`);
    const err = r.issues.find((i) => i.code === "nudo:case-inconsistency");
    expect(err).toBeDefined();
    expect(err!.severity).toBe("error");
    expect(err!.expected).toContain(">");
    expect(err!.message).toContain("neg");
  });

  it("error: percent 上界违例", () => {
    const r = issuesOf(`
/**
 * @nudo:contract n percent
 * @nudo:case "big" (150)
 */
function pct(n) {
  return n;
}
`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "nudo:case-inconsistency")).toBe(true);
  });

  it("ok: 无 refine 的 case 不报", () => {
    const r = issuesOf(`
/**
 * @nudo:case "any" (-1)
 */
function id(x) {
  return x;
}
`);
    expect(r.issues.filter((i) => i.code === "nudo:case-inconsistency")).toEqual([]);
  });

  // Bug 1：纯 bounds 分支此前不执法 .int() 标志——number().int() 的非整数
  // 见证静默通过（hasEqOr 分支经 literalMeetsConstraint 已执法）。
  it("error: 非整数见证 ⊭ number().int()（纯 int，无 range 原子）", () => {
    const r = issuesOf(`
/**
 * @nudo:contract x intOnly
 * @nudo:case "frac" (1.5)
 */
function needsInt(x) {
  return x;
}
`);
    const err = r.issues.find((i) => i.code === "nudo:case-inconsistency");
    expect(err).toBeDefined();
    expect(err!.severity).toBe("error");
    expect(err!.expected).toContain("int");
    expect(err!.message).toContain("frac");
  });

  it("error: 非整数见证 ⊭ number().int().gt(0)（int + bounds 组合）", () => {
    const r = issuesOf(`
/**
 * @nudo:contract x intId
 * @nudo:case "frac" (1.5)
 */
function needsIntId(x) {
  return x;
}
`);
    const err = r.issues.find((i) => i.code === "nudo:case-inconsistency");
    expect(err).toBeDefined();
    expect(err!.expected).toContain("int");
  });

  it("bounds 违例仍报（int 合法但越界）；整数满足 int+bounds 不报", () => {
    const bad = issuesOf(`
/**
 * @nudo:contract x intId
 * @nudo:case "neg" (-1)
 */
function a(x) {
  return x;
}
`);
    const err = bad.issues.find((i) => i.code === "nudo:case-inconsistency");
    expect(err).toBeDefined();
    expect(err!.expected).toContain(">");

    const ok = issuesOf(`
/**
 * @nudo:contract x intId
 * @nudo:case "two" (2)
 */
function b(x) {
  return x;
}
`);
    expect(ok.issues.filter((i) => i.code === "nudo:case-inconsistency")).toEqual([]);
  });

  it("控制：无 .int() 的纯 bounds 契约对小数见证不报（1.5 ⊨ positive）", () => {
    const r = issuesOf(`
/**
 * @nudo:contract x positive
 * @nudo:case "frac" (1.5)
 */
function c(x) {
  return x;
}
`);
    expect(r.issues.filter((i) => i.code === "nudo:case-inconsistency")).toEqual([]);
  });
});
