/**
 * TS rest 元组 `[T, ...U[]]` 的 Shape 播种与展示。
 *
 * Shape 模型本来就能表达 rest 元组（`{ k: "tuple", elements, rest }`），旧
 * 映射却把「变长」一律降级成 `arr(前缀 ∪ rest)` ⇒ 抹掉**位置**维度：
 * `[number, ...string[]]` 的 `t[0]` 恒 `number`（TS / 原生），引擎却折
 * `number | string`，并让 dts 返回位同步变宽（消费方 TS2322 假红）。
 *
 * 同时锁展示面：rest 槽是**元素域**，必须渲染 `...U[]`（漏掉 `[]` 会印成
 * 非法的单值形态 `...string`）。
 */
import { describe, it, expect } from "vitest";
import { absShapeForTsTypeText } from "../contract/ts-type-shape.ts";
import { formatShape } from "../format/format.ts";
import { abs } from "../abs.ts";
import { call } from "./eval-helpers.ts";

const shaped = (text: string): string => {
  const s = absShapeForTsTypeText(text);
  if (!s) throw new Error(`unmapped: ${text}`);
  return formatShape(abs(s, undefined, undefined, "exact"));
};

describe("TS rest 元组的 Shape 播种", () => {
  it("BUG-177 `[T, ...U[]]` 保留前缀位置与 rest 元素域；`t[0]` 折前缀类型而不是并集", () => {
    expect(absShapeForTsTypeText("[number, ...string[]]")).toMatchObject({
      k: "tuple",
      elements: [{ shape: { k: "prim", type: "number" } }],
      rest: { shape: { k: "prim", type: "string" } },
    });
    expect(shaped("[number, ...string[]]")).toBe("[number, ...string[]]");
    // union / fn 元素与 arr 面同款加括号（否则 `...number | string[]` 歧义）
    expect(shaped("[number, ...(string | boolean)[]]")).toBe(
      "[number, ...(string | boolean)[]]",
    );
    // 纯 rest 与 arr 同域 ⇒ 仍折 arr
    expect(shaped("[...string[]]")).toBe("string[]");

    const r = call(
      `export function firstRest(t) { return t[0]; }`,
      "firstRest",
      [abs(absShapeForTsTypeText("[number, ...string[]]")!, undefined, undefined, "path")],
    );
    expect(r.result.shape).toMatchObject({ k: "prim", type: "number" });
  });

  it("BUG-177 对照：定长元组不变；可选位（长度可变且位置不确定）仍降级为 arr(元素并集)", () => {
    expect(shaped("[number, string]")).toBe("[number, string]");
    expect(shaped("[string, number?]")).toBe("(string | number)[]");
  });
});
