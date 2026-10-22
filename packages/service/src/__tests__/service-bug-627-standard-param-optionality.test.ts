/**
 * Bug 627 —— **standard 面**把契约「顶层形参的**可选性**」整条丢掉：顶层形参
 * 导出走的是**独立值节点**（不是对象槽）⇒ 结构上**无处挂 `optional`** ⇒
 * 发布的 `act_x` 校验器**运行时拒收**契约允许的 `undefined`
 * （契约 `number().optional()` ⇒ `act_x.validate(undefined)` 应通过）。
 *
 * 修法（service 侧）：
 * - `StandardSchemaFunctionSpec.inputs[].optional`（契约级可选性，同 dts 面
 *   `DtsContractFace.params[].optional` 口径）——`constraintToEntryAbs` 对标量
 *   契约丢掉 `isOptional`，故必须由契约面显式带过来；
 * - 声明级可选性（默认形参 `function f(a, b = 2)`）从 `spec.formals` 派生；
 * - 可选位的整参校验器 = `T | undefined`（与 zod 面 `.optional()` 同判据），
 *   `<fn>Input` 的对应槽位带 `optional`（键可缺席）。
 */
import { describe, it, expect } from "vitest";
import { num, type FormalParam } from "@nudojs/core";
import { absToStandardSchemaFunction } from "../emit/standard-schema.ts";
import { loadGeneratedModule } from "../emit/__tests__/fixtures.ts";

/** 声明级默认形参 `function f(a, b = 2)` 的形参表面。 */
const defaultFormals: FormalParam[] = [
  { kind: "id", name: "a", index: 0 },
  { kind: "default", name: "b", index: 1 },
];

describe("Bug 627: standard 顶层形参的可选性必须保真（接受 undefined）", () => {
  it("契约级可选位：整参校验器接受 undefined（契约 number().optional()）", async () => {
    const { source } = absToStandardSchemaFunction({
      fn: "act",
      inputs: [{ name: "x", abs: num(), optional: true }],
      formals: [{ kind: "id", name: "x", index: 0 }],
      output: num(),
    });
    const mod = await loadGeneratedModule(source);
    const validate = mod.act_x!["~standard"].validate;
    // 契约允许 undefined ⇒ 接受
    expect(validate(undefined).issues).toBeUndefined();
    // 正常值仍接受 / 错误类型仍拒绝
    expect(validate(1).issues).toBeUndefined();
    expect(validate("hello").issues).toBeDefined();
  });

  it("契约级可选位：<fn>Input 的槽位可缺席（键可缺、显式 undefined 合法）", async () => {
    const { source } = absToStandardSchemaFunction({
      fn: "act",
      inputs: [{ name: "x", abs: num(), optional: true }],
      formals: [{ kind: "id", name: "x", index: 0 }],
      output: num(),
    });
    const mod = await loadGeneratedModule(source);
    const validate = mod.actInput!["~standard"].validate;
    expect(validate({}).issues).toBeUndefined();
    expect(validate({ x: undefined }).issues).toBeUndefined();
    expect(validate({ x: 1 }).issues).toBeUndefined();
    expect(validate({ x: "hello" }).issues).toBeDefined();
  });

  it("声明级可选位（默认形参）同样保真", async () => {
    const { source } = absToStandardSchemaFunction({
      fn: "f",
      inputs: [
        { name: "a", abs: num() },
        { name: "b", abs: num() },
      ],
      formals: defaultFormals,
      output: num(),
    });
    const mod = await loadGeneratedModule(source);
    expect(mod.f_b!["~standard"].validate(undefined).issues).toBeUndefined();
    expect(mod.f_a!["~standard"].validate(undefined).issues).toBeDefined();
  });

  it("负控制：未申报可选的位仍拒收 undefined", async () => {
    const { source } = absToStandardSchemaFunction({
      fn: "act",
      inputs: [{ name: "x", abs: num() }],
      formals: [{ kind: "id", name: "x", index: 0 }],
      output: num(),
    });
    const mod = await loadGeneratedModule(source);
    expect(mod.act_x!["~standard"].validate(undefined).issues).toBeDefined();
    const validate = mod.actInput!["~standard"].validate;
    expect(validate({}).issues).toBeDefined();
  });
});
