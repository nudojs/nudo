/**
 * 函数边界缺参归一（Bug 7 / Bug 12）回归。
 *
 * Bug 7（部分传参）：省略的尾实参以宿主 undefined 流入函数体——
 *   `$add` 等算子读 .shape 崩溃被调用边界收成假 may-throw（`two(s)` 对
 *   `two(a, b)` 报 entry-may-throw），或经 return 通道泄漏裸 undefined
 *   （违反 TranspiledCallResult.result: Abs 不变量）。
 *   修复：宿主绑定元数内省略槽位按「显式传 undefined」语义归一为
 *   lit(undefined)——函数声明/类方法在体内 prologue 收形（$absVal），
 *   函数表达式/对象方法在 $fnVal apply 钩子按 impl.length 补齐。
 *
 * Bug 12（零参调用）：省略形参原以宿主 undefined 落进 $get 的宿主值
 *   回落分支折 unknown 且漏记 may-throw（确定抛被折成保证不抛——
 *   throws 域假阴性）。归一为 lit(undefined) 后 `$get`/解构守卫走
 *   nullish 硬抛（与显式传 undefined 实参同面）。
 *
 * 统一语义：省略 ≡ 显式传 undefined。红线：默认参照常取默认
 * （$orDefault 对 lit(undefined) 兼容）、rest 收 [] 不补、
 * `typeof` 折 "undefined"、arguments.length 不被补齐膨胀。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  litValue,
  anyAbs,
  checkSource,
  pTrue,
} from "@nudojs/core";

function run(src: string, args: Parameters<typeof callTranspiledExportFull>[2] = []) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, "go", args);
}

/** 结果字面量（NaN 经 JSON 序列化为 null，此处用原生值比较） */
function lit(r: ReturnType<typeof callTranspiledExportFull>): unknown {
  const v = litValue(r.result);
  return v.ok ? v.value : undefined;
}

function throwsName(r: ReturnType<typeof callTranspiledExportFull>): string {
  return r.throws.shape.k === "brand" ? (r.throws.shape as { name?: string }).name ?? "?" : r.throws.shape.k;
}

describe("Bug 7：部分传参——省略尾实参归一为 lit(undefined)", () => {
  it("内部调用 two(s)：值域 number|string，不再崩成 unknown（any 侧 may-throw 由 check 门记）", () => {
    const r = run(
      `function two(a, b) { return a + b; }\nexport function go(s) { return two(s); }`,
      [anyAbs],
    );
    // 修复前：$add 读宿主 undefined 的 .shape 崩溃 → result unknown + 假硬抛；
    // 修复后归一为 lit(undefined)：值域与 `any ⊕ any` 一致
    expect(r.result.shape.k).toBe("sum");
    // 原生 go("s") → "sundefined"（拼接臂）；go(5) → NaN（数值臂）
    expect(JSON.stringify(r.result.shape)).toContain('"number"');
    expect(JSON.stringify(r.result.shape)).toContain('"string"');
  });

  it("case 形态 cat(\"ab\")：折 \"abundefined\" 零 throws", () => {
    const r = run(`export function go(a, b) { return a + b; }`, [
      { shape: { k: "prim", type: "string" as const }, term: { op: "lit" as const, value: "ab" }, pred: pTrue, conf: "exact" as const },
    ]);
    expect(throwsName(r)).toBe("never");
    expect(lit(r)).toBe("abundefined");
  });

  it("引擎边界结果通道：two(\"x\") 的 result 是合法 Abs（lit undefined）", () => {
    const r = run(`function two(a, b) { return b; }\nexport function go() { return two("x"); }`);
    // 修复前 result 是宿主 undefined（formatAbs 读 .shape 即崩）
    expect(r.result).toBeTruthy();
    expect(typeof r.result).toBe("object");
    expect(r.result.shape.k).toBe("unknown");
    expect(lit(r)).toBeUndefined();
    expect(r.throws.shape.k).toBe("never");
  });

  it("check 门：go(s) 记诚实 may-throw（any 侧可为 Symbol，与 s+1 同口径）", () => {
    const r = checkSource(
      "/t/boundary-param.js",
      `function two(a, b) { return a + b; }\nexport function go(s) { return two(s); }`,
      pTrue,
      {},
    );
    // 归一后不再崩成 unknown 假硬抛；`undefined + any` 的 any 侧投射面
    //（Symbol → 原生 TypeError）按 any ⊕ any/any + 1 同口径记 entry-may-throw
    const l2 = r.issues.filter((i) => i.code === "nudo:entry-may-throw" && i.fn === "go");
    expect(l2.length).toBeGreaterThan(0);
    expect(r.signatures.find((s) => s.name === "go")?.display).toContain("number | string");
  });

  it("check 门红线：`s + 1` 的 any 投射面 may-throw policy 不变", () => {
    const r = checkSource(
      "/t/boundary-param-plusone.js",
      `export function plusOne(s) { return s + 1; }`,
      pTrue,
      {},
    );
    const l2 = r.issues.filter((i) => i.code === "nudo:entry-may-throw" && i.fn === "plusOne");
    expect(l2.length).toBeGreaterThan(0);
  });
});

describe("Bug 12：零参调用——省略形参的成员读/解构记 throws（不再 unknown 无抛）", () => {
  it("f(a){a.b} 零参 → throws TypeError（原生确定抛）", () => {
    const r = run(`export function go(a) { return a.b; }`, []);
    expect(throwsName(r)).toBe("TypeError");
    expect(r.result.shape.k).toBe("never");
  });

  it("g({x}) 零参 → 解构 undefined 硬抛 TypeError", () => {
    const r = run(`export function go({ x }) { return x; }`, []);
    expect(throwsName(r)).toBe("TypeError");
  });

  it("内部零参调用同面：f() 对 f(a){a.b}", () => {
    const r = run(
      `function f(a) { return a.b; }\nexport function go() { try { return f(); } catch (e) { return "caught"; } }`,
    );
    expect(lit(r)).toBe("caught");
    expect(r.throws.shape.k).toBe("never");
  });

  it("类方法零参同面：m(a){a.b}", () => {
    const r = run(
      `class C { m(a) { return a.b; } }\nexport function go() { try { return new C().m(); } catch (e) { return "caught"; } }`,
    );
    expect(lit(r)).toBe("caught");
  });
});

describe("边界归一红线（原生语义对照）", () => {
  it("默认参：省略 → 取默认（声明/箭头/方法）", () => {
    expect(lit(run(`function d(a, b = 5) { return a + b; }\nexport function go() { return d(1); }`))).toBe(6);
    expect(lit(run(`const d = (a, b = 5) => a + b;\nexport function go() { return d(1); }`))).toBe(6);
  });

  it("rest：省略 → 收 []（声明 arguments 切片 / 箭头宿主 rest）", () => {
    expect(lit(run(`function r(a, ...rest) { return rest.length; }\nexport function go() { return r(1); }`))).toBe(0);
    expect(lit(run(`const r = (a, ...rest) => rest.length;\nexport function go() { return r(1); }`))).toBe(0);
  });

  it("typeof 省略形参 → \"undefined\"", () => {
    expect(lit(run(`function f(a, b) { return typeof b; }\nexport function go() { return f(1); }`))).toBe("undefined");
  });

  it("arguments.length 不被补齐膨胀（f(1) → 1，非 2）", () => {
    expect(lit(run(`function f(a, b) { return arguments.length; }\nexport function go() { return f(1); }`))).toBe(1);
  });

  it("显式 undefined 实参语义不变：nullish 成员读硬抛，catch 可吸收", () => {
    const r = run(
      `export function go() { const f = (a) => { try { return a.b; } catch { return "caught"; } }; return f(undefined); }`,
    );
    expect(lit(r)).toBe("caught");
  });

  it("数组解构形参零参 → 迭代守卫硬抛（catch 可吸收）", () => {
    const r = run(
      `function f([a, b]) { return a; }\nexport function go() { try { return f(); } catch (e) { return "caught"; } }`,
    );
    expect(lit(r)).toBe("caught");
  });

  it("缺参数值域恒 NaN：声明/箭头/对象方法/类方法/静态/构造器", () => {
    expect(lit(run(`const add2 = (a, b) => a + b;\nexport function go() { return add2(1); }`))).toBeNaN();
    expect(lit(run(`function d(a, b) { return a + b; }\nexport function go() { return d(1); }`))).toBeNaN();
    expect(lit(run(`export function go() { const o = { m(a, b) { return a + b; } }; return o.m(1); }`))).toBeNaN();
    expect(lit(run(`class C { m(a, b) { return a + b; } }\nexport function go() { return new C().m(1); }`))).toBeNaN();
    expect(lit(run(`class C { static s(a, b) { return a + b; } }\nexport function go() { return C.s(1); }`))).toBeNaN();
    expect(lit(run(`class C { constructor(a, b) { this.s = a + b; } }\nexport function go() { return new C(1).s; }`))).toBeNaN();
  });

  it("hasThis+arguments 函数表达式：this/arguments/缺参共存（体内归一，钩子不补齐）", () => {
    // 原生：f.call(o, 1) → this.x=10 + a=1 + b=NaN + arguments.length=1 → NaN
    const r = run(
      `const o = { x: 10 }; const f = function (a, b) { return this.x + a + b + arguments.length; };\nexport function go() { return f.call(o, 1); }`,
    );
    expect(lit(r)).toBeNaN();
  });
});
