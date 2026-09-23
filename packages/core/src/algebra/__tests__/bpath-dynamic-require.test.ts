/**
 * 动态 require：可解析子集（字面量/模板/拼接折叠）+ 诚实降级（unknown）。
 * 产品边界见 docs/design/limitations.md §2——动态模块图不是 bug。
 */
import { describe, it, expect } from "vitest";
import {
  transpile,
  runTranspiled,
  callTranspiledExportFull,
  foldStaticStringExpr,
  litValue,
  formatShape,
  $lit,
  type Abs,
  type AbsModuleExports,
} from "@nudojs/core";
import { parseSource } from "../parse-source.ts";

function foldArg(src: string): string | undefined {
  const file = parseSource(src);
  const stmt = (
    file as unknown as {
      program: { body: Array<{ expression?: { arguments?: unknown[] } }> };
    }
  ).program.body[0]!;
  const arg = stmt.expression!.arguments![0];
  return foldStaticStringExpr(arg);
}

describe("foldStaticStringExpr (require spec subset)", () => {
  it("folds plain string literal", () => {
    expect(foldArg(`require("./x.js");`)).toBe("./x.js");
  });

  it("folds template literal without interpolation", () => {
    expect(foldArg("require(`./x.js`);")).toBe("./x.js");
  });

  it("folds template with literal interpolations", () => {
    expect(foldArg('require(`./${"x"}.js`);')).toBe("./x.js");
    expect(foldArg("require(`./${1}.js`);")).toBe("./1.js");
  });

  it("folds concatenation of string literals", () => {
    expect(foldArg('require("./" + "x" + ".js");')).toBe("./x.js");
  });

  it("folds string + numeric literal via ToString", () => {
    expect(foldArg('require("./m" + 1 + ".js");')).toBe("./m1.js");
  });

  it("refuses non-constant interpolations / concatenations", () => {
    expect(foldArg("require(`./${name}.js`);")).toBeUndefined();
    expect(foldArg('require("./" + name + ".js");')).toBeUndefined();
    expect(foldArg("require(name);")).toBeUndefined();
    // 1+2 不是字符串拼接
    expect(foldArg("require(1 + 2);")).toBeUndefined();
  });
});

describe("transpile require subset", () => {
  it("literal / template / concat → __nudoRequire", () => {
    const js = transpile(`
const a = require("./x.js");
const b = require(\`./x.js\`);
const c = require("./" + "x" + ".js");
`);
    expect(js).toContain(`__nudoRequire("./x.js")`);
    expect(js.match(/__nudoRequire\(/g)?.length).toBe(3);
  });

  it("true dynamic require → $unknown() (not $callNamed require)", () => {
    const js = transpile(`const m = require(name);`);
    expect(js).toContain("$unknown()");
    expect(js).not.toContain('$callNamed("require"');
    expect(js).not.toContain("__nudoRequire(");
  });

  it("require.resolve(lit) → $lit(spec); dynamic → $unknown()", () => {
    const js = transpile(`
const p = require.resolve("./m.js");
const q = require.resolve(name);
`);
    expect(js).toContain(`$lit("./m.js")`);
    expect(js).toContain("$unknown()");
    expect(js).not.toContain('$invoke(require, "resolve"');
  });

  it("optional require both-sides foldable → __nudoRequireOptional", () => {
    const js = transpile(`
function go() {
  let m;
  try { m = require("./a.js"); } catch { m = require("./b.js"); }
  return m;
}
`);
    expect(js).toContain(`__nudoRequireOptional(["./a.js","./b.js"])`);
    // 不再展开整套 try/catch 机械
    expect(js).not.toContain("$tryMark()");
  });

  it("optional require with non-foldable side stays honest try/catch", () => {
    const js = transpile(`
function go() {
  let m;
  try { m = require("./a.js"); } catch { m = require(name); }
  return m;
}
`);
    expect(js).not.toContain("__nudoRequireOptional");
    expect(js).toContain(`__nudoRequire("./a.js")`);
  });
});

describe("B-path require runtime", () => {
  const modules = {
    "./a.js": { named: { tag: $lit("from-a") } },
    "./b.js": { named: { tag: $lit("from-b") } },
  } as unknown as Record<string, AbsModuleExports>;

  function run(src: string, fn: string, args: Abs[] = []): Abs | undefined {
    const exports = runTranspiled(src, { modules: modules as never, mode: "exec" });
    return callTranspiledExportFull(exports, fn, args).result;
  }

  it("folded require injects the module namespace", () => {
    const r = run(
      `export function go() { const m = require("./a.js"); return m.tag; }`,
      "go",
    );
    expect(r).toBeDefined();
    expect(litValue(r!)).toBe("from-a");
  });

  it("dynamic require returns unknown and does not throw", () => {
    const r = run(
      `export function go(name) { const m = require(name); return m; }`,
      "go",
      [$lit("whatever")],
    );
    expect(r).toBeDefined();
    expect(formatShape(r!)).toBe("unknown");
  });

  it("optional require prefers success side (first present module)", () => {
    const r1 = run(
      `export function go() {
        let m;
        try { m = require("./a.js"); } catch { m = require("./b.js"); }
        return m.tag;
      }`,
      "go",
    );
    expect(litValue(r1!)).toBe("from-a");

    const r2 = run(
      `export function go() {
        let m;
        try { m = require("./missing.js"); } catch { m = require("./b.js"); }
        return m.tag;
      }`,
      "go",
    );
    expect(litValue(r2!)).toBe("from-b");
  });

  it("optional require neither side resolves → unknown (honest)", () => {
    const r = run(
      `export function go() {
        let m;
        try { m = require("./no-a.js"); } catch { m = require("./no-b.js"); }
        return m;
      }`,
      "go",
    );
    expect(r).toBeDefined();
    expect(formatShape(r!)).toBe("unknown");
  });

  it("require.resolve(lit) evaluates to the static specifier", () => {
    const r = run(`export function go() { return require.resolve("./a.js"); }`, "go");
    expect(litValue(r!)).toBe("./a.js");
  });

  it("require.resolve(dynamic) evaluates to unknown", () => {
    const r = run(`export function go(n) { return require.resolve(n); }`, "go", [$lit("x")]);
    expect(formatShape(r!)).toBe("unknown");
  });
});
