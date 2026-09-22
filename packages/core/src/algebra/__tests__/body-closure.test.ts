/**
 * 件 C：回调/闭包 body 编译注入——compiledBodyOf 解析自由标识符：
 * impl.env.vars → Abs 注入；impl.env.fns → absFunction 包装注入（调用走
 * $callNamed → applyAbsFn，递归预算/解释语义保留）；不可解析（全局名/
 * 自递归名）→ 回落解释路径。
 */
import { describe, it, expect } from "vitest";
import { $call } from "../exec/call.ts";
import { absFunction, getFnImpl } from "../abs-fn.ts";
import { litValue, numLit } from "@nudojs/core";
import { parseSource } from "../parse-source.ts";
import { emptyEnv } from "../ast-eval.ts";

function declOf(src: string, name: string) {
  const file = parseSource(`function ${name}(x) { ${src} }`);
  return (file.program.body as Array<{ type: string; id?: { name: string }; params: Array<{ name?: string }>; body: never }>).find(
    (s) => s.type === "FunctionDeclaration" && s.id?.name === name,
  )!;
}

describe("compiled body closure injection (件 C)", () => {
  it("sibling const captured from impl.env.vars", () => {
    const decl = declOf("return x + k;", "f");
    const env = emptyEnv();
    env.vars.set("k", numLit(2));
    const f = absFunction(["x"], { body: decl.body, env });
    expect(litValue($call(f, [numLit(5)]))).toBe(7);
  });

  it("sibling function captured from impl.env.fns (interpreted inside)", () => {
    const helperFile = parseSource(`function helper(n) { return n * 2; }`);
    const helperDecl = (helperFile.program.body as Array<{ type: string; id?: { name: string }; params: Array<{ name?: string }>; body: never }>)[0]!;
    const decl = declOf("return helper(x) + 1;", "f");
    const env = emptyEnv();
    env.fns.set("helper", { params: ["n"], body: helperDecl.body, async: false });
    const f = absFunction(["x"], { body: decl.body, env });
    expect(litValue($call(f, [numLit(5)]))).toBe(11);
  });

  it("nested arrow closure capturing outer param compiles", () => {
    // 内层 g 的 env 含 x —— 直接对 g 的 impl 编译
    const gBody = parseSource(`function g() { return x + 1; }`).program.body[0] as never;
    const inner = (gBody as { body: never }).body;
    const env = emptyEnv();
    env.vars.set("x", numLit(10));
    const g = absFunction([], { body: inner, env });
    expect(litValue($call(g, []))).toBe(11);
  });

  it("unresolvable free name falls back to interpreter (no crash)", () => {
    const decl = declOf("return x + mysteryGlobal;", "f");
    const f = absFunction(["x"], { body: decl.body, env: emptyEnv() });
    const r = $call(f, [numLit(5)]);
    expect(r).toBeDefined();
  });

  it("recursive self-name stays on interpreter path", () => {
    const file = parseSource(`function fac(n) { if (n <= 1) { return 1; } return n * fac(n - 1); }`);
    const decl = (file.program.body as Array<{ type: string; params: Array<{ name?: string }>; body: never }>)[0]!;
    const f = absFunction(["n"], { body: decl.body, env: emptyEnv() });
    expect(getFnImpl(f)?.body).toBeDefined();
    const r = $call(f, [numLit(5)]);
    expect(r).toBeDefined(); // 不爆栈（解释路径 + 预算）
  });
});
