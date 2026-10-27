/**
 * 件 C：回调/闭包 body 编译注入——compiledBodyOf 解析自由标识符：
 * impl.env.vars → Abs 注入；impl.env.fns → absFunction 包装注入（调用走
 * $callNamed → applyAbsFn，递归预算/解释语义保留）；不可解析（全局名/
 * 自递归名）→ 回落解释路径。
 */
import { describe, it, expect } from "vitest";
import { $call } from "../exec/call.ts";
import { freeIdentifiers } from "../exec/body-fn.ts";
import { absFunction, getFnImpl } from "../abs-fn.ts";
import { boolLit, litValue, numLit } from "@nudojs/core";
import { parseSource } from "../parse-source.ts";
import { emptyEnv } from "../ast-env.ts";

function declOf(src: string, name: string) {
  const file = parseSource(`function ${name}(x) { ${src} }`);
  return (file.program.body as Array<{ type: string; id?: { name: string }; params: Array<{ name?: string }>; body: never }>).find(
    (s) => s.type === "FunctionDeclaration" && s.id?.name === name,
  )!;
}

/** 无参（或指定形参）函数 body——块作用域回归用（declOf 固定带形参 x）。 */
function bodyOf(src: string, params = "", name = "f") {
  const file = parseSource(`function ${name}(${params}) { ${src} }`);
  const decl = (file.program.body as Array<{ type: string; params: Array<{ name?: string }>; body: never }>)[0]!;
  return decl.body;
}

describe("compiled body closure injection (件 C)", () => {
  it("sibling const captured from impl.env.vars", () => {
    const decl = declOf("return x + k;", "f");
    const env = emptyEnv();
    env.vars.set("k", numLit(2));
    const f = absFunction(["x"], { body: decl.body, env });
    expect(litValue($call(f, [numLit(5)]))).toEqual({ ok: true, value: 7 });
  });

  it("sibling function captured from impl.env.fns (interpreted inside)", () => {
    const helperFile = parseSource(`function helper(n) { return n * 2; }`);
    const helperDecl = (helperFile.program.body as Array<{ type: string; id?: { name: string }; params: Array<{ name?: string }>; body: never }>)[0]!;
    const decl = declOf("return helper(x) + 1;", "f");
    const env = emptyEnv();
    env.fns.set("helper", { params: ["n"], body: helperDecl.body, async: false });
    const f = absFunction(["x"], { body: decl.body, env });
    expect(litValue($call(f, [numLit(5)]))).toEqual({ ok: true, value: 11 });
  });

  it("nested arrow closure capturing outer param compiles", () => {
    // 内层 g 的 env 含 x —— 直接对 g 的 impl 编译
    const gBody = parseSource(`function g() { return x + 1; }`).program.body[0] as never;
    const inner = (gBody as { body: never }).body;
    const env = emptyEnv();
    env.vars.set("x", numLit(10));
    const g = absFunction([], { body: inner, env });
    expect(litValue($call(g, []))).toEqual({ ok: true, value: 11 });
  });

  it("unresolvable free name compiles and throws ReferenceError (native parity)", () => {
    const decl = declOf("return x + mysteryGlobal;", "f");
    const f = absFunction(["x"], { body: decl.body, env: emptyEnv() });
    let threw = false;
    try {
      $call(f, [numLit(5)]);
    } catch (e) {
      threw = e instanceof ReferenceError;
    }
    expect(threw).toBe(true);
  });

  it("self-recursive body with env self-name computes under budget", () => {
    const file = parseSource(`function fac(n) { if (n <= 1) { return 1; } return n * fac(n - 1); }`);
    const decl = (file.program.body as Array<{ type: string; params: Array<{ name?: string }>; body: never }>)[0]!;
    const env = emptyEnv();
    env.fns.set("fac", { params: ["n"], body: decl.body, async: false });
    const f = absFunction(["n"], { body: decl.body, env });
    expect(litValue($call(f, [numLit(5)]))).toEqual({ ok: true, value: 120 });
    // 无界自递归：cycle 键命中 → opaque，不爆栈。
    // f 实参必须是函数值：wave-1 起 $call 对 prim 字面量 callee 抛
    // TypeError（原生语义），number 实参会在 f() 处先行抛出、测不到递归预算
    const file2 = parseSource(`function forever(f) { f(); return forever(f); }`);
    const decl2 = (file2.program.body as Array<{ type: string; params: Array<{ name?: string }>; body: never }>)[0]!;
    const env2 = emptyEnv();
    env2.fns.set("forever", { params: ["f"], body: decl2.body, async: false });
    const forever = absFunction(["f"], { body: decl2.body, env: env2 });
    const noop = absFunction([], { body: declOf("return 1;", "noop").body, env: emptyEnv() });
    const r2 = $call(forever, [noop]);
    expect(r2.conf).toBe("opaque");
  });
});

describe("block-scoped free variables (let/const/var/for/catch/static-block/class)", () => {
  it("let inside a block does not shadow an outer same-name closure binding", () => {
    // 复现：旧 freeIdentifiers 把 let 当函数作用域 ⇒ 不注入闭包 x ⇒
    // 编译产物 return x 读宿主全局 ⇒ ReferenceError（应返回 42）。
    const body = bodyOf("{ let x = 1; } return x;");
    const env = emptyEnv();
    env.vars.set("x", numLit(42));
    const f = absFunction([], { body, env });
    expect(litValue($call(f, []))).toEqual({ ok: true, value: 42 });
    expect(freeIdentifiers(body, []).has("x")).toBe(true);
  });

  it("for-head let binding does not leak past the loop", () => {
    const body = bodyOf("for (let x = 0; x < 1; x++) {} return x;");
    const env = emptyEnv();
    env.vars.set("x", numLit(42));
    const f = absFunction([], { body, env });
    expect(litValue($call(f, []))).toEqual({ ok: true, value: 42 });
    expect(freeIdentifiers(body, []).has("x")).toBe(true);
  });

  it("const inside if-block does not shadow an outer same-name binding", () => {
    const body = bodyOf("if (c) { const y = 1; } return y;", "c");
    const env = emptyEnv();
    env.vars.set("y", numLit(42));
    const f = absFunction(["c"], { body, env });
    expect(litValue($call(f, [boolLit(true)]))).toEqual({ ok: true, value: 42 });
    expect(litValue($call(f, [boolLit(false)]))).toEqual({ ok: true, value: 42 });
    expect(freeIdentifiers(body, ["c"]).has("y")).toBe(true);
  });

  it("catch param shadows the closure binding inside the handler only", () => {
    const body = bodyOf("try { throw 7; } catch (e) { return e; }");
    const env = emptyEnv();
    env.vars.set("e", numLit(42));
    const f = absFunction([], { body, env });
    expect(litValue($call(f, []))).toEqual({ ok: true, value: 7 });

    const after = bodyOf("try { throw 1; } catch (e) { } return e;");
    const g = absFunction([], { body: after, env });
    expect(litValue($call(g, []))).toEqual({ ok: true, value: 42 });
    expect(freeIdentifiers(after, []).has("e")).toBe(true);
  });

  it("nested function params do not leak to the outer scope", () => {
    const body = bodyOf("function g(b) { return b; } return g(1) + a;", "a");
    const f = absFunction(["a"], { body });
    expect(litValue($call(f, [numLit(5)]))).toEqual({ ok: true, value: 6 });
    expect(freeIdentifiers(body, ["a"]).has("b")).toBe(false);

    const leaking = bodyOf("function g(b) { return 1; } return b;");
    expect(freeIdentifiers(leaking, []).has("b")).toBe(true);
  });

  it("var inside a block hoists to the function scope", () => {
    const body = bodyOf("{ var v = 1; } return v;");
    expect(freeIdentifiers(body, []).has("v")).toBe(false);
    const env = emptyEnv();
    env.vars.set("v", numLit(42));
    const f = absFunction([], { body, env });
    expect(litValue($call(f, []))).toEqual({ ok: true, value: 1 });
  });

  it("switch case let bindings are scoped to the switch block", () => {
    const body = bodyOf("switch (c) { case 1: let w = 2; break; } return w;", "c");
    expect(freeIdentifiers(body, ["c"]).has("w")).toBe(true);
    const env = emptyEnv();
    env.vars.set("w", numLit(42));
    const f = absFunction(["c"], { body, env });
    expect(litValue($call(f, [numLit(1)]))).toEqual({ ok: true, value: 42 });
  });

  it("class static block is its own var scope (var does not leak to the caller)", () => {
    // 复现：StaticBlock 曾按普通 BlockStatement 压块 ⇒ var helper 被声明到
    // 外层函数作用域 ⇒ 不注入闭包 helper ⇒ return helper 抛 ReferenceError。
    const body = bodyOf("class C { static { var helper = 1; } } return helper;");
    expect(freeIdentifiers(body, []).has("helper")).toBe(true);
    const env = emptyEnv();
    env.vars.set("helper", numLit(42));
    const f = absFunction([], { body, env });
    expect(litValue($call(f, []))).toEqual({ ok: true, value: 42 });
  });

  it("class-body block functions get no Annex B hoisting even for sloppy source", () => {
    const body = bodyOf(
      "class C { static m() { { function g() { return 3; } } return g(); } } return C.m();",
    );
    // 源是 sloppy（strict=false），但 class 体恒 strict ⇒ 块外 g 是自由名
    expect(freeIdentifiers(body, [], false).has("g")).toBe(true);
    // 对照：同形态在普通函数体（sloppy）内仍按 Annex B 提升
    const sloppyPeer = bodyOf("{ function g() { return 3; } } return g();");
    expect(freeIdentifiers(sloppyPeer, [], false).has("g")).toBe(false);

    // strict 编译单元下解析到外层闭包（g = () => 42），而非块内 g
    const env = emptyEnv();
    env.fns.set("g", { params: [], body: bodyOf("return 42;"), async: false, strict: true });
    const strictFn = absFunction([], { body, env, strict: true });
    expect(litValue($call(strictFn, []))).toEqual({ ok: true, value: 42 });
  });
});
