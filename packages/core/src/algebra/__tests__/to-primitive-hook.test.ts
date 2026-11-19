/**
 * `coerceToStringParts` 漏 `@@toPrimitive` 钩子槽。
 *
 * 对象字面量计算键 `[Symbol.toPrimitive](h){…}` 经 symbolKeyOf 投影存为
 * `"@@toPrimitive"` 字符串槽。仅有该钩子的对象无自有 toString/valueOf →
 * 闭对象默认标签折叠守卫通过 → `o + "x"` 错折 `"[object Object]x"`
 * （native 是钩子返回值，wrong-concrete）。修复：守卫加
 * `!Object.hasOwn(slots, "@@toPrimitive")` → 钩子存在时不折 →
 * `concatString` 落 `isStrPrim` 臂返回抽象 string 域（sound skip）。
 * 钩子调用面不建模（存在性阻断即可去 wrong-concrete）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

/** 语句体（隐式 return）→ __run 执行结果 Abs（与差分 harness 同口径） */
function runBody(body: string) {
  const exports = runTranspiled(`export function __run() {\n${body}\n}`, {
    mode: "exec",
    maxLoopIters: 2000,
  });
  return callTranspiledExportFull(exports, "__run", []);
}

/** 收窄 prim 形态并断言 type（expect().toBe() 不能做 TS 窄化，需真分支） */
function assertPrimShape(result: ReturnType<typeof runBody>["result"]) {
  if (result.shape.k !== "prim") {
    throw new Error(`expected prim shape, got ${result.shape.k}`);
  }
  expect(result.shape.type).toBe("string");
}

const HOOK_SRC = `const o = { [Symbol.toPrimitive](h) { return "P"; } };`;

describe("@@toPrimitive hook blocks default tag fold", () => {
  it("o + \"x\" uses the hook return value (not \"[object Object]x\")", () => {
    const { result } = runBody(`${HOOK_SRC} return o + "x";`);
    expect(litValue(result)).toEqual({ ok: true, value: "Px" });
  });

  it("o + \"\" uses the hook return value", () => {
    const { result } = runBody(`${HOOK_SRC} return o + "";`);
    expect(litValue(result)).toEqual({ ok: true, value: "P" });
  });

  it("template literal `${o}` uses the hook return value (template path)", () => {
    const { result } = runBody(`${HOOK_SRC} return \`\${o}\`;`);
    expect(litValue(result)).toEqual({ ok: true, value: "P" });
  });

  it("regression: {} + \"x\" still folds exactly to \"[object Object]x\"", () => {
    const { result } = runBody(`return {} + "x";`);
    assertPrimShape(result);
    expect(litValue(result)).toEqual({ ok: true, value: "[object Object]x" });
  });

  it("regression: custom toString slot is executed (BUG-142)", () => {
    const { result } = runBody(`const o = { toString() { return "s"; } }; return o + "x";`);
    expect(litValue(result)).toEqual({ ok: true, value: "sx" });
  });
});
