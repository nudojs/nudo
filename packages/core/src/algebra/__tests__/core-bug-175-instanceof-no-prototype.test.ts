/**
 * BUG-175：`instanceof` RHS 没有 `prototype`（Proxy / 箭头函数 / 方法）时
 * `rhsPrototypeOf` 合成一个 brand 原型 ⇒ 「原型非对象 ⇒ 定抛」门永不触发。
 * 修复：缺省信息不得伪造空值语义。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { sigOf } from "./nudo-constraints.ts";

const P1 = `
export function instProxy() { const o = { a: 1 }; return o instanceof Proxy; }
export function instProxyFn() { const f = function () {}; return f instanceof Proxy; }
export function instMath() { const o = { a: 1 }; return o instanceof Math; }
`;

const P2 = `
export function instArrow() { const o = { a: 1 }; return o instanceof (() => {}); }
export function instGen() { const o = { a: 1 }; return o instanceof (function* () {}); }
export function instMethod() { const o = { a: 1 }; const m = { f() {} }.f; return o instanceof m; }
export function instProxy() { const o = { a: 1 }; return o instanceof Proxy; }
`;

describe("BUG-175 instanceof RHS without prototype", () => {
  it("missing prototype ⇒ native TypeError (not a synthetic brand)", () => {
    const r = checkSource("/t/bug-175-p1.js", P1, pTrue);
    expect(sigOf(r, "instProxy")).toBe("never throws TypeError");
    expect(sigOf(r, "instProxyFn")).toBe("never throws TypeError");
    expect(sigOf(r, "instMath")).toBe("never throws TypeError");
  });

  it("generator function has a prototype ⇒ boolean", () => {
    const r = checkSource("/t/bug-175-p2.js", P2, pTrue);
    expect(sigOf(r, "instArrow")).toBe("never throws TypeError");
    expect(sigOf(r, "instGen")).toBe("boolean");
    expect(sigOf(r, "instMethod")).toBe("never throws TypeError");
    expect(sigOf(r, "instProxy")).toBe("never throws TypeError");
  });
});
