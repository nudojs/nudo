/**
 * B 路径 class 声明 TDZ：class B extends A {} 的 extends 应求值当前作用域
 * 绑定——A 尚未声明时原生抛 ReferenceError（class 声明不提升），此前
 * transpile 把 extends 编码为名字字符串进注册表，声明顺序完全不检查，
 * B extends A 在 A 之前定义也能「继承成功」。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("B-path class declaration TDZ", () => {
  it("extending a class declared later throws (TDZ)", () => {
    const r = call(
      `export function f() { class B extends A {} class A { m() { return "base"; } } return new B().m(); }`,
    );
    // 原生 ReferenceError：throws 域非 never
    expect(r.throws.shape.k).not.toBe("never");
  });

  it("extending a class declared earlier works", () => {
    const r = call(
      `export function f() { class A { m() { return "base"; } } class B extends A {} return new B().m(); }`,
    );
    expect(litValue(r.result)).toBe("base");
  });

  it("extending a host global ctor does not throw", () => {
    const r = call(
      `export function f() { class B extends Map {} return typeof new B(); }`,
    );
    expect(r.throws.shape.k).toBe("never");
  });

  it("later declaration order in same scope is honored per evaluation", () => {
    const r = call(
      `export function f() {
        let out = "ok";
        try {
          class C extends D {}
        } catch (e) {
          out = "tdz";
        }
        class D {}
        return out;
      }`,
    );
    expect(litValue(r.result)).toBe("tdz");
  });
});
