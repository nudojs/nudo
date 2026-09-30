/**
 * #69：action-map 物化层单测（kind → 文本编辑；标题区分 fix/silence/review）。
 */
import { describe, it, expect } from "vitest";
import {
  addThrowsAnnotation,
  applyTextEdits,
  materializeAction,
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
});
