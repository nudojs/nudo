/**
 * @nudo:contract return 后置契约：推断返回值 ⊭ 声明。
 * 与 @nudo:contract（前置）对偶；契约仍来自 *.nudo.js 模板。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { withStdImport, stdOpts } from "./nudo-constraints.ts";

function issuesOf(src: string) {
  return checkSource("/t/ret.js", withStdImport(src), pTrue, stdOpts);
}

describe("@nudo:contract return", () => {
  it("ok: 返回值满足 positive", () => {
    const r = issuesOf(`
/**
 * @nudo:contract x positive
 * @nudo:contract return positive
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
 * @nudo:contract return positive
 */
function bad() {
  return 0;
}
`);
    expect(r.ok).toBe(false);
    const err = r.issues.find((i) => i.message.includes("@nudo:contract return"));
    expect(err).toBeDefined();
    expect(err!.expected).toContain(">");
  });

  it("error: 返回类型 ⊭ string", () => {
    const r = issuesOf(`
/**
 * @nudo:contract return notAString
 */
function n() {
  return 1;
}
`);
    // notAString 不在 std 里 → 无契约可查，不报
    expect(r.issues.filter((i) => i.message.includes("@nudo:contract return"))).toEqual([]);
  });

  it("ok: 无 @nudo:contract return 不猜后置", () => {
    const r = issuesOf(`
function free() {
  return -1;
}
`);
    expect(r.issues.filter((i) => i.message.includes("@nudo:contract return"))).toEqual([]);
  });

  it("error: percent 上界", () => {
    const r = issuesOf(`
/**
 * @nudo:contract return percent
 */
function big() {
  return 150;
}
`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes("@nudo:contract return"))).toBe(true);
  });

  it("error: string 长度界（shortName min/max）", () => {
    const r = issuesOf(`
/**
 * @nudo:contract return shortName
 */
function name() {
  return "";
}
`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes("@nudo:contract return"))).toBe(true);
  });

  it("ok: string 满足长度界", () => {
    const r = issuesOf(`
/**
 * @nudo:contract return shortName
 */
function name() {
  return "abc";
}
`);
    expect(r.issues.filter((i) => i.message.includes("@nudo:contract return"))).toEqual([]);
  });

  it("ok: any/符号返回不误报", () => {
    const r = issuesOf(`
/**
 * @nudo:contract x positive
 * @nudo:contract return positive
 */
function keep(x) {
  return x;
}
`);
    // 符号返回带 pred x>0，应满足
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});
