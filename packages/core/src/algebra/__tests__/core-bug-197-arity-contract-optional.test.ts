/**
 * BUG-197 —— `fn` **形参位**的 `.optional()` 在产物面（dts / schema）被认成
 * 「该位可省略」，执法面（`nudo:arg-count`）却按**实现签名**认「必填」。
 *
 * 症状（同一份契约，两面互斥）：
 * - `nudo export --format dts` ⇒ `export declare function opt(a: string, b?: number): any;`
 * - `nudo check caller.js` ⇒ `opt expects 2 argument(s), got 1 (nudo:arg-count)`
 * ⇒ TS 合法调用被 nudo 判红（假红），且 `--from-dts` 往返会把 `.d.ts` 的 `b?`
 *   主动生成为 `number().optional()` ⇒ 往返一次就制造这种不一致。
 *
 * 根因：`checkCallSite()` 的 `arityFace(g)` 只看实现签名（`x?: T` / 默认参）
 * ⇒ 契约级 `constraint.isOptional` 从未进入元数面。
 *
 * 修法：元数检查前先取 `effectiveInterface`，把 handwritten 契约的
 * `constraint.isOptional` 经**同一套位次映射**（`contractOptionalIndexes`）
 * 变成可选位集合 → `arityFace` **优先采用**（与产物面「三来源」序一致：
 * 契约级 > 实现签名）。本地调用与跨文件调用共用该映射 ⇒ 两面同结论。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { makeFiles } from "./nudo-constraints.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetParseSourceCache } from "../parse-source.ts";
import { resetAbsCallBudget, resetEvalForkBudget } from "../call-budget.ts";
import { resetNudoModuleExecCache, takeRefineDiags } from "../refine.ts";
import { resetSidecarLoadFailureCache, takeInterfaceDiags } from "../interface.ts";

beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetParseSourceCache();
  resetAbsCallBudget();
  resetEvalForkBudget();
  resetNudoModuleExecCache();
  resetSidecarLoadFailureCache();
  takeRefineDiags();
  takeInterfaceDiags();
});

/** `b` 契约级可选；`need2` 的两位都必填（对照组） */
const SIDE = `import { fn, number, string, any } from "@nudojs/core";
export const opt = fn({ a: string(), b: number().optional() }, any());
export const need2 = fn({ a: string(), b: number() }, any());
`;

const IMPL = `export function opt(a, b) { return a; }
export function need2(a, b) { return a; }
`;

/** `nudo:arg-count` 的 issue（可按 fn 过滤） */
function argCount<T extends { code: string; fn?: string }>(
  r: { issues: T[] },
  fn?: string,
): T[] {
  return r.issues.filter(
    (i) => i.code === "nudo:arg-count" && (fn === undefined || i.fn === fn),
  );
}

function files(caller?: string) {
  const vfs: Record<string, string> = {
    "/t/opt.nudo.js": SIDE,
    "/t/opt.js": IMPL,
  };
  if (caller !== undefined) vfs["/t/caller.js"] = caller;
  return makeFiles(vfs);
}

/** 同文件调用：契约与调用点同一模块 */
function localCheck(call: string) {
  const { loadModule } = files();
  return checkSource("/t/opt.js", `${IMPL}\n${call}\n`, pTrue, {
    loadModule,
    fromFile: "/t/opt.js",
  });
}

/** 跨文件调用：`caller.js` 从 `./opt.js` 导入被调方 */
function crossCheck(call: string) {
  const caller = `import { opt, need2 } from "./opt.js";\n${call}\n`;
  const { loadModule } = files(caller);
  return checkSource("/t/caller.js", caller, pTrue, {
    loadModule,
    fromFile: "/t/caller.js",
  });
}

describe("BUG-197 —— 契约 `.optional()` 位的元数面（本地 / 跨文件同口径）", () => {
  it("本地调用：契约可选位少传实参 ⇒ 不报 nudo:arg-count", () => {
    const r = localCheck(`opt("a");`);
    expect(argCount(r, "opt")).toEqual([]);
  });

  it("跨文件调用：契约可选位少传实参 ⇒ 不报 nudo:arg-count（与本地同结论）", () => {
    const r = crossCheck(`opt("a");`);
    expect(argCount(r, "opt")).toEqual([]);
  });

  it("本地调用：真正缺必填实参仍报（对照组，两位都必填）", () => {
    const r = localCheck(`need2("a");`);
    expect(argCount(r, "need2")).toHaveLength(1);
    expect(argCount(r, "need2")[0]!.severity).toBe("error");
  });

  it("跨文件调用：真正缺必填实参仍报（对照组，两位都必填）", () => {
    const r = crossCheck(`need2("a");`);
    expect(argCount(r, "need2")).toHaveLength(1);
    expect(argCount(r, "need2")[0]!.severity).toBe("error");
  });

  it("两位都传齐 ⇒ 两面都不报元数错", () => {
    expect(argCount(localCheck(`opt("a", 1);`), "opt")).toEqual([]);
    expect(argCount(crossCheck(`opt("a", 1);`), "opt")).toEqual([]);
  });
});
