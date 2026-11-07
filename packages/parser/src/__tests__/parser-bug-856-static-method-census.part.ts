/**
 * Bug 856 判定钉：静态类方法在**两套**类成员收集器上口径相反。
 *
 * - core 的 `scan-top-functions`（`nudo check` 签名面）**收**静态方法
 *   （注释明写「static 与实例方法同为入口可见」）；
 * - parser 的 `classInstanceMethods`（`ast-guards.ts`）**跳过** static
 *   ⇒ service 的 `collectClassMethods`（`analyzer-ast.ts`）构造出的
 *   `analysis.functions` 里静态方法**不存在** ⇒ `nudo test` / `nudo health`
 *   / `nudo contract` 的函数普查与 `nudo check` 不一致。
 *
 * **裁决（主 agent）**：走 service 侧，用**已导出**的 `getClassMembers`
 * 自行收集 static ⇒ **不改** parser 已发布符号 `classInstanceMethods` 的
 * 契约（其 doc 明写「Skips … static members」），parser 导出面零变化。
 *
 * 本钉因此钉住两件事：
 *  ① parser 侧契约**不变**：`classInstanceMethods` 只收实例方法
 *     （防止有人顺手改语义，把 service 侧收口的前提改掉）；
 *  ② service 侧收口所需的**能力**已在 parser 导出面就位：
 *     `getClassMembers` **能看见** static 成员，且
 *     `classMemberKeyName` / `methodFunctionNode` 能读出它的 key 与函数体
 *     ——否则 service 侧无从收口（这正是本条的真落点）。
 */
import { describe, it, expect } from "vitest";
import type { ClassDeclaration } from "@babel/types";
import { parse } from "../parse.ts";
import {
  classInstanceMethods,
  classMemberKeyName,
  getClassMembers,
  methodFunctionNode,
} from "../ast-guards.ts";

const src = `
export class Util {
  static helper(x) { return x; }
  instanceMethod(y) { return y; }
}
`;

function utilClass(): ClassDeclaration {
  const ast = parse(src);
  const stmt = ast.program.body[0]!;
  if (stmt.type !== "ExportNamedDeclaration") throw new Error("expected export");
  const decl = stmt.declaration;
  if (!decl || decl.type !== "ClassDeclaration") throw new Error("expected class");
  return decl;
}

describe("Bug 856: static method census — parser contract + service-side precondition", () => {
  it("parser contract unchanged: classInstanceMethods skips static members", () => {
    const members = classInstanceMethods(utilClass());
    expect(members.map((m) => m.name)).toEqual(["instanceMethod"]);
  });

  it("service-side precondition: getClassMembers sees the static member", () => {
    const members = getClassMembers(utilClass());
    const statics = members.filter(
      (m) => (m as { static?: boolean }).static === true,
    );
    expect(statics).toHaveLength(1);
    expect(classMemberKeyName(statics[0]!)).toBe("helper");
    // 函数体可取（service 侧据此建 analysis.functions 条目）
    expect(methodFunctionNode(statics[0]!)).toBeDefined();
  });

  it("service-side precondition: instance member is visible too", () => {
    const members = classInstanceMethods(utilClass());
    expect(members.map((m) => m.name)).toEqual(["instanceMethod"]);
    expect(members[0]!.node.type).toBe("ClassMethod");
  });
});
