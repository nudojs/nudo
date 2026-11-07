/**
 * A11 残余 · TNext：dts 第三类型实参的**条件投影**回归钉。
 *
 * 引擎不建模 `.next(v)` 入参 ⇒ `makeGenObject` 填最保守的 `unknown`（与 TS
 * 该类型形参默认值等价），本文件证明「槽位 → 搬运 → 键 → 投影」整条链已
 * 真实接通，且**不退化**既有 Bug 554 / A11 的两实参精确串。
 *
 * 纪律：手工构造 / 无 `facets.genNext` 的旧 Abs 逐字不变；三实参恒带
 * `<…>`，绝不输出裸 `Generator`（TS2314，见 emit-bug-521）。
 */
import { describe, it, expect } from "vitest";
import { abs, numLit, type Abs } from "@nudojs/core";
import { absToTSType, generateDts } from "../dts-generator.ts";
import { analyzeFile } from "@nudojs/service";
import { tscNoEmit } from "./dts-tsc.ts";

const unknownAbs: Abs = abs({ k: "unknown" }, undefined, undefined, "partial");
const fnSlot = (): { value: Abs; internal: boolean } => ({
  value: abs({ k: "fn", params: [] }, undefined, undefined, "exact"),
  internal: true,
});

function generatorLike(asyncMode = false): Abs {
  const slots: Record<string, { value: Abs; internal?: boolean; symbolKey?: boolean }> = {
    "0": { value: numLit(1), internal: true },
    next: fnSlot(),
    return: fnSlot(),
    throw: fnSlot(),
    ...(asyncMode
      ? { "@@asyncIterator": { ...fnSlot(), symbolKey: true } }
      : { "@@iterator": { ...fnSlot(), symbolKey: true } }),
  };
  return abs({ k: "obj", slots }, undefined, undefined, "exact");
}

describe("A11 · TNext 第三实参投影", () => {
  it("genReturn + genNext ⇒ Generator<T, TReturn, unknown>", () => {
    const a = generatorLike();
    a.facets = { brand: "Generator", genReturn: numLit(7), genNext: unknownAbs };
    expect(absToTSType(a)).toBe("Generator<number, number, unknown>");
  });

  it("异步生成器同款 ⇒ AsyncGenerator<T, TReturn, unknown>", () => {
    const a = generatorLike(true);
    a.facets = { brand: "AsyncGenerator", genReturn: numLit(7), genNext: unknownAbs };
    expect(absToTSType(a)).toBe("AsyncGenerator<number, number, unknown>");
  });

  it("负控：无 genNext 仍是既有 Generator<T, TReturn> 逐字不变", () => {
    const a = generatorLike();
    a.facets = { brand: "Generator", genReturn: numLit(7) };
    expect(absToTSType(a)).toBe("Generator<number, number>");
  });

  it("负控：只有 genNext 没有 genReturn ⇒ 不跳位（TS 位置类型参数）", () => {
    const a = generatorLike();
    a.facets = { brand: "Generator", genNext: unknownAbs };
    expect(absToTSType(a)).toBe("Generator<number>");
  });

  it("负控：无 facets 的旧 Abs 仍是既有 Generator<T> 逐字不变", () => {
    expect(absToTSType(generatorLike())).toBe("Generator<number>");
  });
});

describe("A11 · 三实参 .d.ts 仍过 tsc（TS2314 / 消费方编译）", () => {
  it("端到端：真实生成器 dts 带三实参且消费方 for…of 编译通过", () => {
    const dts = generateDts(
      analyzeFile("/test/tnext.js", `export function* gen(x) {\n  yield x;\n}\n`),
    );
    expect(dts).toMatch(/Generator<[^>]*,\s*[^>]*,\s*unknown>/);
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
