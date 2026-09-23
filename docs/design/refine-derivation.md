# Interface 分层推导与契约生成

> **状态**：主体已实施——三层有效契约、侧车自动绑定、`contract` 打印/`--draft`/`--emit`、drift/domain 冲突码、隐式依赖边、组合式生成、LSP open-buffer 侧车真值、**项目根 ambient 绑定边界**。`.nudo/cache` 跨会话缓存部分（L2 harvest 已落盘）。
> **真源**：架构 → kernel-merge.md；命令面/any/unknown/check → cli-semantics.md
>
> 产品动词：`check` / `test` / `contract` / `export` / `health` / `env harvest`。
> 配置键：`package.json#nudo.contract.*`（`autoBind` / `emit`）。
> 相关 flags：`--from`；`test --freeze` 仅 debug 见证固化；`export --format` / `--dialect zod` / `--out`。
> 序列化 API：`CaseJson`（test 报告面）/ `absToSchemaSource`（schema 投影）。

---

## 现状（已落地）

### 三层有效契约

| 层 | 来源 | check 执法 | 产品观察 |
|---|---|---|---|
| **handwritten** | `*.nudo.js` 同名导出 / `@nudo:refine` | **义务**：调用或返回 ⊭ → error | `nudo contract` 默认可打印 |
| **generated** | root 契约下行 / `--emit` 写入的 `@generated` 段 | **事实快照**：不执法，只 drift | 打印 + IDE hover |
| **implicit** | 分析会话内推导（未落盘） | 参与判定，不要求已落盘 | `nudo contract` / hover |

单点读取口 `effectiveInterface(fn)` 合并手写 ∪ 生成 ∪ 隐式，并带来源标注；`check` / `scan` / `generalize` / LSP 统一走它。

### 侧车绑定（主路径）

- `foo.nudo.js` **同名导出**自动绑定 `foo.js` 的**本地 named export**；源码可零注释。
- 绑定集合 = 该文件本地导出；**私有函数不绑定、不落盘**。
- `export default`：本地名 + `"default"` 双登记；re-export/barrel 不参与绑定（契约跟定义文件）。
- CJS 静态 `module.exports` / `exports.x` 参与绑定；动态导出名不猜。
- 源码 `@nudo:refine` 仍支持（全量，不限 exported）；与侧车并存时**合取**，不可满足报冲突码。
- 加载路径：`loadModule` → 受控 `execNudoModule`（真 parser 改写 import/export，注入构建器）；**不**走用户 `node_modules` 的 Node require。
- 执行边界：`node_modules` 下 `.nudo.js` **永不**自动加载；`package.json#nudo.contract.autoBind`（默认 `true`）可整体关闭，并透传到 `check` 与 LSP 执法路径。

### 产品命令面（契约）

| 动作 | 行为 |
|---|---|
| `nudo contract <paths…>` | 只打印有效契约与来源；无路径 → usage error |
| `nudo contract --draft` | 代码优先草稿 → `*.nudo.draft.js` / `*.nudo.draft.ts`（不 ambient 绑定） |
| `nudo contract --emit` | 按 filter 写盘 `@generated` 段；默认只刷新已有生成段；尊重 `nudo.contract.emit` 白名单 |
| `--fn` / `--from` / `--dry-run` / `--exit-on-diff` | 导出过滤 / 域证据注入 / diff·CI |
| `nudo check` | 聚合契约诊断；签名默认打印 |
| `nudo health` | 已落盘契约的 drift 门禁 |
| `nudo test` | case 报告 + 断言；`--freeze` 是 debug 固化，**不是**接口主路径 |

### 已落地机制要点

- 构建器：`fn` / `lit` / `union` / `shift` + utility（`partial` / `pick` / `omit` 等），与 Abs 代数共用，不另写一套。
- `fn` 是一等 `NudoConstraint`（`fn.params` / `fn.returns`），可 import、可嵌 shape。
- 下行推导：root 入口 Abs 上求值 body，实参/返回投影回约束；求值期维护**推导图**（side-channel collector），emit 打印其组合式，**禁止**从 Abs 反编译 shift 链。
- **check 与工件分轨**：check 沿每条 root 链独立推导、**不经 join**；join 只发生在落盘工件聚合，不回灌任何链。
- emit **永远 root 驱动**；纯下游文件靠生成段 `derived-from` 标注反查根。
- 隐式依赖边：`foo.js` ↔ `foo.nudo.js` 及递归闭包并入 dep 指纹与 `nudoDepParents`，避免陈旧缓存。
- 生成物：组合式 + import，依赖与源码同构；手写导出永不覆盖。
- case：机制保留（`test` / 诊断），产品面是 debug 副层，不是接口产物。

### 诊断码（执法面）

完整码表见 [`cli-semantics.md`](./cli-semantics.md) §5.2。与契约层直接相关的：

| code | severity | 触发 |
|---|---|---|
| `nudo:constraint-violated` | error | 推断 ⊭ **手写**契约 |
| `nudo:interface-domain-exceeds` | error | 跨文件注入域 ⊄ 手写契约（conf ∈ {exact,path} 且无截断） |
| `nudo:interface-drift` | warning | 已落盘生成段 ≠ 今日重算 |
| `nudo:interface-name-clash` | error | 生成段与手写同名（手写优先，跳过写入） |
| `nudo:interface-conflict` | error | 源码注解与侧车合取不可满足 |
| `nudo:interface-load` / `nudo:interface-cycle` | error | 侧车加载失败 / 导出形式不识别 / import 环 |
| `nudo:interface-underivable` | info | 约束传不下来（opaque / 循环） |

分析文件内调用点违例仍走 `constraint-violated`，与 domain-exceeds **按证据来源分流**。

---

## 关键不变量 / 设计决策（仍在约束代码的）

1. **类型本体仍是 Abs**；契约层是 NudoConstraint 投影 + 编排，不改内核。
2. **侧车导出 = 源码本地导出**；私有推导只在内存，服务 check，不进 `*.nudo.js`。
3. **手写 > 生成 > 隐式**；手写永不被 emit 覆盖。
4. **执法分档**：仅 handwritten 是义务；generated / 域证据是事实或 drift。
5. **参数位 `fn`（HOF）不参与违例判定**，只进展示（完整隶属判定另见 HOF 设计）。
6. **check 不 join、工件才 join**——join 回灌会把仍成立的上游契约误判失败。
7. **推导图数据，不是反编译**；无图时只 emit 域本身，不编造链。
8. **drift 比语义**：instantiate 后 entry Abs 上双向 `leqAbs`，不比源码字符串。
9. **自动绑定必须登记隐式依赖边**，否则逐出图缺边 → 静默陈旧结果。
10. **`node_modules` 不自动执行侧车**；`autoBind=false` 退回显式指令模式。
11. **配置键是 `package.json#nudo.contract.*`**，不另设配置文件。
12. **`test --freeze` 不是接口固化路径**；接口固化是 `contract --emit`。
13. gold 门禁：`constraint-violated` 码名与语义不动；`interface-*` 只增夹具。
14. dts / schema 是 Abs 的**单向有损投影**（`absToSchemaSource` / CaseJson 等），分析从不读回投影。

---

## 未决 / 未实施

- **项目根内 ambient 绑定**边界：**已落地**（`CheckOptions`/`EffectiveInterfaceOpts.projectDir`：树外侧车不 ambient 加载；CLI/LSP 从 findProjectConfig 下传）。
- LSP **open-buffer** 侧车真值：**已落地**（`makeBufferAwareLoadModule` buffer 优先于磁盘，validate/hover/agent 同源；见 `sidecar-lsp.test.ts`）。
- `.nudo/cache` 跨会话隐式契约缓存：L1 部分 + L2 harvest 磁盘（`harvest-disk.ts`）；用户契约文件与引擎缓存严格分离。
- `nudo:interface-entry-only`（导出无根且无域）：**已落地**（analyzeFile entry@ 合成时 info；无手写/生成契约且无调用点域）。
- 工件 join 后组合式曾退回展开式（已知降级）；分场景契约名仍是工件精度选项，非 check 正确性前置。
- 形参名对齐 / rest·解构 / class 方法侧车键等文法缺口：按「名字对不上不静默错绑」原则收紧时，需同步评估既有静默跳过行为。

---

## 源码锚点

- packages/core/src/algebra/interface.ts
- packages/core/src/algebra/constraint.ts
- packages/core/src/algebra/refine.ts
- packages/core/src/algebra/check.ts
- packages/core/src/algebra/scan.ts
- packages/core/src/algebra/generalize.ts
- packages/core/src/algebra/derivation.ts
- packages/service/src/interface-emitter.ts
- packages/service/src/interface-derivation.ts
- packages/service/src/interface-surface.ts
- packages/service/src/evaluator/config.ts
- packages/service/src/case-json.ts
- packages/service/src/dts-generator.ts
- packages/cli/src/index.ts
- packages/lsp/src/agent-tools.ts
- packages/lsp/src/validation.ts
- docs/examples/interface-derivation/
