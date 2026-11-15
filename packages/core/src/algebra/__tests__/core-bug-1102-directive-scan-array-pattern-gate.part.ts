/**
 * Bug 1102 回归：core **文本路径**（`directive-scan.ts`）的文件级指令位置闸门
 * 漏掉 **array 字面量体（`ArrayExpression`）** 与 **解构模式体（`ObjectPattern`）**
 * ⇒ 写在数组元素 / 解构键**上方**的 `/// @nudo:env web` 被**静默提升**成
 * **整文件** env（零诊断）。
 *
 * 根因：闸门区间只覆盖「函数体」（Bug 847）+「类体 / 对象字面量体」
 * （Bug 1088）；数组字面量体与解构模式体同属**嵌套体**，却**不在**闸门区间内。
 *
 * 与 parser 的 AST 路径同款修复（`packages/parser/src/directives/file-directives.ts`
 * 的 `nestedBodyRanges`，见 `parser-bug-1101-file-directive-gate-hole.test.ts`）：
 * 闸门区间再纳入 `ArrayExpression` 与 `ObjectPattern`（+ 同族孪生
 * `ArrayPattern`）。
 *
 * ⚠ 声明**上方**的注释（`/// @nudo:env node` 写在 `class A {` / `const a = [` /
 * `const {` 之前）仍是合法顶层位置 ⇒ 放行（负控制）。
 */
import { describe, it, expect } from "vitest";
import {
  extractFileEnvNames,
  extractMockModuleRecords,
  extractNudoImportRecords,
} from "../directive-scan.ts";

const ENV_IN_ARRAY = `export const a = [
  /// @nudo:env web
  1,
];
`;

const ENV_IN_OBJECT_PATTERN = `export const {
  /// @nudo:env web
  a,
} = obj;
`;

/** 数组解构模式体（`ArrayPattern`，`ObjectPattern` 的同族孪生）。 */
const ENV_IN_ARRAY_PATTERN = `export const [
  /// @nudo:env web
  a,
] = arr;
`;

const ENV_IN_NESTED_ARRAY = `export const a = [
  [
    /// @nudo:env web
    1,
  ],
];
`;

const MOCK_IN_ARRAY = `export const a = [
  /// @nudo:mock-module "fs" from "./mock-fs.js"
  1,
];
`;

const IMPORT_IN_OBJECT_PATTERN = `export const {
  /// @nudo:import { positive } from "./shapes.nudo.js"
  a,
} = obj;
`;

describe("Bug 1102: 文本路径 — 数组体 / 解构模式体里的文件级指令不提升为文件级", () => {
  it("env inside an array literal body is not file-wide", () => {
    expect(extractFileEnvNames(ENV_IN_ARRAY)).toEqual([]);
  });

  it("env inside a destructuring pattern body is not file-wide", () => {
    expect(extractFileEnvNames(ENV_IN_OBJECT_PATTERN)).toEqual([]);
  });

  it("env inside an array-destructuring pattern body is not file-wide", () => {
    expect(extractFileEnvNames(ENV_IN_ARRAY_PATTERN)).toEqual([]);
  });

  it("env inside a nested array body is not file-wide", () => {
    expect(extractFileEnvNames(ENV_IN_NESTED_ARRAY)).toEqual([]);
  });

  it("mock-module inside an array body is not file-wide", () => {
    expect(extractMockModuleRecords(MOCK_IN_ARRAY)).toEqual([]);
  });

  it("@nudo:import inside a destructuring pattern body is not file-wide", () => {
    expect(extractNudoImportRecords(IMPORT_IN_OBJECT_PATTERN)).toEqual([]);
  });
});

describe("Bug 1102: 负控制（合法顶层位置不回归）", () => {
  it("数组**声明上方**的 env 仍是文件级", () => {
    expect(extractFileEnvNames(`/// @nudo:env node\nexport const a = [1, 2];\n`)).toEqual([
      "node",
    ]);
  });

  it("解构**声明上方**的 env 仍是文件级", () => {
    expect(extractFileEnvNames(`/// @nudo:env node\nexport const { a, b } = obj;\n`)).toEqual([
      "node",
    ]);
  });

  it("数组解构**声明上方**的 env 仍是文件级", () => {
    expect(extractFileEnvNames(`/// @nudo:env node\nexport const [a, b] = arr;\n`)).toEqual([
      "node",
    ]);
  });

  it("class **声明上方**的 env 仍是文件级（Bug 1088 口径不变）", () => {
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
