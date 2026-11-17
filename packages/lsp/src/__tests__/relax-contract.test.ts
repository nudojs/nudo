import { describe, it, expect } from "vitest";
import { relaxSidecarConstraint } from "../a6-relax.ts";

describe("A6 relaxSidecarConstraint (shared implementation)", () => {
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

  it("P0.5 multi-export: only target fn region is rewritten", () => {
    const sc = [
      `import { fn, number } from "@nudojs/core";`,
      `export const alpha = fn({ x: number().gt(0) }, number());`,
      `export const beta = fn({ x: number().int().gt(1) }, number());`,
      ``,
    ].join("\n");
    const out = relaxSidecarConstraint(sc, "beta", "x", "number().int().gt(1)")!;
    expect(out).toBeDefined();
    // alpha 契约必须保留
    expect(out).toContain("export const alpha = fn({ x: number().gt(0) }");
    // beta 被放宽
    expect(out).toContain("export const beta = fn({ x: number() }");
    expect(out).not.toContain("number().int().gt(1)");
  });

  it("P0.5 param regex does not escape into other exports via split/join", () => {
    const sc = [
      `export const f = fn({ x: number().gt(0) }, number());`,
      `export const g = fn({ x: number().gt(9) }, number());`,
      ``,
    ].join("\n");
    // 只放宽 g 的 x：f 的 .gt(0) 不得被剥掉
    const out = relaxSidecarConstraint(sc, "g", "x", undefined)!;
    expect(out).toBeDefined();
    expect(out).toContain("export const f = fn({ x: number().gt(0) }");
    expect(out).toContain("export const g = fn({ x: number() }");
  });

  it("escapes special regex chars in fnName", () => {
    const sc = `export const a$b = fn({ x: number().int() }, number());\n`;
    const out = relaxSidecarConstraint(sc, "a$b", "x", "number().int()")!;
    expect(out).toBeDefined();
    expect(out).toContain("x: number()");
  });

  it("P2: strips .int on param chain (return constraint untouched)", () => {
    const sc = `export const n = fn({ x: number().int().gt(0) }, number().int());\n`;
    const out = relaxSidecarConstraint(sc, "n", "x", "number().int().gt(0)")!;
    expect(out).toBeDefined();
    expect(out).toContain("x: number()");
    expect(out).not.toContain("number().int().gt(0)");
  });
});

// BUG-060：类方法的平铺侧车键 `K_run` 与 quoted `"K.run"` / 顶层函数同面
describe("A6 BUG-060 flat Class_method sidecar key", () => {
  const flat = `import { fn, number } from "@nudojs/core";\nexport const K_run = fn({ n: number() }, number().gt(40));\n`;
  const quoted = `import { fn, number } from "@nudojs/core";\nconst _nudo_1 = fn({ n: number() }, number().gt(40));\nexport { _nudo_1 as "K.run" };\n`;

  it("平铺 K_run：没有 constraintText 也能定位返回槽并放宽", () => {
    const out = relaxSidecarConstraint(flat, "K.run");
    expect(out).toBeDefined();
    expect(out).toContain("export const K_run = fn({ n: number() }, number())");
    expect(out).not.toContain("number().gt(40)");
  });

  it("quoted \"K.run\" 与顶层函数对照不回归", () => {
    expect(relaxSidecarConstraint(quoted, "K.run")).toContain(
      "fn({ n: number() }, number())",
    );
    const top = `export const f = fn({ n: number() }, number().gt(40));\n`;
    expect(relaxSidecarConstraint(top, "f")).toContain(
      "export const f = fn({ n: number() }, number())",
    );
  });
});
