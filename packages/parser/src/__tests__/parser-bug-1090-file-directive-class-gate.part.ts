/**
 * Bug 1090 —— Bug 847 的「文件级指令**位置闸门**」漏掉 **class 体 / 对象字面量体**
 * ⇒ 方法（字段）**上方**的 `/// @nudo:env` 被**静默提升**成**整文件** env（零诊断）。
 *
 * 根因（`file-directives.ts` 的 `functionBodyRanges`）：闸门区间取自
 * `listFnDirectiveScopes` 的 `scope.node.start/end`；对 `ClassMethod` /
 * `ObjectMethod`，Babel 给的 `node.start` 是**方法键**的位置 ⇒ 方法**上方**的
 * 行注释落在区间**之外** ⇒ 不算 misplaced ⇒ 指令被提升成文件级。
 *
 * 修法：闸门区间再纳入**类体（`ClassBody`）**与**对象字面量体
 * （`ObjectExpression`）** ⇒ 方法 / 字段上方的注释一并被拦下（忽略 +
 * `nudo:directive-syntax` 告警），与函数体口径一致。
 *
 * ⚠ 类**声明上方**的注释（`/// @nudo:env node` 写在 `class A {` 之前）仍是
 * 合法的顶层位置 ⇒ 放行（对照组）。
 */
import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import { extractFileDirectives, type DirectiveDiag } from "../directives.ts";

function fileDiags(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  extractFileDirectives(parse(src), { diags });
  return diags;
}

/** 类体里、方法上方的文件级指令。 */
const ENV_IN_CLASS = `export class A {
  /// @nudo:env node
  m() {
    return 1;
  }
}
`;

/** 对象字面量里、方法上方的文件级指令。 */
const ENV_IN_OBJECT = `export const o = {
  /// @nudo:env node
  m() {
    return 1;
  },
};
`;

/** 类体里、字段上方的文件级指令。 */
const ENV_IN_CLASS_FIELD = `export class A {
  /// @nudo:env node
  x = 1;
}
`;

/** mock-module 同样受闸门约束。 */
const MOCK_MODULE_IN_CLASS = `export class A {
  /// @nudo:mock-module "fs" from "./mock-fs.js"
  m() {
    return 1;
  }
}
`;

describe("Bug 1090: file-level directives in a class / object body are not file scope", () => {
  it("`/// @nudo:env node` above a class method is not promoted + is diagnosed", () => {
    const diags = fileDiags(ENV_IN_CLASS);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("at the top of the file");
    expect(extractFileDirectives(parse(ENV_IN_CLASS), { diags: [] })).toEqual([]);
  });

  it("`/// @nudo:env node` above an object-literal method is not promoted + is diagnosed", () => {
    const diags = fileDiags(ENV_IN_OBJECT);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(extractFileDirectives(parse(ENV_IN_OBJECT), { diags: [] })).toEqual([]);
  });

  it("`/// @nudo:env node` above a class field is not promoted + is diagnosed", () => {
    const diags = fileDiags(ENV_IN_CLASS_FIELD);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(extractFileDirectives(parse(ENV_IN_CLASS_FIELD), { diags: [] })).toEqual([]);
  });

  it("`/// @nudo:mock-module` above a class method is not promoted + is diagnosed", () => {
    const diags = fileDiags(MOCK_MODULE_IN_CLASS);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(extractFileDirectives(parse(MOCK_MODULE_IN_CLASS), { diags: [] })).toEqual([]);
  });

  it("control: the same directive above the class declaration still works", () => {
    const src = `/// @nudo:env node\nexport class A {\n  m() {\n    return 1;\n  }\n}\n`;
    expect(fileDiags(src)).toEqual([]);
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([
      { kind: "env", envs: ["node"] },
    ]);
  });

  it("control: the same directive above the object literal statement still works", () => {
    const src = `/// @nudo:env node\nexport const o = {\n  a: 1,\n};\n`;
    expect(fileDiags(src)).toEqual([]);
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([
      { kind: "env", envs: ["node"] },
    ]);
  });

  it("control: a directive inside a function body is still diagnosed (Bug 847 unchanged)", () => {
    const src = `export function f(a) {\n  /// @nudo:env node\n  return 1;\n}\n`;
    const diags = fileDiags(src);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([]);
  });
});
