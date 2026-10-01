/**
 * collectPredVars assumeFinite 分支回归（BUG-017 / S1-004）。
 * 回归背景：collectPredVars 的 switch 漏 case "assumeFinite"——
 * 只出现在 assumeFinite(t) 里的自由变元不进 acc：
 *  - instantiateMemoKey 的 varOrder 漏它 → 同构不同名实例不共享条目；
 *  - 更糟的是 alphaRenameResult 命中缓存后不把它改回当前名，
 *    返回的 Abs 引用着上一次调用的变量 id。
 * 对照：pred.ts predVars / 本文件 renamePred / hof.ts 均有该分支。
 */
import { describe, it, expect } from "vitest";
import { collectPredVars, instantiateMemoKey, alphaRenameResult } from "../generalize-key.ts";
import { assumeFinite, predVars } from "../pred.ts";
import { v } from "../term.ts";
import { abs } from "../index.ts";

const ONE = abs({ k: "prim", type: "number" }, { op: "lit", value: 1 }, undefined, "exact");

describe("collectPredVars: assumeFinite 变元收集（BUG-017）", () => {
  it("collects vars under assumeFinite", () => {
    const acc = new Set<string>();
    collectPredVars(assumeFinite(v("x")), acc);
    expect([...acc]).toEqual(["x"]);
  });

  it("instantiateMemoKey varOrder includes a var only under assumeFinite", () => {
    // args 不含变元；Φ 只在 assumeFinite 下引用 x
    const { varOrder } = instantiateMemoKey([ONE], assumeFinite(v("x")));
    expect(varOrder).toEqual(["x"]);
  });

  it("isomorphic assumeFinite instances share the memo key", () => {
    const a = instantiateMemoKey([ONE], assumeFinite(v("x")));
    const b = instantiateMemoKey([ONE], assumeFinite(v("y")));
    expect(b.key).toBe(a.key);
  });

  it("alphaRenameResult renames assumeFinite-wrapped vars back to current ids", () => {
    const a = instantiateMemoKey([ONE], assumeFinite(v("x")));
    const b = instantiateMemoKey([ONE], assumeFinite(v("y")));
    // 真实流程（generalize.ts）：缓存结果带缓存调用方的原始名 x，
    // 本次调用名 y → α-换名 x→y
    const result = abs(
      { k: "prim", type: "number" },
      { op: "var", id: "x" },
      assumeFinite(v("x")),
      "exact",
    );
    const renamed = alphaRenameResult(result, a.varOrder, b.varOrder);
    expect(JSON.stringify(renamed)).toContain('"y"');
    expect(JSON.stringify(renamed)).not.toContain('"x"');
  });

  it("口径与 predVars 一致（同一谓词同自由变元集）", () => {
    const p = assumeFinite(v("q"));
    const acc = new Set<string>();
    collectPredVars(p, acc);
    expect(acc).toEqual(predVars(p));
  });
});
