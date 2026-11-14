/**
 * 性能回归钉：`listFnDirectiveScopes` 按 AST 对象缓存。
 *
 * `checkSource` 对每个函数调用 `findFnDirectiveScope(file, name)`；旧实现每次
 * 全量遍历 AST（O(函数数 × 节点数)）。实测 @babel/parser `lib/index.js`
 * （0.49 MB / 1259 scopes）单次遍历 52 ms，check 13 s 中约 54% 在该访问器；
 * 缓存后 check 4.7 s（−64%）。AST 在分析期不可变（parseSource 的 LRU 返回
 * 同一对象），因此按对象身份缓存不改变结果。
 */
import { describe, it, expect } from "vitest";
import { listFnDirectiveScopes, parseSource } from "../index.ts";

describe("directive scope scan cache", () => {
  it("同一 AST 的重复查询返回同一结果实例（只遍历一次）", () => {
    const ast = parseSource("export function f(a) { return a; }\nfunction g() {}\n");
    const first = listFnDirectiveScopes(ast);
    const second = listFnDirectiveScopes(ast);
    expect(second).toBe(first);
    expect(first.map((s) => s.name)).toContain("f");
  });

  it("不同 AST（不同源码）不共享结果", () => {
    const a = parseSource("function a() {}\n");
    const b = parseSource("function b() {}\n");
    expect(listFnDirectiveScopes(a).map((s) => s.name)).toContain("a");
    expect(listFnDirectiveScopes(b).map((s) => s.name)).toContain("b");
  });
});
