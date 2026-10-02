/**
 * #69：action-map 物化层单测（kind → 文本编辑；标题区分 fix/silence/review）。
 */
import { describe, it, expect } from "vitest";
import {
  addThrowsAnnotation,
  applyTextEdits,
  materializeAction,
  matchSidecarFnDecl,
  sidecarBindingFor,
  titleKindFor,
  wrapReturnNullable,
} from "../quickfix-edits.ts";

describe("quickfix materialize", () => {
  it("titleKind: draft=fix, entry throws=review, unproven relax=review", () => {
    expect(titleKindFor("nudo:entry-may-throw", { kind: "draft", label: "x" })).toBe("fix");
    expect(titleKindFor("nudo:entry-may-throw", { kind: "relax", label: "x" })).toBe("silence");
    expect(titleKindFor("nudo:unproven-return", { kind: "relax", label: "x" })).toBe("review");
  });

  it("addThrowsAnnotation inserts @nudo:throws into existing JSDoc", () => {
    const src = `/**
 * helper
 */
export function f(n) {
  return n.type;
}
`;
    const r = addThrowsAnnotation(src, "f", "TypeError");
    expect(r).toBeDefined();
    const next = applyTextEdits(src, r!.edits);
    expect(next).toContain("@nudo:throws TypeError");
    expect(next).toContain("helper");
  });

  it("addThrowsAnnotation creates JSDoc when missing", () => {
    const src = `export function f(n) { return n.x; }\n`;
    const r = addThrowsAnnotation(src, "f", "TypeError");
    const next = applyTextEdits(src, r!.edits);
    expect(next).toContain("/**");
    expect(next).toContain("@nudo:throws TypeError");
  });

  it("addThrowsAnnotation expands single-line JSDoc instead of prepending", () => {
    const src = `/** helper */\nexport function f(n) { return n.x; }\n`;
    const r = addThrowsAnnotation(src, "f", "TypeError");
    expect(r).toBeDefined();
    const next = applyTextEdits(src, r!.edits);
    expect(next).toContain("@nudo:throws TypeError");
    expect(next).toContain("helper");
    // 不得把 tag 插到 `/**` 之前
    expect(next.trimStart().startsWith("/**")).toBe(true);
    expect(next).toContain("*/");
  });

  it("wrapReturnNullable wraps the return clause", () => {
    const sc = `export const parseMajor = fn({ range: string() }, number());\n`;
    const next = wrapReturnNullable(sc, "parseMajor");
    expect(next).toContain("nullable(number())");
    expect(next).toContain("fn({ range: string() }");
  });

  it("materialize entry-may-throw draft: source body-read is enough (no empty shape)", () => {
    // 诊断未带 body-read 时仍可从源码用法推断并生成 shape（非 command-only）
    const src = `export function staticName(node) {
  return node.type === "x" ? node.name : null;
}
`;
    const plan = materializeAction({
      code: "nudo:entry-may-throw",
      fn: "staticName",
      file: "/t/a.js",
      source: src,
      sidecarPath: "/t/a.nudo.js",
      action: {
        kind: "draft",
        command: "nudo contract --draft",
        label: "narrow the entry",
      },
    });
    expect(plan?.titleKind).toBe("fix");
    expect(plan?.sidecar?.newText).toContain("shape({");
    expect(plan?.sidecar?.newText).not.toContain("shape({})");
    expect(plan?.sidecar?.newText).toContain("type: string()");
  });

  it("materialize entry-may-throw draft with body-read emits inferred types (not empty / not fake string)", () => {
    const src = `export function staticName(node) {
  return node.type === "Identifier" ? node.name : null;
}
`;
    const plan = materializeAction({
      code: "nudo:entry-may-throw",
      fn: "staticName",
      file: "/t/a.js",
      source: src,
      sidecarPath: "/t/a.nudo.js",
      action: { kind: "draft", label: "x" },
      suggestion: "property 'type' on any  /* body-read { type, name } */",
    });
    expect(plan?.sidecar?.newText).toContain("shape({");
    expect(plan?.sidecar?.newText).toContain("type: string()");
    // name 无用法证据 → any()（不得武断 string()）
    expect(plan?.sidecar?.newText).toContain("name: any()");
    expect(plan?.sidecar?.newText).not.toContain("shape({ })");
    expect(plan?.sidecar?.newText).not.toContain("shape({})");
    expect(plan?.title).toContain("string()");
  });

  it("body-read without type evidence fills any() not string()", () => {
    const src = `export function pick(node) {
  return node.type;
}
`;
    const plan = materializeAction({
      code: "nudo:entry-may-throw",
      fn: "pick",
      file: "/t/a.js",
      source: src,
      sidecarPath: "/t/a.nudo.js",
      action: { kind: "draft", label: "x" },
      suggestion: "/* body-read { type } */",
    });
    expect(plan?.sidecar?.newText).toContain("type: any()");
  });

  // #76 缺口 A/C：嵌套成员读取 → 生成嵌套 shape。
  // 中间环写 any() 会让"读它的属性"继续记 may-throw（动作自废），
  // 且重复请求应给出覆盖嵌套路径的文本（而非同一条扁平 any()）。
  it("nested member reads materialize as nested shapes (intermediates never any())", () => {
    const src = `export function locLine(node) {
  return node.loc.start.line;
}
export function propType(node) {
  return node.property.type;
}
`;
    for (const [fn, expected] of [
      ["locLine", "shape({ loc: shape({ start: shape({ line: any() }) }) })"],
      ["propType", "shape({ property: shape({ type: any() }) })"],
    ] as const) {
      const plan = materializeAction({
        code: "nudo:entry-may-throw",
        fn,
        file: "/t/a.js",
        source: src,
        sidecarPath: "/t/a.nudo.js",
        action: { kind: "draft", label: "x" },
      });
      expect(plan?.sidecar?.newText).toContain(expected);
      // 中间环不得写 any()（loc/property 是对象，不是无约束值）
      expect(plan?.sidecar?.newText).not.toContain("loc: any()");
      expect(plan?.sidecar?.newText).not.toContain("property: any()");
    }
  });
});

describe("DESIGN-003 alias-form sidecar (identity = exported name)", () => {
  const ALIAS_CLS =
    `// @generated by nudo — do not edit\n` +
    `const _nudo_1 = fn({ x: number() }, number());\n` +
    `export { _nudo_1 as class };\n`;
  const ALIAS_STR =
    `// @generated by nudo — do not edit\n` +
    `const _nudo_1 = fn({ x: number() }, number());\n` +
    `export { _nudo_1 as "a-b" };\n`;

  it("sidecarBindingFor resolves alias clauses incl. string names", () => {
    expect(sidecarBindingFor(ALIAS_CLS, "class")).toBe("_nudo_1");
    expect(sidecarBindingFor(ALIAS_STR, "a-b")).toBe("_nudo_1");
    // 直发段不是别名形态 → undefined（身份=绑定名，调用方按直发处理）
    expect(sidecarBindingFor("export const add2 = fn({ x: number() });\n", "add2")).toBeUndefined();
    // 未知名 → undefined
    expect(sidecarBindingFor(ALIAS_CLS, "toString")).toBeUndefined();
  });

  it("sidecarBindingFor resolves quoted names containing , or } (F6 quote-aware scan)", () => {
    // 触发机制：写出面 exportNameRepr 对非标识符导出名发射 JSON 引号串
    // （`export { _nudo_1 as "a,b" }` 是合法产物）；修复前读取面正则
    // `\{([^}]*)\}` 在引号内 `}` 提前截断、split(",") 切进引号内逗号 →
    // 返回 undefined，wrapReturnNullable 等 quickfix 静默 no-op。
    const COMMA =
      `// @generated by nudo — do not edit\n` +
      `const _nudo_1 = fn({ x: number() }, number());\n` +
      `export { _nudo_1 as "a,b" };\n`;
    const BRACE =
      `// @generated by nudo — do not edit\n` +
      `const _nudo_1 = fn({ x: number() }, number());\n` +
      `export { _nudo_1 as "a}b" };\n`;
    expect(sidecarBindingFor(COMMA, "a,b")).toBe("_nudo_1");
    expect(sidecarBindingFor(BRACE, "a}b")).toBe("_nudo_1");
    // matchSidecarFnDecl 经 binding 回落同口径可用（修复前 undefined）
    expect(matchSidecarFnDecl(COMMA, "a,b")).toBeDefined();
    // 引号内逗号不切断兄弟 specifier：同子句后续别名仍可解析
    const SIBLING =
      `const _nudo_1 = fn(number(), number());\n` +
      `const _nudo_2 = fn(number(), number());\n` +
      `export { _nudo_1 as "a,b", _nudo_2 as c };\n`;
    expect(sidecarBindingFor(SIBLING, "c")).toBe("_nudo_2");
  });

  it("matchSidecarFnDecl locates alias-form declaration by exported name", () => {
    const r = matchSidecarFnDecl(ALIAS_CLS, "class");
    expect(r).toBeDefined();
    // start 指向绑定表达式（消费方 slice start..闭括号 即可取到 fn(...) 调用）
    expect(ALIAS_CLS.slice(r!.start, r!.start + 13)).toBe("_nudo_1 = fn(");
    // 字符串导出名同口径
    expect(matchSidecarFnDecl(ALIAS_STR, "a-b")).toBeDefined();
  });

  it("wrapReturnNullable edits the return slot inside an alias const", () => {
    const next = wrapReturnNullable(ALIAS_CLS, "class");
    expect(next).toBeDefined();
    expect(next).toContain("nullable(number())");
    // 别名段身份不被改写：导出子句保持 class
    expect(next).toContain("export { _nudo_1 as class };");
  });
});
