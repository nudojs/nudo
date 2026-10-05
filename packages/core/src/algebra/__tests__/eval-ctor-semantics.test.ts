/**
 * 类定义/构造语义回归（wave 4 — Bugs 9/11）：
 * - Bug 9：非构造函数值的 new（箭头/generator/async/async-generator/方法）——
 *   原生 definite TypeError；引擎此前执行调用并报 throws=never。
 *   fn shape 新增可构造性 facet（ctor?: boolean，joinNote 纪律：不进等价）。
 * - Bug 11：class extends 非构造器——原生在类定义期求值 superclass，非
 *   null/构造器即 TypeError；引擎此前静默丢弃 extends。hasExtends 标记区分
 *   `extends undefined` 与无 extends 子句；extends null 定义合法但 new 抛
 *   （隐式/显式 super()）。
 *
 * 原生 ground truth：node v26（TypeError 以原生为准）。
 * 断言三面：value（值域）/ throws（NudoThrow 边界收成面）/ effects（recordMayThrow 软效果）。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $lit,
  anyAbs,
  formatAbs,
  absFunction,
  $new,
} from "@nudojs/core";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../exec/may-throw.ts";
import { hostFnCtorFacet } from "../abs-fn.ts";

/** 源级求值：返回 { value, throws, effects } 三面（conf 标注剥离） */
function evalSrc(
  src: string,
  fnName = "f",
  args: unknown[] = [anyAbs],
): { value: string; throws: string; effects: string[] } {
  const run = runTranspiled(src, { mode: "analyze" });
  const effects: MayThrowEffect[] = [];
  let result: { result?: unknown; throws?: unknown } = {};
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      result = callTranspiledExportFull(run, fnName, args as never[]) as never;
    } catch {
      /* 入口整抛：效果经 throws 面表达 */
    }
    setMayThrowCollector(null);
  });
  const norm = (a: unknown): string => formatAbs(a as never)?.replace(/\s+#[a-z]+$/, "") ?? "";
  return {
    value: norm(result.result ?? $lit(undefined)),
    throws: norm(result.throws),
    effects: [...new Set(effects.map((e) => e.kind))],
  };
}

// --- Bug 9：非构造函数值的 new ---------------------------------------------

describe("Bug 9: new on non-constructible function values", () => {
  it("arrow / generator / async / async-generator / method → definite TypeError (native: TypeError)", () => {
    const cases: Array<[string, string]> = [
      ["arrow", `export function f() { const a = () => 1; return new a(); }`],
      ["arrow-expr-body", `export function f() { const a = () => ({ x: 1 }); return new a(); }`],
      ["generator-decl", `export function f() { function* g() { yield 1; } return new g(); }`],
      ["generator-expr", `export function f() { const g = function* () { yield 1; }; return new g(); }`],
      ["async-arrow", `export function f() { const a = async () => 1; return new a(); }`],
      ["async-decl", `export function f() { async function af() { return 1; } return new af(); }`],
      ["async-expr", `export function f() { const af = async function () { return 1; }; return new af(); }`],
      ["object-method", `export function f() { const o = { m() { return 1; } }; return new o.m(); }`],
      ["class-method-value", `export class K { m() { return 1; } } export function f() { const k = new K(); return new k.m(); }`],
    ];
    for (const [label, src] of cases) {
      const r = evalSrc(src, "f", []);
      expect(r.throws, label).toContain("TypeError");
      expect(r.value, label).toBe("never");
      expect(r.effects, label).toEqual([]);
    }
  });

  it("regular function declaration stays constructible (control)", () => {
    const r = evalSrc(
      `export function f() { function a() { this.x = 1; } return new a(); }`,
      "f",
      [],
    );
    expect(r.throws).toBe("never");
    expect(r.value).toContain("a");
  });

  it("function expression value is constructible → instance brand (native: instance, no throw)", () => {
    const r = evalSrc(
      `export function f() { return new (function fe() { this.x = 1; })(); }`,
      "f",
      [],
    );
    expect(r.throws).toBe("never");
    expect(r.value).not.toBe("never");
  });

  it("class expression value is constructible", () => {
    const r = evalSrc(
      `export function f() { const K = class { constructor() { this.x = 1; } }; return new K(); }`,
      "f",
      [],
    );
    // $classExpr 是 fn 形状（ctor: true）→ 空 brand 实例（host fn 分支同口径）
    expect(r.throws).toBe("never");
    expect(r.value).not.toBe("never");
  });

  it("plain class declaration construct stays exact (control)", () => {
    const r = evalSrc(
      `export class C { constructor() { this.x = 1; } }
       export function f() { return new C(); }`,
      "f",
      [],
    );
    expect(r.throws).toBe("never");
    expect(r.value).toContain("C");
  });

  it("calls (not constructions) on arrow/method stay exact (controls)", () => {
    const arrow = evalSrc(
      `export function f(cb) { const a = () => 1; return a(); }`,
      "f",
      [],
    );
    expect(arrow.value).toBe("1");
    expect(arrow.throws).toBe("never");

    const method = evalSrc(
      `export function f() { const o = { m() { return 1; } }; return o.m(); }`,
      "f",
      [],
    );
    expect(method.value).toBe("1");
    expect(method.throws).toBe("never");
  });

  it("unknown constructibility (apply-hooked fn, mock-shaped) → may-throw, value domain unchanged", () => {
    const effects: MayThrowEffect[] = [];
    let value = "";
    runWithMayThrowSession(() => {
      setMayThrowCollector((e) => effects.push(e));
      // mock 形 fn：absFunction + apply、无 ctor facet
      const mockFn = absFunction(["x"], { apply: (args) => args[0] ?? $lit(1) });
      const r = $new(mockFn, []);
      value = formatAbs(r);
      setMayThrowCollector(null);
    });
    expect(effects.map((e) => e.kind)).toContain("TypeError");
    expect(value).not.toBe("never");
  });

  it("fn shape ctor facet is stamped by absFunction opts and ignored elsewhere", () => {
    const nonCtor = absFunction(["x"], { apply: (args) => args[0] ?? $lit(1) }, { ctor: false });
    expect((nonCtor.shape as { ctor?: boolean }).ctor).toBe(false);
    const ctor = absFunction(["x"], { apply: (args) => args[0] ?? $lit(1) }, { ctor: true });
    expect((ctor.shape as { ctor?: boolean }).ctor).toBe(true);
    const unknown = absFunction(["x"], { apply: (args) => args[0] ?? $lit(1) });
    expect((unknown.shape as { ctor?: boolean }).ctor).toBeUndefined();
  });

  it("hostFnCtorFacet: generator/async/arrow/bound vs regular", () => {
    function* gen() { yield 1; }
    async function af() { return 1; }
    async function* agen() { yield 1; }
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const arrow = () => 1;
    function regular() { return 1; }
    const bound = regular.bind(null);
    expect(hostFnCtorFacet(gen)).toBe(false);
    expect(hostFnCtorFacet(af)).toBe(false);
    expect(hostFnCtorFacet(agen)).toBe(false);
    expect(hostFnCtorFacet(arrow)).toBe(false);
    expect(hostFnCtorFacet(regular)).toBe(true);
    expect(hostFnCtorFacet(bound)).toBeUndefined();
    const marked = function m() { return 1; } as { __nudoNonCtor?: unknown };
    marked.__nudoNonCtor = 1;
    expect(hostFnCtorFacet(marked as never)).toBe(false);
  });
});

// --- Bug 11：class extends 非构造器 ----------------------------------------

describe("Bug 11: class extends non-constructor", () => {
  it("prim / undefined / string / arrow superclass → definite TypeError at definition (native: TypeError)", () => {
    for (const sup of ["1", "undefined", '"s"', "(() => 1)"]) {
      const r = evalSrc(
        `export function f() { class C extends ${sup} {} return 1; }`,
        "f",
        [],
      );
      expect(r.throws, `extends ${sup}`).toContain("TypeError");
      expect(r.value, `extends ${sup}`).toBe("never");
      expect(r.effects, `extends ${sup}`).toEqual([]);
    }
  });

  it("object superclass → may TypeError (value domain unchanged)", () => {
    const r = evalSrc(`export function f() { class C extends {} {} return 1; }`, "f", []);
    expect(r.effects).toContain("TypeError");
    expect(r.value).toBe("1");
    expect(r.throws).toBe("never");
  });

  it("unconstrained param superclass → may TypeError", () => {
    const r = evalSrc(`export function f(P) { class C extends P {} return 1; }`, "f", [anyAbs]);
    expect(r.effects).toContain("TypeError");
    expect(r.value).toBe("1");
    expect(r.throws).toBe("never");
  });

  it("generator function superclass → definite TypeError (extends facet of Bug 9)", () => {
    const r = evalSrc(
      `export function f() { function* g() {} class C extends g {} return 1; }`,
      "f",
      [],
    );
    expect(r.throws).toContain("TypeError");
    expect(r.value).toBe("never");
  });

  it("extends null is legal at definition; new C() throws via implicit/explicit super()", () => {
    const def = evalSrc(`export function f() { class C extends null {} return 1; }`, "f", []);
    expect(def.throws).toBe("never");
    expect(def.effects).toEqual([]);
    expect(def.value).toBe("1");

    const implicitNew = evalSrc(
      `export function f() { class C extends null {} return new C(); }`,
      "f",
      [],
    );
    expect(implicitNew.throws).toContain("TypeError");
    expect(implicitNew.value).toBe("never");

    const explicitSuper = evalSrc(
      `export function f() { class C extends null { constructor() { super(); } } return new C(); }`,
      "f",
      [],
    );
    expect(explicitSuper.throws).toContain("TypeError");
    expect(explicitSuper.value).toBe("never");
  });

  it("controls: extends host ctor / identifier chain stay total", () => {
    const hostCtor = evalSrc(`export function f() { class C extends Map {} return 1; }`, "f", []);
    expect(hostCtor.throws).toBe("never");
    expect(hostCtor.value).toBe("1");

    const chain = evalSrc(
      `export function f() { class A {} class B extends A {} return new B(); }`,
      "f",
      [],
    );
    expect(chain.throws).toBe("never");
    expect(chain.value).toContain("B");
  });

  it("no-extends plain class stays total and exact (control)", () => {
    const r = evalSrc(
      `export function f() { class C { constructor() { this.x = 1; } } return new C(); }`,
      "f",
      [],
    );
    expect(r.throws).toBe("never");
    expect(r.value).toContain("C");
  });
});

// --- 跨模块桥接（bindImport wrapper 不得误判构造性） ------------------------

describe("Bug 9/11: import bridge constructibility", () => {
  /** 经 modules 注入 + __nudoBindImport（真 wrapper 路径）求值 */
  function evalWithModule(fnAbs: unknown): { value: string; throws: string } {
    const src = `import { F } from "./lib.js";\nexport function f() { return new F(); }`;
    const run = runTranspiled(src, {
      mode: "analyze",
      modules: { "./lib.js": { named: { F: fnAbs as never } } },
    });
    const r = callTranspiledExportFull(run, "f", []);
    const norm = (a: unknown): string =>
      formatAbs(a as never)?.replace(/\s+#[a-z]+$/, "") ?? "";
    return { value: norm(r.result), throws: norm(r.throws) };
  }

  it("imported regular function is constructible (wrapper must not read as arrow)", () => {
    // lib 导出构造函数 → 桥接 fn ctor:true；bindImport 包成 JS 可调用 wrapper
    //（箭头）——$new 须回 Abs 派发（__nudoAbsFn），不得按箭头误判假抛。
    const ctorFn = absFunction([], { apply: () => $lit(1) }, { ctor: true });
    const r = evalWithModule(ctorFn);
    expect(r.throws).toBe("never");
    expect(r.value).not.toBe("never");
  });

  it("imported arrow stays non-constructible through the wrapper", () => {
    const arrow = absFunction([], { apply: () => $lit(1) }, { ctor: false });
    const r = evalWithModule(arrow);
    expect(r.throws).toContain("TypeError");
    expect(r.value).toBe("never");
  });
});
