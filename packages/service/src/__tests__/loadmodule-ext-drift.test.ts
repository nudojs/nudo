/**
 * 回归：目录 import（`import "./utils"` + 仅有 `utils/index.ts`）必须在
 * 所有装载管线（load-module / 模块图 / 脏图边 / env 装载 / abs 局部绑定）解析到同一文件。
 * 三套扩展名表漂移曾导致 check 能装载、模块图侧报 missing。
 */
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { defaultLoadModule, moduleResolveCandidates, resolveModuleFile } from "../load-module.ts";
import { defaultAbsLoadModule, evalAbsModuleGraph } from "../abs-modules-graph.ts";
import { buildModuleGraph } from "../analyzer-module-load.ts";
import { resolveLoadSpecPath } from "../env-path-deps.ts";
import { resolveImportAbs } from "../analyzer-abs-eval.ts";
import { tmpProject } from "./tmp-project.ts";

/** 只有 `utils/index.ts`，无 utils.js / utils/index.js 的目录 fixture */
function dirIndexFixture(): { dir: string; main: string; indexTs: string; src: string } {
  const dir = tmpProject("nudo-ext-drift-");
  mkdirSync(join(dir, "utils"), { recursive: true });
  const indexTs = join(dir, "utils", "index.ts");
  writeFileSync(indexTs, `export function pad(s: string): string { return "[" + s + "]"; }\n`, "utf-8");
  const main = join(dir, "main.ts");
  const src = `import { pad } from "./utils";\nexport function go(s: string): string { return pad(s); }\n`;
  writeFileSync(main, src, "utf-8");
  return { dir, main, indexTs, src };
}

describe("module resolve candidate table (ext-table drift)", () => {
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

// ---------------------------------------------------------------------------
// NodeNext：说明符写编译产物后缀（./lib.js）时先改回 TS 源后缀
// ---------------------------------------------------------------------------
describe("NodeNext 声明相对说明符的改写", () => {
/**
 * `tsc` 的 nodenext 官方写法是「import 时写**产物**后缀」：`.ts` 源码里
 * `import { add } from "./lib.js"` 会先被改回 `./lib.ts` 再查盘。旧候选表
 * 只拼后缀（`lib.js.js` / `lib.js.ts`）⇒ `nudo:module-missing` 假红、跨模块
 * 返回值退 unknown；`.mts` 引用方更只有一条 ESM 候选。
 */
  it(".ts 引用方：./lib.js 的改写候选优先，且真的装载到 lib.ts", () => {
    const dir = tmpProject("nudo-nodenext-ts-", {
      "lib.ts": `export function add(a: number, b: number): number { return a + b; }\n`,
      "use.ts": `import { add } from "./lib.js";\nexport function total(a: number, b: number) { return add(a, b); }\n`,
    });
    const libTs = join(dir, "lib.ts");
    const use = join(dir, "use.ts");
    const cands = moduleResolveCandidates("./lib.js", use);
    expect(cands[0]).toBe(libTs);
    expect(resolveModuleFile("./lib.js", use)).toBe(libTs);
    expect(defaultLoadModule("./lib.js", use)).toContain("add");
  });

  it(".mts 引用方：ESM 表也改写 ./lib.js → ./lib.mts（旧表只探一条 lib.js）", () => {
    const dir = tmpProject("nudo-nodenext-mts-", {
      "lib.mts": `export function add(a: number, b: number): number { return a + b; }\n`,
      "use.mts": `import { add } from "./lib.js";\nexport function total(a: number, b: number) { return add(a, b); }\n`,
    });
    expect(resolveModuleFile("./lib.js", join(dir, "use.mts"))).toBe(join(dir, "lib.mts"));
    expect(moduleResolveCandidates("./lib.mjs", join(dir, "use.mts"))[0]).toBe(
      join(dir, "lib.mts"),
    );
  });

  it("对照：无后缀说明符的候选表逐字不变（旧行为不受影响）", () => {
    const dir = tmpProject("nudo-nodenext-bare-", {
      "use.ts": `import { add } from "./lib";\n`,
    });
    const cands = moduleResolveCandidates("./lib", join(dir, "use.ts"));
    const base = join(dir, "lib");
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
});
