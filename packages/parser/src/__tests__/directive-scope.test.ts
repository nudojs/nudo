/**
 * 指令作用域：绑定 AST 最近的 Function（nested function、class/object method、
 * const arrow）；同一函数上 case 与 contract 必须同时可见。
 * 文件级指令：parser / core 两套读取器对同一源码给出一致的 env / mock / import。
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
import { withStdImport, stdLoadModule } from "../../../core/src/algebra/__tests__/nudo-constraints.ts";

const stdOpts = { loadModule: stdLoadModule, fromFile: "/test/file.js" };
const caseNamesOf = (src: string): string[] => extractDirectives(parse(src)).map((f) => f.name);
const contractParamsOf = (raw: string, fnName: string): string[] =>
  extractRefinesFromSource(withStdImport(raw), fnName, stdOpts).map((e) => e.param);

type ScopeCase = {
  name: string;
  src: string;
  fn: string;
  params: string[];
  outer?: string;
  alsoCase?: string;
  throws?: { fn: string; names: string[] };
  lines?: boolean;
};

const SCOPE_CASES: ScopeCase[] = [
  {
    name: "nested function",
    fn: "inner",
    params: ["x"],
    outer: "outer",
    src: `
export function outer(x) {
  /**
   * @nudo:case "inner-t" (1)
   * @nudo:contract x positive
   */
  function inner(x) { return x; }
  return inner(x);
}
`,
  },
  {
    name: "class method",
    fn: "Calculator.add",
    params: ["a", "b"],
    alsoCase: "Calculator.neg",
    throws: { fn: "Calculator.neg", names: ["RangeError"] },
    lines: true,
    src: `
export class Calculator {
  /**
   * @nudo:case "add-t" (1, 2)
   * @nudo:contract a positive
   * @nudo:contract b positive
   */
  add(a, b) { return a + b; }

  // @nudo:case "neg-t" (0)
  // @nudo:throws RangeError
  neg(n) {
    if (n < 0) throw new RangeError();
    return -n;
  }
}
`,
  },
  {
    name: "nested class method",
    fn: "Inner.m",
    params: ["n"],
    src: `
export function make() {
  class Inner {
    /**
     * @nudo:case "m-t" (1)
     * @nudo:contract n positive
     */
    m(n) { return n; }
  }
  return new Inner();
}
`,
  },
  {
    name: "object method",
    fn: "api.get",
    params: ["id"],
    src: `
export const api = {
  /**
   * @nudo:case "get-t" (1)
   * @nudo:contract id positive
   */
  get(id) { return id; },
};
`,
  },
  {
    name: "const arrow",
    fn: "helper",
    params: ["n"],
    src: `
export function outer() {
  /**
   * @nudo:case "helper-t" (2)
   * @nudo:contract n positive
   */
  const helper = (n) => n * 2;
  return helper;
}
`,
  },
];

describe("指令绑定最近的 Function", () => {
  it.each(SCOPE_CASES)("$name：case 与 contract 可见", ({ src, fn, params, outer, alsoCase, throws, lines }) => {
    const names = caseNamesOf(src);
    expect(names).toContain(fn);
    expect(contractParamsOf(src, fn)).toEqual(params);
    if (alsoCase) expect(names).toContain(alsoCase);
    if (outer) {
      expect(names).not.toContain(outer);
      expect(contractParamsOf(src, outer)).toEqual([]);
    }
    if (throws) {
      expect(extractDeclaredThrows(src, throws.fn)).toEqual(throws.names);
      expect(extractDeclaredThrows(src, fn)).toBeUndefined();
    }
    if (lines) {
      for (const name of names) expect(fnDirectiveCommentLines(src, name).length).toBeGreaterThan(0);
    }
  });
});

describe("文件级指令：两套读取器一致", () => {
  const src = [
    `// @nudo:env node, es`,
    `// @nudo:mock-module "fs" { readFileSync } from "./mock-fs.js"`,
    `// @nudo:mock-module "path" from "./mock-path.js"`,
    `/// @nudo:import { positive } from "./c.nudo.js"`,
    `export function f(x) { return x; }`,
  ].join("\n");

  it("env / mock-module / import 记录逐项一致", () => {
    const directives = extractFileDirectives(parse(src));
    const envFromParser = directives
      .filter((d) => d.kind === "env")
      .flatMap((d) => (d.kind === "env" ? d.envs : []));
    expect(envFromParser).toEqual(["node", "es"]);
    expect(extractFileEnvNames(src)).toEqual(["node", "es"]);

    const mockFromParser = directives.filter((d) => d.kind === "mock-module");
    expect(mockFromParser).toEqual([
      { kind: "mock-module", source: "fs", names: ["readFileSync"], fromPath: "./mock-fs.js" },
      { kind: "mock-module", source: "path", fromPath: "./mock-path.js" },
    ]);
    expect(extractMockModuleRecords(src)).toEqual([
      { source: "fs", names: ["readFileSync"], fromPath: "./mock-fs.js" },
      { source: "path", fromPath: "./mock-path.js" },
    ]);
    expect(extractNudoImports(src)).toEqual([{ names: ["positive"], spec: "./c.nudo.js" }]);
  });

  it("字符串与块注释里的同形文本对所有读取器都不是指令", () => {
    const tricky = [`const s = "// @nudo:env node";`, `/* @nudo:env web */`, `export function f() {}`].join("\n");
    expect(extractFileEnvNames(tricky)).toEqual([]);
    expect(extractFileDirectives(parse(tricky))).toEqual([]);
    expect(extractMockModuleRecords(tricky)).toEqual([]);
  });
});

describe("作用域绑定器与 contract 共用同一注释块", () => {
  const src = `
/**
 * @nudo:case "t" (1)
 * @nudo:contract x positive
 */
export function f(x) { return x; }
`;

  it("list / find / contract 指向同一函数与注释块", () => {
    expect(listFnDirectiveScopes(parseSource(src)).map((s) => s.name)).toContain("f");
    const scope = findFnDirectiveScope(parseSource(src), "f");
    expect(scope).toBeDefined();
    expect(scope!.commentLines.some((l) => l.includes("@nudo:contract"))).toBe(true);
    expect(contractParamsOf(src, "f")).toEqual(["x"]);
  });
});
