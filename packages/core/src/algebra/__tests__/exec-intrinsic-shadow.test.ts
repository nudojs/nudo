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
 *
 * 遮蔽判定覆盖**三个位置**：读点（expr/atom.ts）、标签模板位（atom.ts）、
 * **调用位**（expr/call.ts）——调用位此前无条件走宿主裸调用（`NaN(1)`），
 * 用户绑定是 Abs 值 ⇒ 宿主当非函数调 ⇒ 假抛 TypeError（原生返回值）。
 * 表达式入口（exec/transpile/expr.ts 的 transpileExpression）另补**声明
 * 扫描**：表达式内部的声明（形参名 undefined / 局部 let / const / var /
 * catch 参数）此前不可见 ⇒ 体折宿主内建（原生读的是绑定值）。
 */
import { describe, it, expect } from "vitest";
import { parseExpression } from "@babel/parser";
import { call, throwsError, val } from "./eval-helpers.ts";
import { $lit } from "../exec/runtime/state.ts";
import { transpileExpression, transpileSource } from "../exec/transpile.ts";
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

describe("调用位（callee）的宿主内建遮蔽", () => {
  it("const NaN = (x) => x：NaN(1) 走 Abs 派发 ⇒ 1（原生同值）", () => {
    const src = `const NaN = (x) => x;\nexport function f() { return NaN(1); }\n`;
    expect(val(src)).toEqual({ ok: true, value: 1 });
  });

  it("const undefined = (x) => x：undefined(1) ⇒ 1（原生同值）", () => {
    const src = `const undefined = (x) => x;\nexport function f() { return undefined(1); }\n`;
    expect(val(src)).toEqual({ ok: true, value: 1 });
  });

  it("const Infinity = (x) => x：Infinity(1) ⇒ 1（原生同值）", () => {
    const src = `const Infinity = (x) => x;\nexport function f() { return Infinity(1); }\n`;
    expect(val(src)).toEqual({ ok: true, value: 1 });
  });

  it("未遮蔽 undefined(1) / NaN(1) 仍定抛 TypeError（原生同）", () => {
    for (const name of ["undefined", "NaN", "Infinity"]) {
      const r = call(`export function f() { return ${name}(1); }\n`);
      expect(throwsError(r.throws, "TypeError")).toBe(true);
    }
  });

  it("遮蔽但非函数（const NaN = 5）：NaN(1) 定抛 TypeError（原生同）", () => {
    const src = `const NaN = 5;\nexport function f() { return NaN(1); }\n`;
    const r = call(src);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("形参名 undefined：undefined(1) 定抛 TypeError（原生同）", () => {
    const r = call(`export function f(undefined) { return undefined(1); }\n`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("产物：遮蔽走 $callNamed（Abs 派发），未遮蔽走宿主裸调用", () => {
    const shadowed = transpileSource(
      `const NaN = (x) => x;\nexport function f() { return NaN(1); }\n`,
    );
    expect(shadowed).toContain('$callNamed("NaN"');
    expect(shadowed).not.toContain("NaN($lit(1))");
    const plain = transpileSource(`export function f() { return undefined(1); }\n`);
    expect(plain).toContain("undefined($lit(1))");
    expect(plain).not.toContain('$callNamed("undefined"');
  });

  it("new NaN() 语义不变（原生同抛 TypeError）", () => {
    expect(throwsError(call(`export function f() { return new NaN(); }\n`).throws, "TypeError")).toBe(
      true,
    );
    expect(
      throwsError(
        call(`const NaN = (x) => x;\nexport function f() { return new NaN(); }\n`).throws,
        "TypeError",
      ),
    ).toBe(true);
  });
});

describe("表达式入口扫描内部声明（遮蔽判定）", () => {
  it("形参名 undefined：体发标识符读点（$absVal），不折 $lit(void 0)", () => {
    const out = transpileExpression(parseExpression(`((undefined) => undefined)`), {});
    expect(out).toContain("$absVal(undefined)");
    expect(out).not.toContain("$lit(void 0)");
  });

  it("局部 const undefined = 5：体按绑定值比较", () => {
    const out = transpileExpression(
      parseExpression(`(() => { const undefined = 5; return undefined; })`),
      {},
    );
    expect(out).toContain("$absVal(undefined)");
    expect(out).not.toContain("$lit(void 0)");
  });

  it("无遮蔽时产物不变（仍折字面量，不发 $absVal）", () => {
    expect(transpileExpression(parseExpression(`undefined`), {})).toBe("$lit(void 0)");
    const out = transpileExpression(parseExpression(`(x => x + 1)`), {});
    expect(out).toContain("$add(x, $lit(1))");
    expect(out).not.toContain("$absVal");
  });
});

describe("成员调用键分类走单一实现（emitMemberKey）", () => {
  it("obj[\"m\"]() / obj[1]() / obj[key]() 派发形态不变", () => {
    const out = transpileSource(`export function f(o, k) { o["m"](); o[1](); o[k](); }\n`);
    expect(out).toContain('$invoke(o, "m"');
    expect(out).toContain('$invoke(o, "1"');
    expect(out).toContain("$invokeKey(o, k");
  });

  it("计算键调用仍保 this 绑定（原生同）", () => {
    const src = `export function f() { const o = { v: 7, m() { return this.v; } }; return o["m"](); }\n`;
    expect(val(src)).toEqual({ ok: true, value: 7 });
    const src2 = `export function f() { const o = { v: 7, m() { return this.v; } }; const k = "m"; return o[k](); }\n`;
    expect(val(src2)).toEqual({ ok: true, value: 7 });
  });
});

describe("analyze 模式的顶层循环剥离口径（文档面）", () => {
  it("for-in / for-of 保留（落 $forOf），普通 for / while 剥离", () => {
    const out = transpileSource(
      [
        "for (const x of [1, 2, 3]) { g(x); }",
        "for (const k in { a: 1 }) { g(k); }",
        "for (let i = 0; i < 3; i++) { g(i); }",
        "while (false) { g(1); }",
        "",
      ].join("\n"),
      { mode: "analyze" },
    );
    // 只看产物体（运行时 import 行含全部 helper 名，不能作判据）
    const body = out.split("\n").slice(2).join("\n");
    expect(body).toContain("$forOf");
    expect(body).not.toContain("$whileSeq");
  });
});
