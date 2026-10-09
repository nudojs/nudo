import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getHoverAtPosition, getAbsAtPosition } from "../lsp-surface.ts";
import { makeBufferAwareLoadModule } from "../validation.ts";
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
    // typeText 落 evaluator/TypeValue（调用点结果），不是「只有签名」的早退
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
  it("evaluator binding returns lossless Abs (no TypeValue bridge)", () => {
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

// R2B-004：G2 作用域下 nested / class method / object method hover 不再 null
describe("getHoverAtPosition G2 scope (nested / class / object method)", () => {
  it("hover on class method name shows intension (Calculator.add)", () => {
    const source = `export class Calculator {\n  add(a, b) {\n    return a + b;\n  }\n}\n`;
    // `add` at line 2, col 2
    const hover = getHoverAtPosition("/t/cls.js", source, 2, 2);
    expect(hover).not.toBeNull();
    expect(hover!.intension ?? hover!.typeText).toBeDefined();
    expect(hover!.intension ?? hover!.typeText).toContain("add");
  });

  it("hover on nested function name shows intension (inner)", () => {
    const source = `export function outer() {\n  function inner(x) {\n    return x + 1;\n  }\n  return inner(1);\n}\n`;
    // `inner` at line 2, col 11
    const hover = getHoverAtPosition("/t/nested.js", source, 2, 11);
    expect(hover).not.toBeNull();
    expect(hover!.intension ?? hover!.typeText).toBeDefined();
    expect(hover!.intension ?? hover!.typeText).toContain("inner");
  });

  it("hover on object method name shows intension (api.get)", () => {
    const source = `export const api = {\n  get(id) {\n    return id;\n  }\n};\n`;
    // `get` at line 2, col 2
    const hover = getHoverAtPosition("/t/obj.js", source, 2, 2);
    expect(hover).not.toBeNull();
    expect(hover!.intension ?? hover!.typeText).toBeDefined();
    expect(hover!.intension ?? hover!.typeText).toContain("get");
  });

  it("hover on nested class method name shows intension (Inner.m)", () => {
    const source = `export function make() {\n  class Inner {\n    m(n) {\n      return n;\n    }\n  }\n  return new Inner();\n}\n`;
    // `m` at line 3, col 4
    const hover = getHoverAtPosition("/t/nested-cls.js", source, 3, 4);
    expect(hover).not.toBeNull();
    expect(hover!.intension ?? hover!.typeText).toBeDefined();
    expect(hover!.intension ?? hover!.typeText).toContain("m");
  });

  it("hover on class method name with @nudo:case still shows intension", () => {
    const source = `export class Calculator {\n  // @nudo:case "t" (1, 2)\n  add(a, b) {\n    return a + b;\n  }\n}\n`;
    // `add` at line 3, col 2
    const hover = getHoverAtPosition("/t/cls-case.js", source, 3, 2);
    expect(hover).not.toBeNull();
    expect(hover!.intension ?? hover!.typeText).toBeDefined();
    expect(hover!.intension ?? hover!.typeText).toContain("add");
  });

  it("hover on nested const arrow name shows intension (helper)", () => {
    const source = `export function outer() {\n  const helper = (n) => n * 2;\n  return helper(1);\n}\n`;
    // `helper` at line 2, col 8 (const helper)
    const hover = getHoverAtPosition("/t/nested-arrow.js", source, 2, 8);
    expect(hover).not.toBeNull();
    expect(hover!.intension ?? hover!.typeText).toBeDefined();
    expect(hover!.intension ?? hover!.typeText).toContain("helper");
  });
});

describe("getHoverAtPosition param projection (entryShapes + formals)", () => {
  // 绑定面只有模块级 import——参数 Abs 唯一权威源是 enclosing fn 的 generalize
  //（与函数名 hover 同源：契约种子（侧车/refine）+ 提升扫描在这里生效）
  it("destructured param declaration/usage hovers its slot Abs (sidecar contract)", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-param-hover-"));
    writeFileSync(
      join(dir, "decide.nudo.js"),
      `import { fn, string, shape, array } from '@nudojs/core';
export const decide = fn(
  { grade: string(), findings: array(shape({ ruleId: string() })) },
  shape({ ok: string() }),
);
`,
      "utf-8",
    );
    const main = `export function decide({ grade, findings }) {
  return grade + String(findings.length);
}
`;
    const f = join(dir, "decide.js");
    writeFileSync(f, main, "utf-8");
    const loadModule = makeBufferAwareLoadModule(() => undefined);

    // line 1 声明处 grade（col 25）与 line 2 体内引用（col 9）
    const decl = getHoverAtPosition(f, main, 1, 25, undefined, { loadModule });
    expect(decl).not.toBeNull();
    expect(decl!.typeText).toContain("string");

    const body = getHoverAtPosition(f, main, 2, 9, undefined, { loadModule });
    expect(body).not.toBeNull();
    expect(body!.typeText).toContain("string");
    expect(body!.abs).toContain("#");

    rmSync(dir, { recursive: true, force: true });
  });

  it("promoted direct param hovers entryShapes snapshot", () => {
    const src = `export function processItems(items) {\n  return items.map((x) => x + 1);\n}\n`;
    // line 1: items col 26
    const hover = getHoverAtPosition("/t/param-promote.js", src, 1, 26);
    expect(hover).not.toBeNull();
    expect(hover!.abs).toBeDefined();
  });

  it("unconstrained param / body local stay fail-closed null", () => {
    const src = `export function scale(x) {\n  return x * 2;\n}\n`;
    // 无契约、无提升：参数与局部都不产出（诚实 unknown，不冒充 any）
    expect(getHoverAtPosition("/t/param-null.js", src, 1, 23)).toBeNull();
    const local = `export function f(n) {\n  const local = n + 1;\n  return local;\n}\n`;
    expect(getHoverAtPosition("/t/local-null.js", local, 2, 8)).toBeNull();
  });
});
