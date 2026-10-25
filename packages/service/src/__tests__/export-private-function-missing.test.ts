/**
 * 私有顶层函数**不是**模块导出 —— 跨模块具名 import 必须报
 * `nudo:missing-export`，而不是被 evaluator 的导出表静默解析。
 *
 * 修前：transpile 给所有顶层 FunctionDeclaration 加 `export ` 前缀 ⇒
 * run.ts 文本回收把私有函数并入导出表 ⇒ `evalExportsToModuleExports`
 * 的 Object.keys 面包含私有名 ⇒ `import { helper }` 从"私有但既然能求值
 * 就当导出"静默拿值（原生 ESM 是 link-time SyntaxError；nudo 应报缺名）。
 *
 * 修后：私有函数的 run 槽是**非枚举**分析槽（按名调用仍可用），模块导出
 * 表（Object.keys）只剩真实导出 ⇒ 缺名判定自然触发。依赖内部直接调用私有
 * 函数（`export function entry(){ return helper(); }`）不受影响——那是
 * 闭包调用，不经导出表。
 */
import { describe, it, expect } from "vitest";
import { analyzeFile, clearEvalCache, evalAbsModuleGraph } from "@nudojs/service";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpProject } from "./tmp-project.ts";

function setup(files: Record<string, string>): string {
  const dir = tmpProject("nudo-privexport-");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "privexport", version: "1.0.0" }));
  for (const [name, src] of Object.entries(files)) {
    writeFileSync(join(dir, name), src);
  }
  return dir;
}

function analyze(dir: string, src: string, file = "index.js") {
  writeFileSync(join(dir, file), src);
  clearEvalCache();
  return analyzeFile(join(dir, file), src);
}

const DEP = `function helper() { return 1; }
export const a = 2;
`;

const CONSUMER = `import { helper } from "./m.js";
/**
 * @nudo:case
 */
export function go() { return helper; }
`;

describe("私有顶层函数不可跨模块具名 import", () => {
  it("报 nudo:missing-export（error），并点名依赖与符号", () => {
    const dir = setup({ "m.js": DEP });
    const r = analyze(dir, CONSUMER);
    const missing = r.diagnostics.filter((d) => d.code === "nudo:missing-export");
    expect(missing.length).toBe(1);
    expect(missing[0]!.severity).toBe("error");
    expect(missing[0]!.message).toContain("m.js");
    expect(missing[0]!.message).toContain("helper");
  });

  it("依赖的求值导出表不含私有名（evaluated 真值面）", () => {
    const dir = setup({ "m.js": DEP });
    writeFileSync(join(dir, "index.js"), CONSUMER);
    clearEvalCache();
    const g = evalAbsModuleGraph(CONSUMER, join(dir, "index.js"));
    const dep = g.modules["./m.js"];
    expect(dep).toBeDefined();
    expect(dep!.evaluated).toBe(true);
    expect(Object.hasOwn(dep!.named, "helper")).toBe(false);
    expect(Object.hasOwn(dep!.named, "a")).toBe(true);
    expect(g.issues.some((i) => i.kind === "missing-export" && i.label.includes("helper"))).toBe(
      true,
    );
  });

  it("真实导出的具名 import 不受影响（零回归）", () => {
    const dir = setup({ "m.js": DEP });
    const src = `import { a } from "./m.js";
/**
 * @nudo:case
 */
export function go() { return a; }
`;
    const r = analyze(dir, src);
    expect(r.diagnostics.filter((d) => d.code === "nudo:missing-export")).toEqual([]);
  });
});
