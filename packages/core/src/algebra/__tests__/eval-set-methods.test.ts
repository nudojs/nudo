/**
 * Bug 28：ES2025 Set 方法族（union/intersection/difference/
 * symmetricDifference/isSubsetOf/isSupersetOf/isDisjointFrom）此前落
 * evalBuiltinInstanceMethod Set 臂 default → 调用 unknown：实参零校验
 * （native 对非对象 / .size NaN 对象 / .has·.keys 非 callable 全抛
 * TypeError），L2 静默假阴。修复：Set 臂 7 方法 case——enforceSetMethodArg
 * 三读校验（GetSetRecord：① 非对象；② ToNumber(.size) NaN / symbol·bigint；
 * ③ .has/.keys 非 callable）+ setMethodFold 值域折叠（双方条目表确切时
 * union 恒折；其余运算与 is* 谓词全字面量折 SameValueZero；Map 实参是
 * 键域语义——node 实测 set.union(map) = 元素 ∪ map 键，条目值不参与）。
 * 不可折 → 集合运算诚实 unknown / is* 抽象 boolean。
 *
 * Bug 31：Map/Set.prototype.forEach 此前无 GetCallback 前置校验——空接收者
 * 零迭代，非函数回调静默不抛；非空 + 对象回调形态同漏（$call 仅 prim
 * callee 定抛）。修复：派发点 validateCallableArg（Bug 55 数组 HOF 同口径，
 * 空接收者零迭代也抛）。
 * ground truth：node 26 原生实测（native 是 ground truth）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { checkSource } from "../check.ts";
import { litValue, anyAbs, type Abs } from "../abs.ts";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../may-throw.ts";

const METHODS = [
  "union",
  "intersection",
  "difference",
  "symmetricDifference",
  "isSubsetOf",
  "isSupersetOf",
  "isDisjointFrom",
] as const;

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
  return checkSource("/t/eval-set-methods.js", src);
}

/** L2 entry-may-throw issue 数 */
function l2Count(r: ReturnType<typeof checkSource>): number {
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

/** result 面 shape kind */
function shapeK(a: Abs | undefined): string {
  return a?.shape?.k ?? "?";
}

// ---------------------------------------------------------------------------
// Bug 28：ES2025 Set 方法实参校验（GetSetRecord 三读）
// ---------------------------------------------------------------------------

describe("Bug 28：非对象实参 → 定抛 TypeError（must be an object）", () => {
  it.each([...METHODS])("%s", (method) => {
    for (const arg of ["1", "true", "1n", "null", "undefined", "Symbol()", "Symbol.for('k')"]) {
      const expr = `new Set([1]).${method}(${arg})`;
      expectCaught(`export function f() { try { ${expr}; return "no-throw"; } catch (e) { return "caught"; } }`);
      expectThrows(`export function f() { ${expr}; }`, "TypeError");
    }
    // 缺省实参 ≡ undefined → 非对象
    expectCaught(`export function f() { try { new Set([1]).${method}(); return "no-throw"; } catch (e) { return "caught"; } }`);
  });
});

describe("Bug 28：无数值 .size 的对象实参 → 定抛 TypeError（.size is NaN）", () => {
  it.each([...METHODS])("%s", (method) => {
    for (const arg of ["{}", "[]", "[1]", "Object.create(null)"]) {
      const expr = `new Set([1]).${method}(${arg})`;
      expectCaught(`export function f() { try { ${expr}; return "no-throw"; } catch (e) { return "caught"; } }`);
      expectThrows(`export function f() { ${expr}; }`, "TypeError");
    }
  });
});

describe("Bug 28：不透明 brand/fn 实参 → 保守 may（WeakMap/Date 原生抛，brand 不可枚举）", () => {
  it.each([...METHODS])("%s", (method) => {
    for (const arg of ["new WeakMap()", "new Date()", "() => {}"]) {
      const src = `export function f() { try { new Set([1]).${method}(${arg}); return "no-throw"; } catch (e) { return "caught"; } }`;
      expect(val(src), src).toEqual({ ok: true, value: "no-throw" });
      expect(effects(`export function f(x) { x; return new Set([1]).${method}(${arg}); }`), src)
        .toContain("TypeError");
    }
  });
});

describe("Bug 28：duck-typed set-like 闭对象三读槽（native 合法形态）", () => {
  it("数值 .size + 可调用 .has/.keys 全过 → no-throw（node：union({size:3,has,keys}) 合法）", () => {
    const duck = "{ size: 3, has() { return true; }, keys() { return []; } }";
    for (const method of METHODS) {
      const src = `export function f() { try { new Set([1]).${method}(${duck}); return "no-throw"; } catch (e) { return "caught"; } }`;
      expect(val(src), src).toEqual({ ok: true, value: "no-throw" });
    }
  });

  it("可强转 .size 字面量（null→0 / \"3\"→3 / true→1）→ no-throw", () => {
    for (const size of ["null", '"3"', "true", '""']) {
      const duck = `{ size: ${size}, has() { return true; }, keys() { return []; } }`;
      const src = `export function f() { try { new Set([1]).union(${duck}); return "no-throw"; } catch (e) { return "caught"; } }`;
      expect(val(src), src).toEqual({ ok: true, value: "no-throw" });
    }
  });

  it(".size NaN / 不可解析字符串 / undefined → 定抛 TypeError", () => {
    for (const size of ["NaN", '"x"', "undefined"]) {
      const duck = `{ size: ${size}, has() { return true; }, keys() { return []; } }`;
      expectCaught(`export function f() { try { new Set([1]).union(${duck}); return "no-throw"; } catch (e) { return "caught"; } }`);
    }
  });

  it(".size symbol/bigint → ToNumber 定抛 TypeError（node 实测）", () => {
    for (const size of ["1n", "Symbol()"]) {
      const duck = `{ size: ${size}, has() { return true; }, keys() { return []; } }`;
      expectCaught(`export function f() { try { new Set([1]).union(${duck}); return "no-throw"; } catch (e) { return "caught"; } }`);
    }
  });

  it("缺 .has / 缺 .keys（undefined 非 callable）→ 定抛 TypeError", () => {
    expectCaught(`export function f() { try { new Set([1]).union({ size: 3 }); return "no-throw"; } catch (e) { return "caught"; } }`);
    expectCaught(`export function f() { try { new Set([1]).union({ size: 3, has() { return true; } }); return "no-throw"; } catch (e) { return "caught"; } }`);
    // .has 非函数形态
    expectCaught(`export function f() { try { new Set([1]).union({ size: 3, has: 1, keys() { return []; } }); return "no-throw"; } catch (e) { return "caught"; } }`);
  });
});

describe("Bug 28：Set/Map 实参控制组（合法，no-throw）", () => {
  it.each([...METHODS])("%s", (method) => {
    for (const arg of ["new Map()", "new Set([2])"]) {
      const src = `export function f() { try { new Set([1]).${method}(${arg}); return "no-throw"; } catch (e) { return "caught"; } }`;
      expect(val(src), src).toEqual({ ok: true, value: "no-throw" });
    }
  });
});

// ---------------------------------------------------------------------------
// Bug 28：值域折叠（setMethodFold）
// ---------------------------------------------------------------------------

describe("Bug 28：union/difference/intersection/symmetricDifference 折叠", () => {
  it("union：元素并 + SameValueZero 去重", () => {
    expect(val(`export function f() { return new Set([1, 2]).union(new Set([2, 3])).size; }`))
      .toEqual({ ok: true, value: 3 });
    expect(val(`export function f() { return new Set([1]).union(new Set([2])).has(2); }`))
      .toEqual({ ok: true, value: true });
    expect(val(`export function f() { return new Set([1]).union(new Set([2])).has(9); }`))
      .toEqual({ ok: true, value: false });
    // +0/-0 SameValueZero 同键
    expect(val(`export function f() { return new Set([0]).union(new Set([-0])).size; }`))
      .toEqual({ ok: true, value: 1 });
  });

  it("difference / intersection / symmetricDifference（全字面量折）", () => {
    expect(val(`export function f() { return new Set([1, 2]).difference(new Set([2])).size; }`))
      .toEqual({ ok: true, value: 1 });
    expect(val(`export function f() { return new Set([1, 2]).difference(new Set([2])).has(2); }`))
      .toEqual({ ok: true, value: false });
    expect(val(`export function f() { return new Set([1, 2]).intersection(new Set([2, 3])).size; }`))
      .toEqual({ ok: true, value: 1 });
    expect(val(`export function f() { return new Set([1, 2]).intersection(new Set([2, 3])).has(2); }`))
      .toEqual({ ok: true, value: true });
    expect(val(`export function f() { return new Set([1, 2]).symmetricDifference(new Set([2, 3])).size; }`))
      .toEqual({ ok: true, value: 2 });
    expect(val(`export function f() { return new Set([1, 2]).symmetricDifference(new Set([2, 3])).has(1); }`))
      .toEqual({ ok: true, value: true });
  });

  it("Map 实参是键域（GetSetRecord 迭代 other.keys()，条目值不参与）", () => {
    expect(val(`export function f() { return new Set([1]).union(new Map([[2, "a"]])).size; }`))
      .toEqual({ ok: true, value: 2 });
    expect(val(`export function f() { return new Set([1, 2]).difference(new Map([[1, "a"]])).size; }`))
      .toEqual({ ok: true, value: 1 });
    expect(val(`export function f() { return new Set([1, 2]).intersection(new Map([[2, "a"]])).size; }`))
      .toEqual({ ok: true, value: 1 });
    expect(val(`export function f() { return new Set([1]).isSubsetOf(new Map([[1, "a"], [2, "b"]])); }`))
      .toEqual({ ok: true, value: true });
  });

  it("is* 谓词折叠 boolean（含 NaN SameValueZero）", () => {
    expect(val(`export function f() { return new Set([1, 2]).isSubsetOf(new Set([1, 2, 3])); }`))
      .toEqual({ ok: true, value: true });
    expect(val(`export function f() { return new Set([1, 4]).isSubsetOf(new Set([1, 2, 3])); }`))
      .toEqual({ ok: true, value: false });
    expect(val(`export function f() { return new Set([1, 2]).isSupersetOf(new Set([1])); }`))
      .toEqual({ ok: true, value: true });
    expect(val(`export function f() { return new Set([1]).isSupersetOf(new Set([1, 2])); }`))
      .toEqual({ ok: true, value: false });
    expect(val(`export function f() { return new Set([1]).isDisjointFrom(new Set([2])); }`))
      .toEqual({ ok: true, value: true });
    expect(val(`export function f() { return new Set([1]).isDisjointFrom(new Set([1, 2])); }`))
      .toEqual({ ok: true, value: false });
    // NaN 相等（SameValueZero）：不自交
    expect(val(`export function f() { return new Set([NaN]).isDisjointFrom(new Set([NaN])); }`))
      .toEqual({ ok: true, value: false });
    // 空集边界
    expect(val(`export function f() { return new Set().isSubsetOf(new Set([1])); }`))
      .toEqual({ ok: true, value: true });
    expect(val(`export function f() { return new Set([1]).isSupersetOf(new Set()); }`))
      .toEqual({ ok: true, value: true });
  });

  it("诚实档：抽象实参不可折 → 集合运算 unknown / is* 抽象 boolean", () => {
    const r1 = run(`export function f(x) { return new Set([1]).union(x); }`, [anyAbs]);
    expect(shapeK(r1.result)).toBe("unknown");
    const r2 = run(`export function f(x) { return new Set([1]).isSubsetOf(x); }`, [anyAbs]);
    expect(shapeK(r2.result)).toBe("prim");
    expect((r2.result!.shape as { type?: string }).type).toBe("boolean");
    expect(r2.result!.term?.op).not.toBe("lit");
    // 抽象元素：union 恒折（表域口径——抽象元素计独立成员）
    expect(val(`export function f(x) { return new Set([x]).union(new Set([1])).size; }`, [anyAbs]))
      .toEqual({ ok: true, value: 2 });
    // 抽象元素：intersection 成员判定不可判 → 诚实 unknown
    const r3 = run(`export function f(x) { return new Set([x]).intersection(new Set([1])); }`, [anyAbs]);
    expect(shapeK(r3.result)).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// Bug 28：gate 面（L2 entry-may-throw）
// ---------------------------------------------------------------------------

describe("Bug 28：gate 面（checkSource L2）", () => {
  it("any 实参 → may TypeError 记入 L2", () => {
    expect(l2Count(check(`export function f(x) { return new Set([1]).union(x); }`))).toBe(1);
    expect(l2Count(check(`export function f(x) { return new Set([1]).isSubsetOf(x); }`))).toBe(1);
    expect(l2Count(check(`export function f(x) { return new Set([1]).difference(x); }`))).toBe(1);
  });

  it("定抛字面量 → throw-bridge 捕获进 L2（此前引擎不抛 → 无可捕获）", () => {
    expect(l2Count(check(`export function f() { return new Set([1]).union(1); }`))).toBeGreaterThan(0);
    expect(l2Count(check(`export function f() { return new Set([1]).union({}); }`))).toBeGreaterThan(0);
  });

  it("合法实参 → 不误报", () => {
    expect(l2Count(check(`export function f() { return new Set([1]).union(new Set([2])).size; }`))).toBe(0);
    expect(l2Count(check(`export function f() { return new Set([1]).isSubsetOf(new Set([1, 2])); }`))).toBe(0);
    expect(l2Count(check(`export function f() { return new Set([1]).union(new Map()).size; }`))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Bug 31：Map/Set.prototype.forEach GetCallback 前置校验
// ---------------------------------------------------------------------------

describe("Bug 31：非函数回调 → 定抛 TypeError（空接收者零迭代也抛）", () => {
  it.each([
    ["Map 空接收者 number", `new Map().forEach(1)`],
    ["Map 空接收者 null", `new Map().forEach(null)`],
    ["Map 空接收者对象", `new Map().forEach({})`],
    ["Map 空接收者字符串", `new Map().forEach("s")`],
    ["Map 缺省回调", `new Map().forEach()`],
    ["Set 空接收者 number", `new Set().forEach(1)`],
    ["Set 空接收者字符串", `new Set().forEach("s")`],
    ["Set 空接收者对象", `new Set().forEach({})`],
    ["Map 非空 prim 回调", `new Map([["a", 1]]).forEach(1)`],
    ["Map 非空对象回调", `new Map([["a", 1]]).forEach({})`],
    ["Set 非空对象回调", `new Set([1]).forEach({})`],
  ])("%s → TypeError", (_name, expr) => {
    expectCaught(`export function f() { try { ${expr}; return "no-throw"; } catch (e) { return "caught"; } }`);
    expectThrows(`export function f() { ${expr}; }`, "TypeError");
  });

  it("数组孪生控制组（Bug 55 口径不回退）", () => {
    expectCaught(`export function f() { try { [].forEach(1); return "no-throw"; } catch (e) { return "caught"; } }`);
  });
});

describe("Bug 31：合法回调控制组（执行副作用，不误抛）", () => {
  it("Map forEach 回调逐条目执行（值/键两参）", () => {
    expect(val(`export function f() { let n = 0; new Map([["a", 1], ["b", 2]]).forEach((v, k) => { n += v; }); return n; }`))
      .toEqual({ ok: true, value: 3 });
  });

  it("Set forEach 回调逐元素执行", () => {
    expect(val(`export function f() { let n = 0; new Set([5]).forEach((v) => { n += v; }); return n; }`))
      .toEqual({ ok: true, value: 5 });
  });

  it("空集合 + 合法回调 → no-throw 恒 undefined", () => {
    expect(val(`export function f() { try { new Map().forEach(() => {}); new Set().forEach(() => {}); return "no-throw"; } catch (e) { return "caught"; } }`))
      .toEqual({ ok: true, value: "no-throw" });
  });
});

describe("Bug 31：gate 面（checkSource L2）", () => {
  it("any 回调 + 空接收者 → may TypeError 记入 L2（此前静默）", () => {
    expect(l2Count(check(`export function f(x) { return new Map().forEach(x); }`))).toBe(1);
    expect(l2Count(check(`export function f(x) { return new Set().forEach(x); }`))).toBe(1);
  });

  it("定抛字面量回调 → 进 L2（空接收者此前静默）", () => {
    expect(l2Count(check(`export function f() { return new Map().forEach(1); }`))).toBeGreaterThan(0);
    expect(l2Count(check(`export function f() { return new Set().forEach(null); }`))).toBeGreaterThan(0);
  });

  it("合法回调 → 不误报", () => {
    expect(l2Count(check(`export function f() { return new Map([["a", 1]]).forEach((v) => v); }`))).toBe(0);
    expect(l2Count(check(`export function f() { return new Set([1]).forEach((v) => v); }`))).toBe(0);
  });
});
