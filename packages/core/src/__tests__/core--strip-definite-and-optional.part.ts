/**
 * Bug 447 —— 类成员的 `x!`（确定赋值断言）/ `y?`（可选属性）/ `m?()`（可选方法）
 * 未剥 ⇒ 产物不是合法 JS（`node --check` ⇒ SyntaxError: Unexpected token '!' / '?'）。
 *
 * 根因：strip-types.ts 的 `deleteTypeSyntaxFields` 里
 * - `definite`（Babel 的 ClassProperty.definite）**根本没有**删除逻辑；
 * - `optional` 的删除白名单只有 Identifier / ObjectPattern / ArrayPattern /
 *   RestElement —— **不含类成员节点**。
 *
 * 修法：两个字段都在「只在类成员节点族上删」的块里删（与 accessibility /
 * readonly / abstract / override / declare 同块）。⚠ 表达式节点自己的
 * `optional`（`a?.b`）不是 TS 语法，不能动。
 */
import { describe, it, expect } from "vitest";
import { parseSource } from "../index.ts";

type Member = Record<string, unknown> & { type: string; key?: { name?: string } };

const classMembers = (src: string): Member[] => {
  const decl = parseSource(src).program.body.find(
    (n) => n.type === "ExportNamedDeclaration",
  ) as unknown as { declaration?: { body?: { body?: Member[] } } };
  return decl?.declaration?.body?.body ?? [];
};

describe("Bug 447: 类成员的 definite / optional 被剥除", () => {
  it("x!: number 的 definite 被删", () => {
    const members = classMembers(`export class A { x!: number; }`);
    expect(members).toHaveLength(1);
    expect(members[0].definite).toBeUndefined();
    expect("definite" in members[0]).toBe(false);
  });

  it("y?: string 的 optional 被删", () => {
    const members = classMembers(`export class A { y?: string; }`);
    expect(members[0].optional).toBeUndefined();
    expect("optional" in members[0]).toBe(false);
  });

  it("m?(): void {} 的 optional 被删（ClassMethod 同块）", () => {
    const members = classMembers(`export class A { m?(): void {} }`);
    expect(members[0].type).toBe("ClassMethod");
    expect(members[0].optional).toBeUndefined();
    expect("optional" in members[0]).toBe(false);
  });

  it("私有成员同理（#x! / #y?）", () => {
    const members = classMembers(`export class A { #x!: number; #y?: string; }`);
    for (const m of members) {
      expect(m.definite).toBeUndefined();
      expect(m.optional).toBeUndefined();
    }
  });

  it("表达式节点的 optional（a?.b）不受影响", () => {
    const decl = parseSource(`export const v = a?.b;`).program.body[0] as unknown as {
      declaration?: { declarations?: { init?: { type?: string; optional?: unknown } }[] };
    };
    const init = decl?.declaration?.declarations?.[0]?.init;
    expect(init?.type).toBe("OptionalMemberExpression");
    expect(init?.optional).toBe(true);
  });

  it("形参的 optional（a?: T）仍被删（既有行为）", () => {
    const decl = parseSource(`export function f(a?: number) { return a; }`).program.body[0] as unknown as {
      declaration?: { params?: { optional?: unknown }[] };
    };
    expect(decl?.declaration?.params?.[0].optional).toBeUndefined();
  });
});
