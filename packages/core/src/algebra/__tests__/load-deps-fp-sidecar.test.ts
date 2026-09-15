/**
 * loadModuleDepsFingerprint 的 autoBind 侧车闭包扩展（设计 §4.5）：
 * - 侧车存在 → 指纹含 `sidecar:path=hash` 条目（根 + 递归 .nudo 依赖）；
 * - 内容变 → 指纹变（check 整文件 memo / generalize L0 借此失效）；
 * - 无侧车 → 不加任何条目，指纹与扩展前算法逐字节一致（旧调用方零回归）。
 */
import { describe, it, expect } from "vitest";
import { loadModuleDepsFingerprint, sidecarSpecsOf } from "../load-deps-fp.ts";
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
    expect(r).toEqual({ fp: "", paths: [], truncated: false });
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
