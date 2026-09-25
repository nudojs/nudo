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
 * @nudo:contract x positive
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

  it("without a sidecar file, missing-sidecar edge is still registered (A4 create → revalidate)", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-no-sidecar-"));
    const parent = join(dir, "a.js");
    const dep = join(dir, "shapes.nudo.js");
    const missingSidecar = join(dir, "a.nudo.js");
    registerNudoImportDeps(
      parent,
      `/// @nudo:import { positive } from "./shapes.nudo.js"\nfunction f(x){return x;}\n`,
    );
    // 显式 import 边 + 入口/依赖的 ambient 侧车路径边（文件尚不存在也登记）
    expect(nudoDepParents.get(norm(dep))).toEqual(new Set([norm(parent)]));
    expect(nudoDepParents.get(norm(missingSidecar))?.has(norm(parent))).toBe(true);
  });

  it("maps .ts parents to .nudo.ts sidecars", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-sidecar-ts-"));
    const parent = join(dir, "a.ts");
    const sidecar = join(dir, "a.nudo.ts");
    writeFileSync(sidecar, "export const positive = number().gt(0);\n");
    registerNudoImportDeps(parent, "export function go(x: number) { return x; }\n");
    expect(nudoDepParents.get(norm(sidecar))).toContain(norm(parent));
  });

  it("ESM dependency's ambient sidecar registers as a parent dependency", () => {
    // P1#2 LSP 半边：跨文件被调按定义文件路径绑定 lib.nudo.js，边必须
    // main→lib.nudo.js 存在——编辑依赖侧车后打开中的调用方重检
    const dir = mkdtempSync(join(tmpdir(), "nudo-dep-sidecar-"));
    const parent = join(dir, "main.js");
    const lib = join(dir, "lib.js");
    const libSidecar = join(dir, "lib.nudo.js");
    writeFileSync(lib, "module.exports = { needsPos: (x) => x };\n");
    writeFileSync(libSidecar, "export const needsPos = fn({ x: number().gt(0) });\n");
    registerNudoImportDeps(parent, `const { needsPos } = require("./lib.js");\nneedsPos(1);\n`);
    expect(nudoDepParents.get(norm(libSidecar))).toContain(norm(parent));
  });

  it("sidecar content change → revalidated parent publishes changed diagnostics", async () => {
    // R14：钉住「侧车内容变 → 父文件诊断内容更新」——此前只断言重验被触发
    // 与 memo 实例身份，不校验发布诊断随内容翻转（逐出失效仍全绿）。
    const dir = mkdtempSync(join(tmpdir(), "nudo-sidecar-diag-"));
    const parent = join(dir, "a.js");
    const sidecar = join(dir, "a.nudo.js");
    writeFileSync(
      sidecar,
      "export const needsPositive = fn({ x: number().gt(0) });\n",
    );
    const parentSrc = `export function needsPositive(x) {\n  return x;\n}\nneedsPositive(-1);\n`;
    writeFileSync(parent, parentSrc);
    registerNudoImportDeps(parent, parentSrc);

    const sent = new Map<string, { code?: unknown }[]>();
    const openDocs = new Map([
      [norm(parent), { uri: `file://${parent}`, version: 2, getText: () => parentSrc }],
    ]);
    const deps: ValidateTextDeps = {
      sendDiagnostics: (p) => sent.set(p.uri, p.diagnostics),
      getOpenDocumentByPath: (p) => openDocs.get(p.replace(/\\/g, "/")),
    };
    // 初验：gt(0) 契约 × -1 实参 → nudo:constraint-violated
    await validateText(parent, `file://${parent}`, parentSrc, 2, deps, false);
    const before = sent.get(`file://${parent}`) ?? [];
    expect(before.some((d) => d.code === "nudo:constraint-violated")).toBe(true);

    // 放宽契约：lt(0) 下 -1 满足 → 违例消失（诊断集合随内容翻转）
    writeFileSync(sidecar, "export const needsPositive = fn({ x: number().lt(0) });\n");
    sent.clear();
    await handleNudoDepFileChanged(sidecar, deps);
    const after = sent.get(`file://${parent}`) ?? [];
    expect(after.some((d) => d.code === "nudo:constraint-violated")).toBe(false);
  });
});
