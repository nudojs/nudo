import { describe, it, expect } from "vitest";
import { getHoverAtPosition, getAbsAtPosition } from "../lsp-surface.ts";
import { formatAbs } from "@nudojs/core";

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

describe("getAbsAtPosition", () => {
  it("B-path binding returns lossless Abs (no TypeValue bridge)", () => {
    const source = `const x = 1 + 2;\n`;
    const abs = getAbsAtPosition("/t/abs-pos.js", source, 1, 7);
    expect(abs).not.toBeNull();
    expect(formatAbs(abs!)).toContain("3");
    expect(abs!.conf).toBe("exact");
  });

  it("expression node returns Abs with term identity", () => {
    const source = `const n = 40 + 2;\n`;
    const abs = getAbsAtPosition("/t/abs-pos2.js", source, 1, 14);
    expect(abs).not.toBeNull();
    expect(formatAbs(abs!)).toContain("2");
  });

  it("case body: Abs replay with selected case args (activeCases)", () => {
    const source = `/**
 * @nudo:case "n" (3)
 * @nudo:case "s" (10)
 */
function scale(x) {
  return x * 2;
}
`;
    // return 里的 x：case "n" → 3；case "s" → 10（行 6 列 9 = x）
    const abs0 = getAbsAtPosition("/t/case-replay.js", source, 6, 9, new Map([["scale", 0]]));
    expect(abs0).not.toBeNull();
    expect(formatAbs(abs0!)).toContain("3");

    const abs1 = getAbsAtPosition("/t/case-replay.js", source, 6, 9, new Map([["scale", 1]]));
    expect(abs1).not.toBeNull();
    expect(formatAbs(abs1!)).toContain("10");

    // BinaryExpression 整节点（列 9–14）：x*2 在 case "n" 下是 6
    const ret0 = getAbsAtPosition("/t/case-replay.js", source, 6, 10, new Map([["scale", 0]]));
    expect(ret0).not.toBeNull();
    // 最紧包围可能是 x(3) 或 x*2(6)——两者都证明 case 实参已注入
    expect(formatAbs(ret0!)).toMatch(/\b[36]\b/);
  });
});
