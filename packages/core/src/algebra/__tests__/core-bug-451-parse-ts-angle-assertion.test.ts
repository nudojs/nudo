/**
 * Bug 451 —— 解析器**无条件**启用 `jsx` 插件 ⇒ `.ts`（非 `.tsx`）里**合法**的
 * 尖括号类型断言 `<T>x` 被 Babel 当成 JSX ⇒ **整文件解析失败**
 * （`check` / `test` / `export` / `migrate strip` 全废）。
 *
 * 根因：`parseSource(source, opts)` 拿不到文件名 ⇒ 对所有源一律
 * `["typescript", "jsx"]`；TS+JSX 双插件下 `<` 起始的表达式**优先**按 JSX 解析。
 *
 * 修法（路线 A，单文件 / 零调用面改动 / `parseSource` 签名不变）：
 * `packages/core/src/algebra/parse-source.ts` 的 `parseWithJsxFallback` ——
 * 解析**硬失败**时去掉 `jsx` **重试一次**。
 *
 * 已知**未覆盖**形态：`errorRecovery: true` 下 `<T>(x) => x`（泛型箭头无尾逗号）
 * 在 TS+JSX 下是「软成功」（errors=1、AST 失真）⇒ 不抛错 ⇒ 不触发重试。
 */
import { describe, it, expect } from "vitest";
import { parseSource, resetParseSourceCache } from "../parse-source.ts";
import { val } from "./eval-helpers.ts";

const TS_ANGLE = `const n = <number>1;
export function f(x: number): number {
  return x + n;
}
`;

describe("Bug 451: .ts 尖括号类型断言不再整文件解析失败", () => {
  it("无 filename 时 `<number>1` 解析成功（降级重试命中）", () => {
    resetParseSourceCache();
    const ast = parseSource(TS_ANGLE);
    expect(ast.program.body.length).toBe(2);
  });

  it("带 filename=x.ts 时同样解析成功", () => {
    resetParseSourceCache();
    const ast = parseSource(TS_ANGLE, { filename: "x.ts" });
    expect(ast.program.body.length).toBe(2);
  });

  it("引擎端到端：`<number>1` 求值为字面量 1（剥除面已就绪）", () => {
    resetParseSourceCache();
    const v = val(`const n = <number>1;
export function f() { return n; }
`);
    expect(v).toEqual({ ok: true, value: 1 });
  });

  it("泛型箭头 `<T>(x) => x`（无尾逗号）在硬失败路径下被重试救回", () => {
    resetParseSourceCache();
    const ast = parseSource(`const g = <T>(x: T) => x;
export function f(x: number) { return x; }
`);
    expect(ast.program.body.length).toBe(2);
  });

  it("真 JSX 源不受降级影响（TS+JSX 本就解析成功 ⇒ 不触发重试）", () => {
    resetParseSourceCache();
    const ast = parseSource(`export const el = <div a={1} />;
`);
    expect(ast.program.body.length).toBe(1);
  });

  it("模式分流仍在：`.ts` 收 TS 语法、`.js` 不收（缓存键含模式 ⇒ 不串味）", () => {
    resetParseSourceCache();
    const tsOnly = `const x: number = 1;
export function f() { return x; }
`;
    expect(parseSource(tsOnly, { filename: "x.ts" }).program.body.length).toBe(2);
    // `.js` 模式不开 typescript 插件 ⇒ TS 注解是**真语法错**（重试也救不回 ⇒ 仍抛）
    expect(() => parseSource(tsOnly, { filename: "x.js" })).toThrow();
  });
});
