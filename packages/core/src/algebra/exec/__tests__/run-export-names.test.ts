import { describe, it, expect } from "vitest";
import { stripStaticExportDecls } from "../export-names.ts";
import { transpile } from "../transpile.ts";

/**
 * 锁定 stripStaticExportDecls 从 transpile 生成 JS 回收的导出名（格式耦合面）。
 * 这些期望值刻意固定历史上被发现的名称：多声明式只收首个绑定。
 * `export ` 前缀只发给**真实源导出**（transpileFile 从源 AST 收集
 * exportedDeclNames）——未导出的顶层 function 不再被本函数回收；它们由
 * `sourceTopLevelFunctionNames` 交给 run.ts 建非枚举分析槽。
 * 解构导出不再收内部临时名（Bug 156：真实绑定走 `export { … }` 形态）。
 * 若 transpile 发射格式变化导致失败，须同步 stripStaticExportDecls 与本测试。
 */
describe("stripStaticExportDecls：导出名回收（与 transpile 发射格式耦合）", () => {
  const namesOf = (src: string) => stripStaticExportDecls(transpile(src)).names;

  it("export function 被回收", () => {
    expect(namesOf("export function foo(a){return a}")).toEqual(["foo"]);
  });

  it("非 export 顶层 function 不带 export 前缀 ⇒ 不被回收（私有函数不是导出）", () => {
    expect(namesOf("function bar(a){return a}")).toEqual([]);
    // 源 AST 口径同样不把私有函数当导出
    expect(stripStaticExportDecls(transpile("function bar(a){return a}"), "function bar(a){return a}").names).toEqual([]);
  });

  it("export const / export let 被回收", () => {
    expect(namesOf("export const x = 1;")).toEqual(["x"]);
    expect(namesOf("export let z = 5;")).toEqual(["z"]);
  });

  it("非 export 顶层 const 不回收（无 export 前缀）", () => {
    expect(namesOf("const y = 2;")).toEqual([]);
  });

  it("多声明式 export const a=1,b=2 只回收首个绑定 a（历史口径）", () => {
    expect(namesOf("export const a = 1, b = 2;")).toEqual(["a"]);
  });

  it("export 解构不再收内部临时名（Bug 156）：改由 export { p, q } 形态承载", () => {
    const names = namesOf("export const {p, q} = obj;");
    // 临时名 `_d<N>` 不再泄漏进静态声明导出名面
    expect(names.some((n) => /^_d\d+$/.test(n))).toBe(false);
    // 真实绑定走 `export { … }`（运行时改写成 __nudoExportLazy）
    const js = stripStaticExportDecls(transpile("export const {p, q} = obj;")).js;
    expect(js).toContain("export { p, q };");
  });

  it("export class 折成 export let X = $class，回收 X", () => {
    expect(namesOf("export class Foo {}")).toEqual(["Foo"]);
  });

  it("export default function 不入静态声明面（经 __nudoExport 通道）", () => {
    expect(namesOf("export default function dz(){return 1}")).toEqual([]);
  });

  it("顺序：先全部 function 名，后全部 const 名；去重", () => {
    const names = namesOf(
      "export const c1=1; export function f1(){} export const c2=2; export function f2(){}",
    );
    expect(names).toEqual(["f1", "f2", "c1", "c2"]);
  });

  it("剥掉 export 关键字：function→function、const/let→let", () => {
    const { js } = stripStaticExportDecls(transpile("export function foo(a){return a} export const x=1;"));
    expect(js).toMatch(/^function foo\(/m);
    expect(js).not.toMatch(/^export function/);
    expect(js).toMatch(/^let x =/m);
    expect(js).not.toMatch(/^export (?:const|let)/);
  });
});
