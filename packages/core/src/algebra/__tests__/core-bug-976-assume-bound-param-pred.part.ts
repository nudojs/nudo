/**
 * Bug 976（core 半）—— `buildArgsFromAssume` 把被假设形参的**前提硬编码成
 * `x > 0`** ⇒ `--assume` 的**非正界**（`x>-5` / `x>-100`）被静默替换成
 * `x>0` ⇒ 引擎**过度收窄** ⇒ 合法分支被剪掉（错值 / 假绿）。
 *
 * 根因：core 这一面只收到 id 集合（`assumeIds`），拿不到用户声明的界 ⇒ 写死
 * `>0` 成了「唯一可用假设」；CLI 那一面把用户界只放进 Φ ⇒ 两路合取
 * （`x>0 ∧ x>-5` = `x>0`）把负界吃掉。
 *
 * 修法（族 08 · AGENT-CONTEXT §4 裁决 + 报告 fix）：core 接收**形参 → 界**的
 * 映射，把用户声明的界直接落进形参的 `pred`；**没有声明界时不写界**（不替
 * 用户发明一个更强的默认界）⇒ Φ 只承担跨变量 / 额外前提。
 *
 * 反向钉：HEAD（未修）上 pred 恒为 `x > 0` ⇒ 本文件在 HEAD 上**必失败**。
 */
import { describe, it, expect } from "vitest";
import { buildArgsFromAssume } from "../generalize.ts";
import { predToString, gtNum, geNum, type Pred } from "../pred.ts";
import { v } from "../term.ts";

const SRC = `export function k(x) {
  if (x < 0) {
    return "neg";
  }
  return "pos";
}
`;

const assumeIds = new Set(["x"]);

describe("Bug 976 --assume 的界落进形参 pred（core 半）", () => {
  it("没有声明界 ⇒ 不写界（不得替用户发明 x > 0）", () => {
    const args = buildArgsFromAssume(SRC, "k", assumeIds);
    expect(args.length).toBe(1);
    expect(args[0]!.pred).toBeUndefined();
  });

  it("声明的界直接落进形参 pred（严格 >）", () => {
    const bounds: Map<string, Pred> = new Map([["x", gtNum(v("x"), -5)]]);
    const args = buildArgsFromAssume(SRC, "k", assumeIds, bounds);
    expect(args[0]!.pred).toBeDefined();
    expect(predToString(args[0]!.pred!)).toBe("x > -5");
  });

  it("声明的界直接落进形参 pred（非严格 >=）", () => {
    const bounds: Map<string, Pred> = new Map([["x", geNum(v("x"), 1)]]);
    const args = buildArgsFromAssume(SRC, "k", assumeIds, bounds);
    expect(predToString(args[0]!.pred!)).toBe("x ≥ 1");
  });

  it("未被 assume 的形参仍是 any（不写界）", () => {
    const src = `export function k2(x, y) { return x + y; }\n`;
    const args = buildArgsFromAssume(src, "k2", new Set(["x"]), new Map([["x", gtNum(v("x"), 0)]]));
    expect(args.length).toBe(2);
    expect(args[0]!.pred).toBeDefined();
    expect(args[1]!.pred).toBeUndefined();
    expect(args[1]!.shape.k).toBe("any");
  });
});
