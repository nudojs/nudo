/**
 * Bug 448 —— TS 的 `this` 形参未剥 ⇒ 产物 `function f(this, a)` Node 加载不了。
 *
 * 根因：Babel 把 TS 的 `this` 形参表示成**一个名叫 `this` 的 `Identifier`**，
 * 而 strip-types.ts 的 `deleteTypeSyntaxFields` 只删它的 `typeAnnotation`
 * ⇒ 打印出来是 `function f(this, a)`；`this` 不是合法形参名（strict 与 sloppy
 * 都不允许）⇒ 产物不是合法 JS。
 *
 * 修法：把 `this` 形参从**形参数组**里删掉（不是只删 typeAnnotation），
 * 与 tsc 的 emitter 同口径。
 */
import { describe, it, expect } from "vitest";
import { parseSource } from "../index.ts";

type Fn = { params?: { type?: string; name?: string }[]; body?: { body?: { type: string; argument?: { type: string } }[] } };

/** 取源码里第一个函数（声明或表达式）的节点 */
const fnOf = (src: string): Fn => {
  const decl = parseSource(src).program.body[0] as unknown as {
    declaration?: Fn & { declarations?: { init?: Fn }[] };
  };
  const d = decl?.declaration;
  if (d?.params) return d;
  return d?.declarations?.[0]?.init ?? {};
};

describe("Bug 448: TS 的 this 形参从形参数组里删除", () => {
  it("function f(this: T, a) ⇒ 只剩 a", () => {
    const fn = fnOf(`export function f(this: { x: number }, a: number): number { return a + 1; }`);
    expect(fn.params?.map((p) => p.name)).toEqual(["a"]);
  });

  it("this 是唯一的形参 ⇒ 形参表为空", () => {
    const fn = fnOf(`export function f(this: { x: number }): number { return 1; }`);
    expect(fn.params).toEqual([]);
  });

  it("函数表达式同理", () => {
    const fn = fnOf(`export const f = function (this: { x: number }, a: number) { return a; };`);
    expect(fn.params?.map((p) => p.name)).toEqual(["a"]);
  });

  it("普通形参不受影响（this 之外的名字保留）", () => {
    const fn = fnOf(`export function f(a: number, b: string) { return a; }`);
    expect(fn.params?.map((p) => p.name)).toEqual(["a", "b"]);
  });

  it("函数体里的 this 表达式保留（只有形参位删）", () => {
    const src = `export function f(this: { x: number }) { return this.x; }`;
    const fn = fnOf(src);
    const stmt = fn.body?.body?.[0];
    expect(stmt?.type).toBe("ReturnStatement");
    expect(stmt?.argument?.type).toBe("MemberExpression");
  });
});
