---
"@nudojs/core": patch
---

fix: 后置条件证明通道的 Φ 侧接线（返回点路径前提）+ 消除 Φ 的假红

上一片（族 65 收口）把「证据面 = Φ ∧ ret.pred」的 Φ 侧**同项**判定补上后，
留下两件待决：Φ 侧**从未接入**生产（`phi` 参数恒为 `pTrue`），且按其文档
语义接线**不健全**——Φ 中的界原子可能约束的是**另一个项**
（`if (x > 0) return y`），蕴含失败会被判 `disproved`（error），而真实结论
应是「证不出」。

本片把两件都收口：

- **消除假红（前置）**：Φ 侧计入证据面的条件收紧为「**同项** ∧ **蕴含**该约束
  的 pred」（`postcondition.ts` 的 `phiSuppliesConstraint`）。实测口径：

  | Φ | 契约 | 改前 | 改后 |
  |---|---|---|---|
  | `y > 0`（同项但不足以蕴含 `y > 10`） | `number().gt(10)` | `disproved`（error，**假红**） | `unprovable`（warning，正确） |
  | `y > 20`（同项且足够） | `number().gt(10)` | `unprovable` | `proved` |
  | `x > 100`（**无关项**） | `number().gt(10)` | `unprovable` | `unprovable` |

  ⇒ **Φ 只能把「证不出」升级成「已证明」，绝不制造「确定违约」**；引擎自身
  收窄（`ret.pred`）侧的 fail-closed 口径（守卫弱于契约 ⇒ error）**原样保留**。

- **接进生产**：Φ = 用户引理前提（`@nudo:assume` 的 `assumePhi.phi`）⇒
  `check.ts`（主路径 + skip 分支）→ `ReturnContractAudit.phi` / `.phiPremises`
  → `check-return.ts` → `assertImplies(ret, constraint, { phi })`。
  项身份实测：形参**有契约**时入口 Abs 由 `constraintToEntryAbs` 生成、term =
  **真实形参名** ⇒ 与前提项同项 ✓；形参**无契约**时返回项锚在 α 名 ⇒ 对不上 ⇒
  Φ 侧不生效（保守少证，不假红）。

- **归因不得静默**：证明真的**依赖**路径前提时（去掉 Φ 就证不出），命中的前提
  经 `noteAssumeConsumed` 记进引理账本 ⇒ `nudo:assume-relied`（info）可见——
  用户公理不会被静默消费。skip 分支补齐 `assumeDisplay`，堵住「Φ 被消费却无
  归因」的洞。

- **`@nudo:invariant` 未接**：它是循环携带界（join / 宽化位强制），循环退出后
  的绑定值不必满足它 ⇒ 作为返回点 Φ 不健全。

验证：全仓 `tsc --noEmit`（含测试文件）0 错误；`pnpm run test` **1757 文件 /
14531 用例全绿**（exit 0）；`check-gold`（recall=precision=1.0）绿；新增
`core-bug-1094-postcondition-phi-wiring.test.ts`（15 条，含「Φ 永不新增
`disproved`」的性质不变式）；既有 `core-bug-1080` 的一条断言随假红消除同步
更新（fail-closed 语义改由 `ret.pred` 侧承载，Φ 侧单列「证不出」）。

**已知边界**：当前 `@nudo:assume` 文法只允许「名 <= 名」，而蕴含判定的区间
上下文只提取**数值**界 ⇒ 前提推不出字面界契约 ⇒ Φ 接线虽已生效（生产路径
确实把 Φ 交到证明通道），但**暂不翻转任何判据**。要让 Φ 真正生效，需要其一：
① `@nudo:assume` 文法支持字面界（如 `d <= 10`）；② 把形参契约事实并入返回点
Φ（属可靠性政策决策，与 Bug 346「契约面不得当成事实」的既有口径相关）。
两者都是独立于「接线」的特性，本片未擅自扩展。
