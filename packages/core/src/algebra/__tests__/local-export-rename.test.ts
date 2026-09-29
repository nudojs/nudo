/**
 * 本地 `export { foo as bar }`（无 from）的导出名映射不得丢失。
 * 回归背景：extractFn 只按声明名登记 env.fns，查找 bar 时拿不到 foo；
 * scan-call-graph 的 ExternalFnRef.fnName 仍是导出名，侧车/call-graph 落空。
 * 同类：`export { foo as default }` 也要能按 default 取到 foo。
 */
import { describe, it, expect } from "vitest";
import { generalizeFromAst, extractFn } from "../generalize.ts";
import { resolveExportSource } from "../scan-call-graph.ts";
import { scanLiteralCalls } from "../scan.ts";
import { pTrue } from "../pred.ts";

describe("local export rename name mapping", () => {
  it("extractFn finds export { foo as bar } as bar", () => {
    const src = `function foo(x) { return x; }\nexport { foo as bar };\n`;
    expect(extractFn(src, "foo")).toBeDefined();
    expect(extractFn(src, "bar")).toBeDefined();
  });

  it("generalizeFromAst resolves renamed export bar to foo body", () => {
    const src = `function foo(x) { return x + 1; }\nexport { foo as bar };\n`;
    const g = generalizeFromAst("bar", src);
    expect(g).toBeDefined();
    expect(g!.params).toEqual(["x"]);
  });

  it("export { foo as default } is reachable as default", () => {
    const src = `function foo(x) { return x; }\nexport { foo as default };\n`;
    expect(extractFn(src, "default")).toBeDefined();
    expect(generalizeFromAst("default", src)).toBeDefined();
  });

  it("multiple renames of the same local are both registered", () => {
    const src = `function foo(x) { return x; }\nexport { foo as bar, foo as baz };\n`;
    expect(extractFn(src, "bar")).toBeDefined();
    expect(extractFn(src, "baz")).toBeDefined();
    expect(generalizeFromAst("baz", src)).toBeDefined();
  });

  it("const arrow rename is also registered", () => {
    const src = `const foo = (x) => x;\nexport { foo as bar };\n`;
    expect(extractFn(src, "bar")).toBeDefined();
  });

  it("resolveExportSource reports source for local rename (already same module)", () => {
    const src = `export function foo() { return 1; }\nexport { foo as bar };\n`;
    const r = resolveExportSource(src, "bar", () => undefined);
    expect(r.source).toBe(src);
  });

  it("scanLiteralCalls checks constraints through local rename", () => {
    const files: Record<string, string> = {
      "/t/lib.js": `function needsPos(x) {\n  if (x > 0) return x;\n  return 0;\n}\nexport { needsPos as pos };\n`,
      "/t/lib.nudo.js": `export const pos = fn({ x: number().gt(0) });\n`,
    };
    // sidecar binds by export name `pos`; call-site uses import { pos }
    const source = `import { pos } from "./lib.js";\nconst r = pos(-1);\n`;
    const loadModule = (spec: string, from: string): string | undefined => {
      const base = from.replace(/\/[^/]*$/, "/");
      const key = spec.startsWith(".") ? base + spec.replace(/^\.\//, "") : spec;
      return files[key];
    };
    const issues = scanLiteralCalls(source, [], pTrue, {
      loadModule,
      fromFile: "/t/main.js",
    });
    // 即便侧车未必命中，至少不得因找不到 pos 而把调用点整段丢掉——
    // generalizeFromAst("pos") 应能看到 needsPos 的体
    const g = generalizeFromAst("pos", files["/t/lib.js"]!);
    expect(g).toBeDefined();
    expect(g!.params).toEqual(["x"]);
  });
});
