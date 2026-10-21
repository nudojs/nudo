/**
 * Bug 539 —— **standard 面**对**解构形参**把契约的**字段级**条目**平铺成整参
 * 校验器**导出 ⇒ `act_a.validate({a:1,b:2})` 拒绝正确入参、`act_a.validate(1)`
 * 放行错误入参（双向都错）；且导出名与 zod 面（`<fn>Input`）不一致。
 *
 * 修后（产物生成侧，本分片）：入参面口径与 zod 面对齐——
 * - `<fn>Input`：校验**整个入参对象**（入参条目的对象投影）；
 * - `<fn>_<param>`：**整参**校验器（一个形参一个）；
 * - **解构形参的字段不提升为顶层整参校验器**（字段级校验器与整参校验器同名
 *   同形、语义却不同 ⇒ 消费方必然误用）。
 *
 * 负控制：具名形参（`act(a, b)`）的 `<fn>_<param>` 仍是真的整参校验器。
 */
import { describe, it, expect } from "vitest";
import { num, type Abs, type FormalParam } from "@nudojs/core";
import { absToStandardSchemaFunction } from "../standard-schema.ts";
import { loadGeneratedModule } from "./fixtures.ts";

/** 解构形参 `{ a, b }` 的形参表面（core `formalParamsFromNodes` 的形态）。 */
const patternFormals: FormalParam[] = [
  {
    kind: "pattern",
    placeholder: "_p0",
    bound: ["a", "b"],
    propKey: { a: "a", b: "b" },
    nested: [],
    nestedPaths: [],
    index: 0,
  },
];

/** 具名形参 `a, b` 的形参表面。 */
const namedFormals: FormalParam[] = [
  { kind: "id", name: "a", index: 0 },
  { kind: "id", name: "b", index: 1 },
];

describe("Bug 539: standard 入参面不得把解构字段平铺成整参校验器", () => {
  it("解构形参：出 `<fn>Input` 对象校验器，且**不出**字段级顶层校验器", async () => {
    const { source } = absToStandardSchemaFunction({
      fn: "act",
      inputs: [
        { name: "a", abs: num() },
        { name: "b", abs: num() },
      ],
      formals: patternFormals,
      returns: num(),
    });
    // 导出名口径与 zod 面对齐
    expect(source).toContain("export const actInput");
    // 字段级条目**不**提升为顶层整参校验器
    expect(source).not.toContain("export const act_a");
    expect(source).not.toContain("export const act_b");

    const mod = await loadGeneratedModule(source);
    const validate = mod.actInput!["~standard"].validate;
    // 正确入参（整个对象）被接受
    expect(validate({ a: 1, b: 2 }).issues).toBeUndefined();
    // 错误入参（裸数字 = 字段值冒充整参）被拒绝
    expect(validate(1).issues).toBeDefined();
    // 缺字段被拒绝
    expect(validate({ a: 1 }).issues).toBeDefined();
  });

  it("具名形参：`<fn>_<param>` 仍是真的整参校验器（负控制）", async () => {
    const { source } = absToStandardSchemaFunction({
      fn: "act",
      inputs: [
        { name: "a", abs: num() },
        { name: "b", abs: num() },
      ],
      formals: namedFormals,
      returns: num(),
    });
    expect(source).toContain("export const act_a");
    expect(source).toContain("export const act_b");
    expect(source).toContain("export const actInput");

    const mod = await loadGeneratedModule(source);
    // 整参校验器校验的是**这个形参的值**（不是整个入参对象）
    expect(mod.act_a!["~standard"].validate(1).issues).toBeUndefined();
    expect(mod.act_a!["~standard"].validate({ a: 1 }).issues).toBeDefined();
    // `<fn>Input` 校验整个入参对象
    expect(mod.actInput!["~standard"].validate({ a: 1, b: 2 }).issues).toBeUndefined();
  });

  it("返回面口径：契约返回 → `<fn>Return`；无契约返回 → `<fn>Output`", () => {
    const withReturn = absToStandardSchemaFunction({
      fn: "act",
      inputs: [{ name: "a", abs: num() }],
      returns: num(),
    });
    expect(withReturn.source).toContain("export const actReturn");
    expect(withReturn.source).not.toContain("export const actOutput");

    const withOutput = absToStandardSchemaFunction({
      fn: "act",
      inputs: [{ name: "a", abs: num() }],
      output: num(),
    });
    expect(withOutput.source).toContain("export const actOutput");
    expect(withOutput.source).not.toContain("export const actReturn");
  });

  it("没有形参表面时，全部条目按整参处理（退化口径不变）", () => {
    const { source } = absToStandardSchemaFunction({
      fn: "act",
      inputs: [{ name: "a", abs: num() }],
    });
    expect(source).toContain("export const act_a");
    expect(source).toContain("export const actInput");
  });
});
