import { it, expect, describe, afterAll, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, utimesSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatShape } from "@nudojs/core";
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
    // 缓存命中：第二个入口不再重读盘重求值 util.js（同一导出对象）。custom
    // loader 命中需取一次内容复核（loader 当前内容 hash == 插入时求值源码
    // hash）——恰 +1 次调用，而非整棵重装载。
    expect(loads).toBe(loadsAfterFirst + 1);
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

  it("re-reports cycle issues on re-evaluation (untrackable subtrees are never cached)", () => {
    const dir = setup({
      "a.js": `import { b } from "./b.js";\nexport const a = 1;\n`,
      "b.js": `import { a } from "./a.js";\nexport const b = 2;\n`,
    });
    const entry = (f: string) => `import { a } from "./a.js";\nexport function go() { return a; }`;

    // DESIGN-002：环子树不可追踪 → 不进会话缓存（上一用例已钉
    // getAbsModuleCacheSize() === 0），第二次 evalAbsModuleGraph 是冷重
    // 求值而非缓存重放——本用例钉住重分析仍会报出 cycle issue（不因
    // 前次已报而吞掉）。
    const g1 = evalAbsModuleGraph(entry("e1.js"), join(dir, "e1.js"));
    expect(g1.issues.some((i) => i.kind === "cycle")).toBe(true);

    const g2 = evalAbsModuleGraph(entry("e2.js"), join(dir, "e2.js"));
    expect(g2.issues.some((i) => i.kind === "cycle")).toBe(true);
  });

  it("misses (no stale hit) when custom loader content changes while disk is untouched", () => {
    const dir = setup({
      "util.js": `export const v = 1;\n`,
    });
    // LSP 未保存 buffer：初始与磁盘一致，随后内存编辑 A→B，磁盘 stat 不动
    let buf = `export const v = 1;\n`;
    const loadModule = (spec: string, fromFile: string): string | undefined =>
      spec === "./util.js" ? buf : defaultAbsLoadModule(spec, fromFile);
    const entry = (f: string) => `import { v } from "./util.js";\nexport function go() { return v; }`;

    const g1 = evalAbsModuleGraph(entry("a.js"), join(dir, "a.js"), { loadModule });
    expect(formatShape(g1.modules["./util.js"]!.named.v!)).toBe("1");

    buf = `export const v = 2;\n`;
    const g2 = evalAbsModuleGraph(entry("b.js"), join(dir, "b.js"), { loadModule });
    // 磁盘 stat 未变——若命中校验磁盘盲（只比 mtime+size），此处陈旧返回 "1"
    expect(formatShape(g2.modules["./util.js"]!.named.v!)).toBe("2");
    expect(g2.modules["./util.js"]).not.toBe(g1.modules["./util.js"]);
  });

  it("misses (no stale hit) when a custom loader rewrites a transitive dep while disk is untouched", () => {
    const dir = setup({
      "z.js": `export const v = 1;\n`,
      "m.js": `import { v } from "./z.js";\nexport const w = v;\n`,
    });
    // LSP 未保存 buffer 覆写传递依赖：z 初始与磁盘一致，随后内存编辑 A→B，
    // 磁盘 stat 不动。陈旧面在中间模块 m 的子树指纹——m 自身未变、loader 不
    // 接手 m（R2 已修自身命中），本用例钉子树（传递）面：指纹复核必须按原
    // spec/fromFile 重问 loader，而不是只读磁盘比对。
    let zBuf = `export const v = 1;\n`;
    const loadModule = (spec: string, fromFile: string): string | undefined =>
      spec === "./z.js" ? zBuf : defaultAbsLoadModule(spec, fromFile);
    const entry = (f: string) => `import { w } from "./m.js";\nexport function go() { return w; }`;

    const g1 = evalAbsModuleGraph(entry("e1.js"), join(dir, "e1.js"), { loadModule });
    expect(formatShape(g1.modules["./m.js"]!.named.w!)).toBe("1");

    zBuf = `export const v = 2;\n`;
    const g2 = evalAbsModuleGraph(entry("e2.js"), join(dir, "e2.js"), { loadModule });
    // 磁盘 z.js 未动——若子树复核仍磁盘盲（依赖指纹只存 path），m 条目陈旧
    // 命中，此处仍是 "1"
    expect(formatShape(g2.modules["./m.js"]!.named.w!)).toBe("2");
    expect(g2.modules["./m.js"]).not.toBe(g1.modules["./m.js"]);
  });

  it("misses (no stale hit) when a custom loader drops a path it used to override (buffer closed unsaved)", () => {
    const dir = setup({
      "util.js": `export const v = 1;\n`,
    });
    // LSP buffer 未保存即关闭：首轮 loader 覆写 util 为 A（v=2，磁盘 stat
    // 不动），条目以 A 内容插入；随后 loader 不再接管（didClose 回退磁盘）。
    // 回落 stat 分支只证明磁盘未动、不证明条目内容 == 磁盘内容——若不补
    // 内容 hash 复核，此处陈旧返回 buffer 版 "2"；必须回到磁盘真值 "1"。
    let buf: string | undefined = `export const v = 2;\n`;
    const loadModule = (spec: string, fromFile: string): string | undefined =>
      spec === "./util.js" ? buf : defaultAbsLoadModule(spec, fromFile);
    const entry = (f: string) => `import { v } from "./util.js";\nexport function go() { return v; }`;

    const g1 = evalAbsModuleGraph(entry("a.js"), join(dir, "a.js"), { loadModule });
    expect(formatShape(g1.modules["./util.js"]!.named.v!)).toBe("2");

    buf = undefined; // buffer 关闭：loader 弃管，磁盘 stat 未变
    const g2 = evalAbsModuleGraph(entry("b.js"), join(dir, "b.js"), { loadModule });
    expect(formatShape(g2.modules["./util.js"]!.named.v!)).toBe("1");
    expect(g2.modules["./util.js"]).not.toBe(g1.modules["./util.js"]);
  });

  it("misses (no stale hit) when a custom loader takes over a previously disk-loaded transitive dep", () => {
    const dir = setup({
      "z.js": `export const v = 1;\n`,
      "m.js": `import { v } from "./z.js";\nexport const w = v;\n`,
    });
    // 接管方向：首轮 loader 不接手 z（子树指纹记磁盘内容 A + 装载询问对），
    // 随后 loader 开始覆写 z 为 B（磁盘不动）。fresh 求值此刻会装载 B——
    // 子树复核必须按原询问对重问 loader，而不是只读磁盘比对（磁盘仍 A）。
    let zBuf: string | undefined;
    const loadModule = (spec: string, fromFile: string): string | undefined =>
      spec === "./z.js" ? zBuf : defaultAbsLoadModule(spec, fromFile);
    const entry = (f: string) => `import { w } from "./m.js";\nexport function go() { return w; }`;

    const g1 = evalAbsModuleGraph(entry("e1.js"), join(dir, "e1.js"), { loadModule });
    expect(formatShape(g1.modules["./m.js"]!.named.w!)).toBe("1");

    zBuf = `export const v = 2;\n`;
    const g2 = evalAbsModuleGraph(entry("e2.js"), join(dir, "e2.js"), { loadModule });
    // 磁盘 z.js 未动、m 自身未动——若子树复核不问 loader（只读盘），m 条目
    // 陈旧命中，此处仍是 "1"
    expect(formatShape(g2.modules["./m.js"]!.named.w!)).toBe("2");
    expect(g2.modules["./m.js"]).not.toBe(g1.modules["./m.js"]);
  });

  it("hits (no re-eval) when custom loader content for a transitive dep is unchanged", () => {
    const dir = setup({
      "z.js": `export const v = 1;\n`,
      "m.js": `import { v } from "./z.js";\nexport const w = v;\n`,
    });
    let mLoads = 0;
    let zLoads = 0;
    const loadModule = (spec: string, fromFile: string): string | undefined => {
      if (spec === "./m.js") mLoads++;
      if (spec === "./z.js") zLoads++;
      return defaultAbsLoadModule(spec, fromFile);
    };
    const entry = (f: string) => `import { w } from "./m.js";\nexport function go() { return w; }`;

    const g1 = evalAbsModuleGraph(entry("e1.js"), join(dir, "e1.js"), { loadModule });
    expect(formatShape(g1.modules["./m.js"]!.named.w!)).toBe("1");
    expect(mLoads).toBe(1);
    expect(zLoads).toBe(1);

    const g2 = evalAbsModuleGraph(entry("e2.js"), join(dir, "e2.js"), { loadModule });
    // 内容未变 → 仍命中：同一导出对象（无重求值），子树复核不退化为整棵重
    // 装载。loader 恰好各 +1 = m 自身命中复核 + z 子树装载证据复核各一次；
    // 退化为重求值时 z 至少再 +2（条目自身命中复核 + 重装载），导出对象也会换。
    expect(g2.modules["./m.js"]).toBe(g1.modules["./m.js"]);
    expect(mLoads).toBe(2);
    expect(zLoads).toBe(2);
  });

  it("hits (no re-eval) when custom loader content is unchanged", () => {
    const dir = setup({
      "util.js": `export function inc(x) { return x + 1; }\n`,
    });
    let utilLoads = 0;
    const loadModule = (spec: string, fromFile: string): string | undefined => {
      if (spec === "./util.js") utilLoads++;
      return defaultAbsLoadModule(spec, fromFile);
    };
    const entry = (f: string) => `import { inc } from "./util.js";\nexport function go(x) { return inc(x); }`;

    const g1 = evalAbsModuleGraph(entry("a.js"), join(dir, "a.js"), { loadModule });
    expect(g1.modules["./util.js"]).toBeDefined();
    expect(utilLoads).toBe(1);

    const g2 = evalAbsModuleGraph(entry("b.js"), join(dir, "b.js"), { loadModule });
    // 内容未变 → 命中：同一导出对象（无重求值），loader 恰好多一次调用 =
    // 命中复核取内容，不是重装载（性能语义保留）
    expect(g2.modules["./util.js"]).toBe(g1.modules["./util.js"]);
    expect(utilLoads).toBe(2);
  });

  it("default loader keeps the stat fast path (no content-hash degradation)", () => {
    const dir = setup({
      "util.js": `export const v = 1;\n`,
    });
    const utilPath = join(dir, "util.js");
    const entry = (f: string) => `import { v } from "./util.js";\nexport function go() { return v; }`;
    // 整秒 pin：utimes 回写后 statSync().mtimeMs 精确相等可复现
    const t1 = Math.floor(Date.now() / 1000);
    utimesSync(utilPath, t1, t1);

    // 未动盘 → stat 命中（同一导出对象）
    const g1 = evalAbsModuleGraph(entry("a.js"), join(dir, "a.js"));
    const g2 = evalAbsModuleGraph(entry("b.js"), join(dir, "b.js"));
    expect(g2.modules["./util.js"]).toBe(g1.modules["./util.js"]);

    // 内容不变 + mtime 变 → miss（stat 严格相等语义，非内容比对）
    const t2 = t1 + 10;
    writeFileSync(utilPath, `export const v = 1;\n`, "utf-8");
    utimesSync(utilPath, t2, t2);
    const g3 = evalAbsModuleGraph(entry("c.js"), join(dir, "c.js"));
    expect(g3.modules["./util.js"]).not.toBe(g1.modules["./util.js"]);

    // 同 size 内容变 + mtime 回写 → 仍命中：默认路径不读自身内容做 hash
    // （§3.1 残余由宿主 evictAbsModuleCacheFiles 盖；若默认路径退化成内容
    // 比对，此处会翻 miss 并看到 "2"）
    const sizeBefore = statSync(utilPath).size;
    writeFileSync(utilPath, `export const v = 2;\n`, "utf-8");
    utimesSync(utilPath, t2, t2);
    expect(statSync(utilPath).size).toBe(sizeBefore);
    const g4 = evalAbsModuleGraph(entry("d.js"), join(dir, "d.js"));
    expect(g4.modules["./util.js"]).toBe(g3.modules["./util.js"]);
    expect(formatShape(g4.modules["./util.js"]!.named.v!)).toBe("1");
  });
});
