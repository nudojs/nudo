/**
 * Bug 185 回归：`while` 循环体接**关系守卫**（`x > 0`）。
 *
 * ES 语义：`while (test)` 的测试在每轮迭代前求值、为真则进体 ⇒ 「测试为
 * 真 ⇒ 体内成立」与 `if (test) { … }` 的事实臂**完全等价**。
 *
 * 修复前：`while` 分支的 `loopGuards` **只**取 `nullishGuardsOf` ⇒ 关系
 * 守卫（`relGuardOf`）在 `while`/`do-while` 分支里一次都没出现 ⇒
 * `while (x > 0) { return x; }` 的体内 x 仍是入口处的 `number`（无 `> 0`
 * 事实）⇒ `@nudo:contract return number().gt(0)` 被判违约（L1 假红），
 * 而同机制的 `while (v !== null)`（nullish 守卫）是**绿**的 ⇒ 同一机制
 * 内部不自洽。
 *
 * 不变量（负控制钉住）：nullish 守卫接线不回归；体侧写守卫名 ⇒ 跳过收窄
 * （影子参数会吞体侧写）仍报 L1；循环体外的读不携带关系事实。
 */
import { describe, it, expect } from "vitest";
import { litValue, checkSource, pTrue } from "@nudojs/core";
import { callLit } from "./eval-helpers.ts";
import { l2Count, sigOf, sidecarOpts } from "./nudo-constraints.ts";

/** 引擎求值结果字面量值 */
function v(src: string, ...args: unknown[]) {
  return litValue(callLit(src, "f", ...args).result);
}

const NUDO_SRC = `
export const num = number();
export const posNum = number().gt(0);
export const strOrNull = union(string(), lit(null));
`;
const opts = sidecarOpts("std185c", NUDO_SRC, "/t/b185.js");
const IMP = `/// @nudo:import { num, posNum, strOrNull } from "./std185c.nudo.js"\n`;

function check(src: string) {
  return checkSource("/t/b185.js", IMP + src, pTrue, opts);
}

describe("Bug 185 — while 循环体接关系守卫（L1 契约成立）", () => {
  it("while (x > 0) { return x; } 满足 return number().gt(0)", () => {
    const r = check(`
/**
 * @nudo:contract x num
 * @nudo:contract return posNum
 */
export function f(x) {
  while (x > 0) {
    return x;
  }
  return 1;
}
`);
    expect(r.summary.errors).toBe(0);
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated").length).toBe(0);
  });

  it("与 if 写法结论一致（同守卫换结构结论相同）", () => {
    const r = check(`
/**
 * @nudo:contract x num
 * @nudo:contract return posNum
 */
export function f(x) {
  if (x > 0) {
    return x;
  }
  return 1;
}
`);
    expect(r.summary.errors).toBe(0);
  });

  it("while (x >= 0) 的关系事实同样接进体内", () => {
    const r = check(`
/**
 * @nudo:contract x num
 * @nudo:contract return num
 */
export function f(x) {
  while (x >= 0) {
    return x;
  }
  return 0;
}
`);
    expect(r.summary.errors).toBe(0);
  });
});

describe("Bug 185 — 负控制：nullish 守卫接线不回归 / 收窄不越界", () => {
  it("while (v !== null) 体内成员读仍零 L2（nullish 接线不回归）", () => {
    const r = check(`
/**
 * @nudo:contract v strOrNull
 */
export function f(v) {
  while (v !== null) {
    return v.length;
  }
  return 0;
}
`);
    expect(l2Count(r, "f")).toBe(0);
    expect(sigOf(r, "f")).not.toMatch(/throws/);
  });

  it("体侧写守卫名（影子会吞写）⇒ 跳过收窄仍报 L1", () => {
    const r = check(`
/**
 * @nudo:contract x num
 * @nudo:contract return posNum
 */
export function f(x) {
  while (x > 0) {
    x = 0;
    return x;
  }
  return 1;
}
`);
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated").length).toBeGreaterThan(0);
  });

  it("循环体外的读不携带关系事实（仍报 L1）", () => {
    const r = check(`
/**
 * @nudo:contract x num
 * @nudo:contract return posNum
 */
export function f(x) {
  while (x > 0) {
    const y = 1;
    if (y < 0) return 0;
  }
  return x;
}
`);
    // Bug 370：无界证据（循环体外的读不携带关系事实）⇒ 判「证不出」
    // （nudo:unproven-return，warning）而非「确定违约」（error）
    expect(
      r.issues.filter(
        (i) => i.code === "nudo:constraint-violated" || i.code === "nudo:unproven-return",
      ).length,
    ).toBeGreaterThan(0);
  });
});

describe("Bug 185 — 引擎求值：while 语义不变", () => {
  it("while (x > 0) 在 x 为正时进体（返回 x）", () => {
    const src = `export function f(x) { while (x > 0) { return x; } return 1; }`;
    expect(v(src, 5)).toEqual({ ok: true, value: 5 });
  });

  it("while (x > 0) 在 x 为负时进不了体（返回 1）", () => {
    const src = `export function f(x) { while (x > 0) { return x; } return 1; }`;
    expect(v(src, -5)).toEqual({ ok: true, value: 1 });
  });

  it("while (v !== null) 的 nullish 收窄不改变取值", () => {
    const src = `export function f(v) { while (v !== null) { return v.length; } return 0; }`;
    expect(v(src, "ab")).toEqual({ ok: true, value: 2 });
    expect(v(src, null)).toEqual({ ok: true, value: 0 });
  });
});
