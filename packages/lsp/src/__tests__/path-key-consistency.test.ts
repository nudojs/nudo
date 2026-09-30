import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cacheKey,
  cacheKeyGraph,
  makeBufferAwareLoadModule,
} from "../validation.ts";
import { computeDirtySet } from "@nudojs/service";
import { uriForFileOrUri, type CommandDeps } from "../server-commands.ts";
import { collectNavigationExtraFiles, type NavigationDeps } from "../server-navigation.ts";

/**
 * FIX-RESIDUAL-2 / FIX-J1 残留：activeLoadModule / getOpenText / uriForFileOrUri /
 * buildModuleGraph 边 与 cacheKey 不一致处统一走 cacheKey。同一 Windows 文件的
 * uri 形态（`file:///c:/a.js`、`/c:/a.js`）与 fs 解析形态（`c:\a.js`）必须能互相
 * 命中，否则未保存 buffer 对 agent/hover 不可见、脏传播跨形态漏边。
 *
 * 这些测试在 POSIX 上跑；cacheKey 自身统一盘符形态，无需真 Windows。
 */
describe("cacheKeyGraph (R2-2 buildModuleGraph edge unification)", () => {
  it("normalizes fs-native edge keys to cacheKey so computeDirtySet hits across forms", () => {
    // buildModuleGraph 的 `to` 边是 resolveModuleFile 的 fs 原生形态（c:\...），
    // `from` 是 knownFiles 的 cacheKey 形态（c:/...）。
    const raw = new Map<string, Set<string>>([
      ["c:\\proj\\dep.js", new Set(["c:/proj/parent.js"])],
    ]);
    const g = cacheKeyGraph(raw);
    // 变更文件以 cacheKey 形态（生产传 cacheKey(p)）查询能命中
    const dirty = computeDirtySet(g, cacheKey("file:///c:/proj/dep.js"));
    expect(new Set(dirty)).toEqual(new Set(["c:/proj/dep.js", "c:/proj/parent.js"]));
  });

  it("hits when the changed file is passed in a different form than the edge key", () => {
    const raw = new Map<string, Set<string>>([
      ["c:\\proj\\dep.js", new Set(["c:/proj/parent.js"])],
    ]);
    // 同一查询以 /c:/ 形态给出（uriToFilePath 形态）——cacheKeyGraph 后仍命中
    const dirty = computeDirtySet(cacheKeyGraph(raw), cacheKey("/c:/proj/dep.js"));
    expect(new Set(dirty)).toEqual(new Set(["c:/proj/dep.js", "c:/proj/parent.js"]));
  });

  it("merges duplicate keys that only differ by path form", () => {
    const raw = new Map<string, Set<string>>([
      ["c:/proj/dep.js", new Set(["c:/proj/a.js"])],
      ["c:\\proj\\dep.js", new Set(["c:/proj/b.js"])],
    ]);
    const g = cacheKeyGraph(raw);
    expect(g.size).toBe(1);
    expect(g.get("c:/proj/dep.js")).toEqual(new Set(["c:/proj/a.js", "c:/proj/b.js"]));
  });

  it("is a no-op on clean POSIX absolute paths (cacheKey is identity)", () => {
    const raw = new Map<string, Set<string>>([["/test/dep.js", new Set(["/test/parent.js"])]]);
    const g = cacheKeyGraph(raw);
    expect(g.get("/test/dep.js")).toEqual(new Set(["/test/parent.js"]));
    expect(computeDirtySet(g, "/test/dep.js")).toEqual(["/test/dep.js", "/test/parent.js"]);
  });

  it("emits cacheKey-form dependent nodes (seed stays as the caller's cacheKey query)", () => {
    const raw = new Map<string, Set<string>>([
      ["c:\\proj\\dep.js", new Set(["file:///c:/proj/parent.js"])],
    ]);
    // 生产以 cacheKey 形式传种子（selfKey / cacheKey(p)），故种子已是 cacheKey 形态
    const seed = cacheKey("/c:/proj/dep.js");
    const dirty = computeDirtySet(cacheKeyGraph(raw), seed);
    expect(seed).toBe("c:/proj/dep.js");
    for (const d of dirty) expect(d).toBe(cacheKey(d));
    expect(dirty).toContain("c:/proj/parent.js");
  });
});

describe("uriForFileOrUri (cacheKey cross-form open-doc lookup)", () => {
  function depsWithDoc(uri: string): CommandDeps {
    return {
      connection: {} as CommandDeps["connection"],
      getDocument: () => undefined,
      listDocuments: () => [{ uri } as never],
      getActiveCases: () => new Map(),
      validateDocument: async () => {},
      validationDeps: () => ({ sendDiagnostics: () => {} }),
      refreshPullDiagnostics: () => {},
      agentToolDeps: {},
    };
  }

  it("finds the open doc when file is given in a different form than the doc uri", () => {
    const deps = depsWithDoc("file:///c:/proj/a.js");
    // 比较走 cacheKey(raw)：跨 uri/盘符形态命中 → 返回 doc.uri
    expect(uriForFileOrUri({ file: "c:\\proj\\a.js" }, deps)).toBe("file:///c:/proj/a.js");
    expect(uriForFileOrUri({ file: "/c:/proj/a.js" }, deps)).toBe("file:///c:/proj/a.js");
    expect(uriForFileOrUri({ file: "c:/proj/a.js" }, deps)).toBe("file:///c:/proj/a.js");
  });

  it("finds the open doc when the doc is registered under a path form and queried by uri", () => {
    const deps = depsWithDoc("c:/proj/a.js");
    expect(uriForFileOrUri({ file: "file:///c:/proj/a.js" }, deps)).toBe("c:/proj/a.js");
    expect(uriForFileOrUri({ file: "/c:/proj/a.js" }, deps)).toBe("c:/proj/a.js");
  });

  it("still short-circuits when params.uri is provided", () => {
    const deps = depsWithDoc("file:///c:/proj/other.js");
    expect(uriForFileOrUri({ uri: "file:///c:/proj/a.js" }, deps)).toBe("file:///c:/proj/a.js");
  });

  it("falls back to a synthesized file uri when no doc is open", () => {
    const deps = depsWithDoc("file:///c:/proj/other.js");
    const out = uriForFileOrUri({ file: "/c:/proj/gone.js" }, deps);
    expect(out.startsWith("file://")).toBe(true);
    expect(out).toContain("gone.js");
  });
});

describe("collectNavigationExtraFiles (dedup across path forms)", () => {
  it("does not list the same file twice under different forms", () => {
    const deps: NavigationDeps = {
      connection: {} as NavigationDeps["connection"],
      getDocument: () => undefined,
      listDocuments: () => [{ uri: "file:///c:/proj/a.js" } as never],
      isNudoFile: () => true,
      knownFiles: new Set(["c:/proj/a.js", "c:/proj/b.js"]),
    };
    // currentPath 以第三种形态给出同一文件 a.js
    const files = collectNavigationExtraFiles("/c:/proj/a.js", deps);
    const keys = files.map((f) => cacheKey(f));
    // a.js 只出现一次，b.js 出现一次
    expect(keys.filter((k) => k === "c:/proj/a.js").length).toBe(1);
    expect(keys.filter((k) => k === "c:/proj/b.js").length).toBe(1);
    expect(files.length).toBe(2);
  });

  it("keeps distinct files distinct", () => {
    const deps: NavigationDeps = {
      connection: {} as NavigationDeps["connection"],
      getDocument: () => undefined,
      listDocuments: () => [],
      isNudoFile: () => true,
      knownFiles: new Set(["c:/proj/a.js", "c:/proj/b.js"]),
    };
    const files = collectNavigationExtraFiles("c:/proj/c.js", deps);
    expect(files.length).toBe(3);
  });
});

/**
 * activeLoadModule / getOpenText 在 server.ts 内以
 * `cacheKey(doc.uri) === cacheKey(filePath)` 查 open doc。这里抽出同一谓词并走
 * 真实 `makeBufferAwareLoadModule`，钉住「未保存 buffer 跨形态可见」+「不串侧车」。
 */
describe("open-doc predicate + buffer-aware load (activeLoadModule / getOpenText)", () => {
  const docs = (uri: string, text: string) => (filePath: string) =>
    cacheKey(uri) === cacheKey(filePath) ? text : undefined;

  it("matches an open doc across all drive/uri forms", () => {
    const openText = docs("file:///c:/proj/a.nudo.js", "export const a = number().gt(0);\n");
    for (const form of [
      "c:\\proj\\a.nudo.js",
      "c:/proj/a.nudo.js",
      "/c:/proj/a.nudo.js",
      "file:///c:/proj/a.nudo.js",
    ]) {
      expect(openText(form), form).toBe("export const a = number().gt(0);\n");
    }
  });

  it("does not match a different file", () => {
    const openText = docs("file:///c:/proj/lib.nudo.js", "export const lib = number();\n");
    expect(openText("c:/proj/std.nudo.js")).toBeUndefined();
    expect(openText("c:/proj/lib2.nudo.js")).toBeUndefined();
  });

  const temps: string[] = [];
  afterEach(() => {
    while (temps.length) {
      const d = temps.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  it("makeBufferAwareLoadModule prefers the cacheKey-resolved open buffer (relative sidecar)", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-pathkey-"));
    temps.push(dir);
    const srcPath = join(dir, "a.js");
    writeFileSync(srcPath, "export function add(x){return x;}\n");
    const sidecarPath = join(dir, "a.nudo.js");
    writeFileSync(sidecarPath, "export const add = number().int();\n");
    const unsaved = "export const add = number().gt(0); // unsaved\n";
    // open doc 以 uri 形态登记，loadModule 用 fs 解析路径查询 —— cacheKey 谓词命中
    const openText = docs(`file://${sidecarPath}`, unsaved);
    const load = makeBufferAwareLoadModule(openText);
    expect(load("./a.nudo.js", srcPath)).toBe(unsaved);
  });

  it("makeBufferAwareLoadModule falls back to disk when the buffer is closed", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-pathkey2-"));
    temps.push(dir);
    const srcPath = join(dir, "b.js");
    writeFileSync(srcPath, "export function f(){return 1;}\n");
    const sidecarPath = join(dir, "b.nudo.js");
    writeFileSync(sidecarPath, "export const f = number();\n");
    const load = makeBufferAwareLoadModule(() => undefined);
    expect(load("./b.nudo.js", srcPath)).toContain("number()");
  });
});
