/**
 * Bug 37/38/39 回归：TypedArray/ArrayBuffer 成员面三案。
 *
 * - Bug 37：%TypedArray%.from(items, mapFn) —— mapFn GetMethod 前置校验
 *   此前完全缺失（args[1] 被忽略）：非函数 mapFn 不抛（native 先于任何
 *   元素映射定抛 TypeError）、L2 假阴（Array.from 孪生已正确记 may）。
 *   修复口径：validateCallableArg({undefinedOk}) 对齐 Array.from + 字面量
 *   元素（tuple items）的 mapper 逐元素执行（副作用/抛错传播）。
 * - Bug 38：%TypedArray%.prototype.set(source, offset) —— 原生三段校验
 *   （offset ToIndex / source ToObject / offset+srcLen>targetLen）此前全缺：
 *   定抛臂一律 no-throw、L2 假阴。修复口径：enforceToIndex + nullish 源
 *   TypeError + length 槽折叠的越界档；new <TA>(n) 数字长度入槽
 *   （enumerable:false，对齐原生不可枚举数据属性）。
 * - Bug 39：ArrayBuffer.prototype.resize —— 此前无派发：非 resizable 不抛
 *   TypeError、超 max 不抛 RangeError、resize 是 no-op（byteLength 保持
 *   构造值的 wrong-exact）。修复口径：resizable/ToIndex/超 max 三档 +
 *   成功臂 byteLength 槽原地更新（$set 引用语义惯例）。
 */
import { describe, it, expect } from "vitest";
// 相对路径引 src 引擎面（不经 @nudojs/core 别名——本 worktree 的 vite8
// 别名解析会把裸包名落到 dist 旧产物，同 eval-ta-hofs.test.ts）。
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { checkSource } from "../check.ts";
import { litValue, anyAbs, type Abs } from "../abs.ts";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../may-throw.ts";

function run(src: string, args: Abs[] = []) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, "f", args);
}

function val(src: string, args?: Abs[]) {
  return litValue(run(src, args).result);
}

/** 原生：定抛（try/catch 吸收后返回 "caught"） */
function expectCaught(src: string) {
  expect(val(src), `caught for: ${src}`).toEqual({ ok: true, value: "caught" });
}

/** 定抛：无 try/catch 时 throws 面是相应 Error brand */
function expectThrows(src: string, name: string) {
  const r = run(src);
  const got = r.throws?.shape?.k === "brand"
    ? (r.throws as { shape: { name: string } }).shape.name
    : r.throws?.shape?.k;
  expect(got, `throws ${name} for: ${src}`).toBe(name);
}

function check(src: string) {
  return checkSource("/t/eval-ta-members.js", src);
}

/** L2 entry-may-throw issue 数 */
function l2Count(r: ReturnType<typeof check>): number {
  return r.issues.filter((i) => i.code === "nudo:entry-may-throw").length;
}

/** any 实参运行时效果（may-throw 收集器面） */
function effects(src: string): string[] {
  const exports = runTranspiled(src, { mode: "analyze" });
  const eff: MayThrowEffect[] = [];
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => eff.push(e));
    try {
      callTranspiledExportFull(exports, "f", [anyAbs]);
    } catch {
      /* 入口整抛：效果经 throws 面表达 */
    }
    setMayThrowCollector(null);
  });
  return [...new Set(eff.map((e) => e.kind))];
}

// ---------------------------------------------------------------------------
// Bug 37：%TypedArray%.from(items, mapFn) mapFn IsCallable 前置校验
// ---------------------------------------------------------------------------

describe("Bug 37：TA from 非函数 mapFn 定抛 TypeError（GetMethod 前置）", () => {
  it.each([
    ["number", `Uint8Array.from([1], 1)`],
    ["null", `Uint8Array.from([1], null)`],
    ["string", `Uint8Array.from([1], "f")`],
    ["对象", `Uint8Array.from([1], {})`],
    ["数组", `Uint8Array.from([1], [1])`],
    ["布尔", `Uint8Array.from([1], true)`],
  ])("mapFn=%s → TypeError", (_name, expr) => {
    expectCaught(`export function f() { try { ${expr}; return "no-throw"; } catch (e) { return "caught"; } }`);
    expectThrows(`export function f() { ${expr}; }`, "TypeError");
  });

  it("BigInt 家族同口径", () => {
    expectCaught(`export function f() { try { BigInt64Array.from([1n], 1); return "no-throw"; } catch (e) { return "caught"; } }`);
    expectCaught(`export function f() { try { BigUint64Array.from(["1"], null); return "no-throw"; } catch (e) { return "caught"; } }`);
  });

  it("合法/缺省 mapFn 控制组（no-throw）", () => {
    expect(val(`export function f() { try { Uint8Array.from([1], x => x); return "no-throw"; } catch (e) { return "caught"; } }`))
      .toEqual({ ok: true, value: "no-throw" });
    expect(val(`export function f() { try { Uint8Array.from([1]); return "no-throw"; } catch (e) { return "caught"; } }`))
      .toEqual({ ok: true, value: "no-throw" });
    // 严格 undefined ≡ 无 mapper（原生 from([1],undefined).length === 1）
    expect(val(`export function f() { try { Uint8Array.from([1], undefined); return "no-throw"; } catch (e) { return "caught"; } }`))
      .toEqual({ ok: true, value: "no-throw" });
  });

  it("items 接收者面不回退（Bug 27 回归控制）", () => {
    expectCaught(`export function f() { try { Uint8Array.from(null); return "no-throw"; } catch (e) { return "caught"; } }`);
    expect(val(`export function f() { try { Uint8Array.from(Symbol()); return "no-throw"; } catch (e) { return "caught"; } }`))
      .toEqual({ ok: true, value: "no-throw" });
  });

  it("Array.from 孪生控制组（既有口径不回退）", () => {
    expectCaught(`export function f() { try { Array.from([1], 1); return "no-throw"; } catch (e) { return "caught"; } }`);
    expectCaught(`export function f() { try { Array.from([1], null); return "no-throw"; } catch (e) { return "caught"; } }`);
  });
});

describe("Bug 37：TA from 合法 mapper 逐元素执行（副作用/抛错传播）", () => {
  it("副作用计数器落地（tuple items 逐元素）", () => {
    expect(val(`export function f() { let n = 0; Uint8Array.from([1, 2, 3], x => { n += 1; return x; }); return n; }`))
      .toEqual({ ok: true, value: 3 });
  });

  it("mapper 体内抛错传播（definite RangeError）", () => {
    expectCaught(`export function f() { try { Uint8Array.from([1], () => { throw new RangeError("x"); }); return "no-throw"; } catch (e) { return "caught"; } }`);
    expectThrows(`export function f() { Uint8Array.from([1], () => { throw new RangeError("x"); }); }`, "RangeError");
  });
});

describe("Bug 37：L2 gate 面（any mapFn 记 may TypeError）", () => {
  it("Uint8Array.from([1], x) 记 may TypeError", () => {
    const src = `export function f(x) { return Uint8Array.from([1], x); }`;
    expect(l2Count(check(src))).toBeGreaterThan(0);
    expect(effects(src)).toContain("TypeError");
  });

  it("Array.from([1], x) 孪生已记（控制组不回退）", () => {
    const src = `export function f(x) { return Array.from([1], x); }`;
    expect(l2Count(check(src))).toBeGreaterThan(0);
    expect(effects(src)).toContain("TypeError");
  });
});

// ---------------------------------------------------------------------------
// Bug 38：%TypedArray%.prototype.set(source, offset)
// ---------------------------------------------------------------------------

describe("Bug 38：TA set offset ToIndex（负/越界定抛 RangeError）", () => {
  it.each([
    ["offset 超界", `new Uint8Array(8).set([1], 100)`],
    ["offset 负", `new Uint8Array(8).set([1], -1)`],
    ["offset Infinity", `new Uint8Array(8).set([1], Infinity)`],
    // 注：9 元素字面量超 TUPLE_LITERAL_CAP(8) 降 arr——长度不可判，
    // 引擎保守 may（见下方「widened 源」控制组），此处用可折叠短源
    ["源超长（缺省 offset）", `new Uint8Array(2).set([1, 2, 3])`],
    ["字符串源超长", `new Uint8Array(3).set("abcd")`],
    ["TA 源超长", `new Uint8Array(8).set(new Uint8Array(9))`],
    ["array-like 源超长", `new Uint8Array(2).set({ length: 3 })`],
    ["offset+源 越界", `new Uint8Array(8).set([1, 2, 3], 6)`],
  ])("%s → RangeError", (_name, expr) => {
    expectCaught(`export function f() { try { ${expr}; return "no-throw"; } catch (e) { return "caught"; } }`);
    expectThrows(`export function f() { ${expr}; }`, "RangeError");
  });

  it("widened 源（>8 元素字面量降 arr）：长度不可判 → 保守 may 不误报定抛", () => {
    // 原生定抛 RangeError；引擎 arr 源长度未知 → may 档（值面 no-throw
    // 是既定 widened-literal 不精确口径，gate 面记 may RangeError）
    const src = `export function f(x) { return new Uint8Array(8).set([1, 2, 3, 4, 5, 6, 7, 8, 9]); }`;
    expect(val(`export function f() { try { new Uint8Array(8).set([1, 2, 3, 4, 5, 6, 7, 8, 9]); return "no-throw"; } catch (e) { return "caught"; } }`))
      .toEqual({ ok: true, value: "no-throw" });
    expect(effects(src)).toContain("RangeError");
  });

  it("offset symbol/bigint → TypeError（ToNumber 定抛）", () => {
    expectCaught(`export function f() { try { new Uint8Array(8).set([1], Symbol()); return "no-throw"; } catch (e) { return "caught"; } }`);
    expectThrows(`export function f() { new Uint8Array(8).set([1], Symbol()); }`, "TypeError");
    expectCaught(`export function f() { try { new Uint8Array(8).set([1], 1n); return "no-throw"; } catch (e) { return "caught"; } }`);
  });
});

describe("Bug 38：TA set source ToObject（nullish 定抛 TypeError）", () => {
  it.each([
    ["null 源", `new Uint8Array(8).set(null)`],
    ["undefined 源", `new Uint8Array(8).set(undefined)`],
    ["缺省源", `new Uint8Array(8).set()`],
  ])("%s → TypeError", (_name, expr) => {
    expectCaught(`export function f() { try { ${expr}; return "no-throw"; } catch (e) { return "caught"; } }`);
    expectThrows(`export function f() { ${expr}; }`, "TypeError");
  });

  it("控制组：装箱/无长度源 no-throw + 返回 undefined", () => {
    expect(val(`export function f() { try { return new Uint8Array(8).set(1); } catch (e) { return "caught"; } }`))
      .toEqual({ ok: true, value: undefined });
    expect(val(`export function f() { try { new Uint8Array(8).set(Symbol()); return "no-throw"; } catch (e) { return "caught"; } }`))
      .toEqual({ ok: true, value: "no-throw" });
    expect(val(`export function f() { try { new Uint8Array(3).set("abc"); return "no-throw"; } catch (e) { return "caught"; } }`))
      .toEqual({ ok: true, value: "no-throw" });
    expect(val(`export function f() { try { new Uint8Array(8).set([1], 0); return "no-throw"; } catch (e) { return "caught"; } }`))
      .toEqual({ ok: true, value: "no-throw" });
    expect(val(`export function f() { try { new Uint8Array(8).set([1, 2, 3], 5); return "no-throw"; } catch (e) { return "caught"; } }`))
      .toEqual({ ok: true, value: "no-throw" });
  });

  it("BigInt 家族 set 同口径", () => {
    expectCaught(`export function f() { try { new BigInt64Array(2).set([1n, 2n, 3n]); return "no-throw"; } catch (e) { return "caught"; } }`);
    expectCaught(`export function f() { try { new BigUint64Array(2).set(null); return "no-throw"; } catch (e) { return "caught"; } }`);
  });
});

describe("Bug 38：new <TA>(n) 数字 length 入槽", () => {
  it("length 精确折叠（原生不可枚举自有数据属性）", () => {
    expect(val(`export function f() { return new Uint8Array(8).length; }`))
      .toEqual({ ok: true, value: 8 });
    expect(val(`export function f() { return new Float64Array(2).length; }`))
      .toEqual({ ok: true, value: 2 });
    // ToIndex 截断：2.5 → 2（原生同）
    expect(val(`export function f() { return new Uint8Array(2.5).length; }`))
      .toEqual({ ok: true, value: 2 });
    expect(val(`export function f() { return new Uint8Array("4").length; }`))
      .toEqual({ ok: true, value: 4 });
  });

  it("length 不入枚举视图（Object.keys / for-in 保持空）", () => {
    // Object.keys(ta) 折空 tuple（exact）——length 槽 enumerable:false +
    // TA 家族入 BUILTIN_BRAND_NO_ENUM_KEYS
    const r = run(`export function f() { return Object.keys(new Uint8Array(8)); }`);
    expect(r.result.shape.k).toBe("tuple");
    expect((r.result.shape as { elements: unknown[] }).elements.length).toBe(0);
    expect(val(`export function f() { const ks = []; for (const k in new Uint8Array(8)) { ks.push(k); } return ks.length; }`))
      .toEqual({ ok: true, value: 0 });
  });
});

describe("Bug 38：L2 gate 面（any offset/source 记 may）", () => {
  it("set([1], x) 记 may RangeError", () => {
    const src = `export function f(x) { return new Uint8Array(8).set([1], x); }`;
    expect(l2Count(check(src))).toBeGreaterThan(0);
    expect(effects(src)).toContain("RangeError");
  });

  it("set(x) 记 may TypeError（ToObject）", () => {
    const src = `export function f(x) { return new Uint8Array(8).set(x); }`;
    expect(effects(src)).toContain("TypeError");
  });
});

// ---------------------------------------------------------------------------
// Bug 39：ArrayBuffer.prototype.resize
// ---------------------------------------------------------------------------

describe("Bug 39：resize 非 resizable 缓冲定抛 TypeError", () => {
  it.each([
    ["无 options", `new ArrayBuffer(8).resize(4)`],
    ["maxByteLength 缺省 undefined", `new ArrayBuffer(8, { maxByteLength: undefined }).resize(4)`],
    ["newLength symbol（resizable 检查先行）", `new ArrayBuffer(8).resize(Symbol())`],
  ])("%s → TypeError", (_name, expr) => {
    expectCaught(`export function f() { try { ${expr}; return "no-throw"; } catch (e) { return "caught"; } }`);
    expectThrows(`export function f() { ${expr}; }`, "TypeError");
  });
});

describe("Bug 39：resize newLength 校验（ToIndex / 超 max → RangeError）", () => {
  it.each([
    ["超 max", `new ArrayBuffer(8, { maxByteLength: 16 }).resize(17)`],
    ["负", `new ArrayBuffer(8, { maxByteLength: 16 }).resize(-1)`],
    ["Infinity", `new ArrayBuffer(8, { maxByteLength: 16 }).resize(Infinity)`],
  ])("%s → RangeError", (_name, expr) => {
    expectCaught(`export function f() { try { ${expr}; return "no-throw"; } catch (e) { return "caught"; } }`);
    expectThrows(`export function f() { ${expr}; }`, "RangeError");
  });

  it("resizable 缓冲 + symbol newLength → TypeError（ToNumber 定抛，node 实测）", () => {
    expectCaught(`export function f() { try { new ArrayBuffer(8, { maxByteLength: 16 }).resize(Symbol()); return "no-throw"; } catch (e) { return "caught"; } }`);
    expectThrows(`export function f() { new ArrayBuffer(8, { maxByteLength: 16 }).resize(Symbol()); }`, "TypeError");
  });

  it("构造期校验不回退（既有 Bug 15/41 控制组）", () => {
    expectCaught(`export function f() { try { new ArrayBuffer(8, { maxByteLength: 2 }); return "no-throw"; } catch (e) { return "caught"; } }`);
    expectCaught(`export function f() { try { new ArrayBuffer(-1); return "no-throw"; } catch (e) { return "caught"; } }`);
  });
});

describe("Bug 39：合法 resize 更新 byteLength（字面量折叠）+ 返回 undefined", () => {
  it("b.resize(4); b.byteLength → 4（不再保持构造值 8）", () => {
    expect(val(`export function f() { const b = new ArrayBuffer(8, { maxByteLength: 16 }); b.resize(4); return b.byteLength; }`))
      .toEqual({ ok: true, value: 4 });
  });

  it("缩到 max 边界值 / 缺省 newLength → 0", () => {
    expect(val(`export function f() { const b = new ArrayBuffer(8, { maxByteLength: 16 }); b.resize(16); return b.byteLength; }`))
      .toEqual({ ok: true, value: 16 });
    expect(val(`export function f() { const b = new ArrayBuffer(8, { maxByteLength: 16 }); b.resize(); return b.byteLength; }`))
      .toEqual({ ok: true, value: 0 });
  });

  it("连续 resize 取末值；构造时 byteLength 不受影响", () => {
    expect(val(`export function f() { const b = new ArrayBuffer(8, { maxByteLength: 16 }); b.resize(4); b.resize(9); return b.byteLength; }`))
      .toEqual({ ok: true, value: 9 });
    expect(val(`export function f() { return new ArrayBuffer(8).byteLength; }`))
      .toEqual({ ok: true, value: 8 });
  });

  it("resize 恒返 undefined", () => {
    expect(val(`export function f() { const b = new ArrayBuffer(8, { maxByteLength: 16 }); return b.resize(4); }`))
      .toEqual({ ok: true, value: undefined });
  });

  it("槽面控制组：resizable/maxByteLength 不回退", () => {
    expect(val(`export function f() { return new ArrayBuffer(8).resizable; }`))
      .toEqual({ ok: true, value: false });
    expect(val(`export function f() { return new ArrayBuffer(8, { maxByteLength: 16 }).maxByteLength; }`))
      .toEqual({ ok: true, value: 16 });
  });
});

describe("Bug 39：L2 gate 面", () => {
  it("非 resizable + any newLength → 定抛 TypeError 进 L2", () => {
    const src = `export function f(x) { const b = new ArrayBuffer(8); return b.resize(x); }`;
    expect(l2Count(check(src))).toBeGreaterThan(0);
    expectThrows(`export function f(x) { const b = new ArrayBuffer(8); b.resize(x); }`, "TypeError");
  });

  it("resizable + any newLength → may RangeError（不误记 TypeError）", () => {
    const src = `export function f(x) { const b = new ArrayBuffer(8, { maxByteLength: 16 }); return b.resize(x); }`;
    expect(effects(src)).toContain("RangeError");
    expect(effects(src)).not.toContain("TypeError");
  });

  it("options 抽象（undecidable）→ may TypeError + may RangeError", () => {
    const src = `export function f(o) { const b = new ArrayBuffer(8, o); return b.resize(4); }`;
    expect(effects(src)).toContain("TypeError");
    expect(effects(src)).toContain("RangeError");
  });
});
