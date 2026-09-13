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
