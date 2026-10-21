/**
 * Bug 185 同构缺口回归：`do-while` 分支的**关系守卫**接线。
 *
 * ES 语义：`do { B } while (T)` —— 体 B **先**执行一次，之后每轮迭代前求
 * 测试 T；T 为真则再进体 ⇒ 「T 为真 ⇒ 体内成立」与 `if (T) { B }` 的事实臂
 * 等价（**第 2 轮起**）；**首轮**先于任何测试求值 ⇒ 首轮体内无该事实。
 *
 * 修复前：do-while 分支的守卫只取 `nullishGuardsOf` ⇒ **关系守卫**
 * （`relGuardOf`：`x > 0`）一次都没接进体侧 ⇒ 体内 x 折不出 > 0 事实 ⇒
 * `@nudo:contract return number().gt(0)` 被判违约（L1 假红），而同机制的
 * `for` / `while`（含 nullish 守卫）都是绿的 ⇒ 同一机制内部不自洽。
 *
 * 不变量（负控制钉住）：**首轮**拷贝保持未收窄（先于测试求值 ⇒ 无事实，
 * sound）；体侧写守卫名 ⇒ 跳过收窄（影子参数会吞体侧写）仍报 L1；nullish
 * 守卫接线不回归；循环体外的读不携带关系事实；引擎求值语义不变。
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
export const posOrZero = union(number().gt(0), lit(0));
export const strOrNull = union(string(), lit(null));
`;
const opts = sidecarOpts("std185dw", NUDO_SRC, "/t/b185dw.js");
const IMP = `/// @nudo:import { num, posNum, posOrZero, strOrNull } from "./std185dw.nudo.js"\n`;

function check(src: string) {
  return checkSource("/t/b185dw.js", IMP + src, pTrue, opts);
}

/** L1 契约违约数 */
function l1(r: ReturnType<typeof check>): number {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated").length;
}

describe("Bug 185 同构缺口 — do-while 体侧接关系守卫（L1 契约成立）", () => {
  it("第 2 轮起体内成立 x > 0 事实 ⇒ return x 满足契约", () => {
    const r = check(`
/**
 * @nudo:contract x num
 * @nudo:contract return posOrZero
 */
export function f(x) {
  let n = 0;
  do {
    n = n + 1;
    if (n === 2) return x;
  } while (x > 0);
  return 0;
}
`);
    expect(r.summary.errors).toBe(0);
    expect(l1(r)).toBe(0);
  });

  it("与 while 写法结论一致（同守卫换结构结论相同）", () => {
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
    expect(l1(r)).toBe(0);
  });
});

describe("Bug 185 同构缺口 — 负控制：收窄不越界 / 接线不回归", () => {
  it("首轮拷贝保持未收窄（先于测试求值 ⇒ 无 > 0 事实，仍报 L1）", () => {
    const r = check(`
/**
 * @nudo:contract x num
 * @nudo:contract return posNum
 */
export function f(x) {
  do {
    return x;
  } while (x > 0);
}
`);
    expect(l1(r)).toBeGreaterThan(0);
  });

  it("体侧写守卫名（影子会吞写）⇒ 跳过收窄仍报 L1", () => {
    const r = check(`
/**
 * @nudo:contract x num
 * @nudo:contract return posNum
 */
export function f(x) {
  do {
    x = 0;
    return x;
  } while (x > 0);
}
`);
    expect(l1(r)).toBeGreaterThan(0);
  });

  it("循环体外的读不携带关系事实（仍报 L1）", () => {
    const r = check(`
/**
 * @nudo:contract x num
 * @nudo:contract return posNum
 */
export function f(x) {
  do {
    const y = 1;
    if (y < 0) return 0;
  } while (x > 0);
  return x;
}
`);
    expect(l1(r)).toBeGreaterThan(0);
  });

  it("do-while (v !== null) 体内成员读仍零 L2（nullish 接线不回归）", () => {
    const r = check(`
/**
 * @nudo:contract v strOrNull
 */
export function f(v) {
  let n = 0;
  do {
    n = n + 1;
    if (n === 1) return 0;
    return v.length;
  } while (v !== null);
}
`);
    expect(l2Count(r, "f")).toBe(0);
    expect(sigOf(r, "f")).not.toMatch(/throws/);
  });
});

describe("Bug 185 同构缺口 — 引擎求值：do-while 语义不变", () => {
  it("do-while 体至少执行一次（先于测试）", () => {
    const src = `export function f(x) { let n = 0; do { n = n + 1; if (n === 3) return n; } while (x > 0); return n; }`;
    expect(v(src, -1)).toEqual({ ok: true, value: 1 });
    expect(v(src, 5)).toEqual({ ok: true, value: 3 });
  });

  it("第 2 轮的 return 取到 x（运行时取值不变）", () => {
    const src = `export function f(x) {
      let n = 0;
      do {
        n = n + 1;
        if (n === 2) return x;
      } while (x > 0);
      return 0;
    }`;
    expect(v(src, 5)).toEqual({ ok: true, value: 5 });
    expect(v(src, -1)).toEqual({ ok: true, value: 0 });
  });
});
