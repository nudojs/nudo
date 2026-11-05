/**
 * BUG-195 —— `@nudo:import` 的**行注释**形态写在函数体 / 类体 / 对象体 /
 * 数组体 / 解构模式体内 ⇒ **零诊断**地失效（core 文本路的位置闸门把它拦下，
 * 引用它的 `@nudo:contract` 被静默丢弃 ⇒ 门禁假绿）；而同一位置上的
 * **块注释**形态却会明确告警「这是文件级指令」⇒ 同一指令两形态口径相反。
 *
 * 根因：`packages/parser/src/directives/file-directives.ts` 的 misplaced 分支
 * 只认 `@nudo:env` / `@nudo:mock-module`（`warnMisplacedFileTagLine` 的标签
 * 联合类型里没有 `import`）⇒ `@nudo:import` 落在 `continue` 之前的 if 链外
 * ⇒ 无声丢弃。
 *
 * 断言非永真：改前函数体内的 `/// @nudo:import` 的诊断数为 **0**，文件头的
 * 形态也是 0（对照组改前改后都必须是 0）。
 */
import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import {
  extractFileDirectives,
  runWithDirectiveDiags,
  extractDirectives,
  type DirectiveDiag,
} from "../directives.ts";

function fileDiags(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  extractFileDirectives(parse(src), { diags });
  return diags;
}

function importDiags(src: string): DirectiveDiag[] {
  return fileDiags(src).filter((d) => d.message.includes("@nudo:import"));
}

describe("BUG-195 — 行注释形态的 @nudo:import 位置错位必须可见", () => {
  it("函数体内的 /// @nudo:import ⇒ 一条 nudo:directive-syntax（改前：零诊断）", () => {
    const diags = importDiags(`/**
 * @nudo:contract y positive
 */
export function bar(y) {
  /// @nudo:import { positive } from "./std.nudo.js"
  return y;
}
`);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("@nudo:import is a file-level directive");
    expect(diags[0]!.message).toContain("line comment inside");
  });

  it("文件头的 /// @nudo:import ⇒ 零该诊断（合法位置）", () => {
    const diags = importDiags(`/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:contract y positive
 */
export function bar(y) { return y; }
`);
    expect(diags).toEqual([]);
  });

  it("两种注释形态在同一位置**口径一致**（块注释原本就告警）", () => {
    const insideLine = importDiags(`export function bar(y) {
  /// @nudo:import { positive } from "./std.nudo.js"
  return y;
}
`);
    const insideBlock = importDiags(`export function bar(y) {
  /** @nudo:import { positive } from "./std.nudo.js" */
  return y;
}
`);
    expect(insideLine).toHaveLength(1);
    expect(insideBlock).toHaveLength(1);
    // 同一族诊断码（文案按形态分工，但都点名「文件级指令」）
    expect(insideLine[0]!.code).toBe(insideBlock[0]!.code);
    expect(insideBlock[0]!.message).toContain("@nudo:import is a file-level directive");
  });

  it("对象字面量体内的行注释形态同样告警（嵌套体闸门全族一致）", () => {
    const diags = importDiags(`export const conf = {
  /// @nudo:import { positive } from "./std.nudo.js"
  port: 1,
};
`);
    expect(diags).toHaveLength(1);
  });

  it("显式 diags 通道与 runWithDirectiveDiags 域都能收到（消费面无分叉）", () => {
    const src = `export function bar(y) {
  /// @nudo:import { positive } from "./std.nudo.js"
  return y;
}
`;
    const inDomain: DirectiveDiag[] = [];
    runWithDirectiveDiags(inDomain, () => {
      extractFileDirectives(parse(src));
    });
    expect(inDomain.filter((d) => d.message.includes("@nudo:import"))).toHaveLength(1);
    // 函数级抽取（同一份源码）不受影响：@nudo:import 不是函数级指令
    expect(extractDirectives(parse(src))).toEqual([]);
  });
});
