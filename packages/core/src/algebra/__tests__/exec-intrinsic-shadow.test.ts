/**
 * 宿主内建标识符（undefined / NaN / Infinity）遮蔽回归。
 *
 * 回归背景：Identifier 读点此前无条件把这三个名字折成 `$lit(void 0)` /
 * `$lit(0/0)` / `$lit(1/0)`（intrinsics 的 hostIntrinsicLit），不读 JS 绑定
 * ⇒ 用户合法遮蔽（`const undefined = 5`、函数形参名 `undefined`）时读到的
 * 仍是宿主内建，与原生 Node 语义不符。
 *
 * 现口径（保守单位级遮蔽判定）：本转译单元内**无**同名绑定时保持字面量
 * 精确折叠（与旧产物逐字节一致）；有同名绑定时发射标识符本身，由 JS 词法
 * 绑定决定读值（外层 `$absVal` 把 Abs 绑定原样返回）。静态窄化（`x ===
 * undefined` / `case undefined:`）同用该标记——遮蔽后比较的是绑定值（如 5），
 * 不得当 nullish 字面量事实剪枝（否则 unsound）。本文件以原生 Node 语义为
 * oracle，并用未遮蔽对照组钉住折叠精确性与窄化精度（`undefined + 1` 仍折
 * exact NaN、`0 === NaN` 仍折 false、`x !== undefined` 仍窄化）。
 */
import { describe, it, expect } from "vitest";
import { val } from "./eval-helpers.ts";
import { $lit } from "../exec/runtime/state.ts";
import { transpileSource } from "../exec/transpile.ts";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { litValue } from "../abs.ts";

describe("宿主内建标识符可被用户遮蔽", () => {
  it("模块级 const undefined = 5：读点返回 5", () => {
    const src = `const undefined = 5;\nexport function f() { return undefined; }\n`;
    expect(val(src)).toEqual({ ok: true, value: 5 });
  });

  it("函数形参名 undefined：返回实参（词法绑定优先）", () => {
    expect(val(`export function f(undefined) { return undefined; }`, [$lit(7)])).toEqual({
      ok: true,
      value: 7,
    });
  });

  it("const NaN = 5; const Infinity = 6：NaN + Infinity 返回 11", () => {
    const src = [
      "const NaN = 5;",
      "const Infinity = 6;",
      "export function f() { return NaN + Infinity; }",
      "",
    ].join("\n");
    expect(val(src)).toEqual({ ok: true, value: 11 });
  });
});

describe("未遮蔽（宿主全局）行为保持精确", () => {
  it("undefined + 1 → exact NaN", () => {
    expect(val(`export function f() { return undefined + 1; }`)).toEqual({ ok: true, value: NaN });
  });

  it("0 === NaN → false（字面量身份不丢）", () => {
    expect(val(`export function f() { return 0 === NaN; }`)).toEqual({ ok: true, value: false });
  });

  it("Infinity > 1 → true", () => {
    expect(val(`export function f() { return Infinity > 1; }`)).toEqual({ ok: true, value: true });
  });

  it("未遮蔽产物仍是 $lit 折叠（逐字节兼容）", () => {
    const out = transpileSource("export function f() { return [undefined, NaN, Infinity]; }\n");
    expect(out).toContain("$lit(void 0)");
    expect(out).toContain("$lit(0/0)");
    expect(out).toContain("$lit(1/0)");
    expect(out).not.toContain("$absVal(undefined)");
  });

  it("未遮蔽 x !== undefined 仍窄化（精度回归守卫）", () => {
    const src = "export function f(x) { if (x !== undefined) return x; return 0; }";
    expect(val(src, [$lit(undefined as never)])).toEqual({ ok: true, value: 0 });
    expect(val(src, [$lit(5)])).toEqual({ ok: true, value: 5 });
  });
});

describe("遮蔽 undefined 后静态窄化不得把它当 nullish 字面量", () => {
  it("const undefined = 5：x !== undefined 按 5 比较，undefined 臂存活", () => {
    const src = [
      "const undefined = 5;",
      "export function f(x) {",
      "  if (x !== undefined) return x;",
      "  return 0;",
      "}",
    ].join("\n");
    const cons = val(src, [$lit(undefined as never)]);
    expect(cons).toEqual({ ok: true, value: undefined });
    // 对照：x = 5 时比较为假 ⇒ alt 臂
    expect(val(src, [$lit(5)])).toEqual({ ok: true, value: 0 });
  });

  it("undefined === x（字面量在左）同样按绑定值比较", () => {
    const src = [
      "const undefined = 5;",
      "export function f(x) {",
      "  if (undefined === x) return 0;",
      "  return x;",
      "}",
    ].join("\n");
    const alt = val(src, [$lit(undefined as never)]);
    expect(alt).toEqual({ ok: true, value: undefined });
    expect(val(src, [$lit(5)])).toEqual({ ok: true, value: 0 });
  });

  it("switch case undefined 在遮蔽时按 5 比较（不产生 undefined 标签事实）", () => {
    const src = [
      "const undefined = 5;",
      "export function f(x) {",
      "  switch (x) {",
      '    case undefined: return "u";',
      '    case 5: return "five";',
      '    default: return "other";',
      "  }",
      "}",
    ].join("\n");
    // x = undefined 不匹配 5 ⇒ default
    expect(val(src, [$lit(undefined as never)])).toEqual({ ok: true, value: "other" });
    // x = 5 匹配 case undefined（比较值 5）⇒ 第一条臂
    expect(val(src, [$lit(5)])).toEqual({ ok: true, value: "u" });
  });

  it("函数形参名 undefined 在体内遮蔽：x !== undefined 不得剪枝", () => {
    const src = "export function f(x, undefined) { if (x !== undefined) return x; return 0; }";
    const cons = val(src, [$lit(undefined as never), $lit(5)]);
    expect(cons).toEqual({ ok: true, value: undefined });
    // 对照：形参值 5 与 x = 5 比较为假 ⇒ return 0
    expect(val(src, [$lit(5), $lit(5)])).toEqual({ ok: true, value: 0 });
  });

  it("屏蔽单元产物发标识符读点（$absVal）", () => {
    const out = transpileSource("const undefined = 5;\nexport function f() { return undefined; }\n");
    expect(out).toContain("$absVal(undefined)");
  });

  it("@nudo:mock undefined 注入遮蔽宿主内建（Bug 274）", () => {
    const exports = runTranspiled("export function f() { return undefined; }\n", {
      mode: "exec",
      mocks: { undefined: $lit(5) },
    });
    const r = callTranspiledExportFull(exports, "f", []);
    expect(litValue(r.result)).toEqual({ ok: true, value: 5 });
  });
});
