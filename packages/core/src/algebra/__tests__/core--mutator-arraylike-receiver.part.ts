// MERGED (topic-related bug pins): core-bug-254-mutator-arraylike-receiver.test.ts + core-bug-254-mutator-arraylike-wiring.test.ts
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>
import { describe, it, expect } from "vitest";
import { abs, numLit, type Abs, litValue } from "../abs.ts";
import { objOf } from "../objects.ts";
import { invokeArrMethod } from "../exec/class/invoke-arr.ts";
import { call, throwsError } from "./eval-helpers.ts";

describe("[merged] core-bug-254-mutator-arraylike-receiver.test.ts", () => {
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
});

describe("[merged] core-bug-254-mutator-arraylike-wiring.test.ts", () => {
/**
 * Bug 254（主 agent 接线）—— mutator 在**端到端**路径上必须**就地改接收者**。
 *
 * E4 的写面钉（`core--mutator-arraylike-receiver.part.ts`）直接调
 * `invokeArrMethod(闭 obj 接收者, ...)`，只覆盖**写面本身**。
 * 但端到端路径 `Array.prototype.push.call(o, 5)` 走
 * `exec/class/invoke.ts` 的 `home === "Array"` 通道 —— 该通道先把接收者
 * **物化成副本**再派发 mutator ⇒ 写入落在副本上：
 *   改前：`o.length` 仍 0、`o[0]` 仍 undefined、返回值 1（返回值对、写面丢）
 *   改后：`o.length` = 1、`o[0]` = 5（与原生 `push.call({length:0},5)` 一致）
 *
 * 接线修法：mutator 家族在**闭 obj 数组样接收者**上改走**原接收者**
 * （`invokeArrMethod` 的泛型接收者臂 → `$arrMutContainer` → `mutateArrayLike`）。
 *
 * 同批修掉的**族内回归**：`Array.prototype.shift.call([])` 原生返回 `undefined`，
 * 但「tuple 且非空」才进 shift 臂 ⇒ 空元组落到泛型接收者臂 ⇒ `arrayLikeLen()`
 * 对 tuple 返回 undefined ⇒ 折 `unknown`。
 * ⚠ **实测勘误**：数组**字面量** `[]` 在引擎里是抽象 `arr`（不是 0-tuple）⇒
 * 它的 OOB 读（`[][0]` / `[].shift()` / `[].pop()` / `[].at(0)`）**改前改后都是**
 * `unknown`，与原生 `undefined` 不符 —— 那是**建模限制**（空数组应折 undefined），
 * **不属本族**，已记入遗留；本钉只覆盖本族能修好的部分。
 *
 * 原生 oracle（node v26，sloppy + strict 一致）：
 *   Array.prototype.shift.call([])            → undefined
 *   Array.prototype.shift.call(5)             → undefined
 *   Array.prototype.shift.call("ab")          → TypeError（只读 length）
 *   Array.prototype.push.call({length:0},5)   → 1，且 o.length = 1、o[0] = 5
 */




/** 返回值的字面量值（非字面量 → undefined） */
function litOf(v: unknown): unknown {
  const r = litValue(v as never);
  return r.ok ? r.value : undefined;
}

describe("Bug 254 · mutator 端到端就地改接收者（主 agent 接线）", () => {
  it("push.call({length:0},5)：写回原接收者的 length 与索引槽", () => {
    const src = `
      export function f() {
        const o = { length: 0 };
        Array.prototype.push.call(o, 5);
        return o.length;
      }
    `;
    expect(litOf(call(src, "f").result)).toBe(1);
  });

  it("push.call({length:0},5)：接收者的索引槽被写入", () => {
    const src = `
      export function f() {
        const o = { length: 0 };
        Array.prototype.push.call(o, 5);
        return o[0];
      }
    `;
    expect(litOf(call(src, "f").result)).toBe(5);
  });

  it("push.call({length:0},5)：返回值是新长度", () => {
    const src = `
      export function f() {
        return Array.prototype.push.call({ length: 0 }, 5);
      }
    `;
    expect(litOf(call(src, "f").result)).toBe(1);
  });

  it("pop.call({length:1,0:9})：返回被删元素", () => {
    const src = `
      export function f() {
        return Array.prototype.pop.call({ length: 1, 0: 9 });
      }
    `;
    expect(litOf(call(src, "f").result)).toBe(9);
  });

  it("shift.call([1,2])：返回原首位", () => {
    const src = `
      export function f() {
        return Array.prototype.shift.call([1, 2]);
      }
    `;
    expect(litOf(call(src, "f").result)).toBe(1);
  });

  it("shift.call(\"ab\")：字符串接收者原生定抛 TypeError（只读 length）", () => {
    const src = `
      export function f() {
        return Array.prototype.shift.call("ab");
      }
    `;
    expect(throwsError(call(src, "f").throws, "TypeError")).toBe(true);
  });
});
});
