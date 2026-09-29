/**
 * BUG-016 回归：目录 import（`import "./utils"` + 仅有 `utils/index.ts`）必须在
 * 所有装载管线（load-module / 模块图 / 脏图边 / env 装载 / abs 局部绑定）解析到同一文件。
 * 三套扩展名表漂移曾导致 check 能装载、模块图侧报 missing。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultLoadModule, moduleResolveCandidates, resolveModuleFile } from "../load-module.ts";
import { defaultAbsLoadModule, evalAbsModuleGraph } from "../abs-modules-graph.ts";
import { buildModuleGraph } from "../analyzer-module-load.ts";
import { resolveLoadSpecPath } from "../env-path-deps.ts";
import { resolveImportAbs } from "../analyzer-abs-eval.ts";

const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 只有 `utils/index.ts`，无 utils.js / utils/index.js 的目录 fixture */
function dirIndexFixture(): { dir: string; main: string; indexTs: string; src: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-ext-drift-"));
  dirs.push(dir);
  mkdirSync(join(dir, "utils"), { recursive: true });
  const indexTs = join(dir, "utils", "index.ts");
  writeFileSync(indexTs, `export function pad(s: string): string { return "[" + s + "]"; }\n`, "utf-8");
  const main = join(dir, "main.ts");
  const src = `import { pad } from "./utils";\nexport function go(s: string): string { return pad(s); }\n`;
  writeFileSync(main, src, "utf-8");
  return { dir, main, indexTs, src };
}

describe("module resolve candidate table (BUG-016 ext-table drift)", () => {
  it("candidate table always includes file exts and index.js/.mjs/.ts entries", () => {
    const { main } = dirIndexFixture();
    const cands = moduleResolveCandidates("./utils", main);
    const base = join(main, "..", "utils");
    expect(cands).toEqual([
      base,
      `${base}.js`,
      `${base}.mjs`,
      `${base}.ts`,
      join(base, "index.js"),
      join(base, "index.mjs"),
      join(base, "index.ts"),
    ]);
  });

  it("defaultLoadModule / defaultAbsLoadModule / resolveImportAbs / resolveLoadSpecPath all hit utils/index.ts", () => {
    const { main, indexTs } = dirIndexFixture();
    const content = defaultLoadModule("./utils", main);
    expect(content).toContain("pad");
    expect(resolveModuleFile("./utils", main)).toBe(indexTs);
    expect(resolveLoadSpecPath("./utils", main)).toBe(indexTs);
    expect(resolveImportAbs("./utils", main)).toBe(indexTs);

    const absSrc = defaultAbsLoadModule("./utils", main);
    expect(absSrc).toContain("pad");
  });

  it("module graph edge (dirty-graph) resolves ./utils to utils/index.ts", () => {
    const { main, indexTs, src } = dirIndexFixture();
    const { imports } = buildModuleGraph([main, indexTs]);
    expect(imports.get(main)).toEqual(new Set([indexTs]));
    // 源码侧再确认 specifier 就是目录形式
    expect(src).toContain(`from "./utils"`);
  });

  it("evalAbsModuleGraph loads ./utils (no module-missing issue)", () => {
    const { main, indexTs, src } = dirIndexFixture();
    const { modules, issues, byPath } = evalAbsModuleGraph(src, main);
    expect(issues.filter((i) => i.kind === "missing")).toEqual([]);
    expect(modules["./utils"]).toBeDefined();
    expect(modules["./utils"]!.named.pad).toBeDefined();
    expect(byPath.has(indexTs)).toBe(true);
  });
});
