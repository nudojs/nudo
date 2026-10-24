/**
 * Bug 1092 回归：core **文本路径**（`directive-scan.ts`）的文件级指令位置闸门
 * 漏掉 **class 体 / 对象字面量体** ⇒ 方法 / 字段上方的 `/// @nudo:env web`
 * 被**静默提升**成**整文件** env（零诊断）。
 *
 * 根因：`functionBodyRanges` 的区间是「函数站点」区间；对 `ClassMethod` /
 * `ObjectMethod`，Babel 给的 `node.start` 是**方法键**的位置 ⇒ 方法**上方**
 * 的行注释落在区间**之外** ⇒ 闸门不拦。
 *
 * 与 parser 的 AST 路径同款修复（`packages/parser/src/directives/file-directives.ts`
 * 的 `nestedBodyRanges`，见 `parser-bug-1090-file-directive-class-gate.test.ts`）：
 * 闸门区间另纳入「类体（`ClassBody`）」与「对象字面量体（`ObjectExpression`）」。
 *
 * ⚠ 类**声明上方**的注释（`/// @nudo:env node` 写在 `class A {` 之前）仍是
 * 合法顶层位置 ⇒ 不纳入 `ClassDeclaration` 整体。
 */
import { describe, it, expect } from "vitest";
import {
  extractFileEnvNames,
  extractMockModuleRecords,
  extractNudoImportRecords,
} from "../directive-scan.ts";

const ENV_IN_CLASS = `export class A {
  /// @nudo:env web
  m() {}
}
`;

const ENV_IN_OBJECT = `export const o = {
  /// @nudo:env web
  m() {},
};
`;

const MOCK_IN_CLASS = `export class A {
  /// @nudo:mock-module "fs" from "./mock-fs.js"
  m() {}
}
`;

const IMPORT_IN_CLASS = `export class A {
  /// @nudo:import { positive } from "./shapes.nudo.js"
  m() {}
}
`;

describe("Bug 1092: 文本路径 — class 体 / 对象体里的文件级指令不提升为文件级", () => {
  it("env inside a class body is not file-wide", () => {
    expect(extractFileEnvNames(ENV_IN_CLASS)).toEqual([]);
  });

  it("env inside an object literal body is not file-wide", () => {
    expect(extractFileEnvNames(ENV_IN_OBJECT)).toEqual([]);
  });

  it("mock-module inside a class body is not file-wide", () => {
    expect(extractMockModuleRecords(MOCK_IN_CLASS)).toEqual([]);
  });

  it("@nudo:import inside a class body is not file-wide", () => {
    expect(extractNudoImportRecords(IMPORT_IN_CLASS)).toEqual([]);
  });
});

describe("Bug 1092: 负控制（顶层位置不回归）", () => {
  it("class **声明上方**的 env 仍是文件级（合法顶层位置）", () => {
    expect(
      extractFileEnvNames(`/// @nudo:env node\nexport class A { m() {} }\n`),
    ).toEqual(["node"]);
  });

  it("文件头的 env 仍是文件级", () => {
    expect(extractFileEnvNames(`/// @nudo:env node\nexport function f() { return 1; }\n`)).toEqual([
      "node",
    ]);
  });

  it("class 体**之后**的顶层 env 仍是文件级", () => {
    expect(
      extractFileEnvNames(`export class A { m() {} }\n/// @nudo:env node\n`),
    ).toEqual(["node"]);
  });
});
