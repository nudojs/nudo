/**
 * 元组下标读语义回归（同类：$idx / $get）。
 * JS：a["0"] === a[0]（规范数组下标字符串）；a["foo"]、a[1.5] 为缺失属性 → undefined。
 * 回归背景：$idx 对非整数 number / 字符串 key 直接并所有元素；$get 对
 * 下标字符串键落到 unknown。canonicalArrayIndex 已有正确实现（$in/delete 用）。
 */
import { describe, it, expect } from "vitest";
import { $idx, $get, $arr, $lit, litValue, abs } from "@nudojs/core";

function tup() {
  return $arr([$lit(10), $lit(20), $lit(30)]);
}

describe("tuple index reads use canonical array index", () => {
  it("numeric index projects the slot", () => {
    expect(litValue($idx(tup(), $lit(0)))).toBe(10);
    expect(litValue($idx(tup(), $lit(2)))).toBe(30);
    expect(litValue($idx(tup(), $lit(3)))).toBeUndefined();
  });

  it('string "0" is index 0, not join-of-all', () => {
    expect(litValue($idx(tup(), $lit("0")))).toBe(10);
  });

  it("non-index key is undefined, not join-of-all", () => {
    const r = $idx(tup(), $lit("foo"));
    expect(r.term?.op === "lit" && r.term.value === undefined).toBe(true);
    const r2 = $idx(tup(), $lit(1.5));
    expect(r2.term?.op === "lit" && r2.term.value === undefined).toBe(true);
  });

  it("$get on tuple with index string projects the slot", () => {
    expect(litValue($get(tup(), "0"))).toBe(10);
    expect(litValue($get(tup(), "2"))).toBe(30);
  });

  it("$get on tuple with non-index key is undefined", () => {
    const r = $get(tup(), "foo");
    expect(r.term?.op === "lit" && r.term.value === undefined).toBe(true);
    expect(litValue($get(tup(), "1"))).toBe(20);
  });

  it("empty tuple non-index read is undefined (not unknown join)", () => {
    const empty = $arr([]);
    const r = $idx(empty, $lit("foo"));
    expect(r.term?.op === "lit" && r.term.value === undefined).toBe(true);
  });
});
