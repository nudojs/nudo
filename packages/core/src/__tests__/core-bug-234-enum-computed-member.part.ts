/**
 * BUG-234 —— TS enum 的**计算成员**原样保留初始化表达式（不把成员引用改写成
 * `E["A"]`）⇒ strip 产物引用**未绑定全局** ⇒ 运行时 ReferenceError。
 *
 * 根因：`strip-types.ts` 的 `synthesizeEnum` 对计算成员只做
 * `transformValue(init)` 就抄进 IIFE ⇒ `B = A * 10` 里的 `A` 保持裸标识符。
 * 而 tsc 的 emit 会把成员引用改写成 `E["A"]`（常量可折叠时进一步折叠）。
 *
 * 本文件钉**合成 AST 的运行期形态**（不是源码文本）：
 * - 计算成员的初始化表达式里，成员引用必须是 `E["KEY"]`（MemberExpression）；
 * - 同一函数里自动递增成员（`C`）本来就用 `E["B"] + 1` —— 两种口径必须一致；
 * - 字符串值的计算成员**不**建反向映射（tsc 口径）。
 *
 * 反向闸：把 `rewriteEnumMemberRefs` 去掉 ⇒ 第 1/2 条的 `E["A"]` 断言必红。
 */
import { describe, it, expect } from "vitest";
import { parseSource } from "../index.ts";
import { stripTypes } from "../strip-types.ts";

/** `enum E { … }` 的合成 IIFE 语句数组（`export enum` 也接受） */
function enumStmts(src: string): Array<Record<string, unknown>> {
  const ast = parseSource(src, { keepTs: true });
  const report: Record<string, unknown> = {};
  stripTypes(ast, undefined, { report });
  const program = ast.program as unknown as { body: Array<Record<string, unknown>> };
  const first = program.body[0]!;
  const decl = (first.type === "ExportNamedDeclaration" ? first.declaration : first) as Record<
    string,
    unknown
  >;
  expect(decl.type).toBe("VariableDeclaration");
  const declarations = decl.declarations as Array<Record<string, unknown>>;
  const init = declarations[0]!.init as Record<string, unknown>;
  expect(init.type).toBe("CallExpression");
  const callee = init.callee as Record<string, unknown>;
  const fnBody = callee.body as { body: Array<Record<string, unknown>> };
  // 最后一条是 `return E`
  return fnBody.body.slice(0, -1).map((s) => {
    const statement = s as Record<string, unknown>;
    return statement.expression as Record<string, unknown>;
  });
}

/** `E[E["KEY"] = <value>] = "KEY"` → 取 `<value>`；字符串成员取右侧 */
function assignedValue(expr: Record<string, unknown>): Record<string, unknown> {
  const left = expr.left as Record<string, unknown>;
  // 数值成员：left = MemberExpression{ object: E, property: AssignmentExpression }
  if (left.type === "MemberExpression") {
    const inner = left.property as Record<string, unknown>;
    expect(inner.type).toBe("AssignmentExpression");
    return inner.right as Record<string, unknown>;
  }
  // 字符串成员：left = MemberExpression{ object: E, property: "KEY" }
  return expr.right as Record<string, unknown>;
}

/** 初始化表达式里出现的裸标识符名（引用位置；排除被改写后的 MemberExpression） */
function bareIdentifiers(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== "object") return out;
  const rec = node as Record<string, unknown>;
  if (rec.type === "Identifier" && typeof rec.name === "string") {
    out.push(rec.name);
    return out;
  }
  for (const key of Object.keys(rec)) {
    if (key === "loc" || key === "start" || key === "end" || key === "extra") continue;
    const child = rec[key];
    if (child && typeof child === "object") bareIdentifiers(child, out);
  }
  return out;
}

describe("Bug 234: enum 计算成员里的成员引用必须改写成 E[\"KEY\"]", () => {
  it("数值 enum：`B = A * 10` 的 A 变成 E[\"A\"]（不再是未绑定全局）", () => {
    const stmts = enumStmts(`export enum E { A = 1, B = A * 10, C }`);
    const b = assignedValue(stmts[1]!);
    expect(b.type).toBe("BinaryExpression");
    const left = b.left as Record<string, unknown>;
    expect(left.type).toBe("MemberExpression");
    expect(left.computed).toBe(true);
    expect((left.object as { name?: string }).name).toBe("E");
    expect((left.property as { value?: string }).value).toBe("A");
    // 反向闸：产物里不得再有裸 `A`（正是运行期 ReferenceError 的来源）
    expect(bareIdentifiers(b)).not.toContain("A");
  });

  it("同一 enum 的自动递增成员仍用 E[\"B\"] + 1（两种口径一致）", () => {
    const stmts = enumStmts(`export enum E { A = 1, B = A * 10, C }`);
    const c = assignedValue(stmts[2]!);
    expect(c.type).toBe("BinaryExpression");
    expect((c.operator as string)).toBe("+");
    const left = c.left as Record<string, unknown>;
    expect(left.type).toBe("MemberExpression");
    expect((left.property as { value?: string }).value).toBe("B");
  });

  it("混合 enum：`C = A + 5` 的 A 也改写成 E[\"A\"]", () => {
    const stmts = enumStmts(`export enum E { A = 1, B = 'b', C = A + 5 }`);
    const c = assignedValue(stmts[2]!);
    const left = c.left as Record<string, unknown>;
    expect(left.type).toBe("MemberExpression");
    expect((left.property as { value?: string }).value).toBe("A");
    expect(bareIdentifiers(c)).not.toContain("A");
  });

  it("字符串 enum：`B = A + 'b'` 的 A 改写成 E[\"A\"]，且**不**建反向映射", () => {
    const stmts = enumStmts(`export enum E { A = 'a', B = A + 'b' }`);
    const expr = stmts[1]!;
    // 字符串成员：`E["B"] = …`（left 是 MemberExpression，property 不是赋值）
    const left = expr.left as Record<string, unknown>;
    expect(left.type).toBe("MemberExpression");
    const prop = left.property as Record<string, unknown>;
    expect(prop.type).toBe("StringLiteral");
    expect(prop.value).toBe("B");
    // 右侧的 A 已改写成 E["A"]
    const right = expr.right as Record<string, unknown>;
    const rightLeft = right.left as Record<string, unknown>;
    expect(rightLeft.type).toBe("MemberExpression");
    expect((rightLeft.property as { value?: string }).value).toBe("A");
    expect(bareIdentifiers(right)).not.toContain("A");
  });

  it("const enum：`B = A * 3` 同样改写成 E[\"A\"]", () => {
    const stmts = enumStmts(`export const enum E { A = 1, B = A * 3 }`);
    const b = assignedValue(stmts[1]!);
    const left = b.left as Record<string, unknown>;
    expect(left.type).toBe("MemberExpression");
    expect((left.property as { value?: string }).value).toBe("A");
  });

  it("剥除事实回报：enumComputedMemberRewritten 只在有计算成员时为真", () => {
    const plain: Record<string, unknown> = {};
    stripTypes(parseSource(`export enum E { A = 1, B }`, { keepTs: true }), undefined, {
      report: plain,
    });
    expect(plain.enumComputedMemberRewritten).toBeUndefined();

    const computed: Record<string, unknown> = {};
    stripTypes(parseSource(`export enum E { A = 1, B = A * 2 }`, { keepTs: true }), undefined, {
      report: computed,
    });
    expect(computed.enumComputedMemberRewritten).toBe(true);
  });
});
