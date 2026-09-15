import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  clearValidationState,
  handleNudoDepFileChanged,
  nudoDepParents,
  registerNudoImportDeps,
  validateText,
  type ValidateTextDeps,
} from "../validation.ts";
import { generalizeFromAst, getGeneralizeMemoSize, resetGeneralizeMemo } from "@nudojs/core";
import {
  checkSource,
  evictCheckSourceMemoForPaths,
  pTrue,
} from "@nudojs/core";

describe("*.nudo.js watched-file → targeted eviction + parent revalidate", () => {
  beforeEach(() => {
    clearValidationState();
  });

  it("registerNudoImportDeps records parent → dep edges", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-dep-idx-"));
    const parent = join(dir, "a.js");
    const dep = join(dir, "shapes.nudo.js");
    registerNudoImportDeps(
      parent,
      `/// @nudo:import { positive } from "./shapes.nudo.js"\nfunction f(x){return x;}\n`,
    );
    expect(nudoDepParents.get(resolve(dep).replace(/\\/g, "/"))).toContain(
      resolve(parent).replace(/\\/g, "/"),
    );
  });

  it("handleNudoDepFileChanged revalidates open parent and evicts memo deps", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-dep-chg-"));
    const parent = join(dir, "a.js");
    const dep = join(dir, "shapes.nudo.js");
    writeFileSync(dep, "export const positive = number().gt(0);\n");
    const parentSrc = `/// @nudo:import { positive } from "./shapes.nudo.js"
/**
 * @nudo:refine x positive
 */
function needsPositive(x) {
  return x;
}
needsPositive(-1);
`;
    writeFileSync(parent, parentSrc);
    // 模拟已验证会话：登记 @nudo:import 边
    registerNudoImportDeps(parent, parentSrc);

    // 建立 generalize 缓存（含 dep 路径索引）
    const loadModule = (spec: string, fromFile: string) => {
      if (spec.includes("shapes")) return "export const positive = number().gt(0);\n";
      return undefined;
    };
    const g1 = generalizeFromAst("needsPositive", parentSrc, {
      refine: { loadModule, fromFile: parent },
    });
    expect(g1).toBeDefined();
    expect(getGeneralizeMemoSize()).toBeGreaterThan(0);

    let revalidated = 0;
    const sent = new Map<string, unknown[]>();
    const openDocs = new Map([
      [
        resolve(parent).replace(/\\/g, "/"),
        {
          uri: `file://${parent}`,
          version: 2,
          getText: () => parentSrc,
        },
      ],
    ]);
    const deps: ValidateTextDeps = {
      sendDiagnostics: (p) => {
        sent.set(p.uri, p.diagnostics);
        revalidated++;
      },
      getOpenDocumentByPath: (p) => openDocs.get(p.replace(/\\/g, "/")),
    };

    await handleNudoDepFileChanged(dep, deps);

    // 定向逐出后，同参 generalize 得新实例
    const g2 = generalizeFromAst("needsPositive", parentSrc, {
      refine: { loadModule, fromFile: parent },
    });
    expect(g2).toBeDefined();
    expect(g2).not.toBe(g1);
    // 打开中的父文件被重检
    expect(revalidated).toBeGreaterThan(0);
    expect(sent.has(`file://${parent}`)).toBe(true);
  });

  it("does nothing when no parent depends on the path", async () => {
    resetGeneralizeMemo();
    const before = getGeneralizeMemoSize();
    await handleNudoDepFileChanged("/nope/x.nudo.js", {
      sendDiagnostics: () => {},
    });
    expect(getGeneralizeMemoSize()).toBe(before);
  });
});

describe("autoBind implicit sidecar dep edges (设计 §4.5)", () => {
  const norm = (p: string) => resolve(p).replace(/\\/g, "/");

  beforeEach(() => {
    clearValidationState();
  });

  it("registers the implicit sidecar edge without @nudo:import; change → parent revalidated + memos evicted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-sidecar-"));
    const parent = join(dir, "a.js");
    const sidecar = join(dir, "a.nudo.js");
    const sidecarSrc = "export const positive = number().gt(0);\n";
    writeFileSync(sidecar, sidecarSrc);
    const parentSrc = `function needsPositive(x) {\n  return x;\n}\nneedsPositive(1);\n`;
    writeFileSync(parent, parentSrc);
    // 无任何 @nudo:import：侧车边纯由 autoBind 推出
    registerNudoImportDeps(parent, parentSrc);
    expect(nudoDepParents.get(norm(sidecar))).toContain(norm(parent));

    // loadModule 内容恒定：g2 ≠ g1 只可能来自按侧车路径的定向逐出
    const loadModule = (spec: string) => (spec === "./a.nudo.js" ? sidecarSrc : undefined);
    const g1 = generalizeFromAst("needsPositive", parentSrc, {
      refine: { loadModule, fromFile: parent },
    });
    expect(g1).toBeDefined();
    expect(getGeneralizeMemoSize()).toBeGreaterThan(0);

    let revalidated = 0;
    const sent = new Map<string, unknown[]>();
    const openDocs = new Map([
      [norm(parent), { uri: `file://${parent}`, version: 2, getText: () => parentSrc }],
    ]);
    const deps: ValidateTextDeps = {
      sendDiagnostics: (p) => {
        sent.set(p.uri, p.diagnostics);
        revalidated++;
      },
      getOpenDocumentByPath: (p) => openDocs.get(p.replace(/\\/g, "/")),
    };
    await handleNudoDepFileChanged(sidecar, deps);

    const g2 = generalizeFromAst("needsPositive", parentSrc, {
      refine: { loadModule, fromFile: parent },
    });
    expect(g2).toBeDefined();
    expect(g2).not.toBe(g1);
    expect(revalidated).toBeGreaterThan(0);
    expect(sent.has(`file://${parent}`)).toBe(true);

    // check 整文件 memo 的路径索引同样含隐式侧车路径（本文件 + validateText
    // 内部 checkSource 的条目都按该路径索引，均可定向逐出）
    checkSource(parent, parentSrc, pTrue, { loadModule, fromFile: parent });
    expect(evictCheckSourceMemoForPaths([norm(sidecar)])).toBeGreaterThanOrEqual(1);
  });

  it("transitive sidecar dep (std.nudo.js) change invalidates the parent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-sidecar-t-"));
    const parent = join(dir, "a.js");
    const sidecar = join(dir, "a.nudo.js");
    const std = join(dir, "std.nudo.js");
    const stdSrc = "export const positive = number().gt(0);\n";
    const sidecarSrc = `import { positive } from "./std.nudo.js";\nexport const pos = positive;\n`;
    writeFileSync(std, stdSrc);
    writeFileSync(sidecar, sidecarSrc);
    const parentSrc = `function go(x) {\n  return x;\n}\ngo(1);\n`;
    writeFileSync(parent, parentSrc);
    registerNudoImportDeps(parent, parentSrc);
    expect(nudoDepParents.get(norm(sidecar))).toContain(norm(parent));
    expect(nudoDepParents.get(norm(std))).toContain(norm(parent));

    const loadModule = (spec: string) =>
      spec === "./a.nudo.js" ? sidecarSrc : spec === "./std.nudo.js" ? stdSrc : undefined;
    const g1 = generalizeFromAst("go", parentSrc, {
      refine: { loadModule, fromFile: parent },
    });
    expect(g1).toBeDefined();

    let revalidated = 0;
    const openDocs = new Map([
      [norm(parent), { uri: `file://${parent}`, version: 2, getText: () => parentSrc }],
    ]);
    const deps: ValidateTextDeps = {
      sendDiagnostics: () => {
        revalidated++;
      },
      getOpenDocumentByPath: (p) => openDocs.get(p.replace(/\\/g, "/")),
    };
    await handleNudoDepFileChanged(std, deps);
    const g2 = generalizeFromAst("go", parentSrc, {
      refine: { loadModule, fromFile: parent },
    });
    expect(g2).toBeDefined();
    expect(g2).not.toBe(g1);
    expect(revalidated).toBeGreaterThan(0);
  });

  it("without a sidecar file, registration matches the old explicit-import behavior", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-no-sidecar-"));
    const parent = join(dir, "a.js");
    const dep = join(dir, "shapes.nudo.js");
    registerNudoImportDeps(
      parent,
      `/// @nudo:import { positive } from "./shapes.nudo.js"\nfunction f(x){return x;}\n`,
    );
    // 唯一一条边 = 显式 @nudo:import；a.nudo.js 不存在 → 不登记隐式边
    expect(nudoDepParents.size).toBe(1);
    expect(nudoDepParents.get(norm(dep))).toEqual(new Set([norm(parent)]));
  });

  it("maps .ts parents to .nudo.ts sidecars", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-sidecar-ts-"));
    const parent = join(dir, "a.ts");
    const sidecar = join(dir, "a.nudo.ts");
    writeFileSync(sidecar, "export const positive = number().gt(0);\n");
    registerNudoImportDeps(parent, "export function go(x: number) { return x; }\n");
    expect(nudoDepParents.get(norm(sidecar))).toContain(norm(parent));
  });
});
