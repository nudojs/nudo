/**
 * A1 · §5.2 前置 ①「`conf` 可提升机制」的**影响面实证**（2026-11-06）。
 *
 * 台账 §5.2 / §5.6 把「先降后升」列为「内核表示变更，影响 `leqAbs` ⇒
 * 门禁精度」，并据此单独排期。2026-11-04 的订正已指出 `leq.ts` 不读
 * `conf`；本文件用真实生产函数把影响面**精确化到 4 条**，供下一轮拍板：
 *
 * | 面 | 实测 | 对「conf 可提升」的含义 |
 * |---|---|---|
 * | `leqAbs` | 双向 `{ok:true}`（path ↔ exact） | ✅ **不受影响** ⇒ §5.6 R2-a「L1/L2 精度变化」的担忧不成立；原判定过时 |
 * | `absKey` / `absShapeKey` | 相等 | ✅ 不进键，但 ⚠️ **反面风险**：构造期以 `path` 算过的 memo / fingerprint 在升 `exact` 后**不会自动失效**（同键复用旧结论） |
 * | `formatAbs` | `#exact` vs `#path` | ⚠️ 展示面会变 ⇒ 大量精确串断言需逐条复核（与步骤 3 的 12 条同型） |
 * | `joinAbs` | `{...}  #path` | ⚠️ `confJoin` 单调不升 ⇒ 一旦有中间 join 参与，后续「提升」必须显式重算，不能靠字段赋值 |
 *
 * ⇒ 真正需要设计的不是 `leqAbs`，而是 **① 缓存键失效** 与 **② join 单调性**。
 * 这把「内核表示变更」从模糊担忧收敛成两个可实施点。
 *
 * 本文件不接生产、不改任何既有断言。
 */
import { describe, it, expect } from "vitest";
import { abs, numLit, type Abs, type Confidence } from "../abs.ts";
import { formatAbs } from "../format/format.ts";
import { leqAbs } from "../leq.ts";
import { absShapeKey, joinAbs } from "../objects.ts";
import { absKey } from "../key/abs-key.ts";

function obj(conf: Confidence): Abs {
  return abs({ k: "obj", slots: { "0": { value: numLit(1) } } }, undefined, undefined, conf);
}

describe("A1 · conf 可提升机制影响面（2026-11-06 实测）", () => {
  it("① leqAbs 双向都不读 conf ⇒ 原「影响 L1/L2 门禁」判定不成立", () => {
    expect(leqAbs(obj("path"), obj("exact"))).toEqual({ ok: true });
    expect(leqAbs(obj("exact"), obj("path"))).toEqual({ ok: true });
  });

  it("② absKey / absShapeKey 不进 conf ⇒ 提升后缓存键不变（需显式失效）", () => {
    expect(absKey(obj("exact"))).toBe(absKey(obj("path")));
    expect(absShapeKey(obj("exact"))).toBe(absShapeKey(obj("path")));
  });

  it("③ formatAbs 的置信度后缀会变 ⇒ 精确串断言需逐条复核", () => {
    expect(formatAbs(obj("exact"))).toBe('{ "0": 1 }  #exact');
    expect(formatAbs(obj("path"))).toBe('{ "0": 1 }  #path');
  });

  it("④ joinAbs 用 confJoin 单调不升 ⇒ 提升不能靠字段赋值", () => {
    expect(formatAbs(joinAbs(obj("exact"), obj("path")))).toBe('{ "0": 1 }  #path');
  });
});
