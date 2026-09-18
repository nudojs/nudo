/**
 * loadModuleDepsFingerprint 的 autoBind 侧车闭包扩展（设计 §4.5）：
 * - 侧车存在 → 指纹含 `sidecar:path=hash` 条目（根 + 递归 .nudo 依赖）；
 * - 内容变 → 指纹变（check 整文件 memo / generalize L0 借此失效）；
 * - 无侧车 → 不加任何条目，指纹与扩展前算法逐字节一致（旧调用方零回归）。
 */
import { describe, it, expect } from "vitest";
import { loadModuleDepsFingerprint, sidecarSpecsOf } from "../load-deps-fp.ts";
import { generalizeFromAst } from "../generalize.ts";
import { pTrue, predToString } from "../pred.ts";
import { hashSource } from "../hash-source.ts";

function makeLoad(deps: Record<string, string>) {
  return (spec: string, fromFile: string) => {
    const i = fromFile.lastIndexOf("/");
    const base = i >= 0 ? fromFile.slice(0, i) : "";
    const joined = spec.startsWith(".")
      ? `${base}/${spec.replace(/^\.\//, "")}`
      : spec;
    return deps[joined];
  };
}

describe("sidecarSpecsOf", () => {
  it("keeps only relative .nudo.js/.nudo.ts specs (any import form)", () => {
    const src = [
      `import { a } from "./std.nudo.js";`,
      `import { b } from "../x/std.nudo.ts";`,
      `import { number } from "@nudojs/core";`,
      `import { c } from "./plain.js";`,
      `const m = require("./other.nudo.js");`,
      `const d = await import("./dyn.nudo.js");`,
    ].join("\n");
    expect(sidecarSpecsOf(src)).toEqual([
      "./std.nudo.js",
      "../x/std.nudo.ts",
      "./other.nudo.js",
      "./dyn.nudo.js",
    ]);
  });
});

describe("loadModuleDepsFingerprint dependency sidecars", () => {
  it("dependency file's ambient sidecar enters fingerprint and eviction paths", () => {
    // R08 P1：跨文件被调（checkExternalCall）按定义文件路径绑定 lib.nudo.js，
    // 其内容影响调用方报告——lib.nudo.js 必须进调用方指纹与逐出索引，
    // 否则编辑依赖侧车后 check memo 陈旧命中（错诊断）。
    const deps: Record<string, string> = {
      "/t/lib.js": "module.exports = { needsPos: (x) => x };\n",
      "/t/lib.nudo.js": "export const needsPos = fn({ x: number().gt(0) });\n",
    };
    const src = `const { needsPos } = require("./lib.js");\nneedsPos(1);\n`;
    const r = loadModuleDepsFingerprint(src, makeLoad(deps), "/t/a.js");
    expect(r.truncated).toBe(false);
    expect(r.paths).toContain("/t/lib.nudo.js");
    expect(r.fp).toContain(`sidecar:/t/lib.nudo.js=${hashSource(deps["/t/lib.nudo.js"]!)}`);
    // 依赖侧车内容变 → 指纹变（整文件 memo 借此失效）
    deps["/t/lib.nudo.js"] = "export const needsPos = fn({ x: number().gt(5) });\n";
    const r2 = loadModuleDepsFingerprint(src, makeLoad(deps), "/t/a.js");
    expect(r2.fp).not.toBe(r.fp);
    expect(r2.paths).toContain("/t/lib.nudo.js");
  });

  it("dep sidecar with recursive .nudo closure contributes transitive entries", () => {
    const deps: Record<string, string> = {
      "/t/lib.js": "module.exports = { f: (x) => x };\n",
      "/t/lib.nudo.js": `import { positive } from "./std.nudo.js";\nexport const f = fn({ x: positive });\n`,
      "/t/std.nudo.js": "export const positive = number().gt(0);\n",
    };
    const src = `const { f } = require("./lib.js");\nf(1);\n`;
    const r = loadModuleDepsFingerprint(src, makeLoad(deps), "/t/a.js");
    expect(r.paths).toContain("/t/lib.nudo.js");
    expect(r.paths).toContain("/t/std.nudo.js");
    expect(r.fp).toContain(`sidecar:/t/std.nudo.js=${hashSource(deps["/t/std.nudo.js"]!)}`);
  });

  it("generalize L0 recomputes when the analyzed file's sidecar content changes", () => {
    // R08 minor：两阶段断言——不只是指纹字符串翻转，L0 结果必须重算且
    // 签名携带新约束（防「键构成回归」）。go 必须是导出（侧车同名绑定
    // 只落本地 named export）。
    const deps: Record<string, string> = {
      "/t/a.nudo.js": "export const go = fn({ x: number().gt(0) });\n",
    };
    const src = `export function go(x) { return x; }\ngo(1);\n`;
    const refine = { loadModule: makeLoad(deps), fromFile: "/t/a.js" };
    const g1 = generalizeFromAst("go", src, { refine });
    expect(g1).toBeDefined();
    expect(predToString(g1!.entryReqs?.find((r) => r.param === "x")!.pred ?? pTrue)).toContain("x > 0");
    deps["/t/a.nudo.js"] = "export const go = fn({ x: number().gt(5) });\n";
    const g2 = generalizeFromAst("go", src, { refine });
    expect(g2).toBeDefined();
    expect(g2).not.toBe(g1);
    expect(predToString(g2!.entryReqs?.find((r) => r.param === "x")!.pred ?? pTrue)).toContain("x > 5");
  });
});

describe("loadModuleDepsFingerprint sidecar closure", () => {
  it("no sidecar file → fingerprint identical to the pre-sidecar algorithm", () => {
    const deps: Record<string, string> = {
      "/t/util.js": "module.exports = { add1: (x) => x + 1 };\n",
    };
    const src = `const u = require("./util.js");\nfunction go(x) { return u.add1(x); }\n`;
    const r = loadModuleDepsFingerprint(src, makeLoad(deps), "/t/a.js");
    expect(r.truncated).toBe(false);
    expect(r.paths).toEqual(["/t/util.js"]);
    // 旧算法形态：仅声明 spec 的 `路径=hash` 排序拼接，无 sidecar: 条目
    expect(r.fp).toBe(`/t/util.js=${hashSource(deps["/t/util.js"]!)}`);
    expect(r.fp.includes("sidecar:")).toBe(false);
  });

  it("no specs and no sidecar → empty fingerprint", () => {
    const r = loadModuleDepsFingerprint("function id(x) { return x; }\n", makeLoad({}), "/t/a.js");
    expect(r).toEqual({ fp: "", paths: [], contents: [], truncated: false });
  });

  it("existing sidecar contributes sidecar: entries for root and recursive .nudo deps", () => {
    const deps: Record<string, string> = {
      "/t/a.nudo.js": `import { positive } from "./std.nudo.js";\nexport const pos = positive;\n`,
      "/t/std.nudo.js": "export const positive = number().gt(0);\n",
    };
    const src = `function go(x) { return x; }\ngo(1);\n`;
    const r = loadModuleDepsFingerprint(src, makeLoad(deps), "/t/a.js");
    expect(r.truncated).toBe(false);
    expect(r.paths).toEqual(["/t/a.nudo.js", "/t/std.nudo.js"]);
    expect(r.fp).toBe(
      [
        `sidecar:/t/a.nudo.js=${hashSource(deps["/t/a.nudo.js"]!)}`,
        `sidecar:/t/std.nudo.js=${hashSource(deps["/t/std.nudo.js"]!)}`,
      ].sort().join(","),
    );
  });

  it("declared .nudo dep also being the sidecar → single regular entry, no duplicate", () => {
    const deps: Record<string, string> = {
      "/t/a.nudo.js": "export const positive = number().gt(0);\n",
    };
    const src = `/// @nudo:import { positive } from "./a.nudo.js"\nfunction go(x) { return x; }\n`;
    const r = loadModuleDepsFingerprint(src, makeLoad(deps), "/t/a.js");
    expect(r.paths).toEqual(["/t/a.nudo.js"]);
    expect(r.fp).toBe(`/t/a.nudo.js=${hashSource(deps["/t/a.nudo.js"]!)}`);
  });

  it("sidecar content change → fingerprint change", () => {
    const deps: Record<string, string> = {
      "/t/a.nudo.js": "export const positive = number().gt(0);\n",
    };
    const src = `function go(x) { return x; }\ngo(1);\n`;
    const fp1 = loadModuleDepsFingerprint(src, makeLoad(deps), "/t/a.js").fp;
    deps["/t/a.nudo.js"] = "export const positive = number().gt(1);\n";
    const fp2 = loadModuleDepsFingerprint(src, makeLoad(deps), "/t/a.js").fp;
    expect(fp2).not.toBe(fp1);
  });

  it("transitive std.nudo.js content change → fingerprint change", () => {
    const deps: Record<string, string> = {
      "/t/a.nudo.js": `import { positive } from "./std.nudo.js";\nexport const pos = positive;\n`,
      "/t/std.nudo.js": "export const positive = number().gt(0);\n",
    };
    const src = `function go(x) { return x; }\ngo(1);\n`;
    const fp1 = loadModuleDepsFingerprint(src, makeLoad(deps), "/t/a.js").fp;
    deps["/t/std.nudo.js"] = "export const positive = number().gt(2);\n";
    const fp2 = loadModuleDepsFingerprint(src, makeLoad(deps), "/t/a.js").fp;
    expect(fp2).not.toBe(fp1);
  });

  it("missing transitive dep is recorded as miss (creation later flips the fingerprint)", () => {
    const deps: Record<string, string> = {
      "/t/a.nudo.js": `import { positive } from "./ghost.nudo.js";\nexport const pos = positive;\n`,
    };
    const src = `function go(x) { return x; }\ngo(1);\n`;
    const r = loadModuleDepsFingerprint(src, makeLoad(deps), "/t/a.js");
    expect(r.paths).toContain("/t/ghost.nudo.js");
    expect(r.fp).toContain("sidecar:/t/ghost.nudo.js=miss");
    deps["/t/ghost.nudo.js"] = "export const positive = number().gt(0);\n";
    const r2 = loadModuleDepsFingerprint(src, makeLoad(deps), "/t/a.js");
    expect(r2.fp).not.toBe(r.fp);
    expect(r2.fp).not.toContain("=miss");
  });

  it("sidecar closure past the node cap → truncated (callers must fail-open)", () => {
    const deps: Record<string, string> = {};
    let src = "";
    for (let i = 0; i < 60; i++) {
      deps[`/t/d${i}.js`] = `module.exports = { n: ${i} };\n`;
      src += `const m${i} = require("./d${i}.js");\n`;
    }
    let sidecarSrc = "";
    for (let i = 0; i < 10; i++) {
      deps[`/t/s${i}.nudo.js`] = `export const s${i} = number().gt(0);\n`;
      sidecarSrc += `import { s${i} } from "./s${i}.nudo.js";\n`;
    }
    deps["/t/a.nudo.js"] = sidecarSrc;
    src += `function go(x) { return x; }\n`;
    const r = loadModuleDepsFingerprint(src, makeLoad(deps), "/t/a.js");
    expect(r.truncated).toBe(true);
    expect(r.fp.startsWith("trunc:")).toBe(true);
  });
});
