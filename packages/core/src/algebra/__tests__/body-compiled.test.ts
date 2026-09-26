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
import { emptyEnv } from "../ast-env.ts";

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

  it("unresolvable free name compiles and throws ReferenceError (native parity)", () => {
    // 自由名 k 不在 env（非闭包非兄弟）→ 编译产物全局作用域解析 →
    // 未定义名 ReferenceError（原生奇偶；B run 同语义）
    const file = parseSource(`function f(x) { return x + k; }`);
    const decl = (file.program.body as Array<{ type: string; params: Array<{ name?: string }>; body: never; id?: { name: string } }>)[0]!;
    const f = absFunction(["x"], { body: decl.body, env: undefined });
    let threw = false;
    try {
      $call(f, [numLit(5)]);
    } catch (e) {
      threw = e instanceof ReferenceError;
    }
    expect(threw).toBe(true);
  });

  it("self-recursive body compiles with budget (env carries self name)", () => {
    // 生产形态：extractFn 的 env.fns 含自身 → 自名注入（per-body 缓存同
    // 一 Abs → $callNamed cycle 键立即命中）→ 有界递归
    const file = parseSource(`function fac(n) { if (n <= 1) { return 1; } return n * fac(n - 1); }`);
    const decl = (file.program.body as Array<{ type: string; params: Array<{ name?: string }>; body: never; id?: { name: string } }>)[0]!;
    const env = emptyEnv();
    env.fns.set("fac", { params: ["n"], body: decl.body, async: false });
    const f = absFunction(["n"], { body: decl.body, env });
    const r = $call(f, [numLit(5)]);
    expect(litValue(r)).toBe(120);
  });

  it("apply-hooked impl keeps apply priority", () => {
    const f = absFunction(["x"], {
      apply: () => numLit(42),
      body: parseSource(`function g(x) { return x + 1; }`).program.body[0] as never,
    });
    expect(litValue($call(f, [numLit(0)]))).toBe(42);
  });
});
