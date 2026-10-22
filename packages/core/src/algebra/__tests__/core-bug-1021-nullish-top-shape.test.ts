/**
 * Bug 1021：顶层「结构约束」位对 `null` / `undefined` 实参**零诊断**（假绿）
 * ⇒ 同一个实参位、同一个 nullish 实参，仅因约束是 `shape()` 而非标量就
 * 给出相反裁决 ⇒ 引擎内部第 4 套「nullish 是否满足契约」口径。
 *
 * 修法：消费侧（`scan/literal-shapes.ts` 的 `checkShapeAgainstAbs`）的排除
 * 条件从「`shape.k` 字面等于 unknown」改成「**无 term 的** unknown / any /
 * never 才跳过」⇒ nullish（有 term）落入「不是 object ⇒ 报违例」。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import type { CheckIssue } from "../check-report.ts";
import { sidecarOpts } from "./nudo-constraints.ts";

const NUDO_SRC = `
import { fn, number, shape } from "@nudojs/core";
export const g = fn({ o: shape({ a: number() }) });
export const gScalar = fn({ x: number() });
`;

const opts = sidecarOpts("core-bug-1021.nudo.js", NUDO_SRC, "/t/core-bug-1021.js");

function check(src: string) {
  return checkSource("/t/core-bug-1021.js", src, pTrue, opts);
}

function violated(r: { issues: CheckIssue[] }, fn?: string) {
  return r.issues.filter(
    (i) => i.code === "nudo:constraint-violated" && (!fn || i.fn === fn),
  );
}

const DECLS = `
export function g(o) { return o; }
export function gScalar(x) { return x; }
`;

describe("Bug 1021：顶层结构约束对 nullish 实参不再零诊断", () => {
  it("null 实参报违例（object shape at o）", () => {
    const r = check(`${DECLS}\ng(null);\n`);
    const v = violated(r, "g");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain("object shape at o");
  });

  it("undefined 实参报违例", () => {
    const r = check(`${DECLS}\ng(undefined);\n`);
    const v = violated(r, "g");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain("object shape at o");
  });

  it("同口径：顶层标量位对 null 也报违例（两套口径已统一）", () => {
    const r = check(`${DECLS}\ngScalar(null);\n`);
    const v = violated(r, "gScalar");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain('typeof x = "number"');
  });

  it("合规实参零诊断（nullish 执法没有误伤合法调用）", () => {
    const r = check(`${DECLS}\ng({ a: 1 });\ngScalar(1);\n`);
    expect(violated(r)).toEqual([]);
  });
});
