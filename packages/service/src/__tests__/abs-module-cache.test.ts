import { it, expect, describe, afterAll, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  evalAbsModuleGraph,
  defaultAbsLoadModule,
  clearAbsModuleCache,
  evictAbsModuleCacheFiles,
  getAbsModuleCacheSize,
} from "@nudojs/service";

const dirs: string[] = [];

function setup(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-modcache-"));
  dirs.push(dir);
  for (const [f, src] of Object.entries(files)) {
    writeFileSync(join(dir, f), src, "utf-8");
  }
  return dir;
}

beforeEach(() => clearAbsModuleCache());
afterAll(() => {
  clearAbsModuleCache();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("abs module session cache", () => {
  it("reuses evaluated dependency exports across entries (skips re-read/re-eval)", () => {
    const dir = setup({
      "util.js": `export function inc(x) { return x + 1; }\n`,
    });
    let loads = 0;
    const loadModule = (spec: string, fromFile: string): string | undefined => {
      loads++;
      return defaultAbsLoadModule(spec, fromFile);
    };
    const entry = (f: string) => `import { inc } from "./util.js";\nexport function go(x) { return inc(x); }`;

    const g1 = evalAbsModuleGraph(entry("a.js"), join(dir, "a.js"), { loadModule });
    expect(g1.modules["./util.js"]).toBeDefined();
    const loadsAfterFirst = loads;

    const g2 = evalAbsModuleGraph(entry("b.js"), join(dir, "b.js"), { loadModule });
    expect(g2.modules["./util.js"]).toBeDefined();
    // 缓存命中：第二个入口不再读盘重载 util.js
    expect(loads).toBe(loadsAfterFirst);
    // 同一条导出（引用同一对象）
    expect(g2.modules["./util.js"]).toBe(g1.modules["./util.js"]);
  });

  it("invalidates by stat fingerprint when dependency content changes", () => {
    const dir = setup({
      "util.js": `export function inc(x) { return x + 1; }\n`,
    });
    const entry = `import { inc } from "./util.js";\nexport function go(x) { return inc(x); }`;
    const entryFile = join(dir, "main.js");

    const g1 = evalAbsModuleGraph(entry, entryFile);
    expect(g1.modules["./util.js"]!.named.inc).toBeDefined();
    expect(g1.modules["./util.js"]!.named.ver).toBeUndefined();

    // 变更内容（size 必变 → 指纹必失效，与 mtime 精度无关）
    writeFileSync(join(dir, "util.js"), `export function inc(x) { return x + 1; }\nexport const ver = 2;\n`, "utf-8");
    const g2 = evalAbsModuleGraph(entry, entryFile);
    expect(g2.modules["./util.js"]!.named.ver).toBeDefined();
  });

  it("clear and evict drop cached entries", () => {
    const dir = setup({
      "util.js": `export const n = 1;\n`,
    });
    let loads = 0;
    const loadModule = (spec: string, fromFile: string): string | undefined => {
      loads++;
      return defaultAbsLoadModule(spec, fromFile);
    };
    const entry = `import { n } from "./util.js";\nexport function go() { return n; }`;
    const entryFile = join(dir, "main.js");

    evalAbsModuleGraph(entry, entryFile, { loadModule });
    const loadsAfterFirst = loads;

    clearAbsModuleCache();
    evalAbsModuleGraph(entry, entryFile, { loadModule });
    expect(loads).toBeGreaterThan(loadsAfterFirst);

    const loadsAfterSecond = loads;
    evictAbsModuleCacheFiles([join(dir, "util.js")]);
    evalAbsModuleGraph(entry, entryFile, { loadModule });
    expect(loads).toBeGreaterThan(loadsAfterSecond);
  });

  it("replays subtree load issues (missing) on cache hit", () => {
    const dir = setup({
      "util.js": `import { gone } from "./gone.js";\nexport const y = gone;\n`,
    });
    const entry = (f: string) => `import { y } from "./util.js";\nexport function go() { return y; }`;

    const g1 = evalAbsModuleGraph(entry("a.js"), join(dir, "a.js"));
    expect(g1.issues.some((i) => i.kind === "missing" && i.label === "./gone.js")).toBe(true);

    const g2 = evalAbsModuleGraph(entry("b.js"), join(dir, "b.js"));
    expect(g2.issues.some((i) => i.kind === "missing" && i.label === "./gone.js")).toBe(true);
  });

  it("keeps each sibling's missing slice when siblings share one missing dep (BUG-010)", () => {
    const dir = setup({
      "util.js": `import { gone } from "./gone.js";\nexport const y = gone;\n`,
      "helper.js": `import { gone } from "./gone.js";\nexport const z = gone;\n`,
    });
    const e1 = `import { y } from "./util.js";\nimport { z } from "./helper.js";\nexport function go() { return y + z; }`;
    const e2 = `import { z } from "./helper.js";\nexport function go() { return z; }`;
    const hasMissing = (g: { issues: { kind: string; label: string }[] }) =>
      g.issues.some((i) => i.kind === "missing" && i.label === "./gone.js");

    // 冷分析 e1：两个兄弟各自指向同一缺失文件；flat 列表按 kind:label 去重只报一次
    const g1 = evalAbsModuleGraph(e1, join(dir, "e1.js"));
    expect(g1.issues.filter((i) => i.kind === "missing" && i.label === "./gone.js")).toHaveLength(1);

    // 暖分析 e2：helper.js 命中缓存——后到兄弟的子树切片不得被全局去重饿死为空
    const g2 = evalAbsModuleGraph(e2, join(dir, "e2.js"));
    expect(hasMissing(g2)).toBe(true);

    // 顺序无关：清缓存后先 e2（冷）再 e1（暖），各入口的 missing 诊断与上面一致
    clearAbsModuleCache();
    const g2cold = evalAbsModuleGraph(e2, join(dir, "e2.js"));
    expect(hasMissing(g2cold)).toBe(true);
    const g1warm = evalAbsModuleGraph(e1, join(dir, "e1.js"));
    expect(g1warm.issues.filter((i) => i.kind === "missing" && i.label === "./gone.js")).toHaveLength(1);
  });

  it("re-evaluates a middle module when a transitive dep content changes (DESIGN-002)", () => {
    const dir = setup({
      "z.js": `export function base(x) { return x + 1; }\n`,
      "m.js": `const z = require("./z.js");\nexport function wrap(x) { return z.base(x); }\n`,
    });
    let mLoads = 0;
    const loadModule = (spec: string, fromFile: string): string | undefined => {
      if (spec.endsWith("m.js")) mLoads++;
      return defaultAbsLoadModule(spec, fromFile);
    };
    const entry = (f: string) => `const m = require("./m.js");\nexport function go(x) { return m.wrap(x); }`;

    const g1 = evalAbsModuleGraph(entry("e1.js"), join(dir, "e1.js"), { loadModule });
    expect(g1.modules["./m.js"]!.named.wrap).toBeDefined();
    expect(mLoads).toBe(1);

    // 叶子 z.js 内容变更：m.js 自身 stat 未动——条目的子树内容指纹必须翻转，
    // 第二个入口看到的是重求值的 m（新导出对象），而不是陈旧命中。
    writeFileSync(
      join(dir, "z.js"),
      `export function base(x) { return x + 1; }\nexport const v = 2;\n`,
      "utf-8",
    );
    const g2 = evalAbsModuleGraph(entry("e2.js"), join(dir, "e2.js"), { loadModule });
    expect(mLoads).toBe(2);
    expect(g2.modules["./m.js"]!.named.wrap).toBeDefined();
    expect(g2.modules["./m.js"]!.named.wrap).not.toBe(g1.modules["./m.js"]!.named.wrap);
  });

  it("drops the middle-module entry when a tracked transitive dep is deleted (DESIGN-002)", () => {
    const dir = setup({
      "z.js": `export function base(x) { return x + 1; }\n`,
      "m.js": `const z = require("./z.js");\nexport function wrap(x) { return z.base(x); }\n`,
    });
    const entry = (f: string) => `const m = require("./m.js");\nexport function go(x) { return m.wrap(x); }`;
    const g1 = evalAbsModuleGraph(entry("e1.js"), join(dir, "e1.js"));
    expect(g1.modules["./m.js"]!.named.wrap).toBeDefined();

    // 依赖被删：指纹复核读失败 → m 条目 miss，重求值重新报 missing（不重放旧 issue）
    rmSync(join(dir, "z.js"));
    const g2 = evalAbsModuleGraph(entry("e2.js"), join(dir, "e2.js"));
    expect(g2.issues.some((i) => i.kind === "missing" && i.label === "./z.js")).toBe(true);
  });

  it("does not session-cache modules with untrackable subtrees (cycle, DESIGN-002)", () => {
    const dir = setup({
      "a.js": `import { b } from "./b.js";\nexport const a = 1;\n`,
      "b.js": `import { a } from "./a.js";\nexport const b = 2;\n`,
    });
    const entry = `import { a } from "./a.js";\nexport function go() { return a; }`;
    const g = evalAbsModuleGraph(entry, join(dir, "e.js"));
    expect(g.issues.some((i) => i.kind === "cycle")).toBe(true);
    // 环内模块子树不可追踪 → 不进会话缓存（fail-closed，宁冷勿陈旧）
    expect(getAbsModuleCacheSize()).toBe(0);
  });

  it("replays cycle issues on cache hit", () => {
    const dir = setup({
      "a.js": `import { b } from "./b.js";\nexport const a = 1;\n`,
      "b.js": `import { a } from "./a.js";\nexport const b = 2;\n`,
    });
    const entry = (f: string) => `import { a } from "./a.js";\nexport function go() { return a; }`;

    const g1 = evalAbsModuleGraph(entry("e1.js"), join(dir, "e1.js"));
    expect(g1.issues.some((i) => i.kind === "cycle")).toBe(true);

    const g2 = evalAbsModuleGraph(entry("e2.js"), join(dir, "e2.js"));
    expect(g2.issues.some((i) => i.kind === "cycle")).toBe(true);
  });
});
