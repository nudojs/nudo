/**
 * Bug 183 回归：`for` 循环体**接守卫事实**（nullish + 关系）。
 *
 * ES 语义：`for (; test; )` 的测试在**每轮迭代前**求值、为真则进体 ⇒
 * 「测试为真 ⇒ 体内成立」与 `while (test) { … }` / `if (test) { … }` 的
 * 事实臂**完全等价**。
 *
 * 修复前：`ForStatement` 分支**一条守卫都没接**（`if` 接了四种、只接了
 * nullish 的 `while` 接了一种）⇒ 同一守卫事实在 `for` 被丢弃 ⇒
 * - L2 假红：`for (; v !== null; ) { return v.length; }` 报
 *   「property 'length' on null」（native 永不抛）；
 * - L1 假红：`for (; x > 0; ) { return x; }` 的返回值域丢 `> 0` 事实。
 *
 * 不变量（负控制钉住）：无守卫的 for 仍报 L2；体侧写守卫名 ⇒ 跳过收窄
 * （影子参数会吞体侧写）仍报 L2；for 主路径的循环变量（状态线程）不被
 * 影子参数顶掉。
 */
import { describe, it, expect } from "vitest";
import { litValue, checkSource, pTrue } from "@nudojs/core";
import { call, callLit } from "./eval-helpers.ts";
import { l2Count, sigOf, sidecarOpts } from "./nudo-constraints.ts";

/** 引擎求值结果字面量值 */
function v(src: string, ...args: unknown[]) {
  return litValue(callLit(src, "f", ...args).result);
}

const NUDO_SRC = `
export const strOrNull = union(string(), lit(null));
export const num = number();
export const posNum = number().gt(0);
`;
const opts = sidecarOpts("std183c", NUDO_SRC, "/t/b183.js");
const IMP = `/// @nudo:import { strOrNull, num, posNum } from "./std183c.nudo.js"\n`;

function check(src: string) {
  return checkSource("/t/b183.js", IMP + src, pTrue, opts);
}

describe("Bug 183 — for 循环体接 nullish 守卫（零 L2 / 不报 may-throw）", () => {
  it("for (; v !== null; ) { return v.length; } 零 L2（native 永不抛）", () => {
    const r = check(`
/**
 * @nudo:contract v strOrNull
 */
export function f(v) {
  for (; v !== null; ) {
    return v.length;
  }
  return 0;
}
`);
    expect(l2Count(r, "f")).toBe(0);
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, "f")).not.toMatch(/throws/);
  });

  it("与 while 写法结论一致（同守卫同机制）", () => {
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

  it("for 体内的 nullish 守卫对成员读生效（v.length 不撞 null 臂）", () => {
    const r = check(`
/**
 * @nudo:contract v strOrNull
 */
export function f(v) {
  for (; v !== null; ) {
    const n = v.length;
    if (n < 0) return 0;
  }
  return 0;
}
`);
    expect(l2Count(r, "f")).toBe(0);
  });
});

describe("Bug 183 — for 循环体接关系守卫（L1 契约成立）", () => {
  it("for (; x > 0; ) { return x; } 满足 return number().gt(0)", () => {
    const r = check(`
/**
 * @nudo:contract x num
 * @nudo:contract return posNum
 */
export function f(x) {
  for (; x > 0; ) {
    return x;
  }
  return 1;
}
`);
    expect(r.summary.errors).toBe(0);
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated").length).toBe(0);
  });

  it("与 if 写法结论一致（同守卫同机制）", () => {
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
});

describe("Bug 183 — 引擎求值：for 头的测试语义不变", () => {
  it("for (; v !== null; ) 在 v 为 null 时不进体（返回 0）", () => {
    const src = `export function f(v) { for (; v !== null; ) { return v.length; } return 0; }`;
    expect(v(src, null)).toEqual({ ok: true, value: 0 });
  });

  it("for (; v !== null; ) 在 v 为字符串时进体（返回长度）", () => {
    const src = `export function f(v) { for (; v !== null; ) { return v.length; } return 0; }`;
    expect(v(src, "ab")).toEqual({ ok: true, value: 2 });
  });

  it("for 主路径的循环变量不被影子参数顶掉（i 逐轮递增）", () => {
    const src = `export function f() { let s = 0; for (let i = 0; i < 3; i++) { s = s + i; } return s; }`;
    expect(v(src)).toEqual({ ok: true, value: 3 });
  });
});

describe("Bug 183 — 负控制：无守卫 / 体侧写守卫名 ⇒ 仍报 L2", () => {
  it("无守卫的 for 体内读 null 臂成员仍报 L2", () => {
    const r = check(`
/**
 * @nudo:contract v strOrNull
 */
export function f(v) {
  for (let i = 0; i < 1; i++) {
    return v.length;
  }
  return 0;
}
`);
    expect(l2Count(r, "f")).toBeGreaterThan(0);
  });

  it("体侧写守卫名（影子会吞写）⇒ 跳过收窄仍报 L2", () => {
    const r = check(`
/**
 * @nudo:contract v strOrNull
 */
export function f(v) {
  for (; v !== null; ) {
    v = null;
    return v.length;
  }
  return 0;
}
`);
    expect(l2Count(r, "f")).toBeGreaterThan(0);
  });
});
