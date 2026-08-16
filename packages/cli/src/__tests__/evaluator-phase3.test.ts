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
import { evaluate, evaluateFunction, evaluateFunctionFull, evaluateProgram, resetMemo, setModuleResolver, setCurrentFileDir, setUnknownCollector, type UnknownRecord } from "../evaluator.ts";

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
