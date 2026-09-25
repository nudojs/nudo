import { describe, it, expect } from "vitest";
import { stripStaticExportDecls } from "../export-names.ts";
import { transpile } from "../transpile.ts";

/**
 * 锁定 stripStaticExportDecls 从 transpile 生成 JS 回收的导出名（格式耦合面）。
 * 这些期望值刻意固定历史上被发现的名称（含 quirk）：多声明式只收首个绑定、
 * 解构只收临时名、非 export 顶层 function 也带 export 前缀故被发现。
 * 若 transpile 发射格式变化导致失败，须同步 stripStaticExportDecls 与本测试。
 */
describe("stripStaticExportDecls：导出名回收（与 transpile 发射格式耦合）", () => {
  const namesOf = (src: string) => stripStaticExportDecls(transpile(src)).names;

  it("export function 被回收", () => {
    expect(namesOf("export function foo(a){return a}")).toEqual(["foo"]);
  });

  it("非 export 顶层 function 也带 export 前缀（exportKw）故被回收", () => {
    expect(namesOf("function bar(a){return a}")).toEqual(["bar"]);
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

  it("export 解构只回收临时名（历史口径），不回收解构出的 p/q", () => {
    const names = namesOf("export const {p, q} = obj;");
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^_d0_\d+$/);
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
