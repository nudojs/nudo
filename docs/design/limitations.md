<!-- CLI semantics: docs/design/cli-semantics.md — L1 explicit contracts + L2 entry may-throw.
     C0 body-slot prohibition remains; entry unconstrained params = any; observation via check/test. -->
# Nudo 设计限制与待解决问题

> 只列**仍约束决策**的限制、诚实边界与未决项。已解决行为以测试 / `docs/examples/` /
> website `guides/semantics.md` 为准，不在本文重复示例；已闭环条目归档在
> [`../reports/limits-resolved.md`](../reports/limits-resolved.md)（一行锚）。
>
> 产品命令面与 L1/L2：[`cli-semantics.md`](./cli-semantics.md)。
> 执行模型与信任边界：[`kernel-merge.md`](./kernel-merge.md)「执行模型与信任边界」。
> 现行计划未闭环项：[`plans/2026-09-19-close-remaining-dx-gaps.md`](./plans/2026-09-19-close-remaining-dx-gaps.md)。

> **Executive summary (EN).** This document is the honesty ledger for still-binding design limits and open issues — not a tutorial and not a changelog. It governs what Nudo must **not** claim: L1 obligations come only from explicit contracts (`*.nudo.js` / `@nudo:contract`) or call-site facts; body-AST slot invention is forbidden (C0); HOF `promote` is warning-only, never a check error; entry unconstrained params display as **`any`** (`unknown` = inference failure); env/harvest never replaces mocks. The directive-vs-call@ precision asymmetry recorded in old sessions did **not** reproduce (2026-10 retest, §3: identical exact results for literal args); still-binding: same-run exclusivity (a function whose `@nudo:case` runs gets no `call@` cases that run), recursion deeper than `callSiteBudget` (3) widens the call@ witness to inner records + symbolic while the directive case stays exact, and `check` signatures are case-source-independent. Resolved items are one-line anchors in `../reports/limits-resolved.md`. Product CLI face and L1/L2: `cli-semantics.md`. Trust boundary: `kernel-merge.md`.

---

## 1. 仍有效的纪律与限制

> 宿主缓存失效契约（依赖变更后会话缓存逐出，非产品 API）：[`cache-invalidation.md`](./cache-invalidation.md)。

### 1.1 C0 / L2 契约模型（不得回退）

- **义务只来自**显式契约（`*.nudo.js` / `@nudo:contract`）或调用点事实。
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

只列**仍约束决策**的条目；已闭环无残余的条目见 [`../reports/limits-resolved.md`](../reports/limits-resolved.md)。

| 项 | 状态 | 说明 |
|----|------|------|
| Pred 蕴含（D2） | **已扩展** | 线性形（`+`/`-`/`*const`）· 跨项区间合成 · 等式类（`x=y`）· `ne` 收紧为严格界 · 合取目标分解 · and/or 交换律相等。非线性 / 量词仍故意不完整；可选 `setImplicationOracle` 外接 SMT（默认无依赖，仅内建证不出时调用、返回 `true` 才抬升，fail-closed） |
| 闭包跨调用状态合流 | **已建模** | evaluator 顺序调用共享闭包 `let`（`s5-closure-state.test.ts`）。残余：**未调用前**方法槽 `returnType` 诚实 `?`（形参名已展示，如 `(n) => ?`）；首次调用后渐进 join 填入（`engine-precision-residuals.test.ts` T7） |
| HOF `constraint` 表达 fn 形状 | **已开** | `fn()` → entry Abs 落 `shape.fn`；refine→**error** 可测（`hof-refine-error.test.ts`）；promote 仍只 warning |
| 调用点经验泛化（P3） | **明确不做** | 不入主路径（hof-relations） |
| 手写 Node env leaf-clean | **已收窄** | 高频面 options/Date/null/Record 具体化；残余 `any` 仅真无约束参（`assert.*` value、`util.format` 混参、`util.types.*` 谓词入参）— 见 `docs/reports/env-coverage-baseline.md` |
| 混合 `+` 粗化 | **已收窄** | number⊗obj/unknown 等 → `number\|string`（不再纯 unknown）；粗化本身仍是纪律 |
| LSP 客户端 UI 缺口 | 跟踪表已建 | [`lsp-client-gaps.md`](./lsp-client-gaps.md)（LSP-G1…；文档同步 LSP-G5 已关） |
| 生成器体惰性（Bug 212） | **架构债，未修** | 生成器体在**构造期**就跑完 ⇒ 外层绑定被提前改写，且改成一个**在任何原生观测点都不成立**的值（引擎 `1` / 原生 `0`）。两条硬约束：① **eager 收集是值域/签名面的承重结构**（元素域与 `conf` 构造期烘进 shape ⇒ 惰性化会把 `Generator<any \| number>` 退成 `Generator<unknown>`，并降 `conf` ⇒ 冲击 L1/L2 门禁精度）；② **外层绑定的写穿在 runtime 侧无句柄可拦**（转译产物是闭包变量的裸 JS 赋值，`$assignRecord` 只观测、返回值被丢弃）⇒ 任何修法都要先有转译侧钩子。**最小修法（纯转译侧、不动公开面）**：在 `$gen` 的体外套「自由写快照 + `$join` 折回」，复用仓里已有的 `collectFreeAssignedNames` ⇒ 把「确定的错值」变成 **sound 的过近似**（`0\|1` 而非 `1`）；逐点精确需「真挂起」（另立族）。完整数据流 / 消费面清单 / 分步路径 → [`generator-laziness.md`](./generator-laziness.md) |

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

### 1.5 覆盖率地板 ≠ 质量证明

`vitest.config.ts` 的 per-package coverage floors（env/harvester/vite-plugin/parser）
是**防静默倒退**的地板，不是完备性承诺。env 分支基线仍薄；薄包不得躲在 core
体量下被全局阈值掩盖。测试面加厚时**只升不降** floors；降 floor 必须在 PR 里写清原因。

---

## 3. `@nudo:case` 指令路径 vs `call@` 调用点路径（2026-10 复测）

历史会话曾记录「指令路径大量构造退化为 `unknown`、调用点路径精确」的严重不对称
（字符串方法 / sumTo / switch·typeof 曾是两路都精确的例外）。2026-10-16 用双夹具
复测（同一组函数，指令版挂 `@nudo:case` 具体实参；call@ 版去指令、文件顶层以
同样实参真实调用），**旧不对称未复现**：具体字面量实参下两路结果逐条一致且精确，
昔日的「例外」成了全量基线。仍有效的差异只剩结构性的（§3.2），方向与旧断言相反或正交。

### 3.1 复测夹具与结果

夹具（throwaway，放 `/tmp`，不入 `docs/examples/`）覆盖字符串方法链 / 数组
reduce / map HOF / `typeof` 守卫 / `switch` 守卫 / 可选链 + 空值合并 / `.length` /
`join` / HOF 箭头实参 / `String()`·`replace(//g)` 字面量折叠：

```js
function norm(s) { return s.trim().split(",").map((p) => p.trim()).join("-"); }
function sum(xs) { return xs.reduce((a, b) => a + b, 0); }
function double(x) { if (typeof x === "number") return x * 2; return null; }
function classify(x) {
  switch (typeof x) { case "string": return x.length; case "number": return x; default: return -1; }
}
function portOf(cfg) { return cfg?.server?.port ?? 8080; }
// 指令版：每函数 JSDoc 挂 `@nudo:case "x-lit" (<同一实参>)`
// call@ 版：去指令，顶层 `norm("  a, b ,c ")` 等同名实参真实调用
// 各自跑 `pnpm run test:cli <file>`
```

`pnpm run test:cli` 逐条对照（实参相同，两路输出一致）：

| 构造 | 指令路径（`debug "…"`） | call@ 路径（`call@L…`） |
|---|---|---|
| `norm("  a, b ,c ")` 链式 trim/split/map/join | `"a-b-c"` | `"a-b-c"` |
| `sum([1,2,3])` reduce | `6` | `6` |
| `doubleAll([1,2,3])` map ×2 | `[2, 4, 6]` | `[2, 4, 6]` |
| `double(21)` typeof 守卫 | `42` | `42` |
| `classify("abc")` switch·typeof | `3` | `3` |
| `portOf({server:{port:3000}})` `?.`+`??` | `3000` | `3000` |
| `lenOf("hello")` / `joinAll(["x","y"])` | `5` / `"x-y"` | `5` / `"x-y"` |
| `apply((x)=>x*3, 5)` HOF 箭头实参 | `15` | `15` |
| `String("hi").toUpperCase()+"!"` / `replace(/-/g,"_")` | `"HI!"` / `"a_b_c"` | 同左 |
| `new Date("2026-01-02").getFullYear()` | `number` | `number`（同精度：两路同不精确） |

符号实参（约束构建器）是指令路径独有的观察面，且精确：`string()` → `string`、
`array(number())` → `number[]`、`shape({server:{port:number()}})` → `number`。

### 3.2 现存边界（仍有效）

1. **test 同轮互斥**：`test` 命令本轮求值了某函数的 `@nudo:case`，该函数就不再
   合成 `call@`/`entry@` case（`analyzer-orchestrate-uncached.ts`：
   `caseIdxsToRun.length === 0` 才进 `synthCandidates`）。同一函数的两路结果
   **不能同轮同报**；对比必须双文件 / 双函数副本。
2. **递归 × callSiteBudget**：递归深度超过 `callSiteBudget`（默认 `3`）时，call@ 只报
   内部递归记录 + 宽化 `call@symbolic`（`sumTo(3)` → 三条内层 `(0)(1)(2)` +
   `(number) => 0 | number | string`），顶层精确见证 `6` 被预算挤出、不出现；
   指令路径照常精确（`sumTo(3)` → `6`）。深度 ≤ 预算时外层调用可见
   （`sumTo(2)` → `call@ (2) => 3`）。要递归函数的精确见证，用 `@nudo:case`
   固化，不要依赖 call@。
3. **check 面与 case 来源无关**：两变体 `pnpm run check` 签名逐字节一致
   （combined face 不区分 case 来源）。路径差异只体现在 `test` 报告，不影响门禁。
4. **call@ 只能观察真实调用**：构建器 / 符号实参无法经 call@ 表达（记录只来自
   真实代码调用）；符号见证面只有指令路径。

### 3.3 文档纪律

写精度断言时两条路径都要当场实跑，不得沿用旧会话记忆；「指令路径退化 unknown」
的旧结论作废（2026-10 复测未复现），引用本节复测结果为准。

---

## 4. 已解决

已闭环条目（一行锚）归档在 [`../reports/limits-resolved.md`](../reports/limits-resolved.md)；行为以测试 / `docs/examples/` 为准。

金标与 CI 门禁见 [`../ci-nudo-check.md`](../ci-nudo-check.md) 与 cli-semantics §5.6。
