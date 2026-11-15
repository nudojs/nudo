/**
 * Bug 847 —— **文件级** `@nudo:env` / `@nudo:mock-module` / `@nudo:import` 写在
 * **函数体内部**也被当成文件级指令 ⇒ 整文件 env / 模块替换 / 约束模板被静默改写，
 * **零诊断**。
 *
 * 根因（core 文本路径）：`directiveCommentLinesRaw` 把注释**拍平成只带文本、不带
 * 位置**的列表，`extractFileEnvNames` / `extractMockModuleRecords` / `nudoImportPayloads`
 * 只按文本取载荷 ⇒ 函数体里的指令与文件顶部的指令**无法区分**。
 *
 * 位置闸门口径（与 parser AST 路径同口径）：文件级指令**不得落在任何函数体内**；
 * 顶层位置（文件头 / `export` 行 / 语句之间）一律放行。
 */
import { describe, it, expect } from "vitest";
import {
  extractFileEnvNames,
  extractMockModuleRecords,
  extractNudoImportRecords,
} from "../directive-scan.ts";

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

const IMPORT_IN_FN = `export function f(a) {
  /// @nudo:import { positive } from "./shapes.nudo.js"
  return a;
}
`;

describe("Bug 847: text-level file-level extraction is position-gated", () => {
  it("env inside a function body is not file-wide", () => {
    expect(extractFileEnvNames(ENV_IN_FN)).toEqual([]);
  });

  it("mock-module inside a function body is not file-wide", () => {
    expect(extractMockModuleRecords(MOCK_MODULE_IN_FN)).toEqual([]);
  });

  it("@nudo:import inside a function body is not file-wide", () => {
    expect(extractNudoImportRecords(IMPORT_IN_FN)).toEqual([]);
  });

  it("the same directives at the top of the file are honored", () => {
    expect(extractFileEnvNames(`/// @nudo:env node\nexport function f() { return 1; }\n`)).toEqual([
      "node",
    ]);
    expect(
      extractMockModuleRecords(
        `/// @nudo:mock-module "fs" from "./m.js"\nexport function f() { return 1; }\n`,
      ).map((r) => r.source),
    ).toEqual(["fs"]);
    expect(
      extractNudoImportRecords(
        `/// @nudo:import { positive } from "./std.nudo.js"\nexport function f() { return 1; }\n`,
      ),
    ).toHaveLength(1);
  });

  it("a top-level directive after other statements is still honored", () => {
    expect(
      extractFileEnvNames(`export function g() { return 1; }\n/// @nudo:env node\n`),
    ).toEqual(["node"]);
  });

  it("a directive on an export line is still honored", () => {
    expect(
      extractFileEnvNames(`export /// @nudo:env node\nfunction f() { return 1; }\n`),
    ).toEqual(["node"]);
  });
});
