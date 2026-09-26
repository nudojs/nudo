import { it, expect, describe, afterAll } from "vitest";
import { analyzeFile, clearBPathCache, isBPathCapable } from "@nudojs/service";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function analyze(src: string, file = "index.js") {
  const dir = mkdtempSync(join(tmpdir(), "nudo-hosted-"));
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "hosted", version: "1.0.0" }));
  const p = join(dir, file);
  writeFileSync(p, src);
  clearBPathCache();
  return { result: analyzeFile(p, src), path: p, src };
}

describe("B-hosted skips TypeValue evaluateProgram", () => {
  it("capable file is B-hosted and still infers cases", () => {
    const src = `/**
 * @nudo:case "n" (3)
 */
export function scale(x) {
  return x * 2 + 1;
}
`;
    const { result, path } = analyze(src);
    expect(isBPathCapable(src, [])).toBe(true);
    const fn = result.functions.find((f) => f.name === "scale");
    expect(fn?.cases).toHaveLength(1);
    expect(fn?.cases[0]?.abs.shape.k).toBe("prim");
    // 无 TypeValue 专有叠报
    expect(result.diagnostics.filter((d) => d.code === "nudo:unknown-global")).toHaveLength(0);
    expect(result.bindings.has("scale")).toBe(true);
  });

  it("import + top-level call still yields call@ cases", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-hosted2-"));
    dirs.push(dir);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "h2", version: "1.0.0" }));
    writeFileSync(
      join(dir, "util.js"),
      `export function twice(n) { return n * 2; }
`,
    );
    const src = `import { twice } from "./util.js";
const boom = twice(21);
export function go(n) { return twice(n); }
`;
    writeFileSync(join(dir, "index.js"), src);
    clearBPathCache();
    const r = analyzeFile(join(dir, "index.js"), src);
    const go = r.functions.find((f) => f.name === "go");
    const twice = r.functions.find((f) => f.name === "twice");
    expect(go).toBeDefined();
    // 跨文件导出可能合成 externalFunctions 或本文件 twice
    expect(go!.cases.length + (twice?.cases.length ?? 0)).toBeGreaterThan(0);
  });

  it("fail-closed: nodeAbsMap has no Abs fill (node-level collection removed)", () => {
    const src = `const n = 1;
export function id(x) { return x; }
`;
    const { result } = analyze(src);
    // 节点级 Abs 收集（collectAbsBindsAndNodes）已删——显式无信息
    expect(result.nodeAbsMap.size).toBe(0);
  });

  it("BindingInfo.abs filled from B bindings (Abs host fill removed)", () => {
    const src = `const n = 1 + 2;
export function id(x) { return x; }
`;
    const { result } = analyze(src);
    const n = result.bindings.get("n");
    expect(n).toBeDefined();
    // 绑定面保留（collectAbsBindingsFromGraph 的 B 版）；节点表面已删
    expect(n?.abs).toBeDefined();
  });

  it("constraint case grammar still fills case Abs via TypeValue fallback", () => {
    const src = `
/**
 * @nudo:case "n" (number())
 */
export function double(x) { return x * 2; }
`;
    const { result } = analyze(src);
    const fn = result.functions.find((f) => f.name === "double");
    expect(fn?.cases[0]?.argAbs).toBeDefined();
    expect(fn?.cases[0]?.abs).toBeDefined();
  });
});
