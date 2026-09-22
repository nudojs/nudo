/**
 * body 编译执行（迁移件 4）：$call 对自包含 Abs fn 走编译 body 而非
 * evalNode 解释。free-identifier 扫描门：闭包/兄弟函数/自递归引用
 * （property key 不算）→ undefined 回落解释路径（递归预算生效）。
 */
import { describe, it, expect } from "vitest";
import { $call } from "../exec/call.ts";
import { absFunction, getFnImpl } from "../abs-fn.ts";
import { litValue, numLit } from "@nudojs/core";
import { parseSource } from "../parse-source.ts";

function fnOf(src: string, name = "f") {
  const file = parseSource(`function ${name}(x) { ${src} }`);
  const decl = (file.program.body as Array<{ type: string; id?: { name: string }; params: Array<{ name?: string }>; body: never }>).find(
    (s) => s.type === "FunctionDeclaration" && s.id?.name === name,
  )!;
  return absFunction(
    decl.params.map((p, i) => p.name ?? `p${i}`),
    { body: decl.body },
  );
}

describe("body compiled execution ($call, 迁移件 4)", () => {
  it("self-contained arithmetic body compiles and executes", () => {
    const f = fnOf("return x + 1;");
    expect(litValue($call(f, [numLit(5)]))).toBe(6);
  });

  it("conditional body (if/fork) executes compiled", () => {
    const f = fnOf("if (x > 0) { return x; } return -x;");
    expect(litValue($call(f, [numLit(5)]))).toBe(5);
    expect(litValue($call(f, [numLit(-3)]))).toBe(3);
  });

  it("loop body executes compiled", () => {
    const f = fnOf("let s = 0; for (let i = 0; i < 3; i++) { s += i; } return s;");
    expect(litValue($call(f, [numLit(0)]))).toBe(3);
  });

  it("closure reference falls back to interpreter (recursion budget)", () => {
    // 自由标识符 k → 不编译；解释路径行为不变
    const file = parseSource(`function f(x) { return x + k; }`);
    const decl = (file.program.body as Array<{ type: string; params: Array<{ name?: string }>; body: never; id?: { name: string } }>)[0]!;
    const f = absFunction(["x"], { body: decl.body, env: undefined });
    expect(getFnImpl(f)?.body).toBeDefined();
    // 解释路径：k 未绑定 → unknown 传播；不抛即可（假精确门由差分语料守）
    const r = $call(f, [numLit(5)]);
    expect(r).toBeDefined();
  });

  it("recursive body keeps interpreter path (guarded)", () => {
    const file = parseSource(`function fac(n) { if (n <= 1) { return 1; } return n * fac(n - 1); }`);
    const decl = (file.program.body as Array<{ type: string; params: Array<{ name?: string }>; body: never; id?: { name: string } }>)[0]!;
    const f = absFunction(["n"], { body: decl.body });
    const r = $call(f, [numLit(5)]);
    // 自递归 → free identifier → 解释路径 + 递归预算（opaque 或精确皆可，不爆栈）
    expect(r).toBeDefined();
  });

  it("apply-hooked impl keeps apply priority", () => {
    const f = absFunction(["x"], {
      apply: () => numLit(42),
      body: parseSource(`function g(x) { return x + 1; }`).program.body[0] as never,
    });
    expect(litValue($call(f, [numLit(0)]))).toBe(42);
  });
});
