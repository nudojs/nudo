<!-- CLI semantics: docs/design/cli-semantics.md — L1 explicit contracts + L2 entry may-throw.
     C0 body-slot prohibition remains; entry unconstrained params = any; observation via check/test. -->
# Nudo 设计限制与待解决问题

> 只列**仍约束决策**的限制、诚实边界与未决项。已解决行为以测试 / `docs/examples/` /
> website `guides/semantics.md` 为准，不在本文重复示例。
>
> 产品命令面与 L1/L2：[`cli-semantics.md`](./cli-semantics.md)。
> 现行计划未闭环项：[`plans/2026-09-19-close-remaining-dx-gaps.md`](./plans/2026-09-19-close-remaining-dx-gaps.md)。

---

## 1. 仍有效的纪律与限制

### 1.1 C0 / L2 契约模型（不得回退）

- **义务只来自**显式契约（`*.nudo.js` / `@nudo:refine`）或调用点事实。
- **不**从 body AST 预扫描发明必填 slot。
- **L2** 入口 may-throw 是运行时效果门禁（`nudo:entry-may-throw`，默认 error），不是 shape 必填。
- 入口无约束参数显示 **`any`**；**`unknown` = 推导失败**（见 cli-semantics §2）。

### 1.2 HOF promote ≠ check 义务（必须保持）

| `fnRels` 来源 | check 行为 |
|---|---|
| `promote`（body 用量提升） | `nudo:arg-structure` **warning** — suggestion only，不升 exit |
| `refine` / `relationFn`（显式） | error（真正的 L1 义务） |

文档/对比表**不得**把 promote warning 写成「零注解 body 推出的 check 错误」。
纪律与数据结构见 [`hof-relations.md`](./hof-relations.md)。

### 1.3 C0.5 求值缺槽（默认 off）

| 项 | 内容 |
|----|------|
| 配置 | `package.json#nudo.analysis.evalMissingSlot`: `"off"`（默认）\| `"warning"` |
| 码 | `nudo:missing-slot`（warning；不发明门禁 error） |
| 触发 | 求值**实际命中**已知对象 shape 缺 key |
| 禁止 | body AST 预扫描当义务；草稿路径仍是 `nudo contract --draft` |

配置全表见 cli-semantics §7。

### 1.4 未解决 / 部分

| 项 | 状态 | 说明 |
|----|------|------|
| Pred 蕴含（D2） | **已扩展** | 线性形（`+`/`-`/`*const`）· 跨项区间合成 · 等式类（`x=y`）· `ne` 收紧为严格界 · 合取目标分解 · and/or 交换律相等。非线性 / 量词仍故意不完整；可选 `setImplicationOracle` 外接 SMT（默认无依赖，仅内建证不出时调用、返回 `true` 才抬升，fail-closed）。Map 字面量 key 跟踪已落地（collections `mapGetEntry`：字面量命中精确、miss=`undefined`）；复合赋值循环累加在已知长度 tuple 上精确（`total += n` → 15）；旧 infer 套件对应限制已关闭 |
| 闭包跨调用状态合流 | **已建模** | B-path 顺序调用共享闭包 `let`（`s5-closure-state.test.ts`：`c.increment(); c.getCount()` → 1/2）。残余：**未调用前**方法槽 `returnType` 诚实 `?`（形参名已展示，如 `(n) => ?`；零参才 `() => ?`）；首次调用后 `returnType` 渐进 join 填入（`engine-precision-residuals.test.ts` T7） |
| HOF `constraint` 表达 fn 形状 | **已开** | `fn()` → entry Abs 落 `shape.fn`；refine→**error** 可测（`hof-refine-error.test.ts`）；promote 仍只 warning |
| 调用点经验泛化（P3） | **明确不做** | 不入主路径（hof-relations） |
| L2 harvest 磁盘层（`~/.cache/nudo/deps`） | **已落地** | HarvestJson 签名投影（`harvest-json.ts` / `harvest-disk.ts`）；见 [`persistent-cache.md`](./persistent-cache.md) |
| `@types/node` harvest 产品化（B2） | **已落地** | 磁盘缓存 + miss/fail 降级手写 `@nudojs/env` node 面（`harvest-node.ts`） |
| 手写 Node env leaf-clean | **已收窄** | 高频面 options/Date/null/Record 具体化；残余 `any` 仅真无约束参（`assert.*` value、`util.format` 混参、`util.types.*` 谓词入参）— 见 `docs/reports/env-coverage-baseline.md` |
| 项目根内自动绑定边界 | **已落地** | `projectDir` 树外侧车不 ambient 绑定（`sidecar-project-root.test.ts`）；node_modules 仍拦 |
| `nudo:interface-entry-only` | **已落地** | 导出无根且无域 → info（`analyzeFile` entry@ 合成路径） |
| `ns.foo` 命名空间模板 | **已落地** | `@nudo:import * as ns` → `ns.exportName` refine 引用 |
| `@nudo:pure` 记忆化 | **已落地** | `$call` / `$callNamed` 按实参 Abs 缓存 |
| JSX / import.meta / 动态 import | **已落地** | JSX→`$unknown`（文件保持 B-hosted）；`import.meta`→`{url:string}`；`import()`→`Promise<open obj>` |
| 混合 `+` 粗化 | **已收窄** | number⊗obj/unknown 等 → `number\|string`（不再纯 unknown） |
| 侧车键近失配 | **已落地** | `Class.method` vs 裸 `method` 报 load 提示，不静默不绑 |
| 工件 join 组合式 | **已恢复** | 多调用点同 root 纯 shift 链 → `union(shift…)` 组合式 |
| LSP 客户端 UI 缺口 | 跟踪表已建 | [`lsp-client-gaps.md`](./lsp-client-gaps.md)（LSP-G1…；文档同步 LSP-G5 已关） |

---

## 2. 调用点发现的诚实边界（P7）

`nudo test/check --from` 的天花板（不是 bug，是边界）：

| 类别 | 说明 |
|------|------|
| 运行时机制回调 | Node Transform 等 native 内部回调无调用记录 → `entry@` |
| 无使用现场的函数 | 测试未触达 → `entry@` 兜底（覆盖问题，非推断问题） |
| 嵌套函数不归因 | 函数内定义的函数无模块栈定义位点；外部记录被归因门拒收（正确性优先） |
| 双入口包变体 | browser/node 记录不跨文件注入。**已上信号**：分析/`check` 命中双入口变体之一时发 `nudo:dual-entry`（info，单入口零误报）——仍是天花板，只是不再静默 |
| Native / 动态 `require` | env 可有签名、无副作用模拟；**字面量 / 常量折叠子集已解析**（StringLiteral / 无插值模板 / 插值与拼接全为字面量 / `require.resolve("lit")` / try-catch 双侧可折叠 → 优先成功侧）；其余诚实 `unknown` + 既有诊断（`nudo:builtin-unknown`），不假精确 |
| stream / spawn 副作用 | **签名面已一等**（ChildProcess pid/stdio/kill、Transform `transform`/`flush` 等钩子可 refine）；**仍 mock-required**：流机器何时发 `data`、真起进程的副作用（`docs/reports/env-coverage-baseline.md`） |

**env / harvest 不能替代 mock。** 详见 website `guides/semantics.md`「Mock boundary」与
`api/harvester.md`。覆盖报告（`docs/reports/env-coverage-baseline.md`）的解析率
**不是**完备性承诺。

---

## 3. 已解决（一行锚，行为以测试为准）

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

金标与 CI 门禁见 [`../ci-nudo-check.md`](../ci-nudo-check.md) 与 cli-semantics §5.6。
