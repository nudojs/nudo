/**
 * 求值引擎 instanceof 的 @@hasInstance 语义：RHS 是对象且带 Symbol.hasInstance
 * 方法时，instanceof 调用它（v instanceof o ≡ o[Symbol.hasInstance](v)），
 * 而非查原型链。此前 \$instanceof 只拿 RHS 的**名字**做内建/class 派发，
 * 自定义 @@hasInstance 完全忽略（5 instanceof o 折 false）。
 * 修复：transpile 对 `Symbol.X` 计算键投影为 "@@X" 字符串槽（镜像
 * m[Symbol.iterator] 投影）；instanceof Identifier RHS 把值作第三参传入，
 * \$instanceof 读到 "@@hasInstance" 可调用槽则调用并把结果布尔化。
 */
import { describe, it, expect } from "vitest";
// 相对路径引 src 引擎面（不经 @nudojs/core 别名——本 worktree 的 vite8
// 别名解析会把裸包名落到 dist 旧产物，同 eval-ta-hofs.test.ts）。
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { litValue } from "../abs.ts";
import { formatShape } from "../format.ts";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("evaluator instanceof @@hasInstance", () => {
  it("custom Symbol.hasInstance returning true", () => {
    expect(
      litValue(
        call(
          `export function f() { let o = {[Symbol.hasInstance](v){ return true; }}; return 5 instanceof o; }`,
        ).result,
      ),
    ).toEqual({ ok: true, value: true });
  });

  it("custom Symbol.hasInstance returning false", () => {
    expect(
      litValue(
        call(
          `export function f() { let o = {[Symbol.hasInstance](v){ return false; }}; return 5 instanceof o; }`,
        ).result,
      ),
    ).toEqual({ ok: true, value: false });
  });

  it("hasInstance receives the left operand", () => {
    expect(
      litValue(
        call(
          `export function f() { let got = null; let o = {[Symbol.hasInstance](v){ got = v; return true; }}; 5 instanceof o; return got; }`,
        ).result,
      ),
    ).toEqual({ ok: true, value: 5 });
  });

  it("hasInstance can discriminate values", () => {
    const src = `export function f(n) { let o = {[Symbol.hasInstance](v){ return v === 5; }}; return n instanceof o; }`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const abstractNum = { shape: { k: "prim", type: "number" }, conf: "exact" } as never;
    const r = callTranspiledExportFull(exports, "f", [abstractNum]);
    // 抽象 n：v===5 无法判定 → 结果保持抽象 boolean（非具体，不折真/假）
    expect(litValue(r.result)).toEqual({ ok: false });
  });

  it("object without hasInstance falls back to prototype chain", () => {
    // Bug 33：无 @@hasInstance 槽的闭 obj RHS 确定 non-callable → 原生定抛
    // TypeError（修前静默折 false——wrong-exact）。见 eval-instanceof-rhs.test.ts。
    const r = call(`export function f() { let o = {}; return 5 instanceof o; }`);
    expect(litValue(r.result).ok).toBe(false);
    expect(formatShape(r.throws)).toContain("TypeError");
    expect(
      litValue(call(`export function f() { let o = {}; return o instanceof Object; }`).result),
    ).toEqual({ ok: true, value: true });
  });

  it("builtin and class instanceof unaffected", () => {
    expect(litValue(call(`export function f() { return [] instanceof Array; }`).result)).toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { return 's' instanceof String; }`).result)).toEqual({ ok: true, value: false });
    expect(
      litValue(call(`export function f() { class A {} return new A() instanceof A; }`).result),
    ).toEqual({ ok: true, value: true });
  });

  it("hasInstance returning non-boolean is coerced", () => {
    expect(
      litValue(
        call(
          `export function f() { let o = {[Symbol.hasInstance](v){ return 0; }}; return 5 instanceof o; }`,
        ).result,
      ),
    ).toEqual({ ok: true, value: false });
    expect(
      litValue(
        call(
          `export function f() { let o = {[Symbol.hasInstance](v){ return 'yes'; }}; return 5 instanceof o; }`,
        ).result,
      ),
    ).toEqual({ ok: true, value: true });
  });
});
