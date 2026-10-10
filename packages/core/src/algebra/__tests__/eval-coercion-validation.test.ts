/**
 * 强制转换/回调校验三连回归（Bug 24 / 29 / 30）：
 * - Bug 24：`String(x)` 补 ToPrimitive 校验——null-proto 无 coercer 对象
 *   定抛 TypeError（node 实测 `String(Object.create(null))` 抛），抽象臂
 *   （any/obj/fn/brand/sum）may TypeError——与 `Number(x)`（Bug 50）/
 *   `parseInt` 同口径；symbol/字面量全定不受影响；
 * - Bug 29：`new Function(x)` 补构造器形 ToString 校验（Symbol 定抛 /
 *   抽象 may）——$new 宿主分支（exec/class.ts）与 evalBuiltinNew（Abs 面）
 *   双面同口径；调用形 `Function(x)` 经 callHostGlobalLiteralOnly 已覆盖
 *   （控制组回归）；
 * - Bug 30：`queueMicrotask(x)` 补 IsCallable 校验（非可调用定抛 TypeError /
 *   抽象 may）——never-exec 守卫 fail-closed **前置**校验（回调仍不执行，
 *   unknown#opaque 口径不变；setTimeout/fetch 等名单其余成员原生接受任意
 *   首实参，无校验可言——控制组回归）。
 *
 * node 实测 ground truth：
 *   String(Object.create(null)) → TypeError（Cannot convert object to primitive）
 *   String({toString(){throw}}) → 用户 throw 传播（静态面记 may TypeError）
 *   new Function(Symbol()) → TypeError（Cannot convert a Symbol value to a string）
 *   queueMicrotask(1/null/undefined/true/1n/Symbol()/{} ) → TypeError
 *   queueMicrotask(() => {}) / setTimeout(x, 0) → 不抛
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { checkSource } from "../check.ts";
import { pTrue } from "../pred.ts";
import { abs, litValue, type Abs } from "../abs.ts";
import { runWithMayThrowSession, setMayThrowCollector, type MayThrowEffect } from "../exec/may-throw.ts";
import { withStdImport, stdOpts } from "./nudo-constraints.ts";

function evalAbs(
  src: string,
  args: unknown[] = [],
  fnName = "f",
): { result: Abs | undefined; throws: unknown; effects: string[] } {
  const run = runTranspiled(src, { mode: "analyze" });
  const effects: MayThrowEffect[] = [];
  let out: { result?: unknown; throws?: unknown } = {};
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      out = callTranspiledExportFull(run, fnName, args as never[]) as never;
    } catch {
      /* 入口整抛：throws 面表达 */
    }
    setMayThrowCollector(null);
  });
  return {
    result: out.result as Abs | undefined,
    throws: out.throws,
    effects: [...new Set(effects.map((e) => e.kind))],
  };
}

/** 无参入口（体内自含实参）；带抽象参入口（x: any） */
function evalAny(src: string, fnName = "f"): ReturnType<typeof evalAbs> {
  return evalAbs(src, [abs({ k: "any" }, undefined, undefined, "path")], fnName);
}

function litOf(a: Abs | undefined): unknown {
  const r = a ? litValue(a) : undefined;
  return r?.ok ? r.value : undefined;
}

function isNever(a: unknown): boolean {
  const s = a as { shape?: { k?: string } };
  return !!s && typeof s === "object" && s.shape?.k === "never";
}

function check(src: string) {
  return checkSource("/t/eval-coercion-validation.js", withStdImport(src), pTrue, stdOpts);
}

function l2Of(r: ReturnType<typeof check>, fn?: string) {
  return r.issues.filter((i) => i.code === "nudo:entry-may-throw" && (!fn || i.fn === fn));
}

// --- Bug 24：String(x) ToPrimitive -----------------------------------------

describe("Bug 24: String(x) 补 ToPrimitive 校验", () => {
  it("null-proto 无 coercer 对象 → 定抛 TypeError（原生同款）", () => {
    const r = evalAbs(
      `export function f() { try { return String(Object.create(null)); } catch (e) { return e.constructor.name; } }`,
    );
    expect(litOf(r.result)).toBe("TypeError");
    expect(r.effects).toEqual([]);
  });

  it("null-proto 带 coercer 槽 → 不定抛；带 coercer / 闭 obj → may TypeError（无 try 面）", () => {
    // 原生：Object.assign(Object.create(null), {toString(){return "hi"}})
    // → "hi" 不抛——自有 coercer 在，不定抛；静态面记 may（槽体未知）
    const coer = evalAbs(
      `export function f() { const o = Object.create(null); o.toString = () => "hi"; return String(o); }`,
    );
    expect(isNever(coer.result)).toBe(false);
    expect(coer.effects).toContain("TypeError");
    // {toString(){throw}}：ToPrimitive 可能抛（用户 coercer 体）——may
    const obj = evalAbs(
      `export function f() { return String({ toString() { throw new Error("boom"); } }); }`,
    );
    expect(obj.effects).toContain("TypeError");
    expect(isNever(obj.result)).toBe(false);
    // {a:1}：无自有 coercer 但走 Object.prototype——原生折 "[object Object]"
    // 不抛；引擎与 Number(x) 抽象 obj 臂同口径记 may（共享 mayCoerceThrowOperand）
    const plain = evalAbs(`export function f() { return String({ a: 1 }); }`);
    expect(plain.effects).toContain("TypeError");
    expect(isNever(plain.result)).toBe(false);
  });

  it("全定臂保持折叠：字面量 / symbol / 缺省零效果", () => {
    for (const [src, want] of [
      [`export function f() { return String(1); }`, "1"],
      [`export function f() { return String(null); }`, "null"],
      [`export function f() { return String(undefined); }`, "undefined"],
      [`export function f() { return String(); }`, ""],
      [`export function f() { return String(Symbol("s")); }`, "Symbol(s)"],
      [`export function f() { return String(1n); }`, "1"],
    ] as const) {
      const r = evalAbs(src);
      expect(litOf(r.result), src).toBe(want);
      expect(r.effects, src).toEqual([]);
    }
  });

  it("抽象实参（x: any）→ may TypeError；fn 形折叠 / brand 形记 may", () => {
    const r = evalAny(`export function f(x) { return String(x); }`);
    expect(r.effects).toContain("TypeError");
    expect(isNever(r.result)).toBe(false);
    // fn 形实参（ToPrimitive 走 Function.prototype.toString，体未知）——
    // mayCoerceThrowOperand 记 may（模块级 export 声明读是另一特例，不在面内）
    const fn = evalAbs(`export function f() { const g = function () {}; return String(g); }`);
    expect(fn.effects).toContain("TypeError");
    expect(isNever(fn.result)).toBe(false);
    const arrow = evalAbs(`export function f() { return String(() => 1); }`);
    expect(arrow.effects).toContain("TypeError");
    // brand 形：ToPrimitive 走原型 toString（体未知）——mayCoerceThrowOperand 记 may
    const brand = evalAbs(`export function f() { return String(new Date(0)); }`);
    expect(brand.effects).toContain("TypeError");
  });

  it("L2 gate：String(x) 报 entry-may-throw；定抛形与字面量控制组", () => {
    const abs = evalAny(`export function f(x) { return String(x); }`); // 运行面已验
    expect(abs.effects).toContain("TypeError");
    const r = check(`export function f(x) { return String(x); }`);
    const l2 = l2Of(r, "f");
    expect(l2.length).toBeGreaterThan(0);
    expect(l2[0]!.message).toContain("TypeError");
    // 定抛形（null-proto）经 entry 抛面报 TypeError
    const bad = check(
      `export function h() { return String(Object.create(null)); }`,
    );
    const l2b = l2Of(bad, "h");
    expect(l2b.length).toBeGreaterThan(0);
    expect(l2b[0]!.message).toContain("TypeError");
    // 控制组：全定字面量零 L2
    const ok = check(`export function g() { return String(1); }`);
    expect(l2Of(ok, "g")).toEqual([]);
  });
});

// --- Bug 29：new Function(x) ToString --------------------------------------

describe("Bug 29: new Function(x) 补构造器形 ToString 校验", () => {
  it("new Function(Symbol()) → 定抛 TypeError（原生同款）", () => {
    const r = evalAbs(
      `export function f() { try { return new Function(Symbol()); } catch (e) { return e.constructor.name; } }`,
    );
    expect(litOf(r.result)).toBe("TypeError");
    expect(r.effects).toEqual([]);
  });

  it("合法实参不抛：bigint/null/字符串体；动态代码值域 unknown（同 eval 口径）", () => {
    for (const src of [
      `export function f() { try { new Function(1n); return "no-throw"; } catch (e) { return e.constructor.name; } }`,
      `export function f() { try { new Function(null); return "no-throw"; } catch (e) { return e.constructor.name; } }`,
      `export function f() { try { new Function(); return "no-throw"; } catch (e) { return e.constructor.name; } }`,
    ]) {
      const r = evalAbs(src);
      expect(litOf(r.result), src).toBe("no-throw");
      expect(r.effects, src).toEqual([]);
    }
    const dyn = evalAbs(`export function f() { return new Function("return 41 + 1")(); }`);
    expect(isNever(dyn.result)).toBe(false);
    expect(litOf(dyn.result)).toBeUndefined(); // 动态体不可静态求值
  });

  it("抽象实参（x: any）→ may TypeError（构造器形与调用形同口径）", () => {
    const r = evalAny(`export function f(x) { return new Function(x); }`);
    expect(r.effects).toContain("TypeError");
    expect(isNever(r.result)).toBe(false);
  });

  it("L2 gate：new Function(x) 报 entry-may-throw（此前静默）；调用形控制组", () => {
    const r = check(`export function f(x) { return new Function(x); }`);
    const l2 = l2Of(r, "f");
    expect(l2.length).toBeGreaterThan(0);
    expect(l2[0]!.message).toContain("TypeError");
    // 定抛形
    const bad = check(`export function h() { return new Function(Symbol()); }`);
    const l2b = l2Of(bad, "h");
    expect(l2b.length).toBeGreaterThan(0);
    expect(l2b[0]!.message).toContain("TypeError");
    // 控制组：字面量体零 L2
    const ok = check(`export function g() { return new Function("return 1"); }`);
    expect(l2Of(ok, "g")).toEqual([]);
    // 调用形（既有覆盖）保持报
    const callForm = check(`export function c(x) { return Function(x); }`);
    const l2c = l2Of(callForm, "c");
    expect(l2c.length).toBeGreaterThan(0);
  });
});

// --- Bug 30：queueMicrotask(x) IsCallable -----------------------------------

describe("Bug 30: queueMicrotask(x) 补 IsCallable 校验", () => {
  it("非可调用实参 → 定抛 TypeError（原生同款）", () => {
    for (const arg of ["1", "null", "undefined", "true", "1n", "Symbol()", "{}"]) {
      const src = `export function f() { try { queueMicrotask(${arg}); return "no-throw"; } catch (e) { return e.constructor.name; } }`;
      const r = evalAbs(src);
      expect(litOf(r.result), arg).toBe("TypeError");
      expect(r.effects, arg).toEqual([]);
    }
  });

  it("缺省实参同抛；可调用实参控制组零效果不抛（回调仍不执行）", () => {
    const miss = evalAbs(
      `export function f() { try { queueMicrotask(); return "no-throw"; } catch (e) { return e.constructor.name; } }`,
    );
    expect(litOf(miss.result)).toBe("TypeError");
    const ok = evalAbs(
      `export function f() { try { queueMicrotask(() => {}); return "no-throw"; } catch (e) { return e.constructor.name; } }`,
    );
    expect(litOf(ok.result)).toBe("no-throw");
    expect(ok.effects).toEqual([]);
    const okFnVar = evalAbs(
      `export function cb() {} export function f() { try { queueMicrotask(cb); return "no-throw"; } catch (e) { return e.constructor.name; } }`,
    );
    expect(litOf(okFnVar.result)).toBe("no-throw");
  });

  it("抽象实参（x: any）→ may TypeError；open obj 同记", () => {
    const r = evalAny(`export function f(x) { queueMicrotask(x); }`);
    expect(r.effects).toContain("TypeError");
    const open = evalAbs(`export function f(x) { queueMicrotask(x); }`, [
      abs({ k: "obj", slots: {}, open: true } as never, undefined, undefined, "path"),
    ]);
    expect(open.effects).toContain("TypeError");
  });

  it("L2 gate：queueMicrotask(x)/queueMicrotask(1) 报；可调用与 setTimeout 控制组静默", () => {
    const r = check(`export function f(x) { queueMicrotask(x); }`);
    const l2 = l2Of(r, "f");
    expect(l2.length).toBeGreaterThan(0);
    expect(l2[0]!.message).toContain("TypeError");
    const bad = check(`export function h() { queueMicrotask(1); }`);
    const l2b = l2Of(bad, "h");
    expect(l2b.length).toBeGreaterThan(0);
    expect(l2b[0]!.message).toContain("TypeError");
    // 可调用实参：无 L2
    const ok = check(`export function g() { queueMicrotask(() => {}); }`);
    expect(l2Of(ok, "g")).toEqual([]);
    // setTimeout 名单其余成员：原生接受任意首实参——设计上静默（对照）
    const timer = check(`export function t(x) { setTimeout(x, 0); }`);
    expect(l2Of(timer, "t")).toEqual([]);
  });
});
