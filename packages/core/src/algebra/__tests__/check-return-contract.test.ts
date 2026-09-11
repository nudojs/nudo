/**
 * @nudo:return 后置契约：推断返回值 ⊭ 声明。
 * 与 @nudo:requires（前置）对偶；契约仍来自 *.nudo.js 模板。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { withStdImport, stdOpts } from "./nudo-constraints.ts";

function issuesOf(src: string) {
  return checkSource("/t/ret.js", withStdImport(src), pTrue, stdOpts);
}

describe("@nudo:return", () => {
  it("ok: 返回值满足 positive", () => {
    const r = issuesOf(`
/**
 * @nudo:requires x positive
 * @nudo:return positive
 */
function inc(x) {
  return x + 1;
}
`);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("error: 字面量返回 ⊭ positive", () => {
    const r = issuesOf(`
/**
 * @nudo:return positive
 */
function bad() {
  return 0;
}
`);
    expect(r.ok).toBe(false);
    const err = r.issues.find((i) => i.message.includes("@nudo:return"));
    expect(err).toBeDefined();
    expect(err!.expected).toContain(">");
  });

  it("error: 返回类型 ⊭ string", () => {
    const r = issuesOf(`
/**
 * @nudo:return notAString
 */
function n() {
  return 1;
}
`);
    // notAString 不在 std 里 → 无契约可查，不报
    expect(r.issues.filter((i) => i.message.includes("@nudo:return"))).toEqual([]);
  });

  it("ok: 无 @nudo:return 不猜后置", () => {
    const r = issuesOf(`
function free() {
  return -1;
}
`);
    expect(r.issues.filter((i) => i.message.includes("@nudo:return"))).toEqual([]);
  });

  it("error: percent 上界", () => {
    const r = issuesOf(`
/**
 * @nudo:return percent
 */
function big() {
  return 150;
}
`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes("@nudo:return"))).toBe(true);
  });

  it("ok: any/符号返回不误报", () => {
    const r = issuesOf(`
/**
 * @nudo:requires x positive
 * @nudo:return positive
 */
function keep(x) {
  return x;
}
`);
    // 符号返回带 pred x>0，应满足
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});
