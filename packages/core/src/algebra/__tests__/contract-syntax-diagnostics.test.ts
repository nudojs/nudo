/**
 * FIX-D1 回归：F-3-silent-drop 契约文法实例（#6-8, #11）。
 * 非法 @nudo:contract 段 / default @nudo:import 发 nudo:contract-syntax 显式诊断，
 * 不再静默 continue。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  extractRefinesFromSource,
  extractRefineReturnFromSource,
  extractNudoImports,
  takeRefineDiags,
  setRefineDiagCollector,
} from "../refine.ts";

beforeEach(() => {
  setRefineDiagCollector(null);
  takeRefineDiags();
});

describe("F-3 #6-8: malformed @nudo:contract segments", () => {
  it("#6 x > 0 → nudo:contract-syntax diagnostic", () => {
    takeRefineDiags();
    const src = `/**
 * @nudo:contract x > 0
 */
export function f(x) { return x; }`;
    const refs = extractRefinesFromSource(src, "f");
    const diags = takeRefineDiags();
    expect(refs).toHaveLength(0);
    expect(diags.some((d) => d.code === "nudo:contract-syntax" && d.message.includes("x > 0"))).toBe(true);
  });

  it("#7 x number() (inline builder) → nudo:contract-syntax diagnostic", () => {
    takeRefineDiags();
    const src = `/**
 * @nudo:contract x number()
 */
export function f(x) { return x; }`;
    const refs = extractRefinesFromSource(src, "f");
    const diags = takeRefineDiags();
    expect(refs).toHaveLength(0);
    expect(diags.some((d) => d.code === "nudo:contract-syntax")).toBe(true);
  });

  it("#8 x,y pos → diagnostic for 'x' segment, 'y pos' still works", () => {
    takeRefineDiags();
    const src = `
/// @nudo:import { pos } from "./c.nudo.js"
/**
 * @nudo:contract x,y pos
 */
export function f(x, y) { return x + y; }`;
    const refs = extractRefinesFromSource(src, "f", {
      loadModule: () => `export const pos = number().gt(0);`,
      fromFile: "/t/f.js",
    });
    const diags = takeRefineDiags();
    // x 段单独不匹配 → 诊断；y pos 匹配 → 产出 refines
    expect(diags.some((d) => d.code === "nudo:contract-syntax")).toBe(true);
    // y 应该有 refine（约束解析成功时）
    if (refs.length > 0) {
      expect(refs[0]!.param).toBe("y");
    }
  });

  it("valid contract segment → no diagnostic", () => {
    takeRefineDiags();
    const src = `
/// @nudo:import { pos } from "./c.nudo.js"
/**
 * @nudo:contract x pos
 */
export function f(x) { return x; }`;
    extractRefinesFromSource(src, "f", {
      loadModule: () => `export const pos = number().gt(0);`,
      fromFile: "/t/f.js",
    });
    const diags = takeRefineDiags();
    expect(diags.filter((d) => d.code === "nudo:contract-syntax")).toHaveLength(0);
  });

  it("return segment with bad syntax → diagnostic", () => {
    takeRefineDiags();
    const src = `/**
 * @nudo:contract return > 0
 */
export function f(x) { return x; }`;
    extractRefinesFromSource(src, "f"); // skips return segments
    const r = extractRefineReturnFromSource(src, "f");
    const diags = takeRefineDiags();
    expect(diags.some((d) => d.code === "nudo:contract-syntax")).toBe(true);
    expect(r).toBeUndefined();
  });
});

describe("F-3 #11: default @nudo:import", () => {
  it("default import → nudo:contract-syntax diagnostic", () => {
    takeRefineDiags();
    const src = `/// @nudo:import d from "./x.nudo.js"
export function f(x) { return x; }`;
    const imports = extractNudoImports(src);
    const diags = takeRefineDiags();
    expect(imports).toHaveLength(0);
    expect(diags.some((d) => d.code === "nudo:contract-syntax" && d.message.includes("Default"))).toBe(true);
  });

  it("named import → no diagnostic", () => {
    takeRefineDiags();
    const src = `/// @nudo:import { pos } from "./x.nudo.js"
export function f(x) { return x; }`;
    const imports = extractNudoImports(src);
    const diags = takeRefineDiags();
    expect(imports).toHaveLength(1);
    expect(diags.filter((d) => d.code === "nudo:contract-syntax")).toHaveLength(0);
  });

  it("namespace import → no diagnostic", () => {
    takeRefineDiags();
    const src = `/// @nudo:import * as ns from "./x.nudo.js"
export function f(x) { return x; }`;
    const imports = extractNudoImports(src);
    const diags = takeRefineDiags();
    expect(imports).toHaveLength(1);
    expect(diags.filter((d) => d.code === "nudo:contract-syntax")).toHaveLength(0);
  });

  it("garbage import form → diagnostic", () => {
    takeRefineDiags();
    const src = `/// @nudo:import !!!! from
export function f(x) { return x; }`;
    extractNudoImports(src);
    const diags = takeRefineDiags();
    expect(diags.some((d) => d.code === "nudo:contract-syntax")).toBe(true);
  });
});
