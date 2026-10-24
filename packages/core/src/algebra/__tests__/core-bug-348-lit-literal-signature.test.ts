/**
 * Bug 348 —— `lit()` 的字面量只活在 **pred** 里（shape 无字面量位）⇒
 * 只看 term / shape 的 widen 路径**永远看不见它** ⇒ 同一份契约**四个面四种答案**：
 *
 * | 面 | 改前 | 改后 |
 * |---|---|---|
 * | 契约面 `nudo contract` | `x: lit(1)` | `x: lit(1)` ✔ |
 * | zod 产物面 | `z.literal(1)` | `z.literal(1)` ✔ |
 * | **dts 产物面** | `f(x: number)` | `f(x: 1)` ✔ |
 * | **check 签名面** | `f(x: number)` | `f(x: lit(1))` ✔ |
 *
 * 改前 dts 面把「x 必须是字面量 1」印成 `number` ⇒ 消费方 tsc 放行违反契约的
 * 调用，而同一份代码 `nudo check` 判红 ⇒ **双门禁对撞**。
 *
 * 修法（**不加 shape 变体** —— 那会动公开 `Shape`）：
 * - core：签名面按 pred 里的字面量域保形（`formatEntryParamShape` 走
 *   `formatShape(t, { showLits: true })`）；
 * - service：dts 的**参数位**与返回位同口径（复用已有的 `predLiteralSet`）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { stdOpts } from "./nudo-constraints.ts";

/** 同名侧车：源文件 file.js ⇒ 侧车 file.nudo.js */
function optsWithSidecar(sidecar: string) {
  return {
    loadModule: (spec: string): string | undefined =>
      spec === "./file.nudo.js" ? sidecar : stdOpts.loadModule(spec),
    fromFile: "/test/file.js",
  };
}

const LIT_SIDE = `
import { fn, lit, number } from "@nudojs/core";
export const f = fn({ x: lit(1) }, number());
`;

const NUM_SIDE = `
import { fn, number } from "@nudojs/core";
export const f = fn({ x: number() }, number());
`;

const SRC = `export function f(x) { return x; }`;

describe("Bug 348：lit() 的字面量在签名面保形", () => {
  it("check 签名面的参数类型保留字面量（改前拓宽成 number）", () => {
    const r = checkSource("/test/file.js", SRC, pTrue, optsWithSidecar(LIT_SIDE));
    const sig = r.signatures.find((s) => s.name === "f");
    expect(sig).toBeDefined();
    expect(sig!.paramTypes?.[0]).toBe("lit(1)");
    expect(sig!.paramTypes?.[0]).not.toBe("number");
  });

  it("负控制：裸 number 契约不被改成 lit(...)", () => {
    const r = checkSource("/test/file.js", SRC, pTrue, optsWithSidecar(NUM_SIDE));
    const sig = r.signatures.find((s) => s.name === "f");
    expect(sig!.paramTypes?.[0]).toBe("number");
  });
});
