/**
 * Wave 5 class-body 家族回归（Bug 58/59/60/77/78/79/80）：
 * - 59 实例字段：每次构造以新实例为 this 按源序求值（不再误编静态）
 * - 60 计算方法键：定义期求值（definite/may TypeError 表面），不静默挂 "method"
 * - 77 static 块：定义期执行（副作用 + throw 表面；this = 类值）
 * - 78 私有成员：#x/#m 混淆键建模，不再整模块 fail-closed
 * - 79 new.target：普通调用 undefined / 构造帧内类值（不再混编 import.meta）
 * - 80 类表达式：非空类体走 $class 机制（不再恒 unknown）
 * - 58 生成器：调用期全操作——体内 throw/may-throw 不泄漏进调用方 throws 域
 * 每条断言与 node 真实执行对齐（值域 + throws 域双钉）。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  formatAbs,
  abs,
  type Abs,
} from "@nudojs/core";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../may-throw.ts";

const anyAbs = abs({ k: "any" }, undefined, undefined, "path");
const strLit = (s: string): Abs =>
  abs({ k: "prim", type: "string" }, { op: "lit", value: s }, undefined, "exact");

/** 源级求值三面：值 / throws 面 / soft may-throw 效果 kind 集 */
function evalSrc(
  src: string,
  fnName: string,
  args: Abs[] = [],
): { value: string; throws: string; kinds: string[] } {
  const run = runTranspiled(src, { mode: "analyze" });
  const effects: MayThrowEffect[] = [];
  let result: { result?: Abs; throws?: Abs } = {};
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      result = callTranspiledExportFull(run, fnName, args) as { result?: Abs; throws?: Abs };
    } catch {
      /* 入口整抛：NudoThrow 由调用边界收成 throws 面 */
    }
    setMayThrowCollector(null);
  });
  const norm = (a: Abs | undefined): string =>
    (a ? formatAbs(a) : "").replace(/\s+#[a-z]+$/, "");
  return {
    value: norm(result.result),
    throws: norm(result.throws),
    kinds: [...new Set(effects.map((e) => e.kind))],
  };
}

describe("Bug 59: instance class fields initialize per construction on the instance", () => {
  it("field initializer never runs at class-definition time (entry total)", () => {
    const r = evalSrc(
      `export function fieldDef(x) { class C { p = x.a; } return 1; }`,
      "fieldDef",
      [anyAbs],
    );
    expect(r.value).toBe("1");
    expect(r.kinds).toEqual([]);
  });

  it("this in field initializer is the fresh instance; fields land on instances", () => {
    const r = evalSrc(
      `export function fieldThis() { class C { q = 1; p = this.q + 1; } return new C().p; }`,
      "fieldThis",
    );
    expect(r.value).toBe("2");
  });

  it("new C().p reads the instance field (was undefined)", () => {
    const r = evalSrc(
      `export function fieldRead() { class C { p = 1; } return new C().p; }`,
      "fieldRead",
    );
    expect(r.value).toBe("1");
  });

  it("base fields initialize before ctor body (ctor write wins)", () => {
    const r = evalSrc(
      `export function f() { class C { p = 1; constructor() { this.p = 2; } } return new C().p; }`,
      "f",
    );
    expect(r.value).toBe("2");
  });

  it("derived fields initialize after super chain (implicit + explicit ctor)", () => {
    const r = evalSrc(
      `export function derived() {
        class A { a = 1; constructor() { this.ac = 9; } }
        class B extends A { b = this.a + 1; }
        class D extends A { constructor() { super(); this.d = this.a + 2; } }
        return [new B().a, new B().b, new B().ac, new D().d];
      }`,
      "derived",
    );
    expect(r.value).toBe("[1, 2, 9, 3]");
  });

  it("field initializer may-throw surfaces at construction time", () => {
    const r = evalSrc(
      `export function fieldThrow(x) { class C { p = x.a; } return new C().p; }`,
      "fieldThrow",
      [anyAbs],
    );
    // 原生：x.a 在构造期求值——x 为 null 抛 TypeError；无抛时 .p 是成员值
    expect(r.kinds).toContain("TypeError");
  });

  it("static fields keep the modeled path (control)", () => {
    const r = evalSrc(
      `export function staticField() { class C { static p = 1; } return C.p; }`,
      "staticField",
    );
    expect(r.value).toBe("1");
  });
});

describe("Bug 60: computed method-name keys evaluate at definition time", () => {
  it("definite TypeError at definition ([null.x]())", () => {
    const r = evalSrc(
      `export function computedKeyDef() { class C { [null.x]() {} } return 1; }`,
      "computedKeyDef",
    );
    expect(r.value).toBe("never");
    expect(r.throws).toContain("TypeError");
  });

  it("may TypeError for abstract key ([x.a]() with unconstrained x)", () => {
    const r = evalSrc(
      `export function computedKeyAbs(x) { class C { [x.a]() {} } return 1; }`,
      "computedKeyAbs",
      [anyAbs],
    );
    expect(r.value).toBe("1");
    expect(r.kinds).toContain("TypeError");
  });

  it("concrete computed key installs under the real name (no silent \"method\")", () => {
    const r = evalSrc(
      `export function f(k) { class C { [k]() { return 7; } } return new C().m(); }`,
      "f",
      [strLit("m")],
    );
    expect(r.value).toBe("7");
  });

  it("numeric method key serializes to its ToPropertyKey name", () => {
    const r = evalSrc(
      `export function numericKey() { class C { [1]() { return 8; } } return new C()[1](); }`,
      "numericKey",
    );
    expect(r.value).toBe("8");
  });

  it("computed static field key evaluates at definition (definite TypeError)", () => {
    const r = evalSrc(
      `export function f() { class C { static [null.x] = 1; } return 1; }`,
      "f",
    );
    expect(r.value).toBe("never");
    expect(r.throws).toContain("TypeError");
  });
});

describe("Bug 77: static blocks execute at class-definition time", () => {
  it("side effects on enclosing bindings land at definition", () => {
    const r = evalSrc(
      `export function sideEffect() { let y = 0; class C { static { y = 5; } } return y; }`,
      "sideEffect",
    );
    expect(r.value).toBe("5");
  });

  it("definition-time throw surfaces (was silently throws=never)", () => {
    const r = evalSrc(
      `export function defThrow() { class C { static { throw 1; } } return 1; }`,
      "defThrow",
    );
    expect(r.value).toBe("never");
    expect(r.throws).toContain("1");
  });

  it("abstract member access in block is a may-throw", () => {
    const r = evalSrc(
      `export function defAbs(x) { class C { static { x.a; } } return 1; }`,
      "defAbs",
      [anyAbs],
    );
    expect(r.value).toBe("1");
    expect(r.kinds).toContain("TypeError");
  });

  it("this in a static block is the class value (writes land)", () => {
    const r = evalSrc(
      `export function f() { class C { static t = 0; static { this.t = 5; } } return C.t; }`,
      "f",
    );
    expect(r.value).toBe("5");
  });

  it("class name is visible inside the static block", () => {
    const r = evalSrc(
      `export function f() { class C { static n = 0; static { C.n = 3; } } return C.n; }`,
      "f",
    );
    expect(r.value).toBe("3");
  });
});

describe("Bug 78: private fields/methods modeled (no module-wide fail-closed)", () => {
  it("#x instance field read via this.#x", () => {
    const r = evalSrc(
      `export function privField() { class C { #x = 1; m() { return this.#x; } } return new C().m(); }`,
      "privField",
    );
    expect(r.value).toBe("1");
  });

  it("#m private method callable via this.#m()", () => {
    const r = evalSrc(
      `export function privMethod() { class C { #m() { return 2; } m() { return this.#m(); } } return new C().m(); }`,
      "privMethod",
    );
    expect(r.value).toBe("2");
  });

  it("this.#x = v write lands (per instance)", () => {
    const r = evalSrc(
      `export function privWrite() { class C { #x = 1; m(v) { this.#x = v; return this.#x; } } return new C().m(4); }`,
      "privWrite",
    );
    expect(r.value).toBe("4");
  });

  it("static #x readable via C.#x from a static accessor", () => {
    const r = evalSrc(
      `export function privStatic() { class C { static #x = 1; static get x() { return C.#x; } } return C.x; }`,
      "privStatic",
    );
    expect(r.value).toBe("1");
  });

  it("sibling exports stay exact (one private field no longer poisons the module)", () => {
    const r = evalSrc(
      `export function good() { return 1; }
       export function bad() { class C { #x = 1; m() { return this.#x; } } return new C().m(); }`,
      "good",
    );
    expect(r.value).toBe("1");
  });

  it("private method body throws keep their throw domain", () => {
    const r = evalSrc(
      `export function f() { class C { #m() { throw 1; } m() { return this.#m(); } } return new C().m(); }`,
      "f",
    );
    expect(r.value).toBe("never");
    expect(r.throws).toContain("1");
  });
});

describe("Bug 79: new.target is not import.meta", () => {
  it("new.target in a plain call is undefined (was { url: string })", () => {
    const r = evalSrc(
      `export function f() { function g() { return new.target; } return g(); }`,
      "f",
    );
    expect(r.value).toBe("undefined");
  });

  it("new.target inside a class constructor is the class (=== folds true)", () => {
    const r = evalSrc(
      `export class K { constructor() { this.t = new.target === K; } }
       export function useK() { return new K().t; }`,
      "useK",
    );
    expect(r.value).toBe("true");
  });

  it("nested plain call inside the ctor reads undefined (frame cleared)", () => {
    const r = evalSrc(
      `export class K { constructor() { const g = () => new.target; this.t = [new.target === K, g() === undefined]; } }
       export function useK() { return new K().t; }`,
      "useK",
    );
    expect(r.value).toBe("[true, true]");
  });

  it("import.meta keeps its { url: string } lowering (control)", () => {
    const r = evalSrc(`export function f() { return import.meta; }`, "f");
    expect(r.value).toBe("{ url: string }");
  });
});

describe("Bug 80: class expressions route through the class machinery", () => {
  it("method body computes (was unknown)", () => {
    const r = evalSrc(
      `export function f() { const A = class { m() { return 1; } }; return new A().m(); }`,
      "f",
    );
    expect(r.value).toBe("1");
  });

  it("throwing method body keeps its throw domain (was unknown, no throw)", () => {
    const r = evalSrc(
      `export function fThrow() { const A = class { m() { throw 1; } }; return new A().m(); }`,
      "fThrow",
    );
    expect(r.value).toBe("never");
    expect(r.throws).toContain("1");
  });

  it("named class expression scopes the inner name to the class", () => {
    const r = evalSrc(
      `export function fNamed() { const A = class X { static n() { return X.name; } }; return A.n(); }`,
      "fNamed",
    );
    expect(r.value).toBe('"X"');
  });

  it("empty class expression stays fn-shaped (pinned) and typeof works", () => {
    const r = evalSrc(
      `export function fEmpty() { const A = class {}; return typeof A; }`,
      "fEmpty",
    );
    expect(r.value).toBe('"function"');
  });

  it("class expression with ctor params constructs (instance fields too)", () => {
    const r = evalSrc(
      `export function fField() { const A = class { constructor(n) { this.n = n; } }; return new A(3).n; }`,
      "fField",
    );
    expect(r.value).toBe("3");
  });

  it("class expression instance fields land per construction", () => {
    const r = evalSrc(
      `export function fInst() { const A = class { p = 1; }; return new A().p; }`,
      "fInst",
    );
    expect(r.value).toBe("1");
  });

  it("class expression static block runs at definition", () => {
    const r = evalSrc(
      `export function fBlk() { let y = 0; const A = class { static { y = 6; } }; return y; }`,
      "fBlk",
    );
    expect(r.value).toBe("6");
  });
});

describe("Bug 58: generator calls are total (body throws deferred to iteration)", () => {
  it("explicit throw in body does not surface at call time", () => {
    const r = evalSrc(`export function* genThrow() { throw new Error("e"); }`, "genThrow");
    // Bug 22：生成器对象带迭代器协议面（无 yield 元素槽）；体内 throw 仍被
    // $gen 丢弃式帧吞掉（调用期不表面）
    expect(r.value).toContain("next");
    expect(r.kinds).toEqual([]);
    expect(r.throws).not.toContain("Error");
  });

  it("may-throw member access in body does not leak into the entry throws domain", () => {
    const r = evalSrc(
      `export function* genMember(x) { return x.a; }`,
      "genMember",
      [anyAbs],
    );
    expect(r.kinds).toEqual([]);
    expect(r.throws).not.toContain("TypeError");
  });

  it("async generator entries are total too", () => {
    const r = evalSrc(
      `export async function* asyncGenMember(x) { yield x.a; }`,
      "asyncGenMember",
      [anyAbs],
    );
    expect(r.kinds).toEqual([]);
  });

  it("yield collection stays eager (value domain unchanged)", () => {
    // Bug 22：生成器对象不再是 yield 元组数组——值域经原生迭代面（spread）
    // 断言 eager 收集口径不变
    const r = evalSrc(
      `export function* genYield() { yield 1; yield 2; }\nexport function spread() { return [...genYield()]; }`,
      "spread",
    );
    expect(r.value).toBe("[1, 2]");
  });

  it("generator function expression body does not run at call time", () => {
    const r = evalSrc(
      `export function f() { const g = function*() { throw 1; }; g(); return 9; }`,
      "f",
    );
    expect(r.value).toBe("9");
    expect(r.throws).not.toContain("1");
  });

  it("non-generator control: body member access still reports may-throw", () => {
    const r = evalSrc(
      `export function plainMember(x) { return x.a; }`,
      "plainMember",
      [anyAbs],
    );
    expect(r.kinds).toContain("TypeError");
  });
});
