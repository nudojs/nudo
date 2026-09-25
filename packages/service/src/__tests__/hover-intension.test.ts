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

  it("hover on binding shows Abs from evalAbsModuleGraph bindings", () => {
    const source = `const x = 1 + 2;\n`;
    const hover = getHoverAtPosition("/t/h3.js", source, 1, 7);
    if (hover?.abs) {
      expect(hover.abs).toContain("3");
    }
  });

  it("hover on identifier resolves through the binding table (node table removed)", () => {
    const source = `const n = 1 + 2;\n`;
    // fail-closed：节点级 Abs 表已删——标识符 n（column 6）经绑定表解析
    const hover = getHoverAtPosition("/t/h4.js", source, 1, 6);
    expect(hover).not.toBeNull();
    expect(hover!.abs).toBeDefined();
    expect(hover!.abs).toContain("3");
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

  it("identifier returns Abs through binding table (node table removed)", () => {
    const source = `const n = 40 + 2;\n`;
    const abs = getAbsAtPosition("/t/abs-pos2.js", source, 1, 6);
    expect(abs).not.toBeNull();
    expect(formatAbs(abs!)).toContain("42");
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
    // fail-closed：执行态 case 重放（evalSource）已删——case 选中态的
    // 节点级 Abs 无数据（显式无信息）
    const abs0 = getAbsAtPosition("/t/case-replay.js", source, 6, 9, new Map([["scale", 0]]));
    expect(abs0).toBeNull();

    const abs1 = getAbsAtPosition("/t/case-replay.js", source, 6, 9, new Map([["scale", 1]]));
    expect(abs1).toBeNull();

    const ret0 = getAbsAtPosition("/t/case-replay.js", source, 6, 10, new Map([["scale", 0]]));
    expect(ret0).toBeNull();
  });
});
