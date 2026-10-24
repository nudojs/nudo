/**
 * Bug 1124 —— `autoBind:false` 下**不可读的 ambient 侧车**仍被报成 error
 * ⇒ 门禁**假红**（没有任何依赖 / 启用的契约需要这次读取）。
 *
 * 根因：
 * - `packages/core/src/algebra/load-deps-fp.ts`：指纹计算**无条件**探测入口的
 *   ambient 侧车（`absorbSidecarClosure(fromFile)`），且该探测走 check.ts 的
 *   **记录型** loader ⇒ 读失败被记进 `loadReadFailures` ⇒ 收口成 error 诊断
 *   （`nudo:module-unreadable`）。
 * - `packages/core/src/algebra/check.ts`：把探测的 EACCES 升级成分析错误。
 *
 * 修法：
 * (a) 仅为**指纹**做的推测性读取**不升级成分析错误**（读失败只标 readError
 *     ⇒ 指纹键不可信、禁 memo；不产生 error 诊断）；
 * (b) 遵循 ambient 绑定资格：`autoBind:false` 时 ambient 侧车根本不会被绑定
 *     ⇒ 连探测都不必做（不读盘）。
 *
 * 本文件钉住：
 * - autoBind:false + 不可读 ambient 侧车 ⇒ 零 error 诊断、门禁绿；
 * - autoBind:false ⇒ 不探测 ambient 侧车（loader 未被调用）；
 * - 真·依赖不可读 ⇒ 仍报 nudo:module-unreadable（不得放宽真故障）；
 * - autoBind 开启且 ambient 侧车**确实需要** ⇒ 仍报 nudo:interface-load
 *   （真故障不被吞）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetNudoModuleExecCache, takeRefineDiags } from "../refine.ts";
import { resetSidecarLoadFailureCache, takeInterfaceDiags } from "../interface.ts";
import { resetParseSourceCache } from "../parse-source.ts";
import { resetAbsCallBudget, resetEvalForkBudget } from "../call-budget.ts";

beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetNudoModuleExecCache();
  resetSidecarLoadFailureCache();
  resetParseSourceCache();
  resetAbsCallBudget();
  resetEvalForkBudget();
  takeRefineDiags();
  takeInterfaceDiags();
});

/** 恒抛 EACCES 的 loader（记录探测到的 spec） */
function denyingLoader(probes: string[] = []) {
  return (spec: string, _from: string): string | undefined => {
    probes.push(spec);
    throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
  };
}

describe("Bug 1124: 不可读的 ambient 侧车不得被报成 error（假红）", () => {
  it("autoBind:false + 不可读 ambient 侧车 ⇒ 零 error 诊断、门禁绿", () => {
    const r = checkSource("/t/a.js", "export function f(){return 1}", pTrue, {
      fromFile: "/t/a.js",
      autoBind: false,
      loadModule: denyingLoader(),
    });
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.issues.filter((i) => i.code === "nudo:module-unreadable")).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("autoBind:false ⇒ 不探测 ambient 侧车（ambient 绑定无资格 ⇒ 不读盘）", () => {
    const probes: string[] = [];
    checkSource("/t/b.js", "export function f(){return 1}", pTrue, {
      fromFile: "/t/b.js",
      autoBind: false,
      loadModule: denyingLoader(probes),
    });
    expect(probes.filter((p) => p.includes(".nudo."))).toEqual([]);
  });

  it("真·依赖不可读 ⇒ 仍报 nudo:module-unreadable（不得放宽真故障）", () => {
    const src = `import { d } from './dep.js';\nexport function run() { return d(); }\n`;
    const r = checkSource("/t/main.js", src, pTrue, {
      fromFile: "/t/main.js",
      loadModule: (spec, from) => {
        throw Object.assign(new Error(`EACCES: permission denied, open '${from}/${spec}'`), {
          code: "EACCES",
          path: "/t/dep.js",
        });
      },
    });
    const unreadable = r.issues.filter((i) => i.code === "nudo:module-unreadable");
    expect(unreadable.length).toBe(1);
    expect(unreadable[0]!.severity).toBe("error");
    expect(r.ok).toBe(false);
  });

  it("autoBind 开启且 ambient 侧车确实被绑定 ⇒ 仍报 nudo:interface-load（真故障不被吞）", () => {
    const src = `export function alpha(x) { return x; }\n`;
    const r = checkSource("/t/alpha.js", src, pTrue, {
      fromFile: "/t/alpha.js",
      loadModule: denyingLoader(),
    });
    const loadErrs = r.issues.filter((i) => i.code === "nudo:interface-load");
    expect(loadErrs.length).toBeGreaterThan(0);
    expect(loadErrs[0]!.severity).toBe("error");
    expect(r.ok).toBe(false);
  });

  it("autoBind 开启但 ambient 侧车**没被用到** ⇒ 探测失败也不该让门禁变红", () => {
    // 源码没有任何导出 ⇒ 没有同名绑定需要那份侧车 ⇒ 侧车**没被读**过
    const src = `function helper(x) { return x; }\n`;
    const r = checkSource("/t/helper.js", src, pTrue, {
      fromFile: "/t/helper.js",
      loadModule: denyingLoader(),
    });
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.issues.filter((i) => i.code === "nudo:module-unreadable")).toEqual([]);
    expect(r.ok).toBe(true);
  });
});
