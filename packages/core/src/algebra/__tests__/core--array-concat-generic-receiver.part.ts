/**
 * Bug 262 —— `Array.prototype.concat` 的**泛型接收者**被当数组展开 ⇒
 * `Array.prototype.concat.call("ab")` 折出 **2 个元素**（原生是 **1 个**：
 * `["ab"]`）⇒ 元素数 / 首元素全错 ⇒ `nudo test` 对**正确代码**报假红。
 *
 * 规范：`concat` 只在 **IsArray(O)** 为真时把 this 的元素拷进结果；否则 this
 * **整体作为第一个元素**追加（不是泛型数组算法）。
 *
 * 修法（core/algebra/exec/class/invoke.ts）：物化通道的 concat 分支——非数组
 * exotic 接收者**整体作为单元素**进结果（种子元组 [this]）。
 */
import { describe, it, expect } from "vitest";
import { call, tupleEls } from "./eval-helpers.ts";

describe("Bug 262：concat 的非数组接收者整体作为单元素", () => {
  it("concat.call('ab') = 1 个元素（原生；此前 2 个）", () => {
    const r = call(`export function f() { return Array.prototype.concat.call("ab"); }`);
    expect(tupleEls(r.result)).toEqual(["ab"]);
  });

  it("concat.call('ab')[0] = 'ab'（原生；此前 'a'）", () => {
    const r = call(`export function f() { return Array.prototype.concat.call("ab")[0]; }`);
    expect(tupleEls(r.result)).toBeUndefined(); // 标量结果（非元组）
    const lit = r.result;
    expect(lit.shape.k).toBe("prim");
    expect(lit.term?.op).toBe("lit");
    const t = lit.term;
    expect(t?.op === "lit" ? t.value : undefined).toBe("ab");
  });

  it("concat.call(闭 obj) = 1 个元素（原生；此前 2 个）", () => {
    const r = call(
      `export function f() { return Array.prototype.concat.call({ length: 2, 0: "x", 1: "y" }); }`,
    );
    // 元素是接收者对象本身（非字面量）⇒ 断言元组长度
    expect(r.result.shape.k).toBe("tuple");
    expect(r.result.shape.k === "tuple" ? r.result.shape.elements.length : -1).toBe(1);
  });

  it("数组接收者不受影响（concat.call([7,8]) = 2 个元素）", () => {
    const r = call(`export function f() { return Array.prototype.concat.call([7, 8]); }`);
    expect(tupleEls(r.result)).toEqual([7, 8]);
  });

  it("普通数组路径不受影响（[].concat('ab') = 1 个元素）", () => {
    const r = call(`export function f() { return [].concat("ab"); }`);
    expect(tupleEls(r.result)).toEqual(["ab"]);
  });
});
