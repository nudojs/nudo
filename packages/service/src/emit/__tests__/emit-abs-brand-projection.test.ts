/**
 * A11 · `brand` 槽位的 service / dts 侧回归钉。
 *
 * Bug 554 已让 `iteratorTSType` 按 `next` 槽启发式投影 `Generator<T>`；本槽位
 * 让身份**随 Abs 值携带** ⇒ 重建 / 快照产物即使丢了内部协议槽，仍能投影。
 * 关键纪律：泛型实参仍由数字下标元素槽推导，输出恒为 `Generator<T>` /
 * `AsyncGenerator<T>`，**绝不输出裸 `Generator`**（TS2314，见
 * `BUILTIN_GENERIC_BRANDS` 与 emit-bug-521）。
 *
 * 空槽位时 `iteratorTSType` 的旧路径逐字不变（既有 Bug 554 钉不退化）。
 */
import { describe, it, expect } from "vitest";
import { abs, numLit, type Abs } from "@nudojs/core";
import { absToTSType, generateDts } from "../dts-generator.ts";
import { analyzeFile } from "@nudojs/service";
import { tscNoEmit } from "./dts-tsc.ts";

const fnSlot = (): { value: Abs; internal: boolean } => ({
  value: abs({ k: "fn", params: [] }, undefined, undefined, "exact"),
  internal: true,
});

/** 生成器对象形态（core makeGenObject 口径：internal 协议槽 + 数字下标元素槽）。 */
function generatorLike(opts: { withNext: boolean; async?: boolean }): Abs {
  const slots: Record<string, { value: Abs; internal?: boolean; symbolKey?: boolean }> = {
    "0": { value: numLit(1), internal: true },
    return: fnSlot(),
    throw: fnSlot(),
    ...(opts.withNext ? { next: fnSlot() } : {}),
    ...(opts.async
      ? { "@@asyncIterator": { ...fnSlot(), symbolKey: true } }
      : { "@@iterator": { ...fnSlot(), symbolKey: true } }),
  };
  return abs({ k: "obj", slots }, undefined, undefined, "exact");
}

describe("A11 · brand 驱动 dts 迭代器投影", () => {
  it("带 brand、丢掉 next 槽 ⇒ 仍投影 Generator<number>（旧实现走结构面）", () => {
    const a = generatorLike({ withNext: false });
    expect(absToTSType(a)).not.toContain("Generator");
    a.facets = { brand: "Generator" };
    expect(absToTSType(a)).toBe("Generator<number>");
  });

  it("AsyncGenerator brand ⇒ AsyncGenerator<number>", () => {
    const a = generatorLike({ withNext: false, async: true });
    a.facets = { brand: "AsyncGenerator" };
    expect(absToTSType(a)).toBe("AsyncGenerator<number>");
  });

  it("负控：无 brand 且无 next ⇒ 不误判成生成器", () => {
    expect(absToTSType(generatorLike({ withNext: false }))).not.toContain("Generator");
  });

  it("负控：未知 brand 值不改变结构投影", () => {
    const a = generatorLike({ withNext: false });
    a.facets = { brand: "SomeUserBrand" };
    expect(absToTSType(a)).not.toContain("Generator");
  });

  it("A11 残余：genReturn ⇒ Generator<T, TReturn>（恒带实参，不裸名）", () => {
    const a = generatorLike({ withNext: true });
    a.facets = { brand: "Generator", genReturn: numLit(7) };
    expect(absToTSType(a)).toBe("Generator<number, number>");
    const asyncA = generatorLike({ withNext: true, async: true });
    asyncA.facets = { brand: "AsyncGenerator", genReturn: numLit(7) };
    expect(absToTSType(asyncA)).toBe("AsyncGenerator<number, number>");
  });

  it("不退化 Bug 554：无 genReturn 的 Abs 仍只输出 Generator<T>", () => {
    const a = generatorLike({ withNext: true });
    a.facets = { brand: "Generator" };
    expect(absToTSType(a)).toBe("Generator<number>");
  });

  it("不退化 Bug 554：有 next 槽但无 brand ⇒ 既有 Generator<number> 逐字不变", () => {
    expect(absToTSType(generatorLike({ withNext: true }))).toBe("Generator<number>");
    expect(absToTSType(generatorLike({ withNext: true, async: true }))).toBe(
      "AsyncGenerator<number>",
    );
  });
});

describe("A11 · 生成器 brand 启用后 .d.ts 仍过 tsc（TS2314 防线）", () => {
  it("端到端：真实生成器函数的 dts 带 TReturn 实参（不是裸名 / 单实参）", () => {
    const dts = generateDts(
      analyzeFile("/test/brand-return.js", `export function* gen(x) {\n  yield x;\n}\n`),
    );
    expect(dts).toContain("Generator<");
    expect(dts).toMatch(/Generator<[^>]*,\s*[^>]*>/);
  });

  it("端到端：生成器函数返回 Generator<…> 且消费方 for…of 编译通过", () => {
    const dts = generateDts(
      analyzeFile("/test/brand-facet.js", `export function* gen(x) {\n  yield x;\n}\n`),
    );
    expect(dts).toContain("Generator<");
    // 裸 `Generator` 无类型实参会让整份 .d.ts 编译失败
    expect(dts).not.toMatch(/\bGenerator\s*[;,)\n]/);
    const check = tscNoEmit({
      "lib.d.ts": dts,
      "use.ts": `
import { gen } from "./lib.js";
export function useGen() {
  for (const v of gen(1)) return v;
  return null;
}
`,
    });
    expect(check.ok, check.stderr).toBe(true);
  });
});
