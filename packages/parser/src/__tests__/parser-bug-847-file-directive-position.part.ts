/**
 * Bug 847 —— **文件级** `@nudo:env` / `@nudo:mock-module` 写在**函数体内部**也被当成
 * 文件级指令 ⇒ 整文件 env / 模块替换被静默改写，**零诊断**。
 *
 * 根因：文件级指令的**作用域 = 词法位置**这一约束只在**块注释**分支被检查；行注释
 * 分支**没有位置闸门**。
 *
 * 位置闸门口径（与 core 文本路径同口径）：文件级指令**不得落在任何函数体内**；
 * 顶层位置（文件头 / `export` 行 / 语句之间）一律放行。
 */
import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import {
  extractFileDirectives,
  type DirectiveDiag,
} from "../directives.ts";

function fileDiags(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  extractFileDirectives(parse(src), { diags });
  return diags;
}

const ENV_IN_FN = `export function f(a) {
  /// @nudo:env node
  return process.pid;
}
`;

const MOCK_MODULE_IN_FN = `export function f(a) {
  /// @nudo:mock-module "fs" from "./mock-fs.js"
  return a;
}
`;

describe("Bug 847: file-level directives inside a function body are not file scope", () => {
  it("`/// @nudo:env node` in a function body is not promoted + is diagnosed", () => {
    const diags = fileDiags(ENV_IN_FN);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("at the top of the file");
    expect(extractFileDirectives(parse(ENV_IN_FN), { diags: [] })).toEqual([]);
  });

  it("`/// @nudo:mock-module` in a function body is not promoted + is diagnosed", () => {
    const diags = fileDiags(MOCK_MODULE_IN_FN);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("at the top of the file");
    expect(extractFileDirectives(parse(MOCK_MODULE_IN_FN), { diags: [] })).toEqual([]);
  });

  it("the same directive at the top of the file still works", () => {
    const src = `/// @nudo:env node\nexport function f() {\n  return 1;\n}\n`;
    expect(fileDiags(src)).toEqual([]);
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([
      { kind: "env", envs: ["node"] },
    ]);
  });

  it("a top-level directive after other statements still works (top level is allowed)", () => {
    const src = `export function g() {\n  return 1;\n}\n/// @nudo:env node\n`;
    expect(fileDiags(src)).toEqual([]);
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([
      { kind: "env", envs: ["node"] },
    ]);
  });

  it("a directive on an export line still works", () => {
    const src = `export /// @nudo:env node\nfunction f() {\n  return 1;\n}\n`;
    expect(fileDiags(src)).toEqual([]);
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([
      { kind: "env", envs: ["node"] },
    ]);
  });
});
