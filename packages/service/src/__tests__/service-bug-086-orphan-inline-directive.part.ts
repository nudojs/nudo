/**
 * BUG-086 —— 行内指令「无处可施」的诊断被**同文件另一条生效指令**抑制 ⇒
 * 诊断覆盖度取决于无关代码。
 *
 * 根因：`packages/service/src/eval-injection.ts` 的 `collectInto` 只在
 * 「收集表**全空**」（`acc.targets.length === 0 && acc.asTargets.length === 0`）
 * 时才发那条 `nudo:directive-syntax`；只要文件里有任意一条生效的
 * `@nudo:as` / `@nudo:replace`，挂在非语句节点上的孤儿指令就**彻底静默**。
 *
 * 修法：按**指令粒度**上报——每处孤儿各一条（位置进身份），与收集表是否
 * 为空无关。
 *
 * 断言非永真：改前 `ORPHAN_PLUS_WORKING` 的孤儿诊断数为 **0**（`ORPHAN_ONLY`
 * 为 1）⇒ 同一份写错的指令只因文件里多了一条有效指令就隐身。
 */
import { describe, it, expect } from "vitest";
import type { DirectiveDiag } from "@nudojs/parser";
import { collectEvalReplacements } from "../eval-injection.ts";

/** 孤儿 `@nudo:as`：挂在对象属性（非语句节点）上 ⇒ 无处可施 */
const ORPHAN_ONLY = `export function f(x) {
  const obj = {
    // @nudo:as number()
    a: JSON.parse(x),
  };
  return obj;
}
`;

/** 同一份孤儿指令 + 一条**生效**的 `@nudo:as`（唯一变量） */
const ORPHAN_PLUS_WORKING = `export function f(x) {
  const obj = {
    // @nudo:as number()
    a: JSON.parse(x),
  };
  // @nudo:as string()
  const s = JSON.parse(x);
  return [obj, s];
}
`;

/** 两处孤儿（同一文案、不同位置）⇒ 各报一条（Bug 848 位置进身份） */
const TWO_ORPHANS = `export function f(x) {
  const obj = {
    // @nudo:as number()
    a: JSON.parse(x),
    // @nudo:as number()
    b: JSON.parse(x),
  };
  return obj;
}
`;

function orphanDiags(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  collectEvalReplacements(src, { diags });
  return diags.filter(
    (d) =>
      d.code === "nudo:directive-syntax" &&
      d.message.includes("is not attached to a statement"),
  );
}

describe("BUG-086 — 孤儿行内指令的诊断不被同文件其它指令抑制", () => {
  it("只有孤儿指令 ⇒ 有一条「无处可施」诊断（既有口径）", () => {
    expect(orphanDiags(ORPHAN_ONLY)).toHaveLength(1);
  });

  it("孤儿 + 一条生效的 @nudo:as ⇒ 孤儿诊断**仍然在场**（改前被抑制为 0）", () => {
    expect(orphanDiags(ORPHAN_PLUS_WORKING)).toHaveLength(1);
    // 同一条诊断的文案保持不变（既有消费面按文案筛）
    expect(orphanDiags(ORPHAN_PLUS_WORKING)[0]!.message).toBe(
      "inline directive (@nudo:as / @nudo:replace) is not attached to a statement — it has no effect",
    );
  });

  it("生效的那条 @nudo:as 照旧进入收集表（抑制解除没有副作用）", () => {
    expect(collectEvalReplacements(ORPHAN_PLUS_WORKING).asTargets).toHaveLength(1);
  });

  it("两处孤儿各报一条（改前合并成一条）", () => {
    expect(orphanDiags(TWO_ORPHANS)).toHaveLength(2);
  });
});
