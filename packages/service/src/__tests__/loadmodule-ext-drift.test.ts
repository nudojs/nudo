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
 * 返回值退 unknown。
 *
 * 改写表必须与 `tsc` 同口径：`.js` → `.ts` / `.tsx` / `.d.ts`，**与引用方
 * 扩展名无关**（`.mts` 引用方 + 只有 `lib.mts` ⇒ tsc TS2307；+ `lib.ts` ⇒ OK）。
 * 旧实现按引用方格式把 `.js` 改成 `.mts`/`.cts`，与 tsc 相反。
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

  it(".mts 引用方：./lib.js 按 tsc 口径改写为 ./lib.ts（不是 ./lib.mts）", () => {
    const dir = tmpProject("nudo-nodenext-mts-", {
      "lib.ts": `export function add(a: number, b: number): number { return a + b; }\n`,
      "use.mts": `import { add } from "./lib.js";\nexport function total(a: number, b: number) { return add(a, b); }\n`,
    });
    const use = join(dir, "use.mts");
    expect(moduleResolveCandidates("./lib.js", use)[0]).toBe(join(dir, "lib.ts"));
    expect(resolveModuleFile("./lib.js", use)).toBe(join(dir, "lib.ts"));
    // `.mjs` 说明符仍按格式后缀改写（这条与 `.js` 无关）
    expect(moduleResolveCandidates("./lib.mjs", use)[0]).toBe(join(dir, "lib.mts"));
  });

  it(".mts 引用方 + 只有 lib.mts：不解析（与 tsc 的 TS2307 一致）", () => {
    // 旧实现把 `.mts` 引用方的 `./lib.js` 改写成 `./lib.mts` ⇒ 假绿/假红都与
    // tsc 分叉：tsc 只认 `lib.ts` / `lib.tsx` / `lib.d.ts`。
    const dir = tmpProject("nudo-nodenext-mts-only-", {
      "lib.mts": `export function add(a: number, b: number): number { return a + b; }\n`,
      "use.mts": `import { add } from "./lib.js";\n`,
    });
    const use = join(dir, "use.mts");
    expect(moduleResolveCandidates("./lib.js", use)).not.toContain(join(dir, "lib.mts"));
    expect(resolveModuleFile("./lib.js", use)).toBeUndefined();
  });

  it(".ts 引用方 + 只有 lib.tsx：./lib.js 解析到 lib.tsx", () => {
    const dir = tmpProject("nudo-nodenext-tsx-", {
      "lib.tsx": `export function add(a: number, b: number): number { return a + b; }\n`,
      "use.ts": `import { add } from "./lib.js";\n`,
    });
    expect(resolveModuleFile("./lib.js", join(dir, "use.ts"))).toBe(join(dir, "lib.tsx"));
  });

  it(".ts 引用方 + 只有 lib.d.ts：./lib.js 解析到声明文件", () => {
    const dir = tmpProject("nudo-nodenext-dts-", {
      "lib.d.ts": `export declare function add(a: number, b: number): number;\n`,
      "use.ts": `import { add } from "./lib.js";\n`,
    });
    expect(resolveModuleFile("./lib.js", join(dir, "use.ts"))).toBe(join(dir, "lib.d.ts"));
  });

  it("真实存在的 lib.js 仍是候选（改写 miss 后回落原说明符）", () => {
    const dir = tmpProject("nudo-nodenext-js-", {
      "lib.js": `export function add(a, b) { return a + b; }\n`,
      "use.ts": `import { add } from "./lib.js";\n`,
    });
    const libJs = join(dir, "lib.js");
    expect(resolveModuleFile("./lib.js", join(dir, "use.ts"))).toBe(libJs);
    expect(defaultLoadModule("./lib.js", join(dir, "use.ts"))).toContain("add");
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
