/**
 * Bug 614 —— **standard 面**的返回面导出名与**符号来源耦合**：有契约返回叫
 * `<fn>Return`，走观测叫 `<fn>Output` ⇒ 同一函数在不同源码状态下拿到**不同
 * 名字** ⇒ 下游 `import { <fn>Output } from "*.nudo.standard"` 直接报错
 * （而同一次导出的 zod 面**恒叫** `<fn>Output` ⇒ 两面同物异名）。
 *
 * 修法（service 侧）：返回面的导出名**恒为 `<fn>Output`**（与 zod 面同名同义）
 * ——名字与来源**解耦**；内容仍按「契约返回优先，否则观测返回」取值。
 */
import { describe, it, expect } from "vitest";
import { num } from "@nudojs/core";
import { absToStandardSchemaFunction } from "../emit/standard-schema.ts";
import { loadGeneratedModule } from "../emit/__tests__/fixtures.ts";

describe("Bug 614: standard 返回面导出名恒为 <fn>Output（不随符号来源翻转）", () => {
  it("契约返回 ⇒ 恒叫 <fn>Output（不再叫 <fn>Return）", async () => {
    const { source } = absToStandardSchemaFunction({
      fn: "alpha",
      inputs: [{ name: "x", abs: num() }],
      returns: num(),
    });
    expect(source).toContain("export const alphaOutput");
    expect(source).not.toContain("export const alphaReturn");

    const mod = await loadGeneratedModule(source);
    expect(mod.alphaOutput).toBeDefined();
  });

  it("观测返回 ⇒ 同样叫 <fn>Output（两面同名同义）", async () => {
    const { source } = absToStandardSchemaFunction({
      fn: "alpha",
      inputs: [{ name: "x", abs: num() }],
      output: num(),
    });
    expect(source).toContain("export const alphaOutput");
    expect(source).not.toContain("export const alphaReturn");

    const mod = await loadGeneratedModule(source);
    expect(mod.alphaOutput).toBeDefined();
  });

  it("同一函数的两种来源 ⇒ 导出名集合相同（名字与来源解耦）", () => {
    const fromContract = absToStandardSchemaFunction({
      fn: "alpha",
      inputs: [{ name: "x", abs: num() }],
      returns: num(),
    }).source;
    const fromObservation = absToStandardSchemaFunction({
      fn: "alpha",
      inputs: [{ name: "x", abs: num() }],
      output: num(),
    }).source;

    const names = (src: string): string[] =>
      [...src.matchAll(/export const (\w+)/g)].map((m) => m[1]!);
    expect(names(fromContract)).toEqual(names(fromObservation));
    expect(names(fromContract)).toEqual(["alpha_x", "alphaInput", "alphaOutput"]);
  });

  it("契约返回优先于观测返回（内容口径不变，只是名字恒定）", async () => {
    const { source } = absToStandardSchemaFunction({
      fn: "alpha",
      inputs: [{ name: "x", abs: num() }],
      returns: num(),
      output: num(),
    });
    // 只有一个返回面导出（不因两条来源并存而多出同名声明）
    expect([...source.matchAll(/export const alphaOutput/g)].length).toBe(1);
    const mod = await loadGeneratedModule(source);
    expect(mod.alphaOutput!["~standard"].validate(1).issues).toBeUndefined();
  });
});
