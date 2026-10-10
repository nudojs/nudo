/**
 * Bug 10 / Bug 32 回归：obj/arr/tuple 被调者的调用面与构造面。
 *
 * Bug 10：$callDispatch 非函数 callee 臂此前只分两档（prim/nullish-lit 定抛
 * tier 1、any 记 may-throw tier 2），obj/arr/tuple 字面量被调者落尾
 * return unknown——原生 `({})()` / `[]()` 定抛 TypeError（… is not a
 * function），引擎静默成功；L2 gate 对 `const o = {}; o()`（定抛）假阴性，
 * 而 `1()` / `null()` 反而正确报。桥接论据空置：attachFnImpl 只产 fn 形状
 * Abs——obj/arr/tuple 从不携带调用面 → 定抛。
 *
 * Bug 32：$new 的 !spec 落空只校验 fn 形（ctor 旗标），obj/arr/tuple 被调者
 * 直落 $call（同 Bug 10 缺口）→ `new ({})()` 静默成功。原生 [[Construct]]
 * 先做 IsConstructor(C)——obj/arr/tuple 恒非构造器 → 定抛 TypeError
 * （… is not a constructor）。
 *
 * brand（new Proxy(fn,{apply/construct}) 的合法可调对象逃逸）与 unknown
 * （fail-closed 令牌）维持原口径；fn/class/builtin 合法面不回退（对照组）。
 */
import { describe, it, expect } from "vitest";
// 相对路径引 src 引擎面（不经 @nudojs/core 别名——本 worktree 的 vite8
// 别名解析会把裸包名落到 dist 旧产物，同 eval-len-nullish.test.ts）。
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { checkSource } from "../check.ts";
import { pTrue } from "../pred.ts";
import { litValue, anyAbs, type Abs } from "../abs.ts";
import { withStdImport, stdOpts } from "./nudo-constraints.ts";

function run(src: string, args: Abs[] = []) {
  const exports = runTranspiled(src, { mode: "analyze", maxLoopIters: 2000 });
  return callTranspiledExportFull(exports, "f", args);
}

function val(src: string, args?: Abs[]) {
  return litValue(run(src, args).result);
}

/** 原生：非可调用被调者定抛 TypeError（catch 面接住） */
function expectCaught(src: string) {
  expect(val(src), `caught for: ${src}`).toEqual({ ok: true, value: "caught" });
}

/** 定抛 TypeError：throws 面是 TypeError brand（无 try/catch 时） */
function expectTypeError(src: string) {
  const r = run(src);
  const name = r.throws?.shape?.k === "brand"
    ? (r.throws as { shape: { name: string } }).shape.name
    : r.throws?.shape?.k;
  expect(name, `throws for: ${src}`).toBe("TypeError");
}

function check(src: string) {
  return checkSource("/t/eval-non-callable.js", withStdImport(src), pTrue, stdOpts);
}

/** L2 entry-may-throw issue 数（按函数名过滤） */
function l2Issues(r: ReturnType<typeof check>, fn: string) {
  return r.issues.filter((i) => i.code === "nudo:entry-may-throw" && i.fn === fn);
}

function expectMayThrowTypeErr(src: string) {
  const issues = l2Issues(check(src), "f");
  expect(issues.length, `L2 issues for: ${src}`).toBeGreaterThan(0);
  expect(issues.some((i) => i.message.includes("TypeError"))).toBe(true);
}

describe("Bug 10：调用 obj/arr/tuple 被调者定抛 TypeError", () => {
  it("({})() in try/catch → caught", () => {
    expectCaught(
      `export function f() { try { const o = {}; o(); return "no-throw"; } catch (e) { return "caught"; } }`,
    );
  });

  it("({x:1})() → caught", () => {
    expectCaught(
      `export function f() { try { const o = { x: 1 }; o(); return "no-throw"; } catch (e) { return "caught"; } }`,
    );
  });

  it("[]() → caught（tuple 0 元）", () => {
    expectCaught(
      `export function f() { try { const a = []; a(); return "no-throw"; } catch (e) { return "caught"; } }`,
    );
  });

  it("[1]() → caught（tuple 1 元）", () => {
    expectCaught(
      `export function f() { try { const a = [1]; a(); return "no-throw"; } catch (e) { return "caught"; } }`,
    );
  });

  it("const o = {}; o() 无 try/catch → throws 面 TypeError", () => {
    expectTypeError(`export function f() { const o = {}; o(); }`);
  });

  it("const a = []; a() 无 try/catch → throws 面 TypeError", () => {
    expectTypeError(`export function f() { const a = []; a(); }`);
  });

  it("union callee（fn | obj 成员，c: any）保守定抛（与 prim 成员同口径）", () => {
    const r = run(
      `export function f(c) { const g = c ? () => 1 : {}; try { return g(); } catch (e) { return "caught"; } }`,
      [anyAbs],
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "caught" });
  });
});

describe("Bug 10：合法调用面不回退", () => {
  it("箭头函数值直调保持精确", () => {
    expect(val(`export function f() { const g = () => 7; return g(); }`)).toEqual({
      ok: true,
      value: 7,
    });
  });

  it("对象方法调用保持精确", () => {
    expect(
      val(`export function f() { const o = { g: () => 3 }; return o.g(); }`),
    ).toEqual({ ok: true, value: 3 });
  });

  it("function 声明调用保持精确", () => {
    expect(
      val(`export function f() { return helper(); } function helper() { return 5; }`),
    ).toEqual({ ok: true, value: 5 });
  });

  it("内建调用保持精确（Math.max）", () => {
    expect(val(`export function f() { return Math.max(1, 2); }`)).toEqual({
      ok: true,
      value: 2,
    });
  });

  it("any callee（入口参 x()）运行面保守不硬抛（may-throw 记录而非定抛）", () => {
    const r = run(`export function f(x) { try { return x(); } catch (e) { return "caught"; } }`, [
      anyAbs,
    ]);
    expect(litValue(r.result), `result for any callee: ${JSON.stringify(r.result)}`).not.toEqual({
      ok: true,
      value: "caught",
    });
  });
});

describe("Bug 10：L2 gate（definite TypeError 不再假阴性）", () => {
  it("const o = {}; o() → entry-may-throw TypeError", () => {
    expectMayThrowTypeErr(`export function f() { const o = {}; return o(); }`);
  });

  it("const a = []; a() → entry-may-throw TypeError", () => {
    expectMayThrowTypeErr(`export function f() { const a = []; return a(); }`);
  });

  it("对照：return 1(); → 已正确报（既有 tier 1）", () => {
    expectMayThrowTypeErr(`export function f() { return 1(); }`);
  });

  it("对照：return null(); → 已正确报（既有 tier 1）", () => {
    expectMayThrowTypeErr(`export function f() { return null(); }`);
  });

  it("对照：x()（x: any）→ 已正确报（既有 tier 2）", () => {
    expectMayThrowTypeErr(`export function f(x) { return x(); }`);
  });

  it("合法面：fn 直调不记 may-throw", () => {
    const r = check(`export function f() { const g = () => 1; return g(); }`);
    expect(l2Issues(r, "f").length).toBe(0);
  });
});

describe("Bug 32：new obj/arr/tuple 被调者定抛 TypeError", () => {
  it("new ({})(1) → caught", () => {
    expectCaught(
      `export function f() { try { new ({})(1); return "no-throw"; } catch (e) { return "caught"; } }`,
    );
  });

  it("new ({}) → caught", () => {
    expectCaught(
      `export function f() { try { new ({}); return "no-throw"; } catch (e) { return "caught"; } }`,
    );
  });

  it("new ([]) → caught", () => {
    expectCaught(
      `export function f() { try { new ([]); return "no-throw"; } catch (e) { return "caught"; } }`,
    );
  });

  it("new ([1]) → caught", () => {
    expectCaught(
      `export function f() { try { new ([1]); return "no-throw"; } catch (e) { return "caught"; } }`,
    );
  });

  it("new (Object.create({}))() → caught", () => {
    expectCaught(
      `export function f() { try { const o = Object.create({}); new (o)(); return "no-throw"; } catch (e) { return "caught"; } }`,
    );
  });

  it("new (Object.create(null))() → caught", () => {
    expectCaught(
      `export function f() { try { const o = Object.create(null); new (o)(); return "no-throw"; } catch (e) { return "caught"; } }`,
    );
  });

  it("new (JSON.parse(\"{}\"))() → caught", () => {
    expectCaught(
      `export function f() { try { const o = JSON.parse("{}"); new (o)(); return "no-throw"; } catch (e) { return "caught"; } }`,
    );
  });

  it("spread 实参：new ({})(...[1,2]) → caught", () => {
    expectCaught(
      `export function f() { try { const o = {}; new (o)(...[1, 2]); return "no-throw"; } catch (e) { return "caught"; } }`,
    );
  });

  it("new ({})(1) 无 try/catch → throws 面 TypeError", () => {
    expectTypeError(`export function f() { const o = {}; new (o)(1); }`);
  });

  it("union 构造 callee（class | obj 成员，c: any）保守定抛（与 prim 成员同口径）", () => {
    const r = run(
      `export function f(c) { const C = c ? class {} : {}; try { new (C)(); return "no-throw"; } catch (e) { return "caught"; } }`,
      [anyAbs],
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "caught" });
  });
});

describe("Bug 32：合法构造面不回退", () => {
  it("new (class {})() → 对象不抛", () => {
    const r = run(`export function f() { const C = class {}; return new (C)(); }`);
    expect(r.throws?.shape?.k ?? "never", `throws for class new`).toBe("never");
    expect(r.result.shape.k === "brand" || r.result.shape.k === "obj").toBe(true);
  });

  it("new (function(){})() → 对象不抛", () => {
    const r = run(`export function f() { const C = function () {}; return new (C)(); }`);
    expect(r.throws?.shape?.k ?? "never", `throws for fn-ctor new`).toBe("never");
    expect(r.result.shape.k === "brand" || r.result.shape.k === "obj").toBe(true);
  });

  it("class ctor 传参保持精确", () => {
    const r = run(
      `export function f() { const C = class { constructor(x) { this.x = x; } }; return new (C)(5).x; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 5 });
  });

  it("内建构造器 new Map() 保持 brand", () => {
    const r = run(`export function f() { return new Map(); }`);
    expect(r.throws?.shape?.k ?? "never").toBe("never");
    expect(r.result.shape.k).toBe("brand");
  });
});

describe("Bug 32：L2 gate（definite TypeError 不再假阴性）", () => {
  it("new ({})() → entry-may-throw TypeError", () => {
    expectMayThrowTypeErr(`export function f() { const o = {}; return new (o)(); }`);
  });

  it("new ([])() → entry-may-throw TypeError", () => {
    expectMayThrowTypeErr(`export function f() { const a = []; return new (a)(); }`);
  });

  it("对照：new (x)()（x: any）→ 已正确报（$call any 通道）", () => {
    expectMayThrowTypeErr(`export function f(x) { return new (x)(); }`);
  });

  it("合法面：new (class {})() 不记 may-throw", () => {
    const r = check(`export function f() { const C = class {}; return new (C)(); }`);
    expect(l2Issues(r, "f").length).toBe(0);
  });
});
