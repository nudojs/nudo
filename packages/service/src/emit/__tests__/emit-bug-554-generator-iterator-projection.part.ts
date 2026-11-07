/**
 * Bug 554 —— dts 面把**生成器对象**的内部槽当**普通对象字段**直出。
 *
 * 改前：
 *   export declare function gen(x: unknown):
 *     { 0: unknown; next: () => unknown; return: () => unknown;
 *       throw: () => unknown; constructor: GeneratorFunction; "@@iterator": () => unknown };
 * ⇒ 返回类型里**没有** `[Symbol.iterator]()` ⇒ 消费方 `for (const v of gen(1))`
 * 报 **TS2488**（生成的 `.d.ts` 拒绝实现本身允许的用法）。
 *
 * 修法：`obj` 臂先识别**迭代器 / 生成器形态**（有 `next` 槽）⇒ 映射成
 * `Generator<T>` / `AsyncGenerator<T>` / `IterableIterator<T>`（元素类型取
 * 数字下标元素槽）；内部槽（`internal`）不进结构字段（core 的 format 面
 * 同口径）；符号键槽不落成字符串键字段。
 */
import { describe, it, expect } from "vitest";
import { abs, numLit, objOf, type Abs } from "@nudojs/core";
import { absToTSType, generateDts } from "../dts-generator.ts";
import { analyzeFile } from "@nudojs/service";
import { tscNoEmit } from "./dts-tsc.ts";

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
        constructor: { value: abs({ k: "brand", name: "GeneratorFunction", shape: objOf({}) }, undefined, undefined, "path"), internal: true },
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

describe("Bug 554 —— 生成器 / 迭代器形态投影", () => {
  it("同步生成器 → Generator<T>（元素类型取数字下标元素槽）", () => {
    expect(absToTSType(generatorObj([numLit(1)]))).toBe("Generator<number>");
  });

  it("异步生成器 → AsyncGenerator<T>", () => {
    expect(absToTSType(generatorObj([numLit(1)], true))).toBe("AsyncGenerator<number>");
  });

  it("负控制：普通数据对象仍是结构体（不误判成迭代器）", () => {
    const o = abs({ k: "obj", slots: { a: { value: numLit(1) } } }, undefined, undefined, "exact");
    expect(absToTSType(o)).toBe("{ a: 1 }");
  });

  it("内部槽不进结构字段（core format 面同口径：internal 槽不可见）", () => {
    const o = abs(
      { k: "obj", slots: { a: { value: numLit(1) }, "#priv": { value: numLit(2), internal: true } } },
      undefined,
      undefined,
      "exact",
    );
    expect(absToTSType(o)).toBe("{ a: 1 }");
  });

  it("端到端：生成器函数的 dts 返回 Generator，for…of 消费方过 tsc", () => {
    const dts = generateDts(
      analyzeFile("/test/bug554.js", `export function* gen(x) {\n  yield x;\n}\n`),
    );
    expect(dts).toContain("Generator<");
    expect(dts).not.toContain("@@iterator");
    const consumer = `
import { gen } from "./lib.js";
export function useGen() {
  for (const v of gen(1)) {
    return v;
  }
  return null;
}
`;
    const check = tscNoEmit({ "lib.d.ts": dts, "use.ts": consumer });
    expect(check.ok, check.stderr).toBe(true);
  });

  it("改前形态确实红（结构体 ⇒ TS2488）", () => {
    const before = `
export declare function gen(x: any): { 0: number; next: () => unknown; return: () => unknown; throw: () => unknown; constructor: GeneratorFunction; "@@iterator": () => unknown };
`;
    const consumer = `
import { gen } from "./lib.js";
export function useGen() {
  for (const v of gen(1)) {
    return v;
  }
  return null;
}
`;
    const check = tscNoEmit({ "lib.d.ts": before, "use.ts": consumer });
    expect(check.ok).toBe(false);
    expect(check.stderr).toContain("TS2488");
  });
});
