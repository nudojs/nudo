/**
 * Bug 254（主 agent 接线）—— mutator 在**端到端**路径上必须**就地改接收者**。
 *
 * E4 的写面钉（`core-bug-254-mutator-arraylike-receiver.test.ts`）直接调
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
import { describe, it, expect } from "vitest";
import { call, throwsError } from "./eval-helpers.ts";
import { litValue } from "../abs.ts";

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
