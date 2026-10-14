/**
 * #135：check 输出在两个稳定集间翻转（28↔22）——少集 = 契约族诊断整体
 * 静默消失、exit 0 假绿。根因链：fs 读错误被上游折叠成「无侧车」miss 后，
 * checkSourceInScope 的 per-call loadModule 缓存把首次 miss 的 undefined
 * 钉死整场。核心侧的行为钉（loadModule 对侧车 spec **抛错**的真实 fs 错误）：
 *
 * - 瞬态自愈：raw() 抛错不进 per-call 缓存（undefined 才缓存）→ 下一消费者
 *   重试拿到侧车 → 契约族诊断完整在场，且**无** nudo:interface-load；
 * - 持久响亮：loadModule 恒抛 → error 级 nudo:interface-load + ok=false
 *   （interface.ts 已区分「读失败」与「无侧车」，此处验证而非重复实现）；
 * - 真 miss 反钉：loadModule 返回 undefined（真无侧车）→ 静默零诊断，
 *   防修过头的反向回归；
 * - readerr 指纹：读错误轮的 deps 指纹不可信（readerr: 前缀 + readError），
 *   整文件 memo fail-open 不读不写——错误轮 / miss 轮 / 内容轮互不为
 *   跨次陈旧命中（修复前错误轮与 miss 轮折叠成同一 miss 键，28↔22 翻转）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetNudoModuleExecCache, takeRefineDiags } from "../refine.ts";
import { resetSidecarLoadFailureCache, takeInterfaceDiags } from "../interface.ts";
import { loadModuleDepsFingerprint } from "../load-deps-fp.ts";

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
    takeInterfaceDiags();
  });

  it("瞬态读错误自愈：首次抛 EACCES → 重试拿侧车 → 契约诊断完整且无 interface-load", () => {
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
    expect(r.issues.filter((i) => i.code === "nudo:interface-load")).toEqual([]);
    // 且不污染后续轮：同 loader 转「真无侧车」后必须回到干净报告
    // （修复前：瞬态轮以 miss 键 memo 了带诊断报告 → 真 miss 轮陈旧命中）
    setMode("miss");
    const r2 = check(loadModule);
    expect(r2.issues.filter((i) => i.code === "nudo:interface-load")).toEqual([]);
    expect(
      r2.issues.filter((i) => i.code === "nudo:case-inconsistency"),
    ).toEqual([]);
    expect(r2.ok).toBe(true);
  });

  it("持久读错误响亮：恒抛 → error 级 nudo:interface-load + ok=false", () => {
    const { loadModule, setMode } = makeMutableLoader();
    setMode("throw");
    const r = check(loadModule);
    expect(r.ok).toBe(false);
    const errs = r.issues.filter(
      (i) =>
        i.code === "nudo:interface-load" &&
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
    expect(rMiss.issues.filter((i) => i.code === "nudo:interface-load")).toEqual([]);
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
        (i) => i.code === "nudo:interface-load" && i.severity === "error",
      ),
    ).toBe(true);
  });

  it("真 miss（无侧车文件）→ 静默零诊断（反向回归钉）", () => {
    const { loadModule, setMode } = makeMutableLoader();
    setMode("miss");
    const r = check(loadModule);
    expect(r.issues.filter((i) => i.code === "nudo:interface-load")).toEqual([]);
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
