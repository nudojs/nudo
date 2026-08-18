import { describe, it, expect, beforeEach } from "vitest";
import {
  T,
  typeValueEquals,
  typeValueToString,
  createEnvironment,
  isSubtypeOf,
} from "@nudojs/core";
import type { TypeValue } from "@nudojs/core";
import { parse } from "@nudojs/parser";
import { evaluate, evaluateFunction, evaluateFunctionFull, evaluateProgram, resetMemo, setModuleResolver, setCurrentFileDir, setUnknownCollector, setMockModules, resetMockModules, type UnknownRecord } from "../evaluator.ts";

function evalCode(code: string): TypeValue {
  const ast = parse(code);
  const env = createEnvironment();
  return evaluateProgram(ast, env);
}

function evalFn(code: string, args: TypeValue[]): TypeValue {
  const ast = parse(code);
  const env = createEnvironment();
  evaluateProgram(ast, env);
  const fns = ast.type === "File" ? ast.program.body : [];
  const fnNode = fns.find(
    (n: any) => n.type === "FunctionDeclaration",
  );
  if (!fnNode) throw new Error("No function found");
  return evaluateFunction(fnNode, args, env);
}

function evalFnFull(code: string, args: TypeValue[]): { value: TypeValue; throws: TypeValue } {
  const ast = parse(code);
  const env = createEnvironment();
  evaluateProgram(ast, env);
  const fns = ast.type === "File" ? ast.program.body : [];
  const fnNode = fns.find(
    (n: any) => n.type === "FunctionDeclaration",
  );
  if (!fnNode) throw new Error("No function found");
  return evaluateFunctionFull(fnNode, args, env);
}

describe("ThrowStatement", () => {
  it("throw produces ThrowSignal captured by try-catch", () => {
    const result = evalFn(
      `function test(x) {
        try {
          throw new Error("oops");
        } catch (e) {
          return e;
        }
      }`,
      [T.number],
    );
    expect(result.kind).toBe("instance");
    if (result.kind === "instance") {
      expect(result.className).toBe("Error");
    }
  });

  it("uncaught throw in function returns never", () => {
    const { value, throws } = evalFnFull(
      `function test() {
        throw new Error("fail");
      }`,
      [],
    );
    expect(value.kind).toBe("never");
    expect(throws.kind).toBe("instance");
    if (throws.kind === "instance") {
      expect(throws.className).toBe("Error");
    }
  });

  it("try-catch digests throws", () => {
    const { value, throws } = evalFnFull(
      `function test() {
        try {
          throw new TypeError("bad type");
        } catch (e) {
          return "recovered";
        }
      }`,
      [],
    );
    expect(typeValueEquals(value, T.literal("recovered"))).toBe(true);
    expect(throws.kind).toBe("never");
  });

  it("finally always executes", () => {
    const result = evalFn(
      `function test() {
        let x = 0;
        try {
          x = 1;
          return x;
        } finally {
          x = 2;
        }
      }`,
      [],
    );
    expect(typeValueEquals(result, T.literal(1))).toBe(true);
  });

  it("catch receives the thrown type", () => {
    const result = evalFn(
      `function test() {
        try {
          throw new TypeError("bad");
        } catch (e) {
          return e.message;
        }
      }`,
      [],
    );
    expect(typeValueEquals(result, T.literal("bad"))).toBe(true);
  });
});

describe("NewExpression", () => {
  it("creates Error instance", () => {
    const result = evalCode(`new Error("something went wrong")`);
    expect(result.kind).toBe("instance");
    if (result.kind === "instance") {
      expect(result.className).toBe("Error");
      expect(typeValueEquals(result.properties.message, T.literal("something went wrong"))).toBe(true);
    }
  });

  it("creates TypeError instance", () => {
    const result = evalCode(`new TypeError("bad type")`);
    expect(result.kind).toBe("instance");
    if (result.kind === "instance") {
      expect(result.className).toBe("TypeError");
    }
  });

  it("creates instance from user-defined class", () => {
    const result = evalCode(`
      class Point {
        constructor(x, y) {
          this.x = x;
          this.y = y;
        }
      }
      new Point(1, 2)
    `);
    expect(result.kind).toBe("instance");
    if (result.kind === "instance") {
      expect(result.className).toBe("Point");
      expect(typeValueEquals(result.properties.x, T.literal(1))).toBe(true);
      expect(typeValueEquals(result.properties.y, T.literal(2))).toBe(true);
    }
  });
});

describe("ClassDeclaration", () => {
  it("binds class to environment", () => {
    const ast = parse(`
      class Foo {
        constructor(val) {
          this.val = val;
        }
        getVal() {
          return this.val;
        }
      }
      const f = new Foo(42);
    `);
    const env = createEnvironment();
    evaluateProgram(ast, env);
    const f = env.lookup("f");
    expect(f.kind).toBe("instance");
    if (f.kind === "instance") {
      expect(f.className).toBe("Foo");
      expect(typeValueEquals(f.properties.val, T.literal(42))).toBe(true);
      expect(f.properties.getVal?.kind).toBe("function");
    }
  });
});

describe("instanceof", () => {
  it("checks instanceof for known instance", () => {
    const result = evalCode(`
      const e = new Error("test");
      e instanceof Error
    `);
    expect(typeValueEquals(result, T.literal(true))).toBe(true);
  });

  it("instanceof narrowing in if", () => {
    const result = evalFn(
      `function test(x) {
        if (x instanceof Error) {
          return x.message;
        }
        return "not error";
      }`,
      [T.instanceOf("Error", { message: T.literal("oops") })],
    );
    expect(typeValueEquals(result, T.literal("oops"))).toBe(true);
  });

  it("instanceof returns boolean for unknown types", () => {
    const result = evalCode(`
      const x = 42;
      x instanceof Error
    `);
    // primitives can never be instanceof anything — decided statically
    expect(typeValueEquals(result, T.literal(false))).toBe(true);
    // unknown receivers keep the conservative boolean fallback
    const fn = evaluateFunction(
      parse("function f(x) { return x instanceof Error; }").program.body[0],
      [T.unknown],
      createEnvironment(),
    );
    expect(fn).toBe(T.boolean);
  });
});

describe("async/await", () => {
  it("async function wraps return in Promise", () => {
    const result = evalFn(
      `async function fetchData() {
        return 42;
      }`,
      [],
    );
    expect(result.kind).toBe("promise");
    if (result.kind === "promise") {
      expect(typeValueEquals(result.value, T.literal(42))).toBe(true);
    }
  });

  it("await unwraps Promise", () => {
    const result = evalFn(
      `async function test() {
        const p = async function inner() { return 10; };
        const val = await p();
        return val;
      }`,
      [],
    );
    expect(result.kind).toBe("promise");
    if (result.kind === "promise") {
      expect(typeValueEquals(result.value, T.literal(10))).toBe(true);
    }
  });

  it("await on non-promise returns value as-is", () => {
    const result = evalFn(
      `async function test() {
        const val = await 42;
        return val;
      }`,
      [],
    );
    expect(result.kind).toBe("promise");
    if (result.kind === "promise") {
      expect(typeValueEquals(result.value, T.literal(42))).toBe(true);
    }
  });
});

describe("recursion with memoization", () => {
  beforeEach(() => {
    resetMemo();
  });

  it("handles recursive function with memoization", () => {
    const ast = parse(`
      function factorial(n) {
        if (n === 0) return 1;
        if (n === 1) return 1;
        return n * factorial(n - 1);
      }
    `);
    const env = createEnvironment();
    evaluateProgram(ast, env);
    const fn = env.lookup("factorial");
    expect(fn.kind).toBe("function");
    if (fn.kind === "function") {
      (fn as any)._memoize = "factorial";
      const result = evaluate(
        parse(`factorial(5)`).program.body[0],
        env,
      );
      expect(result.kind).toBe("literal");
    }
  });

  it("recursive call returns unknown for in-progress memo", () => {
    const ast = parse(`
      function infinite(x) {
        return infinite(x);
      }
      const result = infinite(1);
    `);
    const env = createEnvironment();
    const fn_ast = ast.program.body[0];
    evaluate(fn_ast, env);
    const fn = env.lookup("infinite");
    if (fn.kind === "function") {
      (fn as any)._memoize = "infinite";
    }
    const callAst = ast.program.body[1];
    evaluate(callAst, env);
    const result = env.lookup("result");
    expect(result.kind).toBe("unknown");
  });

  it("budget-truncated recursion falls back to the function's observed results instead of unknown", () => {
    // eq over chains deeper than MAX_CALL_DEPTH truncates mid-recursion.
    // The first truncation has no observations and stays unknown; precise
    // calls then accumulate true/false; a later truncation (fresh argument
    // shapes, so no memo hit) degrades to the observed union.
    const nest = (n: number, leaf: string): string => (n === 0 ? leaf : `{ x: ${nest(n - 1, leaf)} }`);
    const ast = parse(`
      function eq(a, b) {
        if (a === b) return true;
        if (typeof a !== "object") return false;
        return eq(a.x, b.x);
      }
      const r1 = eq(${nest(70, "1")}, ${nest(70, "2")});
      const t = eq(1, 1);
      const f = eq(1, 2);
      const r2 = eq(${nest(80, "3")}, ${nest(80, "4")});
    `);
    const env = createEnvironment();
    evaluateProgram(ast, env);
    expect(env.lookup("r1").kind).toBe("unknown");
    expect(typeValueToString(env.lookup("t"))).toBe("true");
    expect(typeValueToString(env.lookup("f"))).toBe("false");
    const r2 = env.lookup("r2");
    expect(r2.kind).toBe("union");
    if (r2.kind === "union") {
      expect(r2.members).toHaveLength(2);
      expect(typeValueToString(r2)).toBe("true | false");
    }
  });

  it("budget-truncated recursion without observed results stays unknown", () => {
    const nest = (n: number, leaf: string): string => (n === 0 ? leaf : `{ x: ${nest(n - 1, leaf)} }`);
    const ast = parse(`
      function eq(a, b) {
        if (a === b) return true;
        if (typeof a !== "object") return false;
        return eq(a.x, b.x);
      }
      const r = eq(${nest(70, "5")}, ${nest(70, "6")});
    `);
    const env = createEnvironment();
    evaluateProgram(ast, env);
    expect(env.lookup("r").kind).toBe("unknown");
  });
});

describe("modules import/export", () => {
  beforeEach(() => {
    resetMemo();
  });

  it("handles export named declaration", () => {
    const ast = parse(`
      export const x = 42;
      export function add(a, b) { return a + b; }
    `);
    const env = createEnvironment();
    evaluateProgram(ast, env);
    expect(typeValueEquals(env.lookup("x"), T.literal(42))).toBe(true);
    expect(typeValueEquals(env.lookup("__export_x"), T.literal(42))).toBe(true);
    expect(env.lookup("add").kind).toBe("function");
    expect(env.lookup("__export_add").kind).toBe("function");
  });

  it("handles export default declaration", () => {
    const ast = parse(`
      export default function main() { return "hello"; }
    `);
    const env = createEnvironment();
    evaluateProgram(ast, env);
    expect(env.lookup("__export_default").kind).toBe("function");
  });

  it("handles import with module resolver", () => {
    const moduleSource = `
      export const PI = 3.14;
      export function double(x) { return x * 2; }
    `;
    const moduleAst = parse(moduleSource);

    setModuleResolver((source) => {
      if (source === "./math") {
        return { ast: moduleAst, filePath: "/fake/math.js" };
      }
      return null;
    });
    setCurrentFileDir("/fake");

    const ast = parse(`
      import { PI, double } from "./math";
      const result = double(PI);
    `);
    const env = createEnvironment();
    evaluateProgram(ast, env);

    expect(typeValueEquals(env.lookup("PI"), T.literal(3.14))).toBe(true);
    const result = env.lookup("result");
    expect(typeValueEquals(result, T.literal(6.28))).toBe(true);

    setModuleResolver(null);
  });

  it("handles default import", () => {
    const moduleSource = `
      export default function greet() { return "hi"; }
    `;
    const moduleAst = parse(moduleSource);

    setModuleResolver((source) => {
      if (source === "./greet") {
        return { ast: moduleAst, filePath: "/fake/greet.js" };
      }
      return null;
    });
    setCurrentFileDir("/fake");

    const ast = parse(`
      import greet from "./greet";
    `);
    const env = createEnvironment();
    evaluateProgram(ast, env);

    expect(env.lookup("greet").kind).toBe("function");

    setModuleResolver(null);
  });

  it("handles namespace import", () => {
    const moduleSource = `
      export const a = 1;
      export const b = 2;
    `;
    const moduleAst = parse(moduleSource);

    setModuleResolver((source) => {
      if (source === "./vals") {
        return { ast: moduleAst, filePath: "/fake/vals.js" };
      }
      return null;
    });
    setCurrentFileDir("/fake");

    const ast = parse(`
      import * as vals from "./vals";
    `);
    const env = createEnvironment();
    evaluateProgram(ast, env);

    const vals = env.lookup("vals");
    expect(vals.kind).toBe("object");
    if (vals.kind === "object") {
      expect(typeValueEquals(vals.properties.a, T.literal(1))).toBe(true);
      expect(typeValueEquals(vals.properties.b, T.literal(2))).toBe(true);
    }

    setModuleResolver(null);
  });

  it("caches modules - same file evaluated once", () => {
    setModuleResolver((source) => {
      if (source === "./cached") {
        return { ast: parse(`export const x = 1;`), filePath: "/fake/cached.js" };
      }
      return null;
    });
    setCurrentFileDir("/fake");

    const ast = parse(`
      import { x } from "./cached";
      import { x as x2 } from "./cached";
    `);
    const env = createEnvironment();
    evaluateProgram(ast, env);

    expect(typeValueEquals(env.lookup("x"), T.literal(1))).toBe(true);
    expect(typeValueEquals(env.lookup("x2"), T.literal(1))).toBe(true);

    setModuleResolver(null);
  });

  it("resolves require() of a CJS module exporting an object", () => {
    setModuleResolver((source) => {
      if (source === "./b") {
        return {
          ast: parse(`function triple(x) { return x * 3; }\nmodule.exports = { triple };\n`),
          filePath: "/fake/b.js",
        };
      }
      return null;
    });
    setCurrentFileDir("/fake");

    const ast = parse(`
      const b = require("./b");
      const r = b.triple(4);
    `);
    const env = createEnvironment();
    evaluateProgram(ast, env);

    const b = env.lookup("b");
    expect(b.kind).toBe("object");
    if (b.kind === "object") {
      expect(b.properties.triple.kind).toBe("function");
    }
    expect(typeValueEquals(env.lookup("r"), T.literal(12))).toBe(true);

    setModuleResolver(null);
  });

  it("require() picks up a chained module.exports = internals.x = function assignment", () => {
    setModuleResolver((source) => {
      if (source === "./clone") {
        return {
          ast: parse(`
            const internals = {};
            module.exports = internals.clone = function (obj, options = {}) {
              if (options.shallow) {
                return obj;
              }
              return obj;
            };
          `),
          filePath: "/fake/clone.js",
        };
      }
      return null;
    });
    setCurrentFileDir("/fake");

    const ast = parse(`
      const Clone = require("./clone");
      const r = Clone(5);
    `);
    const env = createEnvironment();
    evaluateProgram(ast, env);

    expect(env.lookup("Clone").kind).toBe("function");
    expect(typeValueEquals(env.lookup("r"), T.literal(5))).toBe(true);

    setModuleResolver(null);
  });

  it("supports exports.name assignments", () => {
    setModuleResolver((source) => {
      if (source === "./b") {
        return {
          ast: parse(`exports.triple = function (x) { return x * 3; };\n`),
          filePath: "/fake/b.js",
        };
      }
      return null;
    });
    setCurrentFileDir("/fake");

    const ast = parse(`
      const b = require("./b");
      const r = b.triple(2);
    `);
    const env = createEnvironment();
    evaluateProgram(ast, env);

    expect(typeValueEquals(env.lookup("r"), T.literal(6))).toBe(true);

    setModuleResolver(null);
  });

  it("require() of an ES module returns its exports as properties", () => {
    setModuleResolver((source) => {
      if (source === "./esm") {
        return {
          ast: parse(`export const n = 1;\nexport function f(x) { return x + 1; }\n`),
          filePath: "/fake/esm.js",
        };
      }
      return null;
    });
    setCurrentFileDir("/fake");

    const ast = parse(`
      const b = require("./esm");
      const r = b.f(b.n);
    `);
    const env = createEnvironment();
    evaluateProgram(ast, env);

    expect(typeValueEquals(env.lookup("r"), T.literal(2))).toBe(true);

    setModuleResolver(null);
  });

  it("require() with a bare specifier returns unknown and records a warning", () => {
    setCurrentFileDir("/fake");

    const records: UnknownRecord[] = [];
    setUnknownCollector((r) => records.push(r));
    const env = createEnvironment();
    try {
      const ast = parse(`const u = require("@hapi/hoek");\n`);
      evaluateProgram(ast, env);
    } finally {
      setUnknownCollector(null);
      setCurrentFileDir("");
    }

    expect(env.lookup("u").kind).toBe("unknown");
    expect(records.some((r) => r.kind === "global" && r.name === `require('@hapi/hoek')`)).toBe(true);
  });

  // --- 模块加载边界守卫（环 / 深度 / 缺失），来源：evaluator.ts loadModuleEnv 加固 ---

  it("reports a circular import chain a -> b -> a and keeps partial-binding semantics", () => {
    const aAst = parse(`import { bVal } from "./b.js";\nexport const aVal = 1;\nexport const mixed = bVal;\n`);
    const bAst = parse(`import { aVal } from "./a.js";\nexport const bVal = aVal;\n`);
    const files: Record<string, { ast: ReturnType<typeof parse>; filePath: string }> = {
      "./a.js": { ast: aAst, filePath: "/fake/a.js" },
      "./b.js": { ast: bAst, filePath: "/fake/b.js" },
    };
    setModuleResolver((source) => files[source] ?? null);
    setCurrentFileDir("/fake");

    const records: UnknownRecord[] = [];
    setUnknownCollector((r) => records.push(r));
    const env = createEnvironment();
    evaluateProgram(parse(`import { aVal, mixed } from "./a.js";\n`), env);

    const cycle = records.find((r) => r.kind === "global" && r.name.startsWith("module-cycle:"));
    expect(cycle).toBeDefined();
    expect(cycle?.name).toBe("module-cycle:a.js");
    expect(cycle?.reason).toBe("Circular module load: /fake/a.js -> /fake/b.js -> /fake/a.js (bindings inside the cycle resolve to their partially evaluated types)");
    // 环内 aVal 在 b 求值时尚未执行 → unknown；环后补齐的导出照常可得
    expect(typeValueEquals(env.lookup("aVal"), T.literal(1))).toBe(true);
    expect(env.lookup("mixed").kind).toBe("unknown");

    setUnknownCollector(null);
    setModuleResolver(null);
    setCurrentFileDir("");
  });

  it("reports a mock-module cycle when the mock file re-imports the mocked module", () => {
    const mockAst = parse(`import { helper } from "calc";\nexport const value = helper;\nexport const own = 2;\n`);
    setMockModules(new Map([["calc", { fromPath: "./mockCalc.js" }]]));
    setModuleResolver((source) => {
      if (source === "./mockCalc.js") return { ast: mockAst, filePath: "/fake/mockCalc.js" };
      return null;
    });
    setCurrentFileDir("/fake");

    const records: UnknownRecord[] = [];
    setUnknownCollector((r) => records.push(r));
    const env = createEnvironment();
    evaluateProgram(parse(`import { value, own } from "calc";\nconst sum = own + 40;\n`), env);

    const cycle = records.find((r) => r.kind === "global" && r.name.startsWith("module-cycle:"));
    expect(cycle).toBeDefined();
    expect(cycle?.reason).toBe("Circular module load: /fake/mockCalc.js -> /fake/mockCalc.js (bindings inside the cycle resolve to their partially evaluated types)");
    // 环截断后 mock 文件其余导出照常求值，分析不中断
    expect(env.lookup("value").kind).toBe("unknown");
    expect(typeValueEquals(env.lookup("sum"), T.literal(42))).toBe(true);

    setUnknownCollector(null);
    setModuleResolver(null);
    setCurrentFileDir("");
    resetMockModules();
  });

  it("truncates module chains deeper than the depth limit and reports the chain", () => {
    // f1 -> f2 -> ... -> f20：第 17 层（f17）触发深度上限（MAX_MODULE_LOAD_DEPTH = 16）
    const files: Record<string, { ast: ReturnType<typeof parse>; filePath: string }> = {};
    for (let i = 1; i <= 20; i++) {
      const body = i < 20
        ? `import { value as inner } from "./f${i + 1}.js";\nexport const value = inner;\n`
        : `export const value = 20;\n`;
      files[`./f${i}.js`] = { ast: parse(body), filePath: `/fake/f${i}.js` };
    }
    setModuleResolver((source) => files[source] ?? null);
    setCurrentFileDir("/fake");

    const records: UnknownRecord[] = [];
    setUnknownCollector((r) => records.push(r));
    const env = createEnvironment();
    evaluateProgram(parse(`import { value } from "./f1.js";\n`), env);

    const depth = records.find((r) => r.kind === "global" && r.name.startsWith("module-depth:"));
    expect(depth).toBeDefined();
    expect(depth?.name).toBe("module-depth:f17.js");
    expect(depth?.reason).toContain("depth 17 > 16 max");
    const expectedChain = Array.from({ length: 17 }, (_, k) => `/fake/f${k + 1}.js`).join(" -> ");
    expect(depth?.reason).toContain(expectedChain);
    // 截断为 unknown，而非栈溢出崩溃
    expect(env.lookup("value").kind).toBe("unknown");

    setUnknownCollector(null);
    setModuleResolver(null);
    setCurrentFileDir("");
  });

  it("reports a missing @nudo:mock-module target with its full path and falls back to the original", () => {
    setMockModules(new Map([["b", { fromPath: "./nope.js" }]]));
    setModuleResolver((source) => {
      if (source === "b") return { ast: parse(`export const x = 41;\n`), filePath: "/fake/b.js" };
      return null; // "./nope.js" 不存在
    });
    setCurrentFileDir("/fake");

    const records: UnknownRecord[] = [];
    setUnknownCollector((r) => records.push(r));
    const env = createEnvironment();
    evaluateProgram(parse(`import { x } from "b";\nconst y = x + 1;\n`), env);

    const missing = records.find((r) => r.kind === "global" && r.name.startsWith("module-missing:"));
    expect(missing).toBeDefined();
    expect(missing?.name).toBe("module-missing:nope.js");
    expect(missing?.reason).toContain('@nudo:mock-module target for "b" not found');
    expect(missing?.reason).toContain("/fake/nope.js");
    // 回落到原模块，mock 缺失不中断分析
    expect(typeValueEquals(env.lookup("y"), T.literal(42))).toBe(true);

    setUnknownCollector(null);
    setModuleResolver(null);
    setCurrentFileDir("");
    resetMockModules();
  });

  it("reports an unresolvable relative import with the attempted full path", () => {
    setModuleResolver(() => null);
    setCurrentFileDir("/fake");

    const records: UnknownRecord[] = [];
    setUnknownCollector((r) => records.push(r));
    const env = createEnvironment();
    evaluateProgram(parse(`import { x } from "./gone.js";\nconst y = 1;\n`), env);

    const missing = records.find((r) => r.kind === "global" && r.name.startsWith("module-missing:"));
    expect(missing).toBeDefined();
    expect(missing?.reason).toContain("Cannot resolve import './gone.js'");
    expect(missing?.reason).toContain("/fake/gone.js");
    expect(typeValueEquals(env.lookup("y"), T.literal(1))).toBe(true);

    setUnknownCollector(null);
    setModuleResolver(null);
    setCurrentFileDir("");
  });

  it("loads nested mock-module dependencies without triggering guard diagnostics", () => {
    const helperAst = parse(`export const h = 2;\n`);
    const mockAst = parse(`import { h } from "./helper.js";\nexport const answer = h * 21;\n`);
    const files: Record<string, { ast: ReturnType<typeof parse>; filePath: string }> = {
      "./helper.js": { ast: helperAst, filePath: "/fake/helper.js" },
      "./mockCalc.js": { ast: mockAst, filePath: "/fake/mockCalc.js" },
    };
    setMockModules(new Map([["calc", { fromPath: "./mockCalc.js" }]]));
    setModuleResolver((source) => files[source] ?? null);
    setCurrentFileDir("/fake");

    const records: UnknownRecord[] = [];
    setUnknownCollector((r) => records.push(r));
    const env = createEnvironment();
    evaluateProgram(parse(`import { answer } from "calc";\nconst life = answer;\n`), env);

    // 正常嵌套 mock：不产生任何守卫诊断
    expect(records.filter((r) => r.name.startsWith("module-"))).toHaveLength(0);
    expect(typeValueEquals(env.lookup("life"), T.literal(42))).toBe(true);

    setUnknownCollector(null);
    setModuleResolver(null);
    setCurrentFileDir("");
    resetMockModules();
  });

  it("pre-binds __dirname and __filename as strings", () => {
    const ast = parse(`const d = __dirname;\nconst f = __filename;\n`);
    const env = createEnvironment();
    evaluateProgram(ast, env);

    expect(typeValueEquals(env.lookup("d"), T.string)).toBe(true);
    expect(typeValueEquals(env.lookup("f"), T.string)).toBe(true);
  });
});

describe("SwitchStatement", () => {
  it("evaluates matching case", () => {
    const result = evalFn(
      `function test(x) {
        switch (x) {
          case 1: return "one";
          case 2: return "two";
          default: return "other";
        }
      }`,
      [T.literal(1)],
    );
    expect(typeValueEquals(result, T.literal("one"))).toBe(true);
  });

  it("evaluates default case", () => {
    const result = evalFn(
      `function test(x) {
        switch (x) {
          case 1: return "one";
          default: return "other";
        }
      }`,
      [T.literal(99)],
    );
    expect(typeValueEquals(result, T.literal("other"))).toBe(true);
  });

  it("returns union for abstract discriminant", () => {
    const result = evalFn(
      `function test(x) {
        switch (x) {
          case 1: return "one";
          case 2: return "two";
          default: return "other";
        }
      }`,
      [T.number],
    );
    expect(result.kind).toBe("union");
  });
});

describe("PromiseType in evaluator", () => {
  it("typeof promise is object", () => {
    const result = evalCode(`typeof (async function() { return 1; })()`);
    expect(typeValueEquals(result, T.literal("object"))).toBe(true);
  });
});

describe("instance property access", () => {
  it("accesses instance properties", () => {
    const result = evalCode(`
      const e = new Error("test");
      e.message
    `);
    expect(typeValueEquals(result, T.literal("test"))).toBe(true);
  });
});

describe("export specifiers", () => {
  it("handles export { x, y }", () => {
    const ast = parse(`
      const x = 1;
      const y = 2;
      export { x, y };
    `);
    const env = createEnvironment();
    evaluateProgram(ast, env);
    expect(typeValueEquals(env.lookup("__export_x"), T.literal(1))).toBe(true);
    expect(typeValueEquals(env.lookup("__export_y"), T.literal(2))).toBe(true);
  });
});
