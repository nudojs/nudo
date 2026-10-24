/**
 * Bug 1101 —— 文件级指令的**位置闸门**漏掉 **ArrayExpression（数组字面量体）**
 * 与 **ObjectPattern（解构模式体）** ⇒ 写在数组元素 / 解构键**上方**的
 * `/// @nudo:env` 被**静默提升**成**整文件** env（零诊断）。
 *
 * 根因：闸门区间只覆盖「函数体」（Bug 847）+「类体 / 对象字面量体」
 * （Bug 1088）；数组字面量体与解构模式体同属**嵌套体**，却**不在**闸门区间内
 * ⇒ 同族洞未闭合（两条通道**同口径**地漏，不是通道漂移）。
 *
 * 修法：闸门区间再纳入 `ArrayExpression` 与 `ObjectPattern`（+ 同族孪生
 * `ArrayPattern`）（parser AST 通道 + core 文本通道**孪生同款**）⇒ 数组元素 /
 * 解构键上方的文件级指令被拦下（不提升 + `nudo:directive-syntax` 告警，
 * **既有诊断码**）。
 *
 * ⚠ 声明**上方**的顶层指令（`class A {` / `const a = [` / `const {` 之前）
 * 仍是合法的顶层位置 ⇒ 放行（对照组）。
 */
import { describe, it, expect } from "vitest";
import { extractFileEnvNames, extractMockModuleRecords } from "@nudojs/core";
import { parse } from "../parse.ts";
import {
  extractDirectives,
  extractFileDirectives,
  type DirectiveDiag,
} from "../directives.ts";

function fileDiags(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  extractFileDirectives(parse(src), { diags });
  return diags;
}

/** parser AST 通道抽到的 env 名（文件级）。 */
function parserEnvs(src: string): string[] {
  return extractFileDirectives(parse(src), { diags: [] })
    .filter((d) => d.kind === "env")
    .flatMap((d) => d.envs);
}

/** parser AST 通道抽到的 mock-module 记录（归一化，与 core 文本通道同形）。 */
function parserMockModules(src: string): Array<{
  source: string;
  names?: string[];
  fromPath: string;
}> {
  return extractFileDirectives(parse(src), { diags: [] })
    .filter((d) => d.kind === "mock-module")
    .map((d) => ({
      source: d.source,
      ...(d.names ? { names: d.names } : {}),
      fromPath: d.fromPath,
    }));
}

/** core 文本通道抽到的 mock-module 记录（同形归一化）。 */
function coreMockModules(src: string): Array<{
  source: string;
  names?: string[];
  fromPath: string;
}> {
  return extractMockModuleRecords(src).map((r) => ({
    source: r.source,
    ...(r.names ? { names: r.names } : {}),
    fromPath: r.fromPath,
  }));
}

// ---------------------------------------------------------------------------
// 样例（Bug 1101 新增两类嵌套体）
// ---------------------------------------------------------------------------

/** 数组字面量体：元素上方的文件级指令。 */
const ENV_IN_ARRAY = `export const a = [
  /// @nudo:env node
  1,
];
`;

/** 解构模式体（`ObjectPattern`）：键上方的文件级指令。 */
const ENV_IN_OBJECT_PATTERN = `export const {
  /// @nudo:env node
  a,
} = obj;
`;

/** 数组解构模式体（`ArrayPattern`，`ObjectPattern` 的同族孪生）：元素上方的文件级指令。 */
const ENV_IN_ARRAY_PATTERN = `export const [
  /// @nudo:env node
  a,
] = arr;
`;

/** 数组字面量体里的 mock-module。 */
const MOCK_MODULE_IN_ARRAY = `export const a = [
  /// @nudo:mock-module "fs" from "./mock-fs.js"
  1,
];
`;

/** 解构模式体里的 mock-module。 */
const MOCK_MODULE_IN_OBJECT_PATTERN = `export const {
  /// @nudo:mock-module "fs" from "./mock-fs.js"
  a,
} = obj;
`;

/** 更深一层：数组里的数组。 */
const ENV_IN_NESTED_ARRAY = `export const a = [
  [
    /// @nudo:env node
    1,
  ],
];
`;

// ---------------------------------------------------------------------------
// 验收 1 / 2：数组字面量体 + 解构模式体
// ---------------------------------------------------------------------------

describe("Bug 1101: file-level directives in an array / destructuring body are not file scope", () => {
  it("`/// @nudo:env node` above an array element is not promoted + is diagnosed", () => {
    const diags = fileDiags(ENV_IN_ARRAY);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("at the top of the file");
    expect(extractFileDirectives(parse(ENV_IN_ARRAY), { diags: [] })).toEqual([]);
    // core 文本通道：同一口径 ⇒ 同样不生效
    expect(extractFileEnvNames(ENV_IN_ARRAY)).toEqual([]);
  });

  it("`/// @nudo:env node` above a destructuring key is not promoted + is diagnosed", () => {
    const diags = fileDiags(ENV_IN_OBJECT_PATTERN);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("at the top of the file");
    expect(extractFileDirectives(parse(ENV_IN_OBJECT_PATTERN), { diags: [] })).toEqual([]);
    expect(extractFileEnvNames(ENV_IN_OBJECT_PATTERN)).toEqual([]);
  });

  it("`/// @nudo:env node` above an array-pattern element is not promoted + is diagnosed", () => {
    const diags = fileDiags(ENV_IN_ARRAY_PATTERN);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("at the top of the file");
    expect(extractFileDirectives(parse(ENV_IN_ARRAY_PATTERN), { diags: [] })).toEqual([]);
    expect(extractFileEnvNames(ENV_IN_ARRAY_PATTERN)).toEqual([]);
  });

  it("`/// @nudo:mock-module` above an array element is not promoted + is diagnosed", () => {
    const diags = fileDiags(MOCK_MODULE_IN_ARRAY);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(extractFileDirectives(parse(MOCK_MODULE_IN_ARRAY), { diags: [] })).toEqual([]);
    expect(extractMockModuleRecords(MOCK_MODULE_IN_ARRAY)).toEqual([]);
  });

  it("`/// @nudo:mock-module` above a destructuring key is not promoted + is diagnosed", () => {
    const diags = fileDiags(MOCK_MODULE_IN_OBJECT_PATTERN);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(extractFileDirectives(parse(MOCK_MODULE_IN_OBJECT_PATTERN), { diags: [] })).toEqual([]);
    expect(extractMockModuleRecords(MOCK_MODULE_IN_OBJECT_PATTERN)).toEqual([]);
  });

  it("a nested array body is gated too (deeper nesting)", () => {
    const diags = fileDiags(ENV_IN_NESTED_ARRAY);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(extractFileDirectives(parse(ENV_IN_NESTED_ARRAY), { diags: [] })).toEqual([]);
    expect(extractFileEnvNames(ENV_IN_NESTED_ARRAY)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 验收 3：类体 / 对象字面量体（Bug 1088 / 1090 行为不得回退）
// ---------------------------------------------------------------------------

describe("Bug 1101: the class / object body gate (Bug 1088) is not regressed", () => {
  it("`/// @nudo:env node` above a class method is still blocked + diagnosed", () => {
    const src = `export class A {\n  /// @nudo:env node\n  m() {\n    return 1;\n  }\n}\n`;
    const diags = fileDiags(src);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([]);
    expect(extractFileEnvNames(src)).toEqual([]);
  });

  it("`/// @nudo:env node` above a class field is still blocked + diagnosed", () => {
    const src = `export class A {\n  /// @nudo:env node\n  x = 1;\n}\n`;
    const diags = fileDiags(src);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([]);
    expect(extractFileEnvNames(src)).toEqual([]);
  });

  it("`/// @nudo:env node` above an object-literal method is still blocked + diagnosed", () => {
    const src = `export const o = {\n  /// @nudo:env node\n  m() {\n    return 1;\n  },\n};\n`;
    const diags = fileDiags(src);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([]);
    expect(extractFileEnvNames(src)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 验收 4 / 5：合法顶层位置放行（不得过度拦截）
// ---------------------------------------------------------------------------

describe("Bug 1101: legal top-level positions still pass (no over-blocking)", () => {
  it("a top-of-file directive still works", () => {
    const src = `/// @nudo:env node\nexport function f() {\n  return 1;\n}\n`;
    expect(fileDiags(src)).toEqual([]);
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([
      { kind: "env", envs: ["node"] },
    ]);
    expect(extractFileEnvNames(src)).toEqual(["node"]);
  });

  it("a directive above a class declaration still works", () => {
    const src = `/// @nudo:env node\nexport class A {\n  m() {\n    return 1;\n  }\n}\n`;
    expect(fileDiags(src)).toEqual([]);
    expect(parserEnvs(src)).toEqual(["node"]);
    expect(extractFileEnvNames(src)).toEqual(["node"]);
  });

  it("a directive above an object literal statement still works", () => {
    const src = `/// @nudo:env node\nexport const o = {\n  a: 1,\n};\n`;
    expect(fileDiags(src)).toEqual([]);
    expect(parserEnvs(src)).toEqual(["node"]);
    expect(extractFileEnvNames(src)).toEqual(["node"]);
  });

  it("a directive above an array literal statement still works", () => {
    const src = `/// @nudo:env node\nexport const a = [1, 2];\n`;
    expect(fileDiags(src)).toEqual([]);
    expect(parserEnvs(src)).toEqual(["node"]);
    expect(extractFileEnvNames(src)).toEqual(["node"]);
  });

  it("a directive above a destructuring declaration still works", () => {
    const src = `/// @nudo:env node\nexport const { a, b } = obj;\n`;
    expect(fileDiags(src)).toEqual([]);
    expect(parserEnvs(src)).toEqual(["node"]);
    expect(extractFileEnvNames(src)).toEqual(["node"]);
  });

  it("a directive above an array-destructuring declaration still works", () => {
    const src = `/// @nudo:env node\nexport const [a, b] = arr;\n`;
    expect(fileDiags(src)).toEqual([]);
    expect(parserEnvs(src)).toEqual(["node"]);
    expect(extractFileEnvNames(src)).toEqual(["node"]);
  });

  it("a top-level directive after an array literal still works", () => {
    const src = `export const a = [1, 2];\n/// @nudo:env node\n`;
    expect(fileDiags(src)).toEqual([]);
    expect(parserEnvs(src)).toEqual(["node"]);
    expect(extractFileEnvNames(src)).toEqual(["node"]);
  });
});

// ---------------------------------------------------------------------------
// 验收 6：函数级语义不变
// ---------------------------------------------------------------------------

describe("Bug 1101: function-level directive semantics are unchanged", () => {
  it("`@nudo:env` in a function body is still diagnosed + not promoted (Bug 847)", () => {
    const src = `export function f() {\n  /// @nudo:env node\n  return 1;\n}\n`;
    const diags = fileDiags(src);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([]);
    expect(extractFileEnvNames(src)).toEqual([]);
  });

  it("a function-level `@nudo:case` above a function declaration is still bound to it", () => {
    const src = `/// @nudo:env node\n/// @nudo:case "c1" (1) => 2\nexport function f(a) {\n  return a + 1;\n}\n`;
    const fns = extractDirectives(parse(src), { diags: [] });
    const f = fns.find((x) => x.name === "f");
    expect(f).toBeDefined();
    expect(f!.directives.some((d) => d.kind === "case")).toBe(true);
    // 文件级闸门不牵连函数级指令：同一文件里的 `@nudo:env` 仍按顶层放行
    expect(parserEnvs(src)).toEqual(["node"]);
    expect(extractFileEnvNames(src)).toEqual(["node"]);
  });

  it("a function-level `@nudo:case` above a class method is still bound to it", () => {
    const src = `export class Calculator {\n  /// @nudo:case "c1" (1, 2) => 3\n  add(a, b) {\n    return a + b;\n  }\n}\n`;
    const fns = extractDirectives(parse(src), { diags: [] });
    const m = fns.find((x) => x.name === "Calculator.add");
    expect(m).toBeDefined();
    expect(m!.directives.some((d) => d.kind === "case")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 验收 7：两条通道逐例一致
// ---------------------------------------------------------------------------

const SAMPLES: Array<{ name: string; src: string }> = [
  {
    name: "class body — method above",
    src: `export class A {\n  /// @nudo:env node\n  m() {\n    return 1;\n  }\n}\n`,
  },
  {
    name: "class body — field above",
    src: `export class A {\n  /// @nudo:env node\n  x = 1;\n}\n`,
  },
  {
    name: "class body — constructor above",
    src: `export class A {\n  /// @nudo:env node\n  constructor() {\n    this.x = 1;\n  }\n}\n`,
  },
  {
    name: "nested class body",
    src: `export class A {\n  static inner = class B {\n    /// @nudo:env node\n    m() {\n      return 1;\n    }\n  };\n}\n`,
  },
  {
    name: "object literal body — method above",
    src: `export const o = {\n  /// @nudo:env node\n  m() {\n    return 1;\n  },\n};\n`,
  },
  {
    name: "object literal body — property above",
    src: `export const o = {\n  /// @nudo:env node\n  a: 1,\n};\n`,
  },
  {
    name: "array literal body — element above",
    src: `export const a = [\n  /// @nudo:env node\n  1,\n];\n`,
  },
  {
    name: "array literal body — nested array above",
    src: `export const a = [\n  [\n    /// @nudo:env node\n    1,\n  ],\n];\n`,
  },
  {
    name: "object pattern body — key above",
    src: `export const {\n  /// @nudo:env node\n  a,\n} = obj;\n`,
  },
  {
    name: "array pattern body — element above",
    src: `export const [\n  /// @nudo:env node\n  a,\n] = arr;\n`,
  },
  {
    name: "function body",
    src: `export function f() {\n  /// @nudo:env node\n  return 1;\n}\n`,
  },
  {
    name: "top of file",
    src: `/// @nudo:env node\nexport function f() {\n  return 1;\n}\n`,
  },
  {
    name: "above a class declaration",
    src: `/// @nudo:env node\nexport class A {\n  m() {\n    return 1;\n  }\n}\n`,
  },
  {
    name: "above an object literal statement",
    src: `/// @nudo:env node\nexport const o = {\n  a: 1,\n};\n`,
  },
  {
    name: "above an array literal statement",
    src: `/// @nudo:env node\nexport const a = [1, 2];\n`,
  },
  {
    name: "above a destructuring declaration",
    src: `/// @nudo:env node\nexport const { a, b } = obj;\n`,
  },
  {
    name: "above an array-destructuring declaration",
    src: `/// @nudo:env node\nexport const [a, b] = arr;\n`,
  },
  {
    name: "top-level switch body",
    src: `export const x = 1;\nswitch (x) {\n  case 1:\n    /// @nudo:env node\n    break;\n  default:\n    break;\n}\n`,
  },
  {
    name: "top-level try block",
    src: `export const x = 1;\ntry {\n  /// @nudo:env node\n  x;\n} catch {\n  x;\n}\n`,
  },
  {
    name: "switch inside a function body",
    src: `export function f(x) {\n  switch (x) {\n    case 1:\n      /// @nudo:env node\n      return 1;\n    default:\n      return 0;\n  }\n}\n`,
  },
  {
    name: "TS interface body",
    src: `interface Foo {\n  /// @nudo:env node\n  a: string;\n}\nexport const x = 1;\n`,
  },
  {
    name: "mock-module above an array element",
    src: `export const a = [\n  /// @nudo:mock-module "fs" from "./mock-fs.js"\n  1,\n];\n`,
  },
  {
    name: "mock-module above a destructuring key",
    src: `export const {\n  /// @nudo:mock-module "fs" from "./mock-fs.js"\n  a,\n} = obj;\n`,
  },
  {
    name: "mock-module at top of file",
    src: `/// @nudo:mock-module "fs" from "./mock-fs.js"\nexport const a = 1;\n`,
  },
];

describe("Bug 1101: the parser AST channel and the core text channel agree case by case", () => {
  it.each(SAMPLES.map((s) => [s.name, s.src] as const))(
    "env extraction matches on: %s",
    (_name, src) => {
      expect(parserEnvs(src)).toEqual(extractFileEnvNames(src));
    },
  );

  it.each(SAMPLES.map((s) => [s.name, s.src] as const))(
    "mock-module extraction matches on: %s",
    (_name, src) => {
      expect(parserMockModules(src)).toEqual(coreMockModules(src));
    },
  );
});
