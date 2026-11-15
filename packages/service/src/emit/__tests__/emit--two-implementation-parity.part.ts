/**
 * Bug 528 —— standard-schema 面**两份实现口径分叉**。
 *
 * 修前：库函数版 `checkNode` 的数组臂用 `value.forEach`（**跳过稀疏洞**），
 * 生成产物内联版用索引循环（**把洞当 `undefined` 报**）⇒ 同一 schema、同一
 * 数据，两个面给出**相反裁决**。
 *
 * 修后：两份实现都用索引循环（洞读作 `undefined`）——与 zod 面
 * （`z.array(z.number())` 对洞报 `received "undefined"`）和引擎把洞实体化成
 * undefined 的口径一致。
 *
 * 断言形态：**逐字相同**（两份实现的结果必须完全一致），且与 zod 同判。
 */
import { describe, it, expect } from "vitest";
import { abs, num } from "@nudojs/core";
import { absToSchemaNode } from "../schema-generator.ts";
import { absToStandardSchema, validateSchemaNode } from "../standard-schema.ts";
import { loadGeneratedModule } from "./fixtures.ts";

const arrOfNumber = () => abs({ k: "arr", element: num() }, undefined, undefined, "exact");

const sparse = (): number[] => {
  const a: number[] = [1, 2, 3];
  delete a[1];
  return a;
};

describe("Bug 528: 两份实现对稀疏数组必须同口径", () => {
  it("库函数版与生成产物版对稀疏洞给出逐字相同的结果", async () => {
    const { node } = absToSchemaNode(arrOfNumber());
    const { source } = absToStandardSchema(arrOfNumber(), { name: "xs" });
    const mod = await loadGeneratedModule(source);

    const lib = validateSchemaNode(node, sparse());
    const prod = mod.xs!["~standard"].validate(sparse());
    expect(JSON.stringify(prod)).toBe(JSON.stringify(lib));
    // 洞读作 undefined ⇒ 元素类型不符 ⇒ 拒绝（与 zod 面同判）
    expect(prod.issues).toBeDefined();
    expect(prod.issues?.[0]?.path).toEqual([1]);
    expect(prod.issues?.[0]?.message).toContain("expected number");
  });

  it("负控制：稠密数组两份实现都放行（不得把稠密数组误判成稀疏）", async () => {
    const { node } = absToSchemaNode(arrOfNumber());
    const { source } = absToStandardSchema(arrOfNumber(), { name: "xs" });
    const mod = await loadGeneratedModule(source);
    expect(validateSchemaNode(node, [1, 2, 3])).toEqual({ value: [1, 2, 3] });
    expect(mod.xs!["~standard"].validate([1, 2, 3])).toEqual({ value: [1, 2, 3] });
  });
});
