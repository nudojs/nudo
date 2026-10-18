/**
 * 求值引擎 String.raw 定抛/良性面（Bug 97）：
 * 此前 evalStringStatic 的 raw 分支对闭 obj 无 raw 槽折 str("path") 且
 * throws 域 never——假 total。原生两级定抛面：
 * ① ToObject(templates)——缺实参/nullish 字面量 → TypeError；
 * ② Get(template,"raw") 后 ToObject(raw)——闭 obj 无 raw 槽（及 prim/tuple/
 *    arr 无 raw 访问面形态，node 实测 String.raw(5)/String.raw([1,2]) 同抛）
 *    → 确定 TypeError；open obj / any/unknown/sum → may TypeError；
 *    raw 内容面：nullish raw → 定抛、symbol 元素 → 定抛、抽象 raw/元素 → may；
 *    字面量非数组 raw（raw:5 原生 ""）良性。
 * 全部断言与 node v26 ground truth 对齐。
 */
import { describe, it, expect } from "vitest";
import { call, effects } from "./eval-helpers.ts";

const throwsName = (r: { throws: unknown }): string | undefined =>
  (r.throws as { shape?: { k?: string; name?: string } })?.shape?.k === "never"
    ? undefined
    : (r.throws as { shape?: { name?: string } })?.shape?.name;

describe("Bug 97: String.raw definite-throw faces", () => {
  it("缺实参 / nullish / 无 raw 访问面形态 → definite TypeError", () => {
    for (const src of [
      `export function f() { return String.raw(); }`,
      `export function f() { return String.raw(null); }`,
      `export function f() { return String.raw(undefined); }`,
      `export function f() { return String.raw({}); }`,
      `export function f() { return String.raw(5); }`,
      `export function f() { return String.raw([1, 2]); }`,
      `export function f() { return String.raw({ raw: null }); }`,
      `export function f() { return String.raw({ raw: undefined }); }`,
      `export function f() { return String.raw({ raw: [Symbol()] }); }`,
    ]) {
      const r = call(src);
      expect((r.result as { shape?: { k?: string } })?.shape?.k, src).toBe("never");
      expect(throwsName(r), src).toBe("TypeError");
    }
  });

  it("良性控制组：字面量非数组 raw（raw:5 → \"\"）/ 模板拼接 / tagged 精确", () => {
    const a = call(`export function f() { return String.raw({ raw: 5 }); }`);
    expect((a.result as { shape?: { k?: string; type?: string } })?.shape?.k).not.toBe("never");
    expect(throwsName(a)).toBeUndefined();
    const b = call(`export function f() { return String.raw({ raw: ["a", "b"] }, "X"); }`);
    expect(throwsName(b)).toBeUndefined();
    const c = call(`export function f() { return String.raw\`a\${1}b\`; }`);
    expect(throwsName(c)).toBeUndefined();
  });

  it("gate 面：open obj / any 模板与抽象 raw 内容 → may TypeError", () => {
    const tpl = effects(`export function f(o) { return String.raw(o); }`);
    expect(tpl).toContain("TypeError");
    const rawAbs = effects(`export function f(x) { return String.raw({ raw: x }); }`);
    expect(rawAbs).toContain("TypeError");
    const elAbs = effects(`export function f(x) { return String.raw({ raw: ["a", x] }); }`);
    expect(elAbs).toContain("TypeError");
  });
});
