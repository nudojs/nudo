/**
 * Bug 399（S3 只落**模型层**）—— 默认形参**可省略**，形参表必须带
 * `optional` 标记。
 *
 * 根因：`requiredFnArity` 靠**名字后缀**（`...rest` / `?`）判「可省」，
 * 而默认形参在 `formalParamDisplayNames` 里被渲染成**光秃秃的名字**
 * ⇒ 既非 `...` 也非 `?` ⇒ 默认形参被计成必选元数。
 *
 * 修法（族 08 · AGENT-CONTEXT §4 裁决）：`FormalParam` 的每个变体带
 * `optional?: boolean` 标记（true = 该位可省略），消费侧（S1 的
 * `requiredFnArity`）改读这个标记，不再靠名字后缀猜。
 *
 * 语义：`optional === true` ⇔ 该形参位**可以省略**：
 * - `kind: "default"`（`f(a, b = 1)`）⇒ true（默认形参可省）
 * - `kind: "rest"`（`f(...args)`）⇒ true（rest 恒可省）
 * - `kind: "pattern"` 且带默认值（`f({ a } = {})`）⇒ true
 * - `kind: "id"` / 无默认值的 pattern ⇒ false（必填）
 *
 * 反向钉：HEAD（未修）上 `optional` 字段不存在（undefined）⇒ 断言**必失败**。
 */
import { describe, it, expect } from "vitest";
import { formalParamsFromNodes } from "../param-surface.ts";

describe("Bug 399 formal param optional marker", () => {
  it("default param is marked optional", () => {
    const formals = formalParamsFromNodes([
      { type: "Identifier", name: "a" },
      { type: "AssignmentPattern", left: { type: "Identifier", name: "b" } },
      { type: "RestElement", argument: { type: "Identifier", name: "args" } },
    ] as never);
    expect(formals[0]!.optional).toBe(false);
    expect(formals[1]!.optional).toBe(true);
    expect(formals[2]!.optional).toBe(true);
  });

  it("pattern with a default value is optional, bare pattern is not", () => {
    const withDefault = formalParamsFromNodes([
      {
        type: "AssignmentPattern",
        left: {
          type: "ObjectPattern",
          properties: [
            {
              type: "ObjectProperty",
              key: { type: "Identifier", name: "a" },
              value: { type: "Identifier", name: "a" },
            },
          ],
        },
      },
    ] as never);
    const bare = formalParamsFromNodes([
      {
        type: "ObjectPattern",
        properties: [
          {
            type: "ObjectProperty",
            key: { type: "Identifier", name: "a" },
            value: { type: "Identifier", name: "a" },
          },
        ],
      },
    ] as never);
    expect(withDefault[0]!.optional).toBe(true);
    expect(bare[0]!.optional).toBe(false);
  });

  it("the marker is independent of the display name (no name-suffix guessing)", () => {
    const formals = formalParamsFromNodes([
      { type: "AssignmentPattern", left: { type: "Identifier", name: "b" } },
    ] as never);
    // 名字不带 `?` / `...` 后缀 ⇒ 消费侧必须读 optional 标记
    const p = formals[0]!;
    expect(p.kind === "default" ? p.name : undefined).toBe("b");
    expect(p.optional).toBe(true);
  });
});
