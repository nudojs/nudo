/**
 * 模块套件：侧车（*.nudo.*）装载、路径派生、诊断归属与指纹。
 *
 * 表行覆盖纯路径口径（sidecarPathOf / 草稿落点）；装载与诊断用例按场景分组，
 * 保留原 fixture 与原生/对照断言。缺陷编号只出现在 it 标题的 provenance。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, effectiveContract, sidecarClosureFingerprint } from "../index.ts";
import { resetCheckSourceMemo } from "../check/check.ts";
import { resetGeneralizeMemo, generalizeFromAst } from "../generalize.ts";
import { resetNudoModuleExecCache, takeRefineDiags, execNudoModule, setRefineDiagCollector, type RefineDiag } from "../refine.ts";
import { resetSidecarLoadFailureCache, takeContractDiags } from "../contract/contract.ts";
import { loadModuleDepsFingerprint, sidecarSpecsOf } from "../key/load-deps-fp.ts";
import { pTrue, predToString } from "../pred.ts";
import { hashSource } from "../key/hash-source.ts";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { makeFiles } from "./nudo-constraints.ts";
import { runWithCollectorScope } from "../collector-scope.ts";
import { resetEngineCaches } from "./eval-helpers.ts";
import { sidecarPathOf } from "../contract/sidecar-path.ts";

const SIDECAR_PATH_CASES = [
  ["/p/api.d.ts", "/p/api.nudo.ts"],
  ["/p/api.d.mts", "/p/api.nudo.ts"],
  ["/p/lib.ts", "/p/lib.nudo.ts"],
  ["/p/lib.mts", "/p/lib.nudo.ts"],
  ["/p/lib.js", "/p/lib.nudo.js"],
  ["/p/lib.mjs", "/p/lib.nudo.js"],
  ["/p/lib.nudo.ts", "/p/lib.nudo.ts"],
  ["/p/api.d.nudo.ts", "/p/api.nudo.ts"],
  ["/a/lib.js", "/a/lib.nudo.js"],
  ["/a/lib.mjs", "/a/lib.nudo.js"],
  ["/a/lib.ts", "/a/lib.nudo.ts"],
  ["/a/lib.mts", "/a/lib.nudo.ts"],
  ["/a/lib.nudo.js", "/a/lib.nudo.js"],
  ["/a/lib.nudo.mts", "/a/lib.nudo.ts"],
  ["/a/lib.nudo.mjs", "/a/lib.nudo.js"],
  ["/a/lib.cjs", "/a/lib.cjs.nudo.js"],
  ["/a/lib", "/a/lib.nudo.js"],
] as const;

const DRAFT_PATH_CASES = [
  ["/p/api.d.ts", "/p/api.nudo.draft.ts"],
] as const;

/** service 侧草稿落点：`.nudo.ts` → `.nudo.draft.ts` */
function draftPathOf(file: string): string {
  return sidecarPathOf(file).replace(/\.nudo\.ts$/, ".nudo.draft.ts");
}

describe("[table] sidecarPathOf", () => {
  it.each(SIDECAR_PATH_CASES)("%s → %s", (input, expected) => {
    expect(sidecarPathOf(input)).toBe(expected);
  });
  it.each(DRAFT_PATH_CASES)("draft %s → %s", (input, expected) => {
    expect(draftPathOf(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// #135 侧车 fs 读错误（check 核心侧）
// ---------------------------------------------------------------------------
describe("[sidecar] #135 侧车 fs 读错误（check 核心侧）", () => {
/**
 * #135：check 输出在两个稳定集间翻转（28↔22）——少集 = 契约族诊断整体
 * 静默消失、exit 0 假绿。根因链：fs 读错误被上游折叠成「无侧车」miss 后，
 * checkSourceInScope 的 per-call loadModule 缓存把首次 miss 的 undefined
 * 钉死整场。核心侧的行为钉（loadModule 对侧车 spec **抛错**的真实 fs 错误）：
 *
 * - 瞬态自愈：raw() 抛错不进 per-call 缓存（undefined 才缓存）→ 下一消费者
 *   重试拿到侧车 → 契约族诊断完整在场，且**无** nudo:contract-load；
 * - 持久响亮：loadModule 恒抛 → error 级 nudo:contract-load + ok=false
 *   （contract.ts 已区分「读失败」与「无侧车」，此处验证而非重复实现）；
 * - 真 miss 反钉：loadModule 返回 undefined（真无侧车）→ 静默零诊断，
 *   防修过头的反向回归；
 * - readerr 指纹：读错误轮的 deps 指纹不可信（readerr: 前缀 + readError），
 *   整文件 memo fail-open 不读不写——错误轮 / miss 轮 / 内容轮互不为
 *   跨次陈旧命中（修复前错误轮与 miss 轮折叠成同一 miss 键，28↔22 翻转）。
 */








/** 带违例 case 的源：侧车绑定成功时必产生 nudo:case-inconsistency（-5 ⊭ x>0） */
const SRC = `
/**
 * @nudo:case "neg" (-5)
 */
export function f(x) {
  return x;
}
`;

const SIDECAR =
  `import { fn, number } from "@nudojs/core";\n` +
  `export const f = fn({ x: number().gt(0) }, number());\n`;

const SIDECAR_SPEC = "./f.nudo.js";

type Mode = "content" | "miss" | "throw";

/**
 * 可变模式 loader：同一函数对象跨 checkSource 调用（loadModuleId 身份稳定，
 * memo 键不因换 loader 而分叉），模式切换模拟 fs 状态变迁。
 * flake-first = 首次探测抛 EACCES、此后返回侧车内容（瞬态故障）。
 */
function makeMutableLoader(flakeFirst = false) {
  let mode: Mode = "content";
  let flaked = !flakeFirst; // flakeFirst 时首次调用仍需抛
  const rawProbes: string[] = [];
  const loadModule = (spec: string, _from: string): string | undefined => {
    rawProbes.push(spec);
    if (flakeFirst && !flaked) {
      flaked = true;
      throw Object.assign(
        new Error(`EACCES: permission denied, stat '/t/f.nudo.js'`),
        { code: "EACCES" },
      );
    }
    if (mode === "throw") {
      throw Object.assign(
        new Error(`EACCES: permission denied, stat '/t/f.nudo.js'`),
        { code: "EACCES" },
      );
    }
    return mode === "content" ? SIDECAR : undefined;
  };
  return {
    loadModule,
    setMode: (m: Mode) => {
      mode = m;
    },
    /** 真实（非缓存命中）探测次数——「抛错后重试」的直接证据 */
    probeCount: (spec = SIDECAR_SPEC) =>
      rawProbes.filter((s) => s === spec).length,
  };
}

function check(loader: (spec: string, from: string) => string | undefined) {
  return checkSource("/t/f.js", SRC, pTrue, {
    loadModule: loader,
    fromFile: "/t/f.js",
  });
}

describe("#135 侧车 fs 读错误（check 核心侧）", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    resetSidecarLoadFailureCache();
    takeRefineDiags();
    takeContractDiags();
  });

  it("瞬态读错误自愈：首次抛 EACCES → 重试拿侧车 → 契约诊断完整且无 contract-load", () => {
    const { loadModule, setMode, probeCount } = makeMutableLoader(true);
    const r = check(loadModule);
    // 自愈：raw 抛错不进 per-call 缓存，下一消费者（侧车闭包指纹 / 绑定）重试
    expect(probeCount()).toBeGreaterThanOrEqual(2);
    // 契约族诊断完整在场（-5 ⊭ x>0）——不是静默消失的少集
    const violation = r.issues.find((i) => i.code === "nudo:case-inconsistency");
    expect(violation).toBeDefined();
    expect(violation!.fn).toBe("f");
    expect(r.ok).toBe(false);
    // 瞬态故障不该被上报为加载失败
    expect(r.issues.filter((i) => i.code === "nudo:contract-load")).toEqual([]);
    // 且不污染后续轮：同 loader 转「真无侧车」后必须回到干净报告
    // （修复前：瞬态轮以 miss 键 memo 了带诊断报告 → 真 miss 轮陈旧命中）
    setMode("miss");
    const r2 = check(loadModule);
    expect(r2.issues.filter((i) => i.code === "nudo:contract-load")).toEqual([]);
    expect(
      r2.issues.filter((i) => i.code === "nudo:case-inconsistency"),
    ).toEqual([]);
    expect(r2.ok).toBe(true);
  });

  it("持久读错误响亮：恒抛 → error 级 nudo:contract-load + ok=false", () => {
    const { loadModule, setMode } = makeMutableLoader();
    setMode("throw");
    const r = check(loadModule);
    expect(r.ok).toBe(false);
    const errs = r.issues.filter(
      (i) =>
        i.code === "nudo:contract-load" &&
        i.severity === "error" &&
        i.message.includes("failed to load") &&
        i.message.includes("EACCES"),
    );
    expect(errs.length).toBeGreaterThanOrEqual(1);
    // 契约族诊断可以缺席（侧车没绑上），但失败本身必须可见、门禁红
  });

  it("持久错误轮不钉 memo：随后真 miss 轮回到干净（不陈旧命中错误报告）", () => {
    const { loadModule, setMode } = makeMutableLoader();
    setMode("throw");
    const rErr = check(loadModule);
    expect(rErr.ok).toBe(false);
    // fs 恢复为「真无侧车」（侧车被删）：同一 loader 身份、同源 → 若错误轮
    // 以 miss 键进了 memo，此轮会陈旧命中错误报告（假红）；修复后必须重算
    setMode("miss");
    const rMiss = check(loadModule);
    expect(rMiss.issues.filter((i) => i.code === "nudo:contract-load")).toEqual([]);
    expect(rMiss.ok).toBe(true);
  });

  it("miss 轮不吞错误轮：先真 miss（干净、进 memo），后恒抛必须响亮（不陈旧命中干净报告）", () => {
    const { loadModule, setMode } = makeMutableLoader();
    setMode("miss");
    const rMiss = check(loadModule);
    expect(rMiss.ok).toBe(true);
    // fs 从「无侧车」变成「有侧车但不可读」：miss 键下已有干净报告——
    // 修复前此轮 memo 命中干净报告 → 读错误静默（#135 假绿形状）；修复后重算
    setMode("throw");
    const rErr = check(loadModule);
    expect(rErr.ok).toBe(false);
    expect(
      rErr.issues.some(
        (i) => i.code === "nudo:contract-load" && i.severity === "error",
      ),
    ).toBe(true);
  });

  it("真 miss（无侧车文件）→ 静默零诊断（反向回归钉）", () => {
    const { loadModule, setMode } = makeMutableLoader();
    setMode("miss");
    const r = check(loadModule);
    expect(r.issues.filter((i) => i.code === "nudo:contract-load")).toEqual([]);
    expect(
      r.issues.filter((i) => i.code === "nudo:case-inconsistency"),
    ).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

describe("#135 readerr 指纹（loadModuleDepsFingerprint）", () => {
  it("装载抛错 ≠ miss：readerr: 前缀 + readError=true，不产 sidecar 条目", () => {
    const throwing = () => {
      throw Object.assign(new Error("EIO: hard I/O error"), { code: "EIO" });
    };
    const r = loadModuleDepsFingerprint("function f(x) { return x; }\n", throwing, "/t/f.js");
    expect(r.readError).toBe(true);
    expect(r.truncated).toBe(false);
    expect(r.fp.startsWith("readerr:")).toBe(true);
    expect(r.fp).not.toContain("sidecar:");
    // contents 补 null 条目：磁盘缓存消费方（hasBareMiss）与主 BFS 读错误
    // 同口径 fail-closed，不按「无侧车」形状写 iface/check 缓存键
    expect(r.paths).toContain("/t/f.nudo.js");
    expect(r.contents).toContainEqual({ path: "/t/f.nudo.js", content: null });
  });

  it("真 miss 无前缀、readError=false；正常内容轮含 sidecar 条目", () => {
    const src = "function f(x) { return x; }\n";
    const rMiss = loadModuleDepsFingerprint(src, () => undefined, "/t/f.js");
    expect(rMiss.readError).toBe(false);
    expect(rMiss.fp).toBe("");
    // 真 miss 不产生任何条目（零回归契约保持）
    expect(rMiss.paths).toEqual([]);
    expect(rMiss.contents).toEqual([]);
    const rContent = loadModuleDepsFingerprint(src, () => SIDECAR, "/t/f.js");
    expect(rContent.readError).toBe(false);
    expect(rContent.truncated).toBe(false);
    expect(rContent.fp).toContain("sidecar:/t/f.nudo.js=");
    // 错误轮与 miss 轮键不同（互不陈旧命中）、与内容轮键也不同
    const rThrow = loadModuleDepsFingerprint(
      src,
      () => {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      },
      "/t/f.js",
    );
    expect(new Set([rMiss.fp, rContent.fp, rThrow.fp]).size).toBe(3);
  });
});
});

// ---------------------------------------------------------------------------
// sidecarSpecsOf
// ---------------------------------------------------------------------------
describe("[sidecar] sidecarSpecsOf", () => {
/**
 * loadModuleDepsFingerprint 的 autoBind 侧车闭包扩展（设计 §4.5）：
 * - 侧车存在 → 指纹含 `sidecar:path=hash` 条目（根 + 递归 .nudo 依赖）；
 * - 内容变 → 指纹变（check 整文件 memo / generalize L0 借此失效）；
 * - 无侧车 → 不加任何条目，指纹与扩展前算法逐字节一致（旧调用方零回归）。
 */






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
    expect(r).toEqual({ fp: "", paths: [], contents: [], truncated: false, readError: false, gatedSidecars: [] });
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
});

// ---------------------------------------------------------------------------
// projectDir ambient bind boundary
// ---------------------------------------------------------------------------
describe("[sidecar] projectDir ambient bind boundary", () => {
/**
 * T7：项目根 ambient 绑定边界。
 * projectDir 提供时，树外侧车不 ambient 加载；树内正常；node_modules 仍拦。
 */






const SIDE = `import { fn, number } from "@nudojs/core";
export const add = fn({ x: number(), y: number() }, number());
`;

function loadSibling(sideName: string) {
  return (spec: string, fromFile: string): string | undefined => {
    if (spec.includes(sideName) || spec.endsWith(".nudo.js")) return SIDE;
    void fromFile;
    return undefined;
  };
}

describe("projectDir ambient bind boundary", () => {
  it("in-tree sidecar binds when projectDir set", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-projroot-"));
    try {
      const srcPath = join(dir, "lib.js");
      const src = `export function add(x, y) { return x + y; }\n`;
      writeFileSync(srcPath, src);
      writeFileSync(join(dir, "lib.nudo.js"), SIDE);
      const eff = effectiveContract(src, "add", {
        loadModule: loadSibling("lib.nudo.js"),
        fromFile: srcPath,
        autoBind: true,
        projectDir: dir,
      });
      expect(eff).toBeDefined();
      expect(eff!.source).toBe("handwritten");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("out-of-tree sidecar is not ambient-bound when projectDir set", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-projroot-out-"));
    const outside = mkdtempSync(join(tmpdir(), "nudo-outside-"));
    try {
      const srcPath = join(outside, "lib.js");
      const src = `export function add(x, y) { return x + y; }\n`;
      writeFileSync(srcPath, src);
      writeFileSync(join(outside, "lib.nudo.js"), SIDE);
      const eff = effectiveContract(src, "add", {
        loadModule: loadSibling("lib.nudo.js"),
        fromFile: srcPath,
        autoBind: true,
        projectDir: root,
      });
      expect(eff?.source !== "handwritten").toBe(true);

      const fp = sidecarClosureFingerprint(srcPath, {
        loadModule: loadSibling("lib.nudo.js"),
        autoBind: true,
        projectDir: root,
      });
      expect(fp).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("node_modules sidecar stays blocked even inside projectDir", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-projroot-nm-"));
    try {
      mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
      const srcPath = join(dir, "node_modules", "pkg", "lib.js");
      const src = `export function add(x, y) { return x + y; }\n`;
      writeFileSync(srcPath, src);
      const eff = effectiveContract(src, "add", {
        loadModule: loadSibling("lib.nudo.js"),
        fromFile: srcPath,
        autoBind: true,
        projectDir: dir,
      });
      expect(eff?.source !== "handwritten").toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("checkSource with projectDir does not load out-of-tree sidecar", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-projroot-chk-"));
    const outside = mkdtempSync(join(tmpdir(), "nudo-outside-chk-"));
    try {
      const srcPath = join(outside, "lib.js");
      const src = `export function add(x, y) { return x + y; }\nadd(1, -2);\n`;
      writeFileSync(srcPath, src);
      const load = (spec: string): string | undefined => {
        if (spec.endsWith(".nudo.js")) {
          return `import { fn, number } from "@nudojs/core";
export const add = fn({ x: number(), y: number().gt(0) }, number());
`;
        }
        return undefined;
      };
      const rOut = checkSource(srcPath, src, pTrue, {
        fromFile: srcPath,
        loadModule: load,
        autoBind: true,
        projectDir: root,
      });
      expect(
        rOut.issues.filter((i) => i.code === "nudo:constraint-violated"),
      ).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// sidecar load I/O error vs no-sidecar (R2-6 #2)
// ---------------------------------------------------------------------------
describe("[sidecar] sidecar load I/O error vs no-sidecar (R2-6 #2)", () => {
/**
 * R2-6 #2：侧车 load 读失败（EACCES/EMFILE…）≠「无侧车」。
 * 读失败必须报 nudo:contract-load；无侧车文件（undefined）是 auto-bind
 * 常态，保持静默。此前 defaultLoadModule 全吞 catch → 两者同形，约束静默
 * 回落 any。
 */








/** 侧车 spec 命中时抛错，模拟 readFileSync EACCES */
function throwingLoadModule(err: Error) {
  return (spec: string, _from: string): string | undefined => {
    if (spec.includes(".nudo.")) throw err;
    return undefined;
  };
}

/** 侧车不存在：返回 undefined（auto-bind 常态） */
function missingSidecarLoadModule() {
  return (): string | undefined => undefined;
}

describe("sidecar load I/O error vs no-sidecar (R2-6 #2)", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    resetSidecarLoadFailureCache();
    takeRefineDiags();
    takeContractDiags();
  });

  it("sidecar read throws (EACCES) → nudo:contract-load，不静默", () => {
    const err = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    const src = `export function alpha(x) { return x; }\n`;
    const r = checkSource("/t/alpha.js", src, pTrue, {
      loadModule: throwingLoadModule(err),
      fromFile: "/t/alpha.js",
    });
    const loadErrs = r.issues.filter((i) => i.code === "nudo:contract-load");
    expect(loadErrs.length).toBeGreaterThan(0);
    expect(loadErrs[0]!.message).toContain("failed to load");
    expect(loadErrs[0]!.message).toContain("EACCES");
  });

  it("no sidecar file (undefined) → 保持静默，无 contract-load", () => {
    const src = `export function alpha(x) { return x; }\nexport function beta(x) { return x; }\n`;
    const r = checkSource("/t/quiet.js", src, pTrue, {
      loadModule: missingSidecarLoadModule(),
      fromFile: "/t/quiet.js",
    });
    const loadErrs = r.issues.filter((i) => i.code === "nudo:contract-load");
    expect(loadErrs).toEqual([]);
  });

  it("读失败按 (路径, 原因) 去重：多导出只报一条", () => {
    const err = Object.assign(new Error("EMFILE: too many open files"), { code: "EMFILE" });
    const src = `export function alpha(x) { return x; }\nexport function beta(x) { return x; }\nexport function gamma(x) { return x; }\n`;
    const r = checkSource("/t/multi-io.js", src, pTrue, {
      loadModule: throwingLoadModule(err),
      fromFile: "/t/multi-io.js",
    });
    const loadErrs = r.issues.filter(
      (i) => i.code === "nudo:contract-load" && i.message.includes("EMFILE"),
    );
    expect(loadErrs).toHaveLength(1);
    expect(loadErrs[0]!.message).toContain("multi-io.nudo.js");
  });

  it("显式 @nudo:import 读失败 → 报诊断（不再炸穿或静默）", () => {
    const err = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    const src = `/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:contract x positive
 */
export function f(x) {
  return x;
}
`;
    const r = checkSource("/t/imp.js", src, pTrue, {
      loadModule: throwingLoadModule(err),
      fromFile: "/t/imp.js",
    });
    const loadErrs = r.issues.filter((i) => i.code === "nudo:contract-load");
    expect(loadErrs.length).toBeGreaterThan(0);
    // 显式 import 的诊断点名 std.nudo.js（auto-bind 侧车的 imp.nudo.js 另报）
    expect(loadErrs.some((i) => i.message.includes("std.nudo.js") && i.message.includes("EACCES"))).toBe(true);
  });
});
});

// ---------------------------------------------------------------------------
// #64 sidecar load failure dedup
// ---------------------------------------------------------------------------
describe("[sidecar] #64 sidecar load failure dedup", () => {
/**
 * #64：侧车加载失败按 (路径, 原因) 去重，不按源导出逐个上报。
 *
 * 最小复现：侧车只绑定 alpha，但 import 打错（null_ 不是构建器）→
 * 修复前 alpha/beta/gamma 各报一条相同的 ERROR；修复后只报 1 条，
 * 且措辞不写 for 'X'（避免读成「X 函数自身有问题」）。
 */









describe("#64 sidecar load failure dedup", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    resetSidecarLoadFailureCache();
    takeRefineDiags();
    takeContractDiags();
  });

  it("sidecar binds only alpha → load failure reported once, not per source export", () => {
    const { loadModule } = makeFiles({
      // null_ 不是注入构建器：exec 时炸在 fn({ x: null_() })
      "/t/dup.nudo.js":
        `import { fn, string, null_ } from '@nudojs/core';\n\nexport const alpha = fn({ x: null_() });`,
    });
    const src = `export function alpha(x) { return x; }\nexport function beta(x) { return x; }\nexport function gamma(x) { return x; }\n`;
    const r = checkSource("/t/dup.js", src, pTrue, {
      loadModule,
      fromFile: "/t/dup.js",
    });
    const loadErrs = r.issues.filter(
      (i) => i.code === "nudo:contract-load" && i.message.includes("failed to load"),
    );
    // 只报 1 条模块级失败（不按 alpha/beta/gamma 各报一条）
    expect(loadErrs).toHaveLength(1);
    // 措辞不点名函数（避免读成「X 自身有问题」）
    expect(loadErrs[0]!.message).not.toMatch(/for '/);
    expect(loadErrs[0]!.message).toContain("dup.nudo.js");
  });

  it("sidecar exports two names and fails → one message, affects 2 bindings", () => {
    const { loadModule } = makeFiles({
      "/t/multi.nudo.js":
        `import { fn, null_ } from '@nudojs/core';\nexport const alpha = fn({ x: null_() });\nexport const beta = fn({ x: null_() });`,
    });
    const src = `export function alpha(x) { return x; }\nexport function beta(x) { return x; }\nexport function gamma(x) { return x; }\n`;
    const r = checkSource("/t/multi.js", src, pTrue, {
      loadModule,
      fromFile: "/t/multi.js",
    });
    const loadErrs = r.issues.filter(
      (i) => i.code === "nudo:contract-load" && i.message.includes("failed to load"),
    );
    expect(loadErrs).toHaveLength(1);
    expect(loadErrs[0]!.message).toMatch(/affects 2 bindings/);
  });

  it("unrelated exports do not surface sidecar load noise", () => {
    const { loadModule } = makeFiles({
      "/t/only.nudo.js":
        `import { fn, number } from '@nudojs/core';\nexport const alpha = fn({ x: number().gt(0) }, number());`,
    });
    // 侧车正常，只绑 alpha：beta/gamma 不该出现任何 contract-load
    const src = `export function alpha(x) { return x; }\nexport function beta(x) { return x; }\nexport function gamma(x) { return x; }\n`;
    const r = checkSource("/t/only.js", src, pTrue, {
      loadModule,
      fromFile: "/t/only.js",
    });
    const loadErrs = r.issues.filter((i) => i.code === "nudo:contract-load");
    expect(loadErrs).toEqual([]);
  });
});
});

// ---------------------------------------------------------------------------
// Bug 438 —— 跨文件调用：侧车按**被调方目录**解析
// ---------------------------------------------------------------------------
describe("[sidecar] Bug 438 —— 跨文件调用：侧车按**被调方目录**解析", () => {
/**
 * Bug 438 —— 跨文件调用时，**被调方**的 `@nudo:import` 侧车说明符按**调用方目录**
 * 解析 ⇒ 侧车明明在**被调方旁边**却报「failed to load」⇒ **error 级**
 * `nudo:contract-load` + `nudo:contract-syntax` 假红。
 *
 * 现状：**假阳性** —— 症状已被修掉：`scan-literal-calls.ts` 的 `checkArgStructures`
 * 把**被调方的定义路径**（`ext.fromFile`，经第 6 参 `contractFromFile` 传进来）
 * 用作 `refine.fromFile`（`refineFromFile = !sameFile && contractFromFile
 * ? contractFromFile : (opts?.fromFile ?? "")`）⇒ 侧车按**被调方目录**解析。
 * 本钉把这条行为钉死（**不改实现**）。
 *
 * 判据（**不是**「有没有报错」，而是「报什么」）：
 *   - 正例：侧车在被调方旁边 ⇒ 只有**真违例**（`nudo:constraint-violated`），
 *     **零** `nudo:contract-load` / **零** `nudo:contract-syntax`；
 *   - 负控制：侧车**只**在调用方目录 ⇒ 按被调方目录解析必然找不到 ⇒ 报
 *     `nudo:contract-load`（证明 loader 的 base 目录确实决定解析结果，
 *     正例不是因为「压根没查侧车」而绿）。
 */




const STD = `import { number } from "@nudojs/core";
export const positive = number().gt(0);
`;

/** 被调方：侧车说明符按**被调方自己的目录**解析 */
const LIB = `/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:contract x positive
 */
export function f(x) {
  return x;
}
`;

/** 调用方（被调方在子目录） */
const CALLER_SUB = `import { f } from "./sub/lib.js";
f(-1);
`;

/** 调用方（被调方同目录） */
const CALLER_SAME = `import { f } from "./lib.js";
f(-1);
`;

const ENTRY = "/t/e-call.js";

function check(caller: string, files: Record<string, string>) {
  const { loadModule } = makeFiles(files);
  return checkSource(ENTRY, caller, pTrue, { loadModule, fromFile: ENTRY });
}

function codes(r: { issues: { code: string }[] }): string[] {
  return r.issues.map((i) => i.code);
}

describe("Bug 438 —— 跨文件调用：侧车按**被调方目录**解析", () => {
  it("正例：侧车在被调方旁边 ⇒ 只有真违例，无 contract-load / contract-syntax", () => {
    const r = check(CALLER_SUB, {
      "/t/sub/std.nudo.js": STD,
      "/t/sub/lib.js": LIB,
    });
    expect(codes(r).filter((c) => c === "nudo:constraint-violated")).toHaveLength(1);
    expect(codes(r).filter((c) => c === "nudo:contract-load")).toHaveLength(0);
    expect(codes(r).filter((c) => c === "nudo:contract-syntax")).toHaveLength(0);
  });

  it("正例：违例诊断指向被调方的契约（expected: x > 0），不是「装载失败」", () => {
    const r = check(CALLER_SUB, {
      "/t/sub/std.nudo.js": STD,
      "/t/sub/lib.js": LIB,
    });
    const issue = r.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(issue?.expected).toBe("x > 0");
    expect(issue?.actual).toContain("-1");
  });

  it("负控制：侧车只在调用方目录 ⇒ 按被调方目录解析找不到 ⇒ 报 contract-load", () => {
    const r = check(CALLER_SUB, {
      "/t/std.nudo.js": STD,
      "/t/sub/lib.js": LIB,
    });
    expect(codes(r).filter((c) => c === "nudo:contract-load")).toHaveLength(1);
    const issue = r.issues.find((i) => i.code === "nudo:contract-load");
    expect(issue?.message).toContain("/t/sub/lib.js");
  });

  it("对照：被调方与调用方同目录 ⇒ 侧车同目录 ⇒ 正常解析（零 contract-load）", () => {
    const r = check(CALLER_SAME, {
      "/t/std.nudo.js": STD,
      "/t/lib.js": LIB,
    });
    expect(codes(r).filter((c) => c === "nudo:constraint-violated")).toHaveLength(1);
    expect(codes(r).filter((c) => c === "nudo:contract-load")).toHaveLength(0);
    expect(codes(r).filter((c) => c === "nudo:contract-syntax")).toHaveLength(0);
  });
});
});

// ---------------------------------------------------------------------------
// Bug 345: 依赖侧车失败的归因
// ---------------------------------------------------------------------------
describe("[sidecar] Bug 345: 依赖侧车失败的归因", () => {
/**
 * Bug 345 回归：依赖侧车的求值异常**不包装、不标注依赖路径** ⇒ 报错指向
 * **导入方**且点名它根本没有的名字；导入方的合法契约被连坐作废 ⇒ 契约门禁
 * 假绿。
 *
 * 修法：依赖侧车的异常在 `execSidecar` 内包装成 Nudo 原生诊断并**点名依赖
 * 侧车路径**（native ESM 语义：导入方因依赖装载失败而无法装载）。
 */




beforeEach(() => {
  setRefineDiagCollector(null);
  takeRefineDiags();
});

const IMPORTER = `
import { fn, number } from "@nudojs/core";
import { positive } from "./std.nudo.js";

export const good = fn({ n: positive }, number().gt(1000));
`;

describe("Bug 345: 依赖侧车失败的归因", () => {
  it("诊断点名**依赖侧车路径**（旧口径只说导入方坏了）", () => {
    const { loadModule } = makeFiles({
      "/t/std.nudo.js": `export const positive = ((( broken syntax\n`,
    });
    let err: unknown;
    try {
      execNudoModule(IMPORTER, {
        loadModule,
        fromFile: "/t/m.nudo.js",
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    const message = err instanceof Error ? err.message : String(err);
    expect(message).toContain("./std.nudo.js");
    expect(message).toContain("imported by");
    expect(message).toContain("/t/m.nudo.js");
  });

  it("依赖侧车正常时，导入方的契约**照常执法**（不再连坐作废）", () => {
    const { loadModule } = makeFiles({
      "/t/std.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);\n`,
    });
    const out = execNudoModule(IMPORTER, {
      loadModule,
      fromFile: "/t/m.nudo.js",
    });
    expect(Object.keys(out)).toContain("good");
    const v = out["good"] as { fn?: { returns?: unknown } } | undefined;
    expect(v?.fn).toBeDefined();
  });
});
});

// ---------------------------------------------------------------------------
// Bug 339 侧车孤儿导出诊断
// ---------------------------------------------------------------------------
describe("[sidecar] Bug 339 侧车孤儿导出诊断", () => {
/**
 * Bug 339：侧车导出名打错 ⇒ 契约被**静默丢弃**。
 *
 * 绑定是「拉取式」的（每个源码函数去问侧车「你叫这个名字吗」），从不枚举
 * 侧车导出 ⇒ 侧车里没人认领的条目在系统里根本不存在：签名退化成 any、
 * dts 类型错、门禁冒一条与真实原因无关的假红（"may throw TypeError"）。
 *
 * 修法：contract.ts 扫侧车孤儿导出——侧车里有、源码里没人认领的 **fn()
 * 契约** ⇒ 报一条点名的诊断（sidecar 导出名 + 源码导出名列表）。
 */








describe("Bug 339 侧车孤儿导出诊断", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    resetSidecarLoadFailureCache();
  });

  it("侧车导出名与源码函数名不匹配 ⇒ 报孤儿导出（点名侧车导出名）", () => {
    const { loadModule } = makeFiles({
      "/t/typo.nudo.js": `import { fn, number } from "@nudojs/core";\nexport const ff = fn({ x: number() }, number());`,
    });
    const src = `export function f(x) { return x * 2; }`;
    const r = checkSource("/t/typo.js", src, pTrue, {
      loadModule,
      fromFile: "/t/typo.js",
    });
    const orphan = r.issues.filter(
      (i) => i.code === "nudo:contract-load" && i.message.includes("has no matching source function"),
    );
    expect(orphan).toHaveLength(1);
    // 点名侧车里真实存在的导出名（ff）+ 源码导出名（f）
    expect(orphan[0]!.message).toContain("'ff'");
    expect(orphan[0]!.message).toContain("source exports: f");
  });

  it("名字对得上 ⇒ 无孤儿诊断（不误报）", () => {
    const { loadModule } = makeFiles({
      "/t/ok.nudo.js": `import { fn, number } from "@nudojs/core";\nexport const f = fn({ x: number() }, number());`,
    });
    const src = `export function f(x) { return x * 2; }`;
    const r = checkSource("/t/ok.js", src, pTrue, {
      loadModule,
      fromFile: "/t/ok.js",
    });
    expect(r.issues.filter((i) => i.code === "nudo:contract-load")).toEqual([]);
  });

  it("非 fn() 形态的孤儿导出（模板）不报（模板是 @nudo:import 的料）", () => {
    const { loadModule } = makeFiles({
      "/t/tpl.nudo.js": `import { shape, number } from "@nudojs/core";\nexport const userShape = shape({ id: number() });`,
    });
    const src = `export function f(x) { return x * 2; }`;
    const r = checkSource("/t/tpl.js", src, pTrue, {
      loadModule,
      fromFile: "/t/tpl.js",
    });
    expect(r.issues.filter((i) => i.code === "nudo:contract-load")).toEqual([]);
  });

  it("已被 @nudo:import 认领的名字不算孤儿", () => {
    const { loadModule } = makeFiles({
      "/t/claimed.nudo.js": `import { fn, number } from "@nudojs/core";\nexport const helper = fn({ x: number() }, number());`,
    });
    const src = `/// @nudo:import { helper } from "./claimed.nudo.js"\nexport function f(x) { return x * 2; }`;
    const r = checkSource("/t/claimed.js", src, pTrue, {
      loadModule,
      fromFile: "/t/claimed.js",
    });
    expect(
      r.issues.filter((i) => i.code === "nudo:contract-load" && i.message.includes("has no matching source function")),
    ).toEqual([]);
  });
});
});

// ---------------------------------------------------------------------------
// Bug 338: 侧车绑定名与构建器名同名
// ---------------------------------------------------------------------------
describe("[sidecar] Bug 338: 侧车绑定名与构建器名同名", () => {
/**
 * Bug 338 回归：侧车自身的绑定名与**构建器名**同名 ⇒ 侧车根本加载不了。
 *
 * 根因：`execSidecar` 用 `new Function(...Object.keys(sidecarInjects), …)`
 * 把 15 个构建器名当**形参**注入；侧车里的 `const pick = …`
 * （rewriteSidecarSource 把 `export const` 改成 `const`）与形参同名 ⇒
 * SyntaxError「Cannot declare a const variable twice」⇒ 整份侧车加载失败 ⇒
 * 该文件的全部契约丢失、三个运行时产物面退化为「接受一切」。
 *
 * 修法：注入名不再占用**侧车自身的顶层作用域**——外层作用域放注入袋 +
 * 构建器解构 + 依赖绑定，内层 IIFE 放侧车自己的代码（同名 = 遮蔽，不是
 * 重复声明）。
 */



beforeEach(() => {
  setRefineDiagCollector(null);
  takeRefineDiags();
});

describe("Bug 338: 侧车绑定名与构建器名同名", () => {
  it("`export const pick = fn(…)`（pick 是构建器名）→ 侧车可加载，导出可见", () => {
    const src = `
import { fn, number } from "@nudojs/core";
export const pick = fn({ flag: number() }, number());
`;
    const out = execNudoModule(src, { fromFile: "/t/lib.nudo.js" });
    expect(Object.keys(out)).toContain("pick");
    const v = out["pick"] as { fn?: unknown } | undefined;
    expect(v).toBeDefined();
    expect(v?.fn).toBeDefined();
  });

  it("侧车里的 `const number = …`（number 是构建器名）→ 可加载，不抛 SyntaxError", () => {
    const src = `
import { fn } from "@nudojs/core";
export const number = fn({ x: 1 }, 1);
`;
    const out = execNudoModule(src, { fromFile: "/t/lib.nudo.js" });
    expect(Object.keys(out)).toContain("number");
  });

  it("构建器仍可用：侧车未遮蔽的名字照常解析（fn / number）", () => {
    const src = `
import { fn, number } from "@nudojs/core";
export const keep = fn({ x: number().gt(0) }, number());
`;
    const out = execNudoModule(src, { fromFile: "/t/lib.nudo.js" });
    const v = out["keep"] as { fn?: { params?: unknown } } | undefined;
    expect(v?.fn).toBeDefined();
  });
});
});

// ---------------------------------------------------------------------------
// Bug 334 侧车环只报一条 nudo:contract-cycle
// ---------------------------------------------------------------------------
describe("[sidecar] Bug 334 侧车环只报一条 nudo:contract-cycle", () => {
/**
 * Bug 334：同一个物理侧车环被两条通道各报一次 ⇒ 一个环 = 两条同码 error。
 *
 * 两条通道：
 * - ambient 侧车加载通道（contract.ts `loadSidecarBinding` 的 exec catch）
 * - `@nudo:import` 通道（refine.ts `collectConstraints` → exec 抛
 *   `NudoSidecarError(nudo:contract-cycle)`）
 *
 * 两条通道命中的是**同一个物理环**（环链文本相同），但 message 差一个
 * "sidecar '…' failed to load: " 前缀 ⇒ check 层的 code+message 去重抓不住
 * ⇒ 门禁摘要虚增一倍。
 *
 * 修法：contract.ts 按**环链文本**去重（同一物理环 ⇒ 一条诊断）。
 */








describe("Bug 334 侧车环只报一条 nudo:contract-cycle", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    resetSidecarLoadFailureCache();
  });

  it("ambient 通道 + @nudo:import 通道命中同一物理环 ⇒ 只报 1 条", () => {
    const { loadModule } = makeFiles({
      // 环：cyc.nudo.js → other.nudo.js → cyc.nudo.js
      "/t/cyc.nudo.js": `import { positive } from "./other.nudo.js";\nexport { positive };`,
      "/t/other.nudo.js": `import { positive } from "./cyc.nudo.js";\nexport const positive = positive;`,
    });
    // 两条通道都 exec 这个侧车：
    // - ambient 通道：源码有导出 ⇒ 侧车被 exec ⇒ 撞环；
    // - @nudo:import 通道：@nudo:contract 引用了导入名 ⇒ 导入侧车被求值 ⇒ 撞环。
    const src = `/// @nudo:import { positive } from "./cyc.nudo.js"
/**
 * @nudo:contract x positive
 */
export function area(x) { return x; }`;
    const r = checkSource("/t/cyc.js", src, pTrue, {
      loadModule,
      fromFile: "/t/cyc.js",
    });
    const cycles = r.issues.filter((i) => i.code === "nudo:contract-cycle");
    expect(cycles).toHaveLength(1);
  });

  it("环诊断文本仍点名环链（去重不丢信息）", () => {
    const { loadModule } = makeFiles({
      "/t/cyc2.nudo.js": `import { positive } from "./other2.nudo.js";\nexport { positive };`,
      "/t/other2.nudo.js": `import { positive } from "./cyc2.nudo.js";\nexport const positive = positive;`,
    });
    const src = `/// @nudo:import { positive } from "./cyc2.nudo.js"
/**
 * @nudo:contract x positive
 */
export function area(x) { return x; }`;
    const r = checkSource("/t/cyc2.js", src, pTrue, {
      loadModule,
      fromFile: "/t/cyc2.js",
    });
    const cycles = r.issues.filter((i) => i.code === "nudo:contract-cycle");
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.message).toContain("sidecar import cycle:");
    expect(cycles[0]!.message).toContain("cyc2.nudo.js");
  });
});
});

// ---------------------------------------------------------------------------
// Bug 1125: 侧车装载诊断的依赖归属
// ---------------------------------------------------------------------------
describe("[sidecar] Bug 1125: 侧车装载诊断的依赖归属", () => {
/**
 * Bug 1125 —— 缓存的 sidecar 装载诊断**丢失依赖归属** ⇒ 依赖侧车的坏 import
 * 被记在 **root 侧车**名下（用户去 root 里找不到那个名字 ⇒ 定位错文件）。
 *
 * 根因（packages/core/src/algebra/refine.ts）：
 *   `SidecarLoadDiag` 只存 `{ code, message }`；递归求值（root → dep）**共享**
 *   同一个 diags 数组；发射时 `emitSidecarLoadDiags(diags, fromFile)` 一律用
 *   **root** 的 fromFile 归因 ⇒ 依赖侧车的诊断挂错文件。
 *
 * 修法：缓存记录里保留**来源文件**，发射时按来源文件归因；去重键也纳入来源
 * 文件（同一消息在不同文件 ⇒ 两条独立事实，不得互相吞掉）。
 *
 * 本文件钉住：
 * - 依赖侧车的坏 import ⇒ 诊断归因到**依赖侧车路径**（不是 root）；
 * - root 自己的坏 import ⇒ 归因到 root（零回归）；
 * - 同一消息在两个文件 ⇒ 两条诊断都在（去重键含来源文件）。
 */





beforeEach(() => {
  resetNudoModuleExecCache();
  takeRefineDiags();
});

/** 在一个分析作用域里装载侧车 ⇒ 返回该作用域看到的装载诊断 */
function execInScope(
  src: string,
  fromFile: string,
  files: Record<string, string>,
): RefineDiag[] {
  const { loadModule } = makeFiles(files);
  return runWithCollectorScope(() => {
    try {
      execNudoModule(src, { loadModule, fromFile });
    } catch {
      /* 侧车写坏可能抛错：诊断仍须可见 */
    }
    return takeRefineDiags().filter((d) => d.code === "nudo:contract-load");
  });
}

const ROOT = `import { fn, number } from "@nudojs/core";
import { positive } from "./dep.nudo.js";
export const f = fn({ x: positive }, number());
`;

/** 依赖侧车：import 了一个不存在的 builder ⇒ 装载期报「not an injected builder」 */
const BAD_DEP = `import { number, totallyBogus } from "@nudojs/core";
export const positive = number().gt(0);
`;

describe("Bug 1125: 侧车装载诊断的依赖归属", () => {
  it("依赖侧车的坏 import ⇒ 诊断归因到依赖侧车路径（不是 root）", () => {
    const diags = execInScope(ROOT, "/t/root.nudo.js", { "/t/dep.nudo.js": BAD_DEP });
    const bad = diags.filter((d) => d.message.includes("is not an injected builder"));
    expect(bad.length).toBeGreaterThan(0);
    expect(bad[0]!.file).toBe("/t/dep.nudo.js");
    expect(bad[0]!.file).not.toBe("/t/root.nudo.js");
  });

  it("root 自己的坏 import ⇒ 归因到 root（零回归）", () => {
    const root = `import { fn, number, totallyBogus } from "@nudojs/core";
export const f = fn({ x: number() });
`;
    const diags = execInScope(root, "/t/root2.nudo.js", {});
    const bad = diags.filter((d) => d.message.includes("is not an injected builder"));
    expect(bad.length).toBeGreaterThan(0);
    expect(bad[0]!.file).toBe("/t/root2.nudo.js");
  });

  it("同一消息在 root 与依赖侧车各一处 ⇒ 两条诊断都在（去重键含来源文件）", () => {
    const root = `import { fn, number, totallyBogus } from "@nudojs/core";
import { positive } from "./dep.nudo.js";
export const f = fn({ x: positive }, number());
`;
    const diags = execInScope(root, "/t/root3.nudo.js", { "/t/dep.nudo.js": BAD_DEP });
    const bad = diags.filter((d) => d.message.includes("is not an injected builder"));
    const files = new Set(bad.map((d) => d.file));
    expect(files.has("/t/root3.nudo.js")).toBe(true);
    expect(files.has("/t/dep.nudo.js")).toBe(true);
  });
});
});

// ---------------------------------------------------------------------------
// Bug 359 侧车形态诊断点名侧车真名
// ---------------------------------------------------------------------------
describe("[sidecar] Bug 359 侧车形态诊断点名侧车真名", () => {
/**
 * Bug 359：侧车形态诊断点名的是**源码本地名**，不是侧车里真实存在的导出名。
 *
 * 形态：别名导出（`export { _c as class }`）与 default 导出
 * （`export { f as default }`）下，侧车身份是**导出名**（class / default），
 * 源码身份是**本地名**（_c / f）。旧诊断点名源码本地名 ⇒ 用户照着去侧车
 * 里找一个根本不存在的导出。
 *
 * 修法：contract.ts 诊断改用绑定键解析出来的**侧车导出名**
 * （bindingLabel），必要时同时给出源码函数名。
 */








describe("Bug 359 侧车形态诊断点名侧车真名", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    resetSidecarLoadFailureCache();
  });

  it("别名导出：诊断点名侧车导出名 class（不是源码本地名 _c）", () => {
    const { loadModule } = makeFiles({
      "/t/lib.nudo.js": `const _nudo_1 = 42;\nexport { _nudo_1 as class };`,
    });
    const src = `export function _c(o) { return o.a; }\nexport { _c as class };`;
    const r = checkSource("/t/lib.js", src, pTrue, {
      loadModule,
      fromFile: "/t/lib.js",
    });
    const diags = r.issues.filter((i) => i.code === "nudo:contract-load");
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toContain("'class'");
    expect(diags[0]!.message).not.toContain("export '_c'");
    // 同时给出源码函数名（用户按本地名也能定位）
    expect(diags[0]!.message).toContain("'_c'");
  });

  it("default 导出：诊断点名侧车导出名 default（不是源码本地名 f）", () => {
    const { loadModule } = makeFiles({
      "/t/def.nudo.js": `export default 42;`,
    });
    const src = `export function f(o) { return o.a; }\nexport { f as default };`;
    const r = checkSource("/t/def.js", src, pTrue, {
      loadModule,
      fromFile: "/t/def.js",
    });
    const diags = r.issues.filter((i) => i.code === "nudo:contract-load");
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toContain("'default'");
    expect(diags[0]!.message).not.toContain("export 'f'");
  });
});
});

// ---------------------------------------------------------------------------
// Bug 1123: 侧车 import 别名不得与 ambient builder 声明撞名
// ---------------------------------------------------------------------------
describe("[sidecar] Bug 1123: 侧车 import 别名不得与 ambient builder 声明撞名", () => {
/**
 * Bug 1123 —— 侧车 import **别名**与注入的 builder 声明冲突 ⇒ 整个 sidecar
 * 装载失败（SyntaxError）⇒ 该文件的全部契约静默丢失（门禁假绿 + 产物面退化）。
 *
 * 根因（packages/core/src/algebra/refine.ts）：
 *   侧车求值包装器在外层作用域声明**全部** builder 名
 *   （`const { number, string, … } = __nudoInjects;`），而 prologue 用 `var`
 *   在**同一外层作用域**绑定显式 import 的本地名
 *   （`import { number as string }` ⇒ `var string = __nudoInjects["number"];`）
 *   ⇒ `const string` + `var string` 同作用域 ⇒ SyntaxError
 *   「Identifier 'string' has already been declared」⇒ 侧车根本装载不了。
 *
 * 修法：把**显式导入的本地名**从 ambient builder 声明中排除（用户显式
 * 导入的名字由 import 绑定，ambient 解构不得再声明同名）。
 *
 * 本文件钉住：
 * - 裸包名别名（`number as string`）⇒ 侧车装载成功、契约照常绑定；
 * - 相对侧车别名（`positive as number`）⇒ 同上；
 * - 别名侧车的约束**真的生效**（case 违例可见）——不得只是「不报错」的假绿。
 */







beforeEach(() => {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();
});

/** 带 case 的源码：case 违例可见 ⇒ 证明契约真的绑上了（不只是「没报错」） */
const SRC = `
/**
 * @nudo:case "neg" (-5)
 */
export function f(x) {
  return x;
}
`;

describe("Bug 1123: 侧车 import 别名不得与 ambient builder 声明撞名", () => {
  it("裸包别名（number as string）⇒ 侧车装载成功、契约生效", () => {
    const { loadModule } = makeFiles({
      "/t/alias.nudo.js":
        `import { number as string, fn } from "@nudojs/core";\n` +
        `export const f = fn({ x: string().gt(0) }, number());`,
    });
    const r = checkSource("/t/alias.js", SRC, pTrue, { loadModule, fromFile: "/t/alias.js" });
    // 装载失败（SyntaxError）会被报成 nudo:contract-load —— 修复后不得出现
    expect(r.issues.filter((i) => i.code === "nudo:contract-load")).toEqual([]);
    // 契约真的绑上了：case 违例可见
    expect(r.issues.filter((i) => i.code === "nudo:case-inconsistency").length).toBeGreaterThan(0);
  });

  it("相对侧车别名（positive as number）⇒ 侧车装载成功、契约生效", () => {
    const { loadModule } = makeFiles({
      "/t/std.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);`,
      "/t/alias2.nudo.js":
        `import { positive as number } from "./std.nudo.js";\n` +
        `import { fn, lit } from "@nudojs/core";\n` +
        `export const f = fn({ x: number }, lit(0));`,
    });
    const r = checkSource("/t/alias2.js", SRC, pTrue, { loadModule, fromFile: "/t/alias2.js" });
    expect(r.issues.filter((i) => i.code === "nudo:contract-load")).toEqual([]);
    expect(r.issues.filter((i) => i.code === "nudo:case-inconsistency").length).toBeGreaterThan(0);
  });

  it("同名导入（number）仍走 ambient 解构 ⇒ 不得被排除（零回归）", () => {
    const { loadModule } = makeFiles({
      "/t/plain.nudo.js":
        `import { fn, number } from "@nudojs/core";\n` +
        `export const f = fn({ x: number().gt(0) }, number());`,
    });
    const r = checkSource("/t/plain.js", SRC, pTrue, { loadModule, fromFile: "/t/plain.js" });
    expect(r.issues.filter((i) => i.code === "nudo:contract-load")).toEqual([]);
    expect(r.issues.filter((i) => i.code === "nudo:case-inconsistency").length).toBeGreaterThan(0);
  });
});
});

// ---------------------------------------------------------------------------
// Bug 356: 侧车注入名撞名
// ---------------------------------------------------------------------------
describe("[sidecar] Bug 356: 侧车注入名撞名", () => {
/**
 * Bug 356 回归：侧车求值的**注入名**与侧车自身绑定撞名 ⇒ SyntaxError。
 *
 * 根因（同 338）：`new Function(...Object.keys(sidecarInjects), …)` 把 15 个
 * 构建器名当形参注入；侧车的顶层 `const <name>` 与形参同名 ⇒ 整份侧车失效。
 *
 * 扩围面（报告原文「356 的扩展面」）：
 * - (1) `__nudoInjects` / `__nudoDeps` 两个注入参数与侧车同名 ⇒ 同样 SyntaxError
 * - (2) 相对 import 的 `var <local>` 前缀路径 ⇒ 同样 SyntaxError
 *
 * 修法：注入名整体搬进**外层作用域**（注入袋 + 构建器解构 + 依赖绑定），
 * 侧车自己的代码放内层 IIFE ⇒ 同名变成「遮蔽」（不同作用域）而不是「重复
 * 声明」；相对 import 的撞名额外报出 Nudo 原生诊断（native ESM 是 SyntaxError，
 * 引擎里是遮蔽 ⇒ 导入值静默丢失、契约悄悄变弱）。
 */



beforeEach(() => {
  setRefineDiagCollector(null);
  takeRefineDiags();
});

describe("Bug 356: 侧车注入名撞名", () => {
  it("构建器名撞名 → 侧车可加载（旧口径 SyntaxError）", () => {
    const src = `
import { fn } from "@nudojs/core";
export const number = fn({ x: 1 }, 1);
`;
    const out = execNudoModule(src, { fromFile: "/t/lib.nudo.js" });
    expect(Object.keys(out)).toContain("number");
  });

  it("`__nudoInjects` 撞名 → 侧车可加载（旧口径 SyntaxError）", () => {
    const src = `
import { fn, number } from "@nudojs/core";

const __nudoInjects = 1;
export const f = fn({ x: number() }, number());
`;
    const out = execNudoModule(src, { fromFile: "/t/lib.nudo.js" });
    expect(Object.keys(out)).toContain("f");
  });

  it("`__nudoDeps` 撞名 → 侧车可加载（旧口径 SyntaxError）", () => {
    const src = `
import { fn, number } from "@nudojs/core";

const __nudoDeps = 1;
export const f = fn({ x: number() }, number());
`;
    const out = execNudoModule(src, { fromFile: "/t/lib.nudo.js" });
    expect(Object.keys(out)).toContain("f");
  });

  it("相对 import 的本地名撞名 → 侧车可加载 + 报出 Nudo 原生诊断", () => {
    const src = `
import { positive } from "./shapes.nudo.js";
import { fn, number } from "@nudojs/core";

const positive = 1;
export const g = fn({ x: number() }, number());
`;
    const diags: Array<{ code: string; message: string }> = [];
    setRefineDiagCollector((d) => diags.push(d));
    const out = execNudoModule(src, {
      fromFile: "/t/lib.nudo.js",
      loadModule: (spec) =>
        spec === "./shapes.nudo.js"
          ? `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);\n`
          : undefined,
    });
    expect(Object.keys(out)).toContain("g");
    const clash = diags.find((d) => d.message.includes("declares 'positive'"));
    expect(clash).toBeDefined();
    expect(clash?.code).toBe("nudo:contract-load");
  });
});
});

// ---------------------------------------------------------------------------
// bug 1064: 侧车装载诊断随 exec 结果缓存（缓存命中时重发）
// ---------------------------------------------------------------------------
describe("[sidecar] bug 1064: 侧车装载诊断随 exec 结果缓存（缓存命中时重发）", () => {
/**
 * Bug 1064 —— 侧车装载失败（`nudo:contract-load`）在 **check 门禁面彻底隐形**
 * ⇒ 门禁假绿（exit 0）。
 *
 * 根因在 core（`packages/core/src/algebra/refine.ts`）：侧车装载诊断在
 * `execSidecar` **内部**产生 ⇒ exec 结果进缓存后，**缓存命中不再跑 exec**
 * ⇒ 该诊断在后续分析里消失。CLI 的固定顺序是「分析器先跑 → checkSource
 * 后跑」⇒ 分析器那轮（冷）拿到诊断、checkSource 那轮（缓存命中）拿不到
 * ⇒ `nudo check` 看不到侧车写坏 ⇒ 门禁绿灯。
 *
 * 修复（core）：装载诊断**随 exec 结果缓存**，每次调用（含缓存命中）重发
 * （与既有「撞名诊断」同口径：作用域内去重 + 每个分析作用域一份新去重表 ⇒
 * 分析器一轮 / checkSource 一轮各拿得到一份）。
 *
 * 注：诊断去重表是**作用域**级的（每个分析作用域一份新表）⇒ 本测试用
 * `runWithCollectorScope` 模拟「两轮分析」（分析器轮 / checkSource 轮）。
 */




/** 侧车 import 了一个非构建器名 ⇒ 装载期报 nudo:contract-load */
const BAD_SIDECAR = `import { fn, number, totallyBogus } from "@nudojs/core";
export const f = fn({ x: number() });
`;

/** 一个分析作用域内执行一次侧车装载 ⇒ 返回该作用域看到的装载诊断 */
function execInScope(fromFile: string): string[] {
  return runWithCollectorScope(() => {
    execNudoModule(BAD_SIDECAR, { fromFile });
    return takeRefineDiags()
      .filter((d) => d.code === "nudo:contract-load")
      .map((d) => d.message);
  });
}

/**
 * 同上，但**连导出对象一起**返回——「是否重新求值」只能靠**对象身份**观测
 * （诊断是**有意重放**的 ⇒ 诊断可见与否证明不了重新求值）。
 */
function execInScopeWithExports(fromFile: string): {
  exports: Record<string, unknown>;
  msgs: string[];
} {
  return runWithCollectorScope(() => {
    const exports = execNudoModule(BAD_SIDECAR, { fromFile });
    const msgs = takeRefineDiags()
      .filter((d) => d.code === "nudo:contract-load")
      .map((d) => d.message);
    return { exports, msgs };
  });
}

describe("bug 1064: 侧车装载诊断随 exec 结果缓存（缓存命中时重发）", () => {
  it("第二个分析作用域（exec 缓存命中）仍报 contract-load", () => {
    resetNudoModuleExecCache();
    const fromFile = "/tmp/bug1064/lib.nudo.js";

    const cold = execInScope(fromFile);
    expect(cold.some((m) => m.includes("is not an injected builder"))).toBe(true);

    // 第二轮：exec 缓存命中（不重跑 execSidecar）⇒ 旧实现这里诊断消失
    const warm = execInScope(fromFile);
    expect(
      warm.some((m) => m.includes("is not an injected builder")),
      "缓存命中必须重发装载诊断（否则 check 面看不到侧车写坏）",
    ).toBe(true);
  });

  it("同一作用域内重复装载 ⇒ 诊断只报一次（作用域内去重，不刷屏）", () => {
    resetNudoModuleExecCache();
    const fromFile = "/tmp/bug1064c/lib.nudo.js";
    const msgs = runWithCollectorScope(() => {
      execNudoModule(BAD_SIDECAR, { fromFile });
      execNudoModule(BAD_SIDECAR, { fromFile });
      return takeRefineDiags()
        .filter((d) => d.code === "nudo:contract-load")
        .map((d) => d.message);
    });
    expect(msgs.filter((m) => m.includes("is not an injected builder"))).toHaveLength(1);
  });

  it("resetNudoModuleExecCache ⇒ 侧车**重新求值**（导出对象身份变化），诊断仍可见", () => {
    resetNudoModuleExecCache();
    const fromFile = "/tmp/bug1064b/lib.nudo.js";
    const first = execInScopeWithExports(fromFile);
    expect(first.msgs.length).toBeGreaterThan(0);

    // 未 reset：exec 缓存命中 ⇒ **同一个**导出对象（没有重跑 exec）
    const cached = execInScopeWithExports(fromFile);
    expect(cached.exports).toBe(first.exports);
    expect(cached.msgs.length).toBeGreaterThan(0);

    // reset 后 ⇒ **重新求值** ⇒ 导出对象身份变化
    // （旧写法只断言「诊断仍可见」——诊断是**有意重放**的 ⇒ 恒真、零信息）
    resetNudoModuleExecCache();
    const afterReset = execInScopeWithExports(fromFile);
    expect(afterReset.exports).not.toBe(first.exports);
    expect(afterReset.msgs.length).toBeGreaterThan(0);
  });
});
});
