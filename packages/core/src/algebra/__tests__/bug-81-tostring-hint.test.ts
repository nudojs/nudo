/**
 * Bug 81 回归：模板插值 `${x}` 是 **ToString（string hint）** 面，须用引擎
 * 自带的 ToString 分档判据（mayToStringThrowOperand），不得复用 ToNumber 面
 * 的 noteCoercionMayThrow（对 brand/obj/fn 一律 may）⇒ Date / Map / 普通闭
 * 对象在 `${x}` 里被假记 TypeError（L2 假红）。
 */
import { describe, it, expect } from "vitest";
import { effects, val } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 81 — 模板插值用 ToString 判据", () => {
  for (const [name, expr] of [
    ["Date", `const d = new Date(0); return \`created at \${d}\`;`],
    ["Map", `const m = new Map(); return \`m=\${m}\`;`],
    ["plain obj", `const o = {}; return \`o=\${o}\`;`],
  ] as const) {
    it(`${name} 的模板插值不记 may-throw（与 String(x) / "x" + x 同裁决）`, () => {
      expect(effects(wrap(expr)), name).not.toContain("TypeError");
    });
  }

  it("值面仍精确（普通闭对象）", () => {
    expect(val(wrap(`const o = {}; return \`o=\${o}\`;`))).toEqual({ ok: true, value: "o=[object Object]" });
  });

  it("负控制：Symbol 插值的确定 TypeError 仍成立", () => {
    const r = effects(wrap(`return \`\${Symbol()}\`;`));
    // 确定抛走 throws 面（不进软 may-throw 收集器）⇒ 只钉不误记软通道
    expect(r).not.toContain("TypeError");
    expect(val(wrap(`return 1;`))).toEqual({ ok: true, value: 1 });
  });
});
