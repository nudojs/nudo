/**
 * Bug 254 — 数组 mutator 的**泛型接收者**（数组样对象 `{length, 0: …}`）：
 * `$arrMutContainer` 对非 tuple/arr 形状**早退**（原样返回接收者）⇒ 写入被
 * 静默丢弃（长度不变、元素不变、不记 may-throw）。
 *
 * 根修：mutator 家族按 spec 泛型化——接收者 `ToObject(O)` 后按
 * `Set(O, "length", n)` / `CreateDataPropertyOrThrow(O, k, v)` /
 * `DeletePropertyOrThrow(O, k)` 写面落地（闭 obj 数组样接收者）；不可判定
 * 形态（open obj / 抽象 length / 带访问器侧表）⇒ 记 may-throw 后不写。
 *
 * 本钉打**写面本身**（`invokeArrMethod` 直接吃闭 obj 接收者）：端到端触发
 * `Array.prototype.push.call(o, 5)` 走 invoke.ts 的 `home === "Array"` 物化
 * 通道（E3 区段）——该通道先把接收者物化成**副本**再派发 mutator ⇒ 写入落在
 * 副本上（端到端症状仍在，见交付报告「越界发现」）。
 */
import { describe, it, expect } from "vitest";
import { abs, numLit } from "../abs.ts";
import { objOf } from "../objects.ts";
import { invokeArrMethod } from "../exec/class/invoke-arr.ts";
import type { Abs } from "../abs.ts";

const S = (s: string): Abs =>
  abs({ k: "prim", type: "string" }, { op: "lit", value: s }, undefined, "exact");

function mkObj(slots: Record<string, Abs>): Abs {
  const s: Record<string, { value: Abs }> = {};
  for (const [k, v] of Object.entries(slots)) s[k] = { value: v };
  return objOf(s as never);
}

/** 变更后的槽面（字面量值） */
function slotsOf(o: Abs): Record<string, unknown> {
  const shape = o.shape as { k: string; slots: Record<string, { value: Abs }> };
  const out: Record<string, unknown> = {};
  for (const [k, sl] of Object.entries(shape.slots ?? {})) {
    const t = sl.value.term;
    out[k] = t && t.op === "lit" ? t.value : "<nonlit>";
  }
  return out;
}

describe("Bug 254 · mutator 家族的泛型（数组样）接收者写面", () => {
  it("push：写 length + 索引槽，返回新长度", () => {
    const o = mkObj({ length: numLit(0) });
    const ret = invokeArrMethod(o, "push", [numLit(5)]);
    expect(slotsOf(o)).toEqual({ "0": 5, length: 1 });
    expect(ret?.term?.op).toBe("lit");
    expect((ret?.term as { value?: unknown })?.value).toBe(1);
  });

  it("pop：删末位 + 收缩 length，返回被删元素", () => {
    const o = mkObj({ length: numLit(1), "0": numLit(9) });
    const ret = invokeArrMethod(o, "pop", []);
    expect(slotsOf(o)).toEqual({ length: 0 });
    expect((ret?.term as { value?: unknown })?.value).toBe(9);
  });

  it("shift：前移 + 收缩 length，返回原首位", () => {
    const o = mkObj({ length: numLit(2), "0": numLit(9), "1": numLit(8) });
    const ret = invokeArrMethod(o, "shift", []);
    expect(slotsOf(o)).toEqual({ length: 1, "0": 8 });
    expect((ret?.term as { value?: unknown })?.value).toBe(9);
  });

  it("unshift：整体右移 + 插入，返回新长度", () => {
    const o = mkObj({ length: numLit(1), "0": numLit(9) });
    const ret = invokeArrMethod(o, "unshift", [numLit(1)]);
    expect(slotsOf(o)).toEqual({ "0": 1, "1": 9, length: 2 });
    expect((ret?.term as { value?: unknown })?.value).toBe(2);
  });

  it("splice：删窗口 + 插入 items + 写回 length（原生语义）", () => {
    const o = mkObj({ length: numLit(2), "0": S("a"), "1": S("b") });
    invokeArrMethod(o, "splice", [numLit(0), numLit(1)]);
    expect(slotsOf(o)).toEqual({ "0": "b", length: 1 });

    const o2 = mkObj({ length: numLit(3), "0": S("a"), "1": S("b"), "2": S("c") });
    invokeArrMethod(o2, "splice", [numLit(1), numLit(1), S("X"), S("Y")]);
    expect(slotsOf(o2)).toEqual({ "0": "a", "1": "X", "2": "Y", "3": "c", length: 4 });

    const o3 = mkObj({ length: numLit(2), "0": S("a"), "1": S("b") });
    invokeArrMethod(o3, "splice", [numLit(0), numLit(0), S("Z")]);
    expect(slotsOf(o3)).toEqual({ "0": "Z", "1": "a", "2": "b", length: 3 });
  });

  it("splice 零实参：原生不删（长度与内容不变）", () => {
    const o = mkObj({ length: numLit(2), "0": S("a"), "1": S("b") });
    invokeArrMethod(o, "splice", []);
    expect(slotsOf(o)).toEqual({ "0": "a", "1": "b", length: 2 });
  });
});
