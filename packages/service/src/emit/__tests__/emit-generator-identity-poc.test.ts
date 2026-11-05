/**
 * schema / guard 生成器身份投影 · **决策 PoC**（不接生产）。
 *
 * 台账「schema / guard 生成器身份投影 · 决策记录」把该诉求判定为
 * **产品语义决策**（会收紧导出校验器接受集），而非机械欠账。本文件只提供
 * 可执行的实证数据，供产品方拍板；**不调用** `absToSchemaSource` /
 * `generateGuardFunctionFromAbs`，不改任何既有 expectation。
 *
 * 现状契约：`emit-bug-130-generator-element-slots.part.ts` 钉住
 * `z.object({  })` 且要求产物真的接受生成器 —— 意图是「不得把 internal 槽
 * 当自有字段」，不是「必须验出身份」。
 */
import { describe, it, expect } from "vitest";

function* syncGen(): Generator<number> {
  yield 1;
}
async function* asyncGen(): AsyncGenerator<number> {
  yield 1;
}

/** 方案 (a) 的判别谓词候选（toStringTag 口径）。 */
const isGenerator = (v: unknown): boolean =>
  Object.prototype.toString.call(v) === "[object Generator]";
const isAsyncGenerator = (v: unknown): boolean =>
  Object.prototype.toString.call(v) === "[object AsyncGenerator]";

describe("schema/guard 身份投影决策 PoC · 方案 (a) 判别谓词", () => {
  it("真同步生成器被接受、真异步生成器需单独分支", () => {
    expect(isGenerator(syncGen())).toBe(true);
    expect(isGenerator(asyncGen())).toBe(false);
    expect(isAsyncGenerator(asyncGen())).toBe(true);
  });

  it("语义收紧实证：普通对象从「接受」变「拒绝」", () => {
    // 现状 z.object({}) 接受任意对象；身份投影会拒绝它们。
    expect(isGenerator({})).toBe(false);
    expect(isGenerator({ next() {} })).toBe(false);
    expect(isGenerator([])).toBe(false);
  });

  it("已知边界：Symbol.toStringTag 可伪造 ⇒ 不是 sound 的 instanceof", () => {
    const fake: Record<symbol, string> = {};
    Object.defineProperty(fake, Symbol.toStringTag, { value: "Generator" });
    expect(isGenerator(fake)).toBe(true);
  });
});

describe("schema/guard 身份投影决策 PoC · 方案 (b) 不可行实证", () => {
  it("没有全局 GeneratorFunction 构造器", () => {
    expect("GeneratorFunction" in globalThis).toBe(false);
  });

  it("生成器对象的原型构造器无名，且不 instanceof 生成器「函数」构造器", () => {
    const g = syncGen();
    expect(Object.getPrototypeOf(g).constructor.name).toBe("");
    const GF = Object.getPrototypeOf(syncGen).constructor as Function;
    expect(GF.name).toBe("GeneratorFunction");
    // z.instanceof(GF) 判的是生成器**函数**，不是生成器对象
    expect(g instanceof (GF as never)).toBe(false);
  });
});
