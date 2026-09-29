/**
 * #64：侧车加载失败按 (路径, 原因) 去重，不按源导出逐个上报。
 *
 * 最小复现：侧车只绑定 alpha，但 import 打错（null_ 不是构建器）→
 * 修复前 alpha/beta/gamma 各报一条相同的 ERROR；修复后只报 1 条，
 * 且措辞不写 for 'X'（避免读成「X 函数自身有问题」）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetNudoModuleExecCache } from "../refine.ts";
import { resetSidecarLoadFailureCache, takeInterfaceDiags } from "../interface.ts";
import { takeRefineDiags } from "../refine.ts";

function makeFiles(files: Record<string, string>) {
  const resolve = (from: string, spec: string): string => {
    if (!spec.startsWith(".")) return spec;
    const parts = from.split("/").slice(0, -1);
    for (const seg of spec.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    return parts.join("/");
  };
  return {
    loadModule: (spec: string, from: string): string | undefined =>
      files[resolve(from, spec)],
  };
}

describe("#64 sidecar load failure dedup", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    resetSidecarLoadFailureCache();
    takeRefineDiags();
    takeInterfaceDiags();
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
      (i) => i.code === "nudo:interface-load" && i.message.includes("failed to load"),
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
      (i) => i.code === "nudo:interface-load" && i.message.includes("failed to load"),
    );
    expect(loadErrs).toHaveLength(1);
    expect(loadErrs[0]!.message).toMatch(/affects 2 bindings/);
  });

  it("unrelated exports do not surface sidecar load noise", () => {
    const { loadModule } = makeFiles({
      "/t/only.nudo.js":
        `import { fn, number } from '@nudojs/core';\nexport const alpha = fn({ x: number().gt(0) }, number());`,
    });
    // 侧车正常，只绑 alpha：beta/gamma 不该出现任何 interface-load
    const src = `export function alpha(x) { return x; }\nexport function beta(x) { return x; }\nexport function gamma(x) { return x; }\n`;
    const r = checkSource("/t/only.js", src, pTrue, {
      loadModule,
      fromFile: "/t/only.js",
    });
    const loadErrs = r.issues.filter((i) => i.code === "nudo:interface-load");
    expect(loadErrs).toEqual([]);
  });
});
