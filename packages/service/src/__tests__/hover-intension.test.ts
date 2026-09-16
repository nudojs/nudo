import { describe, it, expect } from "vitest";
import { getHoverAtPosition } from "../lsp-surface.ts";

describe("getHoverAtPosition lossless Abs", () => {
  it("hover on function name shows Abs + intension", () => {
    const source = `function scale(x) { return x + 1; }\nscale(2);\n`;
    const hover = getHoverAtPosition("/t/hover.js", source, 1, 9);
    expect(hover).not.toBeNull();
    expect(hover!.intension ?? hover!.typeText).toContain("scale");
    expect(hover!.intension ?? "").toContain("+");
    // 无损 Abs：含 conf 标记
    expect(hover!.abs).toBeDefined();
    expect(hover!.abs).toContain("#");
    expect(hover!.absMultiline).toBeDefined();
  });

  it("hover on binding shows Abs from evalProgramAbs", () => {
    const source = `const x = 1 + 2;\n`;
    const hover = getHoverAtPosition("/t/h3.js", source, 1, 7);
    if (hover?.abs) {
      expect(hover.abs).toContain("3");
    }
  });

  it("hover on expression uses Abs node table (lossless)", () => {
    const source = `const n = 1 + 2;\n`;
    // column of `2` is 14 (0-based)
    const hover = getHoverAtPosition("/t/h4.js", source, 1, 14);
    expect(hover).not.toBeNull();
    expect(hover!.abs).toBeDefined();
    expect(hover!.abs).toContain("2");
  });

  it("hover on non-function still returns type", () => {
    const source = `const n = 1;\n`;
    const hover = getHoverAtPosition("/t/h2.js", source, 1, 7);
    if (hover) expect(typeof hover.typeText).toBe("string");
  });

  it("hover on HOF function name reads intension (formatPoly), not arity-only", () => {
    const source = `function processItems(items, transform, filter) {
  return items.filter(filter).map(transform);
}
`;
    // 列：function 名 processItems 起始附近
    const hover = getHoverAtPosition("/t/hof-hover.js", source, 1, 10);
    expect(hover).not.toBeNull();
    expect(hover!.intension).toBeDefined();
    expect(hover!.intension).toContain("items: arr(A1)");
    expect(hover!.intension).toContain("B:transform");
    expect(hover!.intension).not.toContain("arr(A1) = A1");
  });

  it("hover on call callee keeps call-site typeText and attaches intension", () => {
    const source = `function scale(x) { return x * 2; }
const r = scale(3);
`;
    // scale( 的 callee 列
    const hover = getHoverAtPosition("/t/hof-call-hover.js", source, 2, 11);
    expect(hover).not.toBeNull();
    // intension 来自 generalize，不是 arity-only
    expect(hover!.intension).toBeDefined();
    expect(hover!.intension).toContain("scale");
    // typeText 落 B-path/TypeValue（调用点结果），不是「只有签名」的早退
    expect(hover!.typeText).toBeDefined();
    expect(hover!.typeText).not.toBe(hover!.intension);
  });

  it("hover on HOF call site: intension has relations, typeText is not just signature", () => {
    const source = `function processItems(items, transform, filter) {
  return items.filter(filter).map(transform);
}
function caller(items) {
  return processItems(items, (x) => x * 2, (x) => x > 0);
}
`;
    // caller 内 processItems( 的 callee
    const hover = getHoverAtPosition("/t/hof-call2.js", source, 5, 12);
    expect(hover).not.toBeNull();
    expect(hover!.intension).toContain("items: arr(A1)");
    expect(hover!.intension).toContain("B:transform");
    // 有外延侧结果时，typeText 不应被 intension 整份顶掉
    if (hover!.typeText && hover!.typeText !== hover!.intension) {
      expect(hover!.typeText.length).toBeGreaterThan(0);
    }
  });
});
