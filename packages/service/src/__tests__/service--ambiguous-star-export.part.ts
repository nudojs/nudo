/**
 * BUG-269 回归：相对 `export *` 的**同名冲突**是 ESM 的**歧义导出**——按规范
 * 该名**不导出**，宿主的导入方在链接期
 * `SyntaxError: contains conflicting star exports for name 'x'`。
 *
 * 改前引擎按源序后者覆盖 ⇒ 门禁判绿并印出宿主**不可能产出**的确定字面量，
 * 且只换两行 `export *` 顺序结论就翻转。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { evalAbsModuleGraph, clearAbsModuleCache } from "../abs-modules-graph.ts";
import { resolveExportSite } from "../analyzer-abs-eval.ts";
import { tmpProject } from "./tmp-project.ts";

function setup(cBody: string, files: Record<string, string> = {}) {
  const entry = 'import { x } from "./c.mjs";\nexport function use() { return x; }\n';
  const dir = tmpProject("nudo-269-", {
    "a.mjs": "export const x = 1;\n",
    "b.mjs": "export const x = 2;\n",
    "c.mjs": cBody,
    "d.mjs": entry,
    ...files,
  });
  const entryFile = join(dir, "d.mjs");
  const graph = evalAbsModuleGraph(entry, entryFile, {});
  return { dir, graph };
}

const issuesOf = (g: ReturnType<typeof setup>["graph"]) =>
  g.issues.filter((i) => i.kind === "missing-export").map((i) => i.label);

beforeEach(() => {
  clearAbsModuleCache();
});

describe("BUG-269 — export * 同名冲突是歧义导出（不可用）", () => {
  it("两个星号导出同名 ⇒ 该名不导出（导入方报缺名），顺序无关", () => {
    for (const cBody of [
      'export * from "./a.mjs";\nexport * from "./b.mjs";\n',
      'export * from "./b.mjs";\nexport * from "./a.mjs";\n',
    ]) {
      const { graph } = setup(cBody);
      const c = graph.modules["./c.mjs"];
      expect(c).toBeDefined();
      expect(Object.hasOwn(c!.named, "x")).toBe(false);
      expect(issuesOf(graph)).toContain("./c.mjs#x");
    }
  });

  it("对照组：本地导出遮蔽星号导出 ⇒ x 存在且值取自本地（不是歧义）", () => {
    const { graph } = setup(
      'export * from "./a.mjs";\nexport * from "./b.mjs";\nexport const x = 3;\n',
    );
    const c = graph.modules["./c.mjs"];
    expect(Object.hasOwn(c!.named, "x")).toBe(true);
    expect(issuesOf(graph)).not.toContain("./c.mjs#x");
  });

  it("定义位点解析同口径：歧义名解析不出（不得给一个确定定义模块）", () => {
    const dir = setup('export * from "./a.mjs";\nexport * from "./b.mjs";\n').dir;
    expect(resolveExportSite(join(dir, "c.mjs"), "x")).toBeUndefined();
  });

  it("定义位点对照：非歧义星号导出照常解析到定义模块", () => {
    const dir = setup('export * from "./a.mjs";\n').dir;
    expect(resolveExportSite(join(dir, "c.mjs"), "x")?.modulePath).toBe(join(dir, "a.mjs"));
  });
});
