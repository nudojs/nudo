import { it, expect, describe, afterAll, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  evalAbsModuleGraph,
  defaultAbsLoadModule,
  clearAbsModuleCache,
  evictAbsModuleCacheFiles,
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
