/**
 * Bug 186 回归：早退补集窄化的**送达范围**（嵌套语句表）。
 *
 * ES 语义：`if (v === null) { return 0; }` 早退 ⇒ **后续路径**上
 * 「v 不再是 null」⇒ 后续的 `v.length` 不撞 null 臂。这条补集事实与
 * 「早退 if 在语句表的哪一层」无关——裸块 / try 块 / catch 块 / finally 块
 * 里的同一段代码必须得到**同一**结论。
 *
 * 修复前：补集窄化只挂在「函数体顶层语句表」上（`transpileFnBodyStmts`
 * 的同层提升：同层有 `if` 早退 + 其后 `rest` 才提升）⇒ 裸块 / try / catch /
 * finally 四种形态的早退补集**全部失效** ⇒ 同一段代码换位置结论相反
 * （L2 假红：报「property 'length' on null」，而 native 永不抛）。
 *
 * 不变量（负控制钉住）：无早退守卫的嵌套块仍报 L2；非 nullish 早退守卫
 * 不产生补集窄化；块内有词法声明时不摊平（作用域不外泄）。
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
export const strOrNull = union(string(), lit(null));
export const num = number();
`;
const opts = sidecarOpts("std186c", NUDO_SRC, "/t/b186.js");
const IMP = `/// @nudo:import { strOrNull, num } from "./std186c.nudo.js"\n`;

function check(src: string) {
  return checkSource("/t/b186.js", IMP + src, pTrue, opts);
}

describe("Bug 186 — 裸块 / try / catch / finally 内的早退补集窄化生效", () => {
  it("裸块：{ if (v === null) { return 0; } } return v.length; 零 L2", () => {
    const r = check(`
/**
 * @nudo:contract v strOrNull
 */
export function f(v) {
  {
    if (v === null) { return 0; }
  }
  return v.length;
}
`);
    expect(l2Count(r, "f")).toBe(0);
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, "f")).not.toMatch(/throws/);
  });

  it("try 块：同段代码零 L2", () => {
    const r = check(`
/**
 * @nudo:contract v strOrNull
 */
export function f(v) {
  try {
    if (v === null) { return 0; }
    return v.length;
  } catch (e) {
    return 0;
  }
}
`);
    expect(l2Count(r, "f")).toBe(0);
    expect(sigOf(r, "f")).not.toMatch(/throws/);
  });

  it("catch 块：同段代码零 L2", () => {
    const r = check(`
/**
 * @nudo:contract v strOrNull
 */
export function f(v) {
  try {
    throw 1;
  } catch (e) {
    if (v === null) { return 0; }
    return v.length;
  }
}
`);
    expect(l2Count(r, "f")).toBe(0);
    expect(sigOf(r, "f")).not.toMatch(/throws/);
  });

  it("finally 块：同段代码零 L2", () => {
    const r = check(`
/**
 * @nudo:contract v strOrNull
 */
export function f(v) {
  try {
    return 9;
  } finally {
    if (v === null) { return 0; }
    return v.length;
  }
}
`);
    expect(l2Count(r, "f")).toBe(0);
    expect(sigOf(r, "f")).not.toMatch(/throws/);
  });

  it("对照组：函数体顶层同段代码零 L2（既有口径不回归）", () => {
    const r = check(`
/**
 * @nudo:contract v strOrNull
 */
export function f(v) {
  if (v === null) { return 0; }
  return v.length;
}
`);
    expect(l2Count(r, "f")).toBe(0);
    expect(sigOf(r, "f")).not.toMatch(/throws/);
  });

  it("四种嵌套形态与顶层形态签名一致", () => {
    const sigs = [
      `if (v === null) { return 0; } return v.length;`,
      `{ if (v === null) { return 0; } } return v.length;`,
      `try { if (v === null) { return 0; } return v.length; } catch (e) { return 0; }`,
      `try { throw 1; } catch (e) { if (v === null) { return 0; } return v.length; }`,
      `try { return 9; } finally { if (v === null) { return 0; } return v.length; }`,
    ].map((body) =>
      sigOf(
        check(`
/**
 * @nudo:contract v strOrNull
 */
export function f(v) {
  ${body}
}
`),
        "f",
      ),
    );
    for (const s of sigs) expect(s).toBe(sigs[0]);
    expect(sigs[0]).not.toMatch(/throws/);
  });
});

describe("Bug 186 — 引擎求值：嵌套形态的返回值与原生一致", () => {
  it("裸块：v 为 null → 0；v 为字符串 → 长度", () => {
    const src = `export function f(v) { { if (v === null) { return 0; } } return v.length; }`;
    expect(v(src, null)).toEqual({ ok: true, value: 0 });
    expect(v(src, "ab")).toEqual({ ok: true, value: 2 });
  });

  it("try 块：v 为 null → 0；v 为字符串 → 长度", () => {
    const src = `export function f(v) { try { if (v === null) { return 0; } return v.length; } catch (e) { return 0; } }`;
    expect(v(src, null)).toEqual({ ok: true, value: 0 });
    expect(v(src, "ab")).toEqual({ ok: true, value: 2 });
  });

  it("catch 块：v 为 null → 0；v 为字符串 → 长度", () => {
    const src = `export function f(v) { try { throw 1; } catch (e) { if (v === null) { return 0; } return v.length; } }`;
    expect(v(src, null)).toEqual({ ok: true, value: 0 });
    expect(v(src, "ab")).toEqual({ ok: true, value: 2 });
  });

  it("finally 块：v 为 null → 0；v 为字符串 → 长度", () => {
    const src = `export function f(v) { try { return 9; } finally { if (v === null) { return 0; } return v.length; } }`;
    expect(v(src, null)).toEqual({ ok: true, value: 0 });
    expect(v(src, "ab")).toEqual({ ok: true, value: 2 });
  });
});

describe("Bug 186 — 负控制：无早退守卫 / 非 nullish 守卫 ⇒ 仍报 L2", () => {
  it("嵌套块内无早退守卫 → 仍报 L2", () => {
    const r = check(`
/**
 * @nudo:contract v strOrNull
 */
export function f(v) {
  {
    const w = v;
    return w.length;
  }
}
`);
    expect(l2Count(r, "f")).toBeGreaterThan(0);
  });

  it("非 nullish 早退守卫（v === 1）不产生补集窄化 → 仍报 L2", () => {
    const r = check(`
/**
 * @nudo:contract v strOrNull
 */
export function f(v) {
  {
    if (v === 1) { return 0; }
  }
  return v.length;
}
`);
    expect(l2Count(r, "f")).toBeGreaterThan(0);
  });

  it("块内有词法声明时不摊平（名字不外泄到函数作用域）", () => {
    const src = `export function f(v) { { const w = 1; if (v === null) { return 0; } } return typeof w; }`;
    // 原生：块内 const 不在函数作用域 ⇒ typeof w === "undefined"
    expect(v(src, "ab")).toEqual({ ok: true, value: "undefined" });
  });
});
