/**
 * A7：inlay 对齐 interface 档（design-refine-derivation §8）
 * - default 走 symbolic + entryReqs
 * - 与 CodeLens `● interface` 同源（interfaceTierOf）
 * - implicit 导出返回标 derived
 */
import { describe, it, expect } from "vitest";
import { collectAbsInlays } from "../inlay.ts";
import { interfaceTierOf, formatInterfaceTierLine } from "../interface.ts";

const HANDWRITTEN_SIDECAR = `
import { fn, number } from "@nudojs/core";

export const add = fn({ x: number().gt(0) }, number().gt(2));
`;

const sidecarLoader = (sidecar: string) => (spec: string) =>
  spec.endsWith("lib.nudo.js") ? sidecar : undefined;

describe("collectAbsInlays × interface 档 (A7)", () => {
  it("handwritten export: param where + interfaceSource=handwritten, no derived mark", () => {
    const src = `export function add(x) {\n  return x + 2;\n}\n`;
    const inlays = collectAbsInlays(src, {
      fromFile: "/t/lib.js",
      loadModule: sidecarLoader(HANDWRITTEN_SIDECAR),
    });
    const param = inlays.find((i) => i.kind === "parameter");
    expect(param).toBeDefined();
    expect(param!.interfaceSource).toBe("handwritten");
    expect(param!.label).toContain("where");
    const ret = inlays.find((i) => i.kind === "type");
    expect(ret).toBeDefined();
    expect(ret!.interfaceSource).toBe("handwritten");
    expect(ret!.derived).toBeUndefined();
    expect(ret!.label).not.toContain("derived");
  });

  it("implicit export: return inlay marked derived + interfaceSource=implicit", () => {
    const src = `export function double(x) {\n  return x * 2;\n}\n\ndouble(21);\n`;
    const inlays = collectAbsInlays(src, { fromFile: "/t/calls.js" });
    const ret = inlays.find((i) => i.kind === "type");
    expect(ret).toBeDefined();
    expect(ret!.interfaceSource).toBe("implicit");
    expect(ret!.derived).toBe(true);
    expect(ret!.label).toContain("· derived");
  });

  it("private function: no interfaceSource (not in CodeLens tier either)", () => {
    const src = `function helper(n) {\n  return n + 1;\n}\n`;
    const inlays = collectAbsInlays(src, { fromFile: "/t/priv.js" });
    const ret = inlays.find((i) => i.kind === "type");
    expect(ret).toBeDefined();
    expect(ret!.interfaceSource).toBeUndefined();
    expect(ret!.derived).toBeUndefined();
  });

  it("without fromFile: symbolic return only, no tier tags", () => {
    const src = `export function scale(x) { return x + 1; }\n`;
    const inlays = collectAbsInlays(src);
    const ret = inlays.find((i) => i.kind === "type");
    expect(ret!.interfaceSource).toBeUndefined();
  });

  it("autoBind:false → implicit derived even with handwritten sidecar", () => {
    const src = `export function add(x) {\n  return x + 2;\n}\n`;
    const inlays = collectAbsInlays(src, {
      fromFile: "/t/lib.js",
      loadModule: sidecarLoader(HANDWRITTEN_SIDECAR),
      autoBind: false,
    });
    const ret = inlays.find((i) => i.kind === "type");
    expect(ret!.interfaceSource).toBe("implicit");
    expect(ret!.derived).toBe(true);
  });
});

describe("interfaceTierOf 同源 (A7)", () => {
  it("export + handwritten sidecar → handwritten + display", () => {
    const src = `export function add(x) {\n  return x + 2;\n}\n`;
    const tier = interfaceTierOf(src, "add", "/t/lib.js", {
      loadModule: sidecarLoader(HANDWRITTEN_SIDECAR),
    });
    expect(tier).toEqual({
      source: "handwritten",
      display: "(x: number().gt(0)) → number().gt(2)",
    });
    expect(formatInterfaceTierLine(tier!.source)).toBe("● interface / handwritten");
  });

  it("non-export → undefined (not in tier system)", () => {
    const src = `function helper(n) { return n; }\n`;
    expect(interfaceTierOf(src, "helper", "/t/x.js")).toBeUndefined();
  });

  it("export without contract → implicit without display", () => {
    const src = `export function f(x) { return x; }\n`;
    expect(interfaceTierOf(src, "f", "/t/x.js")).toEqual({ source: "implicit" });
  });
});
