/**
 * BUG-130 —— zod / guard / standard 三个**运行时产物面**把生成器的**元素域下标槽**
 * （`"0"` / `"1"`）当成**对象自有字段**发布 ⇒ 导出的校验器**拒绝被导出函数自己的
 * 返回值**（而 dts 面正确给 `Generator<number>`）。
 *
 * 运行时真值：生成器对象**没有任何自有可枚举属性**（`Object.keys` / `gOPN` /
 * `for-in` 恒空）。仓库里 core 的 `async.ts` 把协议槽与元素槽都建成 `internal`，
 * 但产物面的 `isHiddenInternalSlot` 对「规范数组下标」开了例外（本意是数组承载
 * 元素域）⇒ 元素槽又冒回产物面。
 *
 * 修法（emit 侧）：例外收窄为「仅数组形态（`k:"arr"`）不需要该例外」——
 * 迭代器/生成器形态（协议槽 `next` 在场）的数字下标槽**不可见**；zod / standard
 * 在节点层摘槽，guard 在交给 `denoteGuard` 前摘槽（判据同源 `internal-slot.ts`）。
 */
import { describe, it, expect } from "vitest";
import { abs, numLit, objOf, type Abs } from "@nudojs/core";
import { absToSchemaNode, absToSchemaSource } from "../schema-generator.ts";
import { validateSchemaNode } from "../standard-schema.ts";
import { generateGuardFunctionFromAbs } from "../guard-generator.ts";

const fnSlot = (): { value: Abs; internal?: boolean; symbolKey?: boolean } => ({
  value: abs({ k: "fn", params: [] }, undefined, undefined, "exact"),
  internal: true,
});

/** 生成器对象形态（core 的 makeGenObject 口径：协议槽 + 数字下标元素槽） */
const generatorObj = (elements: Abs[], async = false): Abs =>
  abs(
    {
      k: "obj",
      slots: {
        ...Object.fromEntries(elements.map((v, i) => [String(i), { value: v, internal: true }])),
        next: fnSlot(),
        return: fnSlot(),
        throw: fnSlot(),
        constructor: {
          value: abs(
            { k: "brand", name: "GeneratorFunction", shape: objOf({}) },
            undefined,
            undefined,
            "path",
          ),
          internal: true,
        },
        ...(async
          ? {
              "@@asyncIterator": { ...fnSlot(), symbolKey: true },
              "@@toStringTag": { value: numLit(0), internal: true, symbolKey: true },
            }
          : { "@@iterator": { ...fnSlot(), symbolKey: true } }),
      },
    },
    undefined,
    undefined,
    "exact",
  );

/** 真生成器（运行时仲裁用） */
function* gen(): Generator<number> {
  yield 1;
  yield 2;
}

describe("BUG-130 — 生成器元素域不进运行时产物面", () => {
  it("zod 面不发布数字下标字段（运行时不存在的自有属性）", () => {
    const source = absToSchemaSource(generatorObj([numLit(1), numLit(2)]));
    expect(source).not.toContain("0:");
    expect(source).not.toContain("1:");
    expect(source).not.toContain("z.literal(1)");
    expect(source).toBe("z.object({  })");
  });

  it("standard 面接受真正的生成器对象（改前：required path ['0'] / ['1']）", () => {
    const { node } = absToSchemaNode(generatorObj([numLit(1), numLit(2)]));
    expect(JSON.stringify(node)).not.toContain('"key":"0"');
    expect(validateSchemaNode(node, gen())).toMatchObject({});
    expect(validateSchemaNode(node, gen()).issues).toBeUndefined();
  });

  it("guard 面不再要求 hasOwn(data, \"0\")，且真的接受生成器", () => {
    const src = generateGuardFunctionFromAbs("isgenOutput", generatorObj([numLit(1), numLit(2)]));
    expect(src).not.toContain('hasOwn(data, "0")');
    expect(src).not.toContain('data["0"]');
    // 运行时仲裁：把产物守卫的类型标注剥掉（产物是 .ts）后真跑一次
    const js = src
      .replace("(value: unknown): boolean", "(value)")
      .replace("const data = value as Record<string, any>;", "const data = value;")
      .replace("export function ", "function ");
    const guard = new Function(`${js}; return isgenOutput;`)() as (v: unknown) => boolean;
    expect(guard(gen())).toBe(true);
  });

  it("异步生成器同理（@@asyncIterator 形态）", () => {
    const a = generatorObj([numLit(1)], true);
    expect(absToSchemaSource(a)).toBe("z.object({  })");
    const src = generateGuardFunctionFromAbs("isagenOutput", a);
    expect(src).not.toContain('hasOwn(data, "0")');
  });

  it("负控制：普通对象字面量的数字键仍是真实自有属性（不被误剔）", () => {
    const a = abs(
      { k: "obj", slots: { "0": { value: numLit(1) }, "1": { value: numLit(2) } } },
      undefined,
      undefined,
      "exact",
    );
    const source = absToSchemaSource(a);
    expect(source).toContain('0: z.literal(1)');
    expect(source).toContain('1: z.literal(2)');
    const { node } = absToSchemaNode(a);
    expect(validateSchemaNode(node, { 0: 1, 1: 2 }).issues).toBeUndefined();
  });
});
