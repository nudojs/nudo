/**
 * B 路径 class 实例可变状态：$set 对 brand 一律不可变更新返回新 Abs，
 * 方法内 `this.n++` 的写只改局部 __this 绑定，调用点持有的实例 Abs
 * 从不更新——inc() 两次恒返回 1（原生 2）。修复：类实例（非类值）字段
 * 就地突变 inner slots（原生引用共享语义）；$get 对实例沿继承链读取
 * 方法名时返回可 typeof 的 fn 形状（typeof new A().m 此前 undefined）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("B-path class instance state", () => {
  it("method field increment persists across calls", () => {
    const r = call(
      `export function f() {
        class A { constructor() { this.n = 0; } inc() { this.n++; return this.n; } }
        const a = new A();
        a.inc();
        return a.inc();
      }`,
    );
    expect(litValue(r.result)).toBe(2);
  });

  it("plain field write is visible to later calls", () => {
    const r = call(
      `export function f() {
        class A { constructor() { this.x = 1; } get() { return this.x; } }
        const a = new A();
        a.x = 9;
        return a.get();
      }`,
    );
    expect(litValue(r.result)).toBe(9);
  });

  it("compound field assignment reads current value", () => {
    const r = call(
      `export function f() {
        class A { constructor() { this.n = 3; } add(v) { this.n += v; return this.n; } }
        const a = new A();
        a.add(2);
        return a.add(1);
      }`,
    );
    expect(litValue(r.result)).toBe(6);
  });

  it("typeof instance method is function", () => {
    const r = call(`export function f() { class A { m() { return "a"; } } return typeof new A().m; }`);
    expect(litValue(r.result)).toBe("function");
  });

  it("typeof inherited method is function", () => {
    const r = call(
      `export function f() { class A { m() { return "base"; } } class B extends A {} return typeof new B().m; }`,
    );
    expect(litValue(r.result)).toBe("function");
  });

  it("field write on frozen instance throws TypeError", () => {
    const r = call(
      `export function f() {
        class A { constructor() { this.n = 1; } }
        const a = new A();
        Object.freeze(a);
        a.n = 5;
        return a.n;
      }`,
    );
    expect(r.result.shape.k).toBe("never");
    expect((r.throws as { shape?: { name?: string } }).shape?.name).toBe("TypeError");
  });

  it("two instances keep independent state", () => {
    const r = call(
      `export function f() {
        class A { constructor(n) { this.n = n; } inc() { this.n++; return this.n; } }
        const a = new A(0);
        const b = new A(10);
        a.inc();
        return b.inc();
      }`,
    );
    expect(litValue(r.result)).toBe(11);
  });

  it("regression: class value still reads static side undefined for instance keys", () => {
    const r = call(`export function f() { class A { m() { return 1; } } return typeof A.m; }`);
    expect(litValue(r.result)).toBe("undefined");
  });
});
