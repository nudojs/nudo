/**
 * BUG-004：类方法桥把 `D.s1`（静态方法）当实例方法求值 ⇒ 静态方法签名
 * 拿不到返回值（`D.s1 => never`）。修复：按源码类声明分流静态/实例。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { sigOf } from "./nudo-constraints.ts";

const SRC = `
export class D {
  static s1() {
    return 42;
  }
  instance() {
    return 7;
  }
}
`;

describe("BUG-004 class-method bridge static/instance split", () => {
  it("static method returns its value", () => {
    const r = checkSource("/t/bug-004.js", SRC, pTrue);
    expect(sigOf(r, "D.s1")).toBe("42");
  });

  it("instance method still returns its value", () => {
    const r = checkSource("/t/bug-004.js", SRC, pTrue);
    expect(sigOf(r, "D.instance")).toBe("7");
  });

  it("class value itself stays a class signature", () => {
    const r = checkSource("/t/bug-004.js", SRC, pTrue);
    expect(sigOf(r, "D")).toBe("D");
  });
});
