import { describe, it, expect } from "vitest";

// 与 server.ts 同源的 A6 约束放宽（抽出便于单测；server 内联调用）
function relaxSidecarConstraint(
  sidecarSource: string,
  fnName: string,
  param?: string,
  constraintText?: string,
): string | undefined {
  let src = sidecarSource;
  if (constraintText && constraintText.length > 0) {
    const base = constraintText
      .replace(/\.(gt|ge|lt|le|min|max|int|positive|negative)\s*\([^)]*\)/g, "")
      .replace(/\(\)/g, "()");
    if (base && base !== constraintText && src.includes(constraintText)) {
      return src.split(constraintText).join(base);
    }
  }
  if (param) {
    const re = new RegExp(
      `(\\b${param}\\s*:\\s*)number(\\(\\)(?:\\.[A-Za-z]+(?:\\([^)]*\\))?)*)`,
      "g",
    );
    const next = src.replace(re, (_m, p1) => `${p1}number()`);
    if (next !== src) return next;
  }
  const fnRe = new RegExp(
    `(\\b${fnName}\\s*=\\s*)number(\\(\\)(?:\\.[A-Za-z]+(?:\\([^)]*\\))?)*)`,
    "g",
  );
  const next = src.replace(fnRe, (_m, p1) => `${p1}number()`);
  return next !== src ? next : undefined;
}

describe("A6 relaxSidecarConstraint", () => {
  it("relaxes constraintText number().gt(0) → number()", () => {
    const sc = `export const positive = number().gt(0);\n`;
    const out = relaxSidecarConstraint(sc, "positive", "x", "number().gt(0)");
    expect(out).toContain("number()");
    expect(out).not.toContain(".gt(0)");
  });

  it("relaxes param: number().int() in fn shape", () => {
    const sc = `export default fn({ x: number().int() }, number());\n`;
    const out = relaxSidecarConstraint(sc, "f", "x", "number().int()");
    expect(out).toContain("x: number()");
    expect(out).not.toContain("number().int()");
  });
});
