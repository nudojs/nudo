/**
 * B2 金标：内联变量 / 签名改可选。
 */
import { describe, it, expect } from "vitest";
import { inlineVariableAt, makeParamOptionalAt } from "../refactor-b2.ts";

describe("B2 refactor.inline", () => {
  it("inlines a pure local and removes the declaration", () => {
    const src = `function f() {\n  const n = 1 + 2;\n  return n + n;\n}\n`;
    // 光标在 `n`（line 2, col 8）
    const r = inlineVariableAt(src, 2, 8);
    expect(r && "edits" in r).toBe(true);
    if (!r || !("edits" in r)) return;
    expect(r.title).toContain("Inline variable 'n'");
    expect(r.title).toContain("2 use");
    const replaced = r.edits.filter((e) => e.newText.includes("1 + 2"));
    expect(replaced.length).toBe(2);
    const deleted = r.edits.find((e) => e.newText === "");
    expect(deleted).toBeDefined();
    expect(deleted!.range.start.character).toBe(0);
  });

  it("rejects impure init (call)", () => {
    const src = `function f() {\n  const n = g();\n  return n;\n}\n`;
    const r = inlineVariableAt(src, 2, 8);
    expect(r).toBeNull();
  });

  it("rejects reassigned binding", () => {
    const src = `function f() {\n  let n = 1;\n  n = 2;\n  return n;\n}\n`;
    const r = inlineVariableAt(src, 2, 6);
    expect(r).toBeNull();
  });

  /**
   * BUG-073：内联把初始化器文本搬到**使用点** ⇒ 自由名的解析随目标作用域改变。
   * 使用点所在作用域重新绑定了同一个名字（`const a = 10`）时内联会让值静默
   * 改变（`f(1)()` 从 2 变 11）；对照（不遮蔽）必须照常内联，否则这条闸门
   * 会把绝大多数正常内联一起关掉。
   */
  it("rejects inlining when the use site shadows a free name of the initializer", () => {
    const shadowed = `export function f(a) {\n  const x = a + 1;\n  return () => {\n    const a = 10;\n    return x;\n  };\n}\n`;
    // 光标在 x 的声明（line 1, col 8）
    expect(inlineVariableAt(shadowed, 2, 8)).toBeNull();

    // 对照：内层只声明**别的**名字 ⇒ 自由名 a 仍解析到形参 ⇒ 允许内联
    const control = `export function f(a) {\n  const x = a + 1;\n  return () => {\n    const b = 10;\n    return x;\n  };\n}\n`;
    const r = inlineVariableAt(control, 2, 8);
    expect(r && "edits" in r).toBe(true);
  });
});

describe("B2 refactor.rewrite — make param optional", () => {
  it("adds default undefined to a parameter", () => {
    const src = `function f(a, b) {\n  return a + b;\n}\n`;
    // 光标在 `b`（line 1, col 14）
    const r = makeParamOptionalAt(src, 1, 14);
    expect(r && "edits" in r).toBe(true);
    if (!r || !("edits" in r)) return;
    expect(r.title).toContain("make 'b' optional");
    expect(r.edits[0]!.newText).toBe("b = undefined");
    expect(r.edits[0]!.range.start.line).toBe(0);
  });

  it("TS 的可选形参 x?: T 已经是可选 ⇒ 不再出手（对照：x: T 照常出手）", () => {
    // 旧行为：把 `x?: number` 整段改成 `x: number = undefined`，`?` 静默
    // 消失、strict 工程编不过；安全类重构不该对已满足前提的代码动手。
    const already = `export function f(x?: number) { return x; }\n`;
    expect(makeParamOptionalAt(already, 1, 18)).toBeNull();
    const plain = `export function f(x: number) { return x; }\n`;
    const r = makeParamOptionalAt(plain, 1, 18);
    // `x: number` 的注解删除口径尚未落地：旧实现产出
    // `x: number = undefined`（TS strict 下非法）⇒ 这里只钉「照常出手」，
    // 不再把非法文本当成基线。
    expect(r && "edits" in r).toBe(true);
    if (!r || !("edits" in r)) return;
    expect(r.edits.length).toBeGreaterThan(0);
  });

  it("ignores a non-parameter identifier", () => {
    const src = `function f(a) {\n  return a;\n}\n`;
    const r = makeParamOptionalAt(src, 2, 9);
    expect(r).toBeNull();
  });
});
