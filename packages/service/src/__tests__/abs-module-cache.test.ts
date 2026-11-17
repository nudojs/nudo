import { it, expect, describe, afterAll, beforeEach } from "vitest";
import { writeFileSync, rmSync, utimesSync, statSync } from "node:fs";
import { join } from "node:path";
import { formatShape } from "@nudojs/core";
import {
  evalAbsModuleGraph, defaultAbsLoadModule, clearAbsModuleCache,
  evictAbsModuleCacheFiles, getAbsModuleCacheSize,
} from "@nudojs/service";
import { tmpProject } from "./tmp-project.ts";

const setup = (files: Record<string, string>): string => tmpProject("nudo-modcache-", files);
beforeEach(() => clearAbsModuleCache());
afterAll(() => clearAbsModuleCache());

describe("abs module session cache", () => {
  it("复用导出 / stat 失效 / clear+evict / 缺失切片重放", () => {
    const dir = setup({ "util.js": `export function inc(x) { return x + 1; }\n` });
    let loads = 0;
    const loadModule = (spec: string, fromFile: string): string | undefined => { loads++; return defaultAbsLoadModule(spec, fromFile); };
    const entry = `import { inc } from "./util.js";\nexport function go(x) { return inc(x); }`;
    const g1 = evalAbsModuleGraph(entry, join(dir, "a.js"), { loadModule });
    const loadsAfterFirst = loads;
    const g2 = evalAbsModuleGraph(entry, join(dir, "b.js"), { loadModule });
    expect(g2.modules["./util.js"]).toBe(g1.modules["./util.js"]);
    expect(loads).toBe(loadsAfterFirst + 1);

    writeFileSync(join(dir, "util.js"), `export function inc(x) { return x + 1; }\nexport const ver = 2;\n`, "utf-8");
    const g3 = evalAbsModuleGraph(entry, join(dir, "a.js"), { loadModule });
    expect(g3.modules["./util.js"]!.named.ver).toBeDefined();

    clearAbsModuleCache();
    const beforeClear = loads;
    evalAbsModuleGraph(entry, join(dir, "a.js"), { loadModule });
    expect(loads).toBeGreaterThan(beforeClear);
    const beforeEvict = loads;
    evictAbsModuleCacheFiles([join(dir, "util.js")]);
    evalAbsModuleGraph(entry, join(dir, "a.js"), { loadModule });
    expect(loads).toBeGreaterThan(beforeEvict);

    const missDir = setup({ "util.js": `import { gone } from "./gone.js";\nexport const y = gone;\n` });
    const missEntry = `import { y } from "./util.js";\nexport function go() { return y; }`;
    const m1 = evalAbsModuleGraph(missEntry, join(missDir, "a.js"));
    expect(m1.issues.some((i) => i.kind === "missing" && i.label === "./gone.js")).toBe(true);
    const m2 = evalAbsModuleGraph(missEntry, join(missDir, "b.js"));
    expect(m2.issues.some((i) => i.kind === "missing" && i.label === "./gone.js")).toBe(true);
  });

  it("共享缺失依赖时各兄弟切片不被饿死（顺序无关）", () => {
    const dir = setup({
      "util.js": `import { gone } from "./gone.js";\nexport const y = gone;\n`,
      "helper.js": `import { gone } from "./gone.js";\nexport const z = gone;\n`,
    });
    const e1 = `import { y } from "./util.js";\nimport { z } from "./helper.js";\nexport function go() { return y + z; }`;
    const e2 = `import { z } from "./helper.js";\nexport function go() { return z; }`;
    const missing = (g: { issues: { kind: string; label: string }[] }) => g.issues.filter((i) => i.kind === "missing" && i.label === "./gone.js");
    expect(missing(evalAbsModuleGraph(e1, join(dir, "e1.js")))).toHaveLength(1);
    expect(missing(evalAbsModuleGraph(e2, join(dir, "e2.js")))).toHaveLength(1);
    clearAbsModuleCache();
    expect(missing(evalAbsModuleGraph(e2, join(dir, "e2.js")))).toHaveLength(1);
    expect(missing(evalAbsModuleGraph(e1, join(dir, "e1.js")))).toHaveLength(1);
  });

  it("传递依赖内容变更重求值中间模块；删除后重新报 missing", () => {
    const dir = setup({
      "z.js": `export function base(x) { return x + 1; }\n`,
      "m.js": `const z = require("./z.js");\nexport function wrap(x) { return z.base(x); }\n`,
    });
    let mLoads = 0;
    const loadModule = (spec: string, fromFile: string): string | undefined => { if (spec.endsWith("m.js")) mLoads++; return defaultAbsLoadModule(spec, fromFile); };
    const entry = `const m = require("./m.js");\nexport function go(x) { return m.wrap(x); }`;
    const g1 = evalAbsModuleGraph(entry, join(dir, "e1.js"), { loadModule });
    expect(g1.modules["./m.js"]!.named.wrap).toBeDefined();
    expect(mLoads).toBe(1);

    writeFileSync(join(dir, "z.js"), `export function base(x) { return x + 1; }\nexport const v = 2;\n`, "utf-8");
    const g2 = evalAbsModuleGraph(entry, join(dir, "e2.js"), { loadModule });
    expect(mLoads).toBe(2);
    expect(g2.modules["./m.js"]!.named.wrap).not.toBe(g1.modules["./m.js"]!.named.wrap);

    rmSync(join(dir, "z.js"));
    const g3 = evalAbsModuleGraph(entry, join(dir, "e3.js"), { loadModule });
    expect(g3.issues.some((i) => i.kind === "missing" && i.label === "./z.js")).toBe(true);
  });

  it("环子树不可追踪 ⇒ 不进缓存且每次重报 cycle", () => {
    const dir = setup({
      "a.js": `import { b } from "./b.js";\nexport const a = 1;\n`,
      "b.js": `import { a } from "./a.js";\nexport const b = 2;\n`,
    });
    const entry = (f: string) => `import { a } from "./a.js";\nexport function go() { return a; }`;
    const g1 = evalAbsModuleGraph(entry("e1.js"), join(dir, "e1.js"));
    expect(g1.issues.some((i) => i.kind === "cycle")).toBe(true);
    expect(getAbsModuleCacheSize()).toBe(0);
    const g2 = evalAbsModuleGraph(entry("e2.js"), join(dir, "e2.js"));
    expect(g2.issues.some((i) => i.kind === "cycle")).toBe(true);
  });

  it("custom loader：直接/传递/弃管/接管变化都 miss 并重求值", () => {
    {
      const dir = setup({ "util.js": `export const v = 1;\n` });
      let buf = `export const v = 1;\n`;
      const loadModule = (spec: string, fromFile: string): string | undefined => spec === "./util.js" ? buf : defaultAbsLoadModule(spec, fromFile);
      const entry = `import { v } from "./util.js";\nexport function go() { return v; }`;
      const g1 = evalAbsModuleGraph(entry, join(dir, "a.js"), { loadModule });
      expect(formatShape(g1.modules["./util.js"]!.named.v!)).toBe("1");
      buf = `export const v = 2;\n`;
      const g2 = evalAbsModuleGraph(entry, join(dir, "b.js"), { loadModule });
      expect(formatShape(g2.modules["./util.js"]!.named.v!)).toBe("2");
      expect(g2.modules["./util.js"]).not.toBe(g1.modules["./util.js"]);
    }
    {
      const dir = setup({ "z.js": `export const v = 1;\n`, "m.js": `import { v } from "./z.js";\nexport const w = v;\n` });
      let zBuf: string | undefined = `export const v = 1;\n`;
      const loadModule = (spec: string, fromFile: string): string | undefined => spec === "./z.js" ? zBuf : defaultAbsLoadModule(spec, fromFile);
      const entry = `import { w } from "./m.js";\nexport function go() { return w; }`;
      const g1 = evalAbsModuleGraph(entry, join(dir, "e1.js"), { loadModule });
      expect(formatShape(g1.modules["./m.js"]!.named.w!)).toBe("1");
      zBuf = `export const v = 2;\n`;
      const g2 = evalAbsModuleGraph(entry, join(dir, "e2.js"), { loadModule });
      expect(formatShape(g2.modules["./m.js"]!.named.w!)).toBe("2");
      expect(g2.modules["./m.js"]).not.toBe(g1.modules["./m.js"]);

      zBuf = undefined;
      const g3 = evalAbsModuleGraph(entry, join(dir, "e3.js"), { loadModule });
      expect(formatShape(g3.modules["./m.js"]!.named.w!)).toBe("1");
      expect(g3.modules["./m.js"]).not.toBe(g2.modules["./m.js"]);
    }
  });

  it("custom loader：内容不变命中同一导出对象；默认 loader 保持 stat 快路径", () => {
    {
      const dir = setup({ "util.js": `export function inc(x) { return x + 1; }\n` });
      let utilLoads = 0;
      const loadModule = (spec: string, fromFile: string): string | undefined => { if (spec === "./util.js") utilLoads++; return defaultAbsLoadModule(spec, fromFile); };
      const entry = `import { inc } from "./util.js";\nexport function go(x) { return inc(x); }`;
      const g1 = evalAbsModuleGraph(entry, join(dir, "a.js"), { loadModule });
      expect(utilLoads).toBe(1);
      const g2 = evalAbsModuleGraph(entry, join(dir, "b.js"), { loadModule });
      expect(g2.modules["./util.js"]).toBe(g1.modules["./util.js"]);
      expect(utilLoads).toBe(2);
    }
    {
      const dir = setup({ "util.js": `export const v = 1;\n` });
      const utilPath = join(dir, "util.js");
      const entry = (f: string) => `import { v } from "./util.js";\nexport function go() { return v; }`;
      const t1 = Math.floor(Date.now() / 1000);
      utimesSync(utilPath, t1, t1);
      const g1 = evalAbsModuleGraph(entry("a.js"), join(dir, "a.js"));
      const g2 = evalAbsModuleGraph(entry("b.js"), join(dir, "b.js"));
      expect(g2.modules["./util.js"]).toBe(g1.modules["./util.js"]);

      const t2 = t1 + 10;
      writeFileSync(utilPath, `export const v = 1;\n`, "utf-8");
      utimesSync(utilPath, t2, t2);
      const g3 = evalAbsModuleGraph(entry("c.js"), join(dir, "c.js"));
      expect(g3.modules["./util.js"]).not.toBe(g1.modules["./util.js"]);

      const sizeBefore = statSync(utilPath).size;
      writeFileSync(utilPath, `export const v = 2;\n`, "utf-8");
      utimesSync(utilPath, t2, t2);
      expect(statSync(utilPath).size).toBe(sizeBefore);
      const g4 = evalAbsModuleGraph(entry("d.js"), join(dir, "d.js"));
      expect(g4.modules["./util.js"]).toBe(g3.modules["./util.js"]);
      expect(formatShape(g4.modules["./util.js"]!.named.v!)).toBe("1");
    }
  });
});
