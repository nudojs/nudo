/**
 * Bug 85（函数声明绑定是裸宿主函数）：statement.ts 直发 host function，
 * 作**实参**流入 $invoke 派发的 Object/Reflect 静态、$in、JSON.stringify、
 * 强制转换全局时，Abs 解引用点（target.shape.k 等）读宿主函数对象 →
 * 内部 `TypeError: Cannot read properties of undefined`——无 try 折
 * unknown、有 try 被用户 catch 吞成引擎错误，并落假 L2
 * nudo:entry-may-throw。
 *
 * 修复：$invoke 入口对非 Abs 实参 asAbsVal 归一化（copy-on-write；callee
 * 位不动——宿主函数直调路径依赖裸值 apply）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call } from "./eval-helpers.ts";
import { diffBody } from "./differential/harness.ts";

const run = (src: string) => litValue(call(src).result);

describe("Bug 85: 声明函数作实参不再内部 TypeError", () => {
  it("try/catch 不再吞引擎错误（此前 caught:TypeError）", () => {
    expect(
      run(`export function f() { function g(a) { return 1; } try { Object.keys(g); return "ok"; } catch (e) { return "caught:" + e.name; } }`),
    ).toEqual({ ok: true, value: "ok" });
  });

  it("Object.getPrototypeOf(g) === Function.prototype → true", () => {
    expect(
      run(`export function f() { function g(a) { return 1; } return Object.getPrototypeOf(g) === Function.prototype; }`),
    ).toEqual({ ok: true, value: true });
  });

  it("Object.isFrozen(g) → false；JSON.stringify(g) → undefined", () => {
    expect(
      run(`export function f() { function g(a) { return 1; } return Object.isFrozen(g); }`),
    ).toEqual({ ok: true, value: false });
    expect(
      run(`export function f() { function g(a) { return 1; } return JSON.stringify(g); }`),
    ).toEqual({ ok: true, value: undefined });
  });

  it("实参传递 / 嵌套声明位同口径", () => {
    expect(
      run(`export function h(f) { return Object.getPrototypeOf(f) === Function.prototype; } export function f() { function g(a) { return 1; } return h(g); }`),
    ).toEqual({ ok: true, value: true });
    expect(
      run(`export function f() { class C { m() { function g() {} return Object.getPrototypeOf(g) === Function.prototype; } } return new C().m(); }`),
    ).toEqual({ ok: true, value: true });
  });

  it("exec 差分全表对 native 对账（keys/values/in/Reflect/强制转换/freeze 族）", () => {
    // concrete() 盲区行（undefined/数组/对象）由 throws 通道 + 值域对账覆盖
    const rows = [
      `function g(a) { return 1; } return Object.keys(g).length;`,
      `function g(a) { return 1; } return Object.values(g).length;`,
      `function g(a) { return 1; } return Object.entries(g).length;`,
      `function g(a) { return 1; } return Object.getOwnPropertySymbols(g).length;`,
      `function g(a) { return 1; } return Object.getOwnPropertyNames(g).includes("length");`,
      `function g(a) { return 1; } return Object.getPrototypeOf(g) === Function.prototype;`,
      `function g(a) { return 1; } return Object.hasOwn(g, "x");`,
      `function g(a) { return 1; } return Object.freeze(g) === g;`,
      `function g(a) { return 1; } return Object.seal(g) === g;`,
      `function g(a) { return 1; } return Object.defineProperty(g, "x", { value: 1 }) === g;`,
      `function g(a) { return 1; } return Reflect.ownKeys(g).length;`,
      `function g(a) { return 1; } return Reflect.get(g, "x");`,
      `function g(a) { return 1; } return "x" in g;`,
      `function g(a) { return 1; } return JSON.stringify(g);`,
      `function g(a) { return 1; } return String(g).startsWith("function");`,
      `function g(a) { return 1; } return Number.isNaN(Number(g));`,
    ];
    for (const body of rows) {
      expect(diffBody(body), body).toBeNull();
    }
  });
});

describe("Bug 85 controls：宿主函数直调与表达式孪生不回归", () => {
  it("函数表达式 / 箭头（$fnVal 面）同样无内部错误", () => {
    expect(
      run(`export function f() { const g = function (a) { return 1; }; return Object.getPrototypeOf(g) === Function.prototype; }`),
    ).toEqual({ ok: true, value: true });
    expect(
      run(`export function f() { const g = (a) => 1; return Object.getPrototypeOf(g) === Function.prototype; }`),
    ).toEqual({ ok: true, value: true });
  });

  it("声明函数仍可直接调用（callee 位裸宿主直调路径）", () => {
    expect(
      run(`export function f() { function g(a) { return a + 1; } return g(2); }`),
    ).toEqual({ ok: true, value: 3 });
  });
});
