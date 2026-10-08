/**
 * 第八轮 review P0 回归：
 * - 无 default switch 不得当终止语句
 * - $switch 隐式 fall-through
 * - switch 臂间数组 mutator 隔离
 * - fork 臂 throw 不中止兄弟臂
 * - 逻辑赋值 ||= / &&= / ??=
 * - generator 抽象分支不得 exact 出货
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $lit,
  litValue,
  formatAbs,
  formatShape,
} from "@nudojs/core";

function call(src: string, fnName: string, ...litArgs: unknown[]) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(
    exports,
    fnName,
    litArgs.map((a) => $lit(a as never)),
  );
}

function callAbs(src: string, fnName: string, args: unknown[]) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, args as never[]);
}

const absBool = { shape: { k: "prim", type: "boolean" }, conf: "path" } as never;
const absNum = { shape: { k: "prim", type: "number" }, conf: "path" } as never;

describe("P0-1 no-default switch is not terminating", () => {
  const src = `export function f(n) { switch (n) { case 1: return "one"; } return "after"; }`;
  it("concrete no-match continues after switch", () => {
    expect(litValue(call(src, "f", 2).result)).toEqual({ ok: true, value: "after" });
  });
  it("abstract keeps after path", () => {
    const r = callAbs(src, "f", [absNum]);
    const s = formatAbs(r.result);
    expect(s).not.toBe('"one"');
    expect(s).toContain("after");
    expect(r.result.shape.k).toBe("sum");
  });
});

describe("P0-2 $switch implicit fall-through arm", () => {
  const src = `export function f(n) { switch (n) { case 1: return 1; case 2: return 2; } }`;
  it("concrete no-match is undefined not dropped", () => {
    const r = call(src, "f", 3);
    expect(litValue(r.result)).toEqual({ ok: true, value: undefined });
  });
  it("abstract includes fall-through, not exact 1|2 only", () => {
    const r = callAbs(src, "f", [absNum]);
    // 完整枚举：除 1|2 外还须含 no-match 出口（undef/unknown）
    const s = formatAbs(r.result);
    expect(s).toContain("1");
    expect(s).toContain("2");
    expect(s === "1 | 2  #exact").toBe(false);
    expect(r.result.shape.k).toBe("sum");
  });
});

describe("P0-3 switch array mutator arm isolation", () => {
  const src = `export function f(n) { const a=[1,2,3]; switch(n){ case 1: a.pop(); break; default: break; } return a.length; }`;
  it("concrete arms stay correct", () => {
    expect(litValue(call(src, "f", 1).result)).toEqual({ ok: true, value: 2 });
    expect(litValue(call(src, "f", 9).result)).toEqual({ ok: true, value: 3 });
  });
  it("abstract length is not exact 2", () => {
    const r = callAbs(src, "f", [absNum]);
    expect(formatShape(r.result)).not.toBe("2");
    expect(r.result.conf).not.toBe("exact");
  });
});

describe("P0-4 fork throw does not abort sibling arm", () => {
  it("if-throw keeps normal path in result and throw in throws", () => {
    const src = `export function f(flag) { if (flag) { throw "e"; } return "ok"; }`;
    const r = callAbs(src, "f", [absBool]);
    expect(formatAbs(r.result)).toContain("ok");
    expect(formatAbs(r.throws)).toContain("e");
  });
});

describe("P0-5 logical assignment short-circuit", () => {
  it("x &&= a.pop() when x is null does not pop", () => {
    const src = `export function f() { let x = null; const a=[1,2,3]; x &&= a.pop(); return a.length; }`;
    expect(litValue(call(src, "f").result)).toEqual({ ok: true, value: 3 });
  });
  it("x ||= a.pop() under abstract flag is not exact 2", () => {
    const src = `export function f(flag) { let x = flag; const a=[1,2,3]; x ||= a.pop(); return a.length; }`;
    const r = callAbs(src, "f", [absBool]);
    expect(r.result.conf).not.toBe("exact");
  });
});

describe("P0-6 generator abstract yield is not exact wrong tuple", () => {
  it("abstract branch-sensitive generator conf is not exact [1,3]", () => {
    const src = `export function* g(n) { yield 1; if (n) return 2; yield 3; }`;
    const r = callAbs(src, "g", [absBool]);
    expect(r.result.conf).not.toBe("exact");
  });
  it("concrete true still yields [1]", () => {
    const src = `export function* g(n) { yield 1; if (n) return 2; yield 3; }
export function spread(n) { return [...g(n)]; }`;
    const r = call(src, "spread", true);
    // Bug 22：生成器对象是迭代器协议 obj——值域经 spread 消费断言
    expect(formatAbs(r.result)).toContain("[1]");
    expect(r.result.conf).toBe("exact");
  });
});

describe("whileSeq abstract condition joins possible exits", () => {
  it("abstract while does not keep only last body state as exact", () => {
    const src = `
export function f(n) {
  let i = 0;
  while (n > 10) { i = i + 1; }
  return i;
}
`;
    const absNumGt = { shape: { k: "prim", type: "number" }, conf: "path" } as never;
    const r = callAbs(src, "f", [absNumGt]);
    // 可能 0 次迭代出口与 body 后状态 join；不得只剩 exact 单成员 last state。
    // T5 Bug 48 修复后：抽象条件循环携带值 growth-widen 为无上界 prim 域
    //（旧 `0..8` sum 是 Bug 48 的假 exact 上界形状）。
    expect(formatShape(r.result)).not.toBe("8");
    expect(formatShape(r.result)).toBe("number");
  });
});
