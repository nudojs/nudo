/**
 * D6=G2 + D5=F1 契约回归。
 *
 * G2：指令绑定 AST 最近 Function（含 nested function、class method）——
 * 同一函数上 `@nudo:case` 与 `@nudo:contract` 必须同时可见。
 * F1：parser / core / nudojs 对同一源码的指令集合一致（单源抽取）。
 */
import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import { extractDirectives, extractFileDirectives } from "../directives.ts";
import {
  extractDeclaredThrows,
  extractFileEnvNames,
  extractMockModuleRecords,
  extractNudoImports,
  extractRefinesFromSource,
  findFnDirectiveScope,
  fnDirectiveCommentLines,
  listFnDirectiveScopes,
  parseSource,
} from "@nudojs/core";
// 与 core 契约测试同源的约束库（positive 等）
import {
  withStdImport,
  stdLoadModule,
} from "../../../core/src/algebra/__tests__/nudo-constraints.ts";

const stdOpts = { loadModule: stdLoadModule, fromFile: "/test/file.js" };

function caseNamesOf(src: string): string[] {
  return extractDirectives(parse(src)).map((f) => f.name);
}

function contractParamsOf(raw: string, fnName: string): string[] {
  const src = withStdImport(raw);
  return extractRefinesFromSource(src, fnName, stdOpts).map((e) => e.param);
}

describe("G2 scope: nested function", () => {
  const src = `
export function outer(x) {
  /**
   * @nudo:case "inner-t" (1)
   * @nudo:contract x positive
   */
  function inner(x) {
    return x;
  }
  return inner(x);
}
`;

  it("case is bound to the nested function", () => {
    expect(caseNamesOf(src)).toContain("inner");
    const fns = extractDirectives(parse(src));
    const inner = fns.find((f) => f.name === "inner")!;
    expect(inner.directives.some((d) => d.kind === "case")).toBe(true);
  });

  it("contract is bound to the same nested function", () => {
    expect(contractParamsOf(src, "inner")).toEqual(["x"]);
  });

  it("outer does not steal inner's case", () => {
    const fns = extractDirectives(parse(src));
    const outer = fns.find((f) => f.name === "outer");
    expect(outer?.directives.filter((d) => d.kind === "case") ?? []).toEqual([]);
    expect(contractParamsOf(src, "outer")).toEqual([]);
  });
});

describe("G2 scope: class method", () => {
  const src = `
export class Calculator {
  /**
   * @nudo:case "add-t" (1, 2)
   * @nudo:contract a positive
   * @nudo:contract b positive
   */
  add(a, b) {
    return a + b;
  }

  // @nudo:case "neg-t" (0)
  // @nudo:throws RangeError
  neg(n) {
    if (n < 0) throw new RangeError();
    return -n;
  }
}
`;

  it("case binds to Class.method", () => {
    const names = caseNamesOf(src);
    expect(names).toContain("Calculator.add");
    expect(names).toContain("Calculator.neg");
  });

  it("contract binds to the same class method", () => {
    expect(contractParamsOf(src, "Calculator.add")).toEqual(["a", "b"]);
  });

  it("throws binds to the same class method", () => {
    expect(extractDeclaredThrows(src, "Calculator.neg")).toEqual(["RangeError"]);
    expect(extractDeclaredThrows(src, "Calculator.add")).toBeUndefined();
  });

  it("case and contract agree on the class-method function set", () => {
    const withCase = new Set(caseNamesOf(src));
    expect(withCase.has("Calculator.add")).toBe(true);
    // contract visibility must cover every case-carrying function
    for (const name of withCase) {
      const lines = fnDirectiveCommentLines(src, name);
      expect(lines.length, `no comment lines for ${name}`).toBeGreaterThan(0);
    }
  });
});

describe("G2 scope: nested class method inside function", () => {
  const src = `
export function make() {
  class Inner {
    /**
     * @nudo:case "m-t" (1)
     * @nudo:contract n positive
     */
    m(n) {
      return n;
    }
  }
  return new Inner();
}
`;

  it("case + contract both visible on nested class method", () => {
    expect(caseNamesOf(src)).toContain("Inner.m");
    expect(contractParamsOf(src, "Inner.m")).toEqual(["n"]);
  });
});

describe("G2 scope: object method", () => {
  const src = `
export const api = {
  /**
   * @nudo:case "get-t" (1)
   * @nudo:contract id positive
   */
  get(id) {
    return id;
  },
};
`;

  it("case + contract both visible on object method", () => {
    expect(caseNamesOf(src)).toContain("api.get");
    expect(contractParamsOf(src, "api.get")).toEqual(["id"]);
  });
});

describe("G2 scope: variable-declared nested arrow", () => {
  const src = `
export function outer() {
  /**
   * @nudo:case "helper-t" (2)
   * @nudo:contract n positive
   */
  const helper = (n) => n * 2;
  return helper;
}
`;

  it("case + contract both visible on nested const arrow", () => {
    expect(caseNamesOf(src)).toContain("helper");
    expect(contractParamsOf(src, "helper")).toEqual(["n"]);
  });
});

describe("F1 single source: parser / core / nudojs agree on file-level directives", () => {
  const src = [
    `// @nudo:env node, es`,
    `// @nudo:mock-module "fs" { readFileSync } from "./mock-fs.js"`,
    `// @nudo:mock-module "path" from "./mock-path.js"`,
    `/// @nudo:import { positive } from "./c.nudo.js"`,
    `export function f(x) { return x; }`,
  ].join("\n");

  it("env names agree across parser and core text extraction", () => {
    const fromParser = extractFileDirectives(parse(src))
      .filter((d) => d.kind === "env")
      .flatMap((d) => (d.kind === "env" ? d.envs : []));
    const fromCore = extractFileEnvNames(src);
    expect(fromParser).toEqual(["node", "es"]);
    expect(fromCore).toEqual(["node", "es"]);
  });

  it("mock-module records agree across parser and core text extraction", () => {
    const fromParser = extractFileDirectives(parse(src)).filter((d) => d.kind === "mock-module");
    const fromCore = extractMockModuleRecords(src);
    expect(fromParser).toEqual([
      { kind: "mock-module", source: "fs", names: ["readFileSync"], fromPath: "./mock-fs.js" },
      { kind: "mock-module", source: "path", fromPath: "./mock-path.js" },
    ]);
    expect(fromCore).toEqual([
      { source: "fs", names: ["readFileSync"], fromPath: "./mock-fs.js" },
      { source: "path", fromPath: "./mock-path.js" },
    ]);
  });

  it("import records agree (refine extractNudoImports)", () => {
    expect(extractNudoImports(src)).toEqual([{ names: ["positive"], spec: "./c.nudo.js" }]);
  });

  it("strings and block comments are not directives for any consumer", () => {
    const tricky = [
      `const s = "// @nudo:env node";`,
      `/* @nudo:env web */`,
      `export function f() {}`,
    ].join("\n");
    expect(extractFileEnvNames(tricky)).toEqual([]);
    expect(extractFileDirectives(parse(tricky))).toEqual([]);
    expect(extractMockModuleRecords(tricky)).toEqual([]);
  });
});

describe("F1 single source: scope binder is shared", () => {
  const src = `
/**
 * @nudo:case "t" (1)
 * @nudo:contract x positive
 */
export function f(x) {
  return x;
}
`;

  it("listFnDirectiveScopes covers the exported function", () => {
    const scopes = listFnDirectiveScopes(parseSource(src));
    expect(scopes.map((s) => s.name)).toContain("f");
  });

  it("findFnDirectiveScope returns the same comment block used by contract", () => {
    const scope = findFnDirectiveScope(parseSource(src), "f");
    expect(scope).toBeDefined();
    expect(scope!.commentLines.some((l) => l.includes("@nudo:contract"))).toBe(true);
    expect(contractParamsOf(src, "f")).toEqual(["x"]);
  });
});
