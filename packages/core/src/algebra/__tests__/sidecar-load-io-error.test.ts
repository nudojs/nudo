/**
 * R2-6 #2：侧车 load 读失败（EACCES/EMFILE…）≠「无侧车」。
 * 读失败必须报 nudo:interface-load；无侧车文件（undefined）是 auto-bind
 * 常态，保持静默。此前 defaultLoadModule 全吞 catch → 两者同形，约束静默
 * 回落 any。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetNudoModuleExecCache } from "../refine.ts";
import { resetSidecarLoadFailureCache, takeInterfaceDiags } from "../interface.ts";
import { takeRefineDiags } from "../refine.ts";

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
    takeInterfaceDiags();
  });

  it("sidecar read throws (EACCES) → nudo:interface-load，不静默", () => {
    const err = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    const src = `export function alpha(x) { return x; }\n`;
    const r = checkSource("/t/alpha.js", src, pTrue, {
      loadModule: throwingLoadModule(err),
      fromFile: "/t/alpha.js",
    });
    const loadErrs = r.issues.filter((i) => i.code === "nudo:interface-load");
    expect(loadErrs.length).toBeGreaterThan(0);
    expect(loadErrs[0]!.message).toContain("failed to load");
    expect(loadErrs[0]!.message).toContain("EACCES");
  });

  it("no sidecar file (undefined) → 保持静默，无 interface-load", () => {
    const src = `export function alpha(x) { return x; }\nexport function beta(x) { return x; }\n`;
    const r = checkSource("/t/quiet.js", src, pTrue, {
      loadModule: missingSidecarLoadModule(),
      fromFile: "/t/quiet.js",
    });
    const loadErrs = r.issues.filter((i) => i.code === "nudo:interface-load");
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
      (i) => i.code === "nudo:interface-load" && i.message.includes("EMFILE"),
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
    const loadErrs = r.issues.filter((i) => i.code === "nudo:interface-load");
    expect(loadErrs.length).toBeGreaterThan(0);
    // 显式 import 的诊断点名 std.nudo.js（auto-bind 侧车的 imp.nudo.js 另报）
    expect(loadErrs.some((i) => i.message.includes("std.nudo.js") && i.message.includes("EACCES"))).toBe(true);
  });
});
