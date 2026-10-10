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
      sidecarPath: "/t/lib.nudo.js",
      sidecarLine: 4,
    });
    expect(formatInterfaceTierLine(tier!.source)).toBe("● contract / hw");
  });

  it("non-export → undefined (not in tier system)", () => {
    const src = `function helper(n) { return n; }\n`;
    expect(interfaceTierOf(src, "helper", "/t/x.js")).toBeUndefined();
  });

  it("export without contract → implicit without display", () => {
    const src = `export function f(x) { return x; }\n`;
    expect(interfaceTierOf(src, "f", "/t/x.js")).toEqual({ source: "implicit" });
  });

  it("sidecarLine = 绑定声明行（export const / default / export 桥接）", () => {
    // 契约原文链接（file://…#L<n>）的跳转目标：
    // 侧车中绑定声明所在行（1-based）
    const tierA = interfaceTierOf(
      `export function f(x) {\n  return x;\n}\n`,
      "f",
      "/t/lib.js",
      {
        loadModule: sidecarLoader(`import { fn, number } from "@nudojs/core";
export const f = fn({ x: number().gt(0) }, number());
`),
      },
    );
    expect(tierA?.sidecarLine).toBe(2);

    // export default fn(…)：default 声明行
    const tierB = interfaceTierOf(
      `export default function f(x) {\n  return x;\n}\n`,
      "f",
      "/t/lib.js",
      {
        loadModule: sidecarLoader(`import { fn, number } from "@nudojs/core";
export default fn({ x: number().gt(0) }, number());
`),
      },
    );
    expect(tierB?.sidecarLine).toBe(2);

    // const local + export { local as f }：本地声明行
    // （hover 命中本地名 local，bindingKey 经导出名桥接为 f）
    const tierC = interfaceTierOf(
      `function local(x) {\n  return x;\n}\nexport { local as f };\n`,
      "local",
      "/t/lib.js",
      {
        loadModule: sidecarLoader(`import { fn, number } from "@nudojs/core";
const local = fn({ x: number().gt(0) }, number());
export { local as f };
`),
      },
    );
    expect(tierC?.sidecarLine).toBe(2);
  });
});
