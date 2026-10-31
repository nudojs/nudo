/**
 * BUG-009 回归：正则**字面量**的 `flags` 必须按 ES 规范序
 * （`d g i m s u v y`）返回。
 *
 * 根因：`packages/core/src/algebra/builtins/regexp.ts` 的 `regexpBrandSlots`
 * （brand 槽的唯一构造点）把 `litFlags` **原样**写进槽——而同文件的文档注释
 * 却写着「flags：字面量 flags → strLit（规范序）」⇒ 注释与实现相反。
 * `new RegExp(...)` 构造路径**正确**（它先跑真 JS `new RegExp(p, flags)` 再
 * 取 `r.flags`），正则**字面量**路径绕开了它（`$regex` 把源码里的原始 flag
 * 文本直接传下去）⇒ 同一引擎两条路径结论不同。
 *
 * 修法：写入槽前一律用真 JS `new RegExp("", flags).flags` 规范化
 * （与构造路径同口径）。
 */
import { describe, it, expect } from "vitest";
import { val } from "./eval-helpers.ts";

const lit = (src: string): unknown => {
  const r = val(src);
  return r.ok ? r.value : undefined;
};

const wrap = (body: string): string => `export function f() { ${body} }`;

describe("BUG-009：正则字面量的 flags 按规范序", () => {
  it("/a/gimuyds.flags ⇒ \"dgimsuy\"（源码序 ≠ 规范序）", () => {
    expect(lit(wrap("return /a/gimuyds.flags;"))).toBe("dgimsuy");
  });

  it("/a/gmsiy.flags ⇒ \"gimsy\"", () => {
    expect(lit(wrap("return /a/gmsiy.flags;"))).toBe("gimsy");
  });

  it("/a/gimuyds.toString() ⇒ \"/a/dgimsuy\"", () => {
    expect(lit(wrap("return /a/gimuyds.toString();"))).toBe("/a/dgimsuy");
  });

  it("构造路径仍正确（回归控制）：new RegExp(\"a\",\"gimuyds\").flags ⇒ \"dgimsuy\"", () => {
    expect(lit(wrap("return new RegExp(\"a\",\"gimuyds\").flags;"))).toBe("dgimsuy");
  });

  it("已规范的 flags 不变（回归控制）：/a/gimsuy.flags ⇒ \"gimsuy\"", () => {
    expect(lit(wrap("return /a/gimsuy.flags;"))).toBe("gimsuy");
  });

  it("7 个布尔标志 getter 与顺序无关（回归控制）", () => {
    expect(lit(wrap("return /a/gimuyds.global;"))).toBe(true);
    expect(lit(wrap("return /a/gimuyds.ignoreCase;"))).toBe(true);
    expect(lit(wrap("return /a/gimuyds.hasIndices;"))).toBe(true);
    expect(lit(wrap("return /a/gimuyds.sticky;"))).toBe(true);
    expect(lit(wrap("return /a/gimuyds.unicode;"))).toBe(true);
    expect(lit(wrap("return /a/gimuyds.dotAll;"))).toBe(true);
    expect(lit(wrap("return /a/gimuyds.multiline;"))).toBe(true);
  });
});
