/**
 * 缺陷分册 04-contract-command · Bug 50 回归：
 * `nudo contract --draft` 把**嵌套 shape 的可选位**内移一层，草稿与证据相反。
 *
 * 旧 `toDraftBuilderDsl` 用 `([^,}\n]+)` 捕获 `k?: T` 的值 ⇒ 遇到嵌套
 * `shape({ … })` 的第一个 `}` 就截断，`.optional()` 被追加到**内层**
 * `number()` 上（外层变必填、内层变可选）。这里钉住「按括号配平取完整值
 * 边界」后的四组语义（含扁平对照，防止修嵌套时把既有语义改坏）。
 */
import { describe, it, expect } from "vitest";
import { toDraftBuilderDsl } from "../interface-draft.ts";

describe("Bug 50 · toDraftBuilderDsl 嵌套 shape 可选位", () => {
  it("扁平可选槽：k?: T → k: T.optional()（既有语义不回退）", () => {
    const dsl = toDraftBuilderDsl(`shape({ email?: string(), age: number() })`);
    expect(dsl).not.toMatch(/\w\?:/);
    expect(dsl).toContain("email: string().optional()");
    expect(dsl).toContain("age: number()");
    // 值本身已 .optional() ⇒ 不重复追加
    expect(toDraftBuilderDsl(`shape({ email?: string().optional() })`)).toContain(
      "email: string().optional()",
    );
  });

  it("嵌套 shape 外层可选：.optional() 追加到外层值，内层保持必填", () => {
    const dsl = toDraftBuilderDsl(`shape({ outer?: shape({ x: number() }) })`);
    expect(dsl).not.toMatch(/\w\?:/);
    expect(dsl).toContain("outer: shape({ x: number() }).optional()");
    // 旧正则的坏输出正是把可选位挪到内层 number() 上 —— 绝不能出现
    expect(dsl).not.toContain("x: number().optional()");
  });

  it("嵌套 + 内层也可选：内外各一层，互不吞并", () => {
    const dsl = toDraftBuilderDsl(`shape({ a?: shape({ x?: number() }) })`);
    expect(dsl).toContain("a: shape({ x: number().optional() }).optional()");
  });

  it("值内含逗号 / 嵌套调用时按括号配平取完整边界", () => {
    const dsl = toDraftBuilderDsl(`shape({ a?: union(number(), string()), b: number() })`);
    expect(dsl).toContain("a: union(number(), string()).optional()");
    expect(dsl).toContain("b: number()");
  });
});
