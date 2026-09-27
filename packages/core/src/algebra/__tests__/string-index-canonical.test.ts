/**
 * 字符串下标读语义回归（同类：tuple-index-readonly / canonicalArrayIndex）。
 *
 * JS：'hello'['1'] === 'hello'[1] === 'e'（规范数组下标字符串）；
 * 'hello'['foo']、'hello'[1.5]、'hello'['01'] 为缺失属性 → undefined。
 *
 * 回归背景：$idx 字符串臂只认 typeof iv === "number" && Number.isInteger，
 * 字符串键 / 非整数一律 unknown。元组侧已改用 canonicalArrayIndex（见
 * tuple-index-readonly.test.ts）；字符串臂是同族漏网点。
 */
import { describe, it, expect } from "vitest";
import { $idx, $get, $lit, litValue, type Abs } from "@nudojs/core";

function isUndef(r: Abs): boolean {
  return r.term?.op === "lit" && r.term.value === undefined;
}

describe("string index reads use canonical array index", () => {
  it("numeric index projects the character", () => {
    expect(litValue($idx($lit("hello"), $lit(0)))).toBe("h");
    expect(litValue($idx($lit("hello"), $lit(1)))).toBe("e");
    expect(litValue($idx($lit("hello"), $lit(4)))).toBe("o");
    expect(isUndef($idx($lit("hello"), $lit(5)))).toBe(true);
    expect(isUndef($idx($lit("hello"), $lit(-1)))).toBe(true);
  });

  it('string "1" is index 1, not unknown', () => {
    expect(litValue($idx($lit("hello"), $lit("1")))).toBe("e");
    expect(litValue($idx($lit("hello"), $lit("0")))).toBe("h");
    expect(litValue($idx($lit("hello"), $lit("4")))).toBe("o");
    expect(isUndef($idx($lit("hello"), $lit("5")))).toBe(true);
  });

  it("non-index key is undefined, not unknown", () => {
    expect(isUndef($idx($lit("hello"), $lit("foo")))).toBe(true);
    expect(isUndef($idx($lit("hello"), $lit("01")))).toBe(true);
    expect(isUndef($idx($lit("hello"), $lit(1.5)))).toBe(true);
    expect(isUndef($idx($lit("hello"), $lit(true)))).toBe(true);
    expect(isUndef($idx($lit("hello"), $lit("")))).toBe(true);
  });

  it("$get on string prim with index key projects the character", () => {
    expect(litValue($get($lit("hello"), "1"))).toBe("e");
    expect(litValue($get($lit("hello"), "0"))).toBe("h");
    expect(isUndef($get($lit("hello"), "5"))).toBe(true);
    expect(isUndef($get($lit("hello"), "foo"))).toBe(true);
    expect(isUndef($get($lit("hello"), "01"))).toBe(true);
  });
});
