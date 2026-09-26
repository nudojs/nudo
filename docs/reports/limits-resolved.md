# 已解决限制归档（一行锚）

> 从 [`docs/design/limitations.md`](../design/limitations.md) 迁出的**已解决**条目。
> 行为以测试 / `docs/examples/` 为准；本文件只留一行锚，不再复述示例。
> 仍约束决策的限制留在 limitations.md，不在此重复。

## 行为锚

| 曾记限制 | 现状锚 |
|----------|--------|
| 形参表面默认/rest/解构 | `param-surface.test.ts` · `c41-destructure-enforce.test.ts` |
| 数组 reduce / forEach / for-of push | `hof.test.ts` · `docs/examples/algebra/h-array-boundary.js` |
| Map / Set 字面量条目 | `collections.test.ts` |
| 动态 key 投影 | 槽位并集（`$idx`）；`e-index-proj.js` |
| HOF concrete 消费 / dts 投影 | `c3-hof-closure.test.ts` · `hof-dts-projection.test.ts` |
| `this` / 全局标识符 / `==` 折叠 | B-path env + `looseEqAbs`；`bpath-env` / `loose-eq-fold` tests |
| 顶层 `this.x=1` ESM TypeError | B 托管：读 undefined、写硬抛 TypeError（模块装载失败）；`bpath-topthis.test.ts` |
| LSP open-buffer 侧车真值 | `makeBufferAwareLoadModule` buffer 优先于磁盘；`sidecar-lsp.test.ts` · `p0-fix-review-buffer-loader.test.ts` |
| 确定条件三元 / 循环 return / catch 形参 | `$fork` / `$loopReturn` / `$catchVal`；loop/try-catch tests |
| CLI class × 顶层调用栈溢出 | 已修复；`nudo test` / `check` 现 exit 0 |

## 原 §1.4 中已闭环（无残余约束）的条目

| 曾记限制 | 现状锚 |
|----------|--------|
| L2 harvest 磁盘层（`~/.cache/nudo/deps`） | HarvestJson 签名投影（`harvest-json.ts` / `harvest-disk.ts`）；[`persistent-cache.md`](../design/persistent-cache.md) |
| `@types/node` harvest 产品化（B2） | 磁盘缓存 + miss/fail 降级手写 `@nudojs/env` node 面（`harvest-node.ts`） |
| 项目根内自动绑定边界 | `projectDir` 树外侧车不 ambient 绑定（`sidecar-project-root.test.ts`）；node_modules 仍拦 |
| `nudo:interface-entry-only` | 导出无根且无域 → info（`analyzeFile` entry@ 合成路径） |
| `ns.foo` 命名空间模板 | `@nudo:import * as ns` → `ns.exportName` refine 引用 |
| `@nudo:pure` 记忆化 | `$call` / `$callNamed` 按实参 Abs 缓存 |
| JSX / import.meta / 动态 import | JSX→`$unknown`（文件保持 B-hosted）；`import.meta`→`{url:string}`；`import()`→`Promise<open obj>` |
| 侧车键近失配 | `Class.method` vs 裸 `method` 报 load 提示，不静默不绑 |
| 工件 join 组合式 | 多调用点同 root 纯 shift 链 → `union(shift…)` 组合式 |
| Map 字面量 key 跟踪 | collections `mapGetEntry`：字面量命中精确、miss=`undefined` |
| 复合赋值循环累加 | 已知长度 tuple 上精确（`total += n` → 15）；旧 infer 套件对应限制已关闭 |

金标与 CI 门禁见 [`../ci-nudo-check.md`](../ci-nudo-check.md)。
