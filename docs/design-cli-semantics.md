# design-cli-semantics — CLI 统一命令面与 any/unknown/入口 throws 语义

> Status: **design accepted; implementation landed + review fixes on this branch** (CLI verbs, L2 entry-may-throw, any≠unknown display, test case reports)  
> Remaining: next-major verb deletion; website historical sketches  
> Worktree: `nudo-cli-semantics-redesign`  
> Companion conflict inventory: [`design-cli-semantics-conflicts.md`](./design-cli-semantics-conflicts.md)  
> Revision: **无观察动词** — 观察是 `check`/`test`/IDE 的输出能力，不是一级命令。  
> Landed: Abs may-throw（any/nullish）、check L2 `nudo:entry-may-throw` + `--ignore-throws`、CLI 正门 verbs + deprecation、test 全量 case 报告 + `--freeze`、gold L2 用例、zero-FP L2 off 基线、LSP 读 `package.json#nudo.check`、`test --json` 断言失败 exit 1、`check --abs` 仍门禁。  
> Review follow-up: nested-try soft re-home（外层 catch 消化）、export 形态矩阵（alias / anon default / CJS ObjectMethod / class static）、B-path rethrow 不消化 soft、check 签名展示不再用 `=>` regex 误截 HOF、真 unknown 参数展示 + `nudo:unknown-inference`、`--ignore-throws` 只滤门禁不藏 throws、`infer`→test+check、`--json`⊕`--abs`、LSP off 仍保留门禁诊断。

本文取代下列遗留心智作为**产品语义与 CLI 命令面**的唯一设计源：

- 「`nudo infer` / `nudo show` 是 Day 0 主产品」
- 「无显式契约 ⇒ check 无义务、Day 0 不检查」
- 「`unknown` = 无约束参数」（与 `any` 混用）
- 「`generate` / `emit` / `guard` / `infer --dts` 多路径出 `.d.ts`」
- 「入口函数静默 may-throw 可接受」
- 「需要独立命令或 `check --cases` 专门做观察」

引擎代数层（`abs.ts` 对 `any`/`unknown` 的定义、控制流窄化）与本文一致；冲突多在 CLI 展示、check 执法面与文档。

---

## 0. 设计原则

1. **一个动词只干一件事**；同一产物只有一条命令路径。模式（如 `--watch`）不做一级动词。
2. **命令名 = 用户任务**，不用引擎内部词（`infer` / `types` / `refine`）作一级产品名。
3. **默认路径必须诚实**：无显式契约 ≠ 无契约；退化契约为 JS 运行时边界语义。
4. **要观察，不要观察命令**：签名/调用点事实/throws 是 `check`、`test`、IDE 的输出；**禁止** `infer`/`show` 一级动词，也**禁止** `check --cases`（避免观察与执法再搅在一起）。
5. **门禁只出现在带门禁语义的命令上**（exit 1）。
6. **Debug 能力可以存在，不得占据一级 help**。
7. **`any` 与 `unknown` 在产品语义上永不混用**（见 §2）。
8. TS 用户心智对齐：CLI **没有**观察子命令；CI 门禁对齐 `tsc --noEmit` ↔ `nudo check`。与 tsc 的差别：check **成功时仍打印 signatures**（不能静默），这是终端面上的「观察」。

---

## 1. CLI 命令面（目标态）

```text
nudo — JavaScript types, computed

  nudo check <path> [--watch|-w]   # 门禁 + 签名表（Day 0/CI 唯一终端入口）
  nudo test <path> [--watch|-w]    # 逐 case 调用点真值 + 可选断言（debug）
  nudo contract <path>             # 契约：打印 / draft / emit 侧车接口
  nudo export <path>               # 投影：dts | guard | zod
  nudo health [paths] [--watch]    # 体检：分析错误 + 固化漂移
  nudo env harvest <pkg>           # 环境：@types → env 模块
```

**没有** `nudo <path>` 默认观察，**没有** `nudo show` / `nudo infer` / `nudo types`，**没有**一级 `nudo watch`。

`watch` 是模式不是任务：对应 `tsc --watch`。仅挂在有持续重跑意义的子命令上（`check` / `test`，`health` 可选）；**不**挂在 `export`（出货一次性投影）与 `contract --emit`（写盘）。

### 1.1 观察落在哪里（能力保留，动词取消）

| 想知道什么 | 跑什么 |
|------------|--------|
| 入口签名 / any / unknown / throws | `nudo check <path>`（默认打印 signatures） |
| 逐调用点真值 / 窄化结果 | `nudo test <path>`（打印全部 case，含合成 `call@`/`entry@`） |
| 使用处实参形态 | `nudo test/check/contract --from <paths…>`（原 `--callsites`） |
| 代数面 term/pred/conf | `nudo check --abs`（或 `test --abs`） |
| 机器可读 | `nudo check --json` / `nudo test --json` |
| 交互 | IDE hover / inlay |

**禁止旗标：** `infer --dts`、`--emit-cases` 挂观察面；**`check --cases` 不做**。

#### `check` 默认输出（成功也要打印，不可静默）

```text
signatures
  getName(user: any) => any  throws TypeError
  subtract(a: any, b: any) => any
issues
  [error] getName: entry may throw TypeError  (nudo:entry-may-throw)
```

- 入口无约束参数显示 **`any`**，不得显示 `unknown`。
- 推导失败显示 **`unknown`** + conf 标注，并触发引擎债相关诊断。
- throws 域必须上屏。

#### `test` 默认输出（观察 = case 报告）

```text
=== getName ===
  entry@L1  (any) => any   throws TypeError
  call@L42  ({ name: "Ada" }) => "Ada"
  debug "empty"  ({}) => undefined
assertions
  ✓ 2 passed · 0 failed · 1 unchecked
```

- 合成 `call@`/`entry@` **默认打印**（这就是调用点观察）。
- 仅 `@nudo:case` 且带 `=> expected` 的进入 pass/fail；失败才影响 exit。
- `--freeze[=update]`：见证固化（原 `infer --emit-cases`），仍在 `test` 名下。

### 1.2 命令映射（现状 → 目标）

| 现状 | 目标 | 处置 |
|------|------|------|
| `nudo infer f` | `nudo test f`（case 报告）+ `nudo check f`（签名/门禁） | **删除**动词 `infer`；不设 show |
| `nudo infer f --json` | `nudo test f --json` / `nudo check f --json` | 按消费者拆分 |
| `nudo infer f --callsites x` | `nudo test/check/contract f --from x` | 更名 |
| `nudo infer f --dts` | `nudo export f --format dts --out …` | 迁出 |
| `nudo infer f --emit-cases[=update]` | `nudo test f --from … --freeze[=update]` | 迁入 test |
| `nudo types f` | `nudo check f --abs` | **删除**动词 `types` |
| `nudo check f` | `nudo check f` | 保留 + L2 + 默认 signatures |
| `nudo interface` / `refine` | `nudo contract` | 删除别名 `refine` |
| `nudo generate` / `emit` / `guard` | `nudo export --format …` | 三合一 |
| `nudo doctor` | `nudo health` | 更名 |
| `nudo test` | `nudo test` | **升为观察主报告面**（非纯断言） |
| `nudo watch` / `watch --dts` | `nudo check --watch` / `nudo test --watch` | **取消一级动词**；dts 保存时投影属 vite-plugin/IDE，不进 CLI watch |
| `nudo harvest` | `nudo env harvest` | 降级 |

### 1.3 exit code 契约

| 命令 | exit 1 |
|------|--------|
| `export` / `contract`（只读） | 仅用法 / IO 错误 |
| `check`（含 `--abs` / `--json`） | 任一 error 级诊断（L1 或未 ignore 的 L2）；`--abs` 是观察面，**不是**关 CI 的旁路 |
| `test`（含 `--json` / `--abs`） | 任一**声明断言**失败（合成 case / entry@ 不挡 exit） |
| `health` | drift 或 analysis error |
| `contract --emit --exit-on-diff` | 将写盘且有 diff（须同时 `--dry-run`；无 dry-run 时为 usage error） |

CI 门禁只认 `check`（及 `test` 的声明断言、`health` 的 drift）。

### 1.4 迁移

- 过渡 minor：新动词为正门；`infer`/`types`/`generate`/`emit`/`guard`/`interface`/`doctor` 保留 stderr deprecation + 等价新命令。
- `infer` 的 deprecation 文案指向：「签名 → `check`；调用点 case → `test`；dts → `export`」。
- 文档 / examples / gold / health 提示 / LSP·agent 文案一次改到新名。
- 下一 major 删除旧动词；**不做**永久静默同义词。

---

## 2. `any` vs `unknown`

与 `packages/core/src/algebra/abs.ts` 现有注释一致，并提升为**产品契约**：

| | `any` | `unknown` |
|---|-------|-----------|
| 含义 | 无约束：JS 值的并集；**开发者**负责细化 | **推导失败 / 引擎无信息**；**Nudo** 负责修 |
| 来源 | 未标注入口参数、显式 `any()`、refine 解析失败回退 | 求值失败、native 未建模、截断、泄漏、opaque |
| 运算 | 按真实 JS 语义取并集；不是「分析失败」 | 不得假装成合法契约；应触发引擎债诊断 |
| 窄化 | 条件语句可窄化（`typeof` / `===` / `Array.isArray` / `switch` / 真值 / 判别字段）——**已实现**，见 `guides/control-flow-narrowing.md` | **不能**被用户条件「合法化」；先修推导或补 env/mock/refine |
| 展示 | `any`、可带 type-var（`A1`） | `unknown` + conf 标注 |
| 产品话术 | 「未写契约 ⇒ 默认约束为 any + JS 运行时效果」 | 「Nudo 遇到无法处理的场景」 |

**禁止：**

- 文档/CLI 把入口无约束参数打印或叙述为 `unknown`。
- 把 `unknown` 与 `any` 在表格里并成同一格（如 `unknown`/`any` = 全集）。
- 在 check 中对 `unknown`（失败）静默通过而不报引擎债相关诊断。

**允许（代数层已如此）：**

- `leq`：任意 ≤ `any`；`any` ≤ 任意（由 pred/slot 再卡）。
- generalize 入口参数使用 `abs({ k: "any" }, var, pTrue, "path")`。

---

## 3. 义务分层与入口 throws

### 3.1 两层义务

| 层 | 来源 | check 行为 |
|----|------|------------|
| **L1 显式契约** | `*.nudo.js` / `@nudo:refine` / `@nudo:interface`；调用点证据可作 domain | 违例 → **error** |
| **L2 默认 JS 契约** | 未显式收窄时的运行时语义；对**入口/导出**函数 | 未消化的 may-throw → **error**（可用 ignore 过滤） |

「无显式契约」的正确叙述：

> 契约退化为 JS 运行时边界：入口参数为 `any`，对 `any`/可空值的操作可能抛；导出函数不得静默携带未声明、未捕获的 throws。

### 3.2 入口（entry）定义

L2 **只执法入口函数**，不对每个内部 helper 无差别报 may-throw。

入口 = 模块边界上对消费者可见的函数，至少包括：

- `export` / `export default` 声明或赋值
- CJS `exports.x =` / `module.exports` 上的函数
- （可选后续）package `exports` 公开路径上的再导出

内部函数：允许 throw；observe 可见；check 默认不因内部 may-throw 失败。

### 3.3 throws 建模要求

| 接收者 | 成员读 / 危险操作 | Abs / throws |
|--------|-------------------|--------------|
| `any`（无约束） | `user.name` 等 | 结果保持信息可得部分；**记录 may-throw**（常为 `TypeError`） |
| `null` / `undefined` 成员 | `x.prop` | **throws `TypeError`**（设计稿 §4.5.4 已写明，实现需对齐） |
| 对象缺槽 | `obj.missing` | 返回 `undefined`（或 optional），**不**一律 throws |
| 条件 throw 且条件不可判定 | `if (c) throw …` | case 带 may-throw |
| try-catch 消化 | | throws 从出口效果中移除；**catch rethrow 则不消化**（soft/hard 均上浮） |
| 无 handler 的 try | | soft may-throw 上浮至 L2 |
| 显式 refine 将参数收成 shape | | 操作落在已约束形状上；L2 消失或降为 L1 |

**L2 失败示意（`getName`）：**

```js
export function getName(user) {
  return user.name;
}
```

```text
[error] getName (export): may throw TypeError
  cause:    property 'name' on any (unconstrained param `user`)
  actual:   (user: any) => any    throws TypeError
  expected: entry total, or declare/catch throws
  → refine user / guard / try-catch / --ignore-throws TypeError
```

### 3.4 `--ignore-throws`

```bash
nudo check src/
nudo check src/ --ignore-throws TypeError
nudo check src/ --ignore-throws TypeError,RangeError
# package.json
"nudo": { "check": { "ignoreThrows": ["TypeError"] } }
```

语义钉死：

- **只**作用于 L2 入口 throws；**不**吞 L1 契约违例。
- 过滤的是 throws 的类型/形状（可扩展为入口路径 glob），不是模糊关掉整个 check。
- 默认**不** ignore 任何 throws。

### 3.5 与 Node 类比

未捕获异常使 Node 进程以非零码退出；同样，**导出边界**上的未声明/未捕获 throws 使 `nudo check` 失败。内部调用栈中的 throw 是实现细节，由调用方或 L1 契约处理。

---

## 4. 窄化与 `any` 的开发者路径

开发者将 `any` 收窄的方式（产品主路径，非遗留）：

1. **代码内条件**（零注解）：`typeof` / `===` / `Array.isArray` / `switch` / 真值 / 判别字段 —— 求值器已支持（具体调用点精确；符号 `any` 可能 join，属精度债，记入 unknown 类引擎问题）。
2. **显式契约**（Day 1）：`@nudo:refine` / `*.nudo.js` 把入口 `any` 收成 shape/pred。
3. **env / mock**：补外部 API，消除因未建模产生的 `unknown`。

`contract` / `draft` / `emit` 是路径 2 的命令面；不得再用 `infer --emit-cases` 充当契约产品。

---

## 5. 诊断码（目标）

| code | 层 | severity | 含义 |
|------|----|----------|------|
| `nudo:constraint-violated` 等既有 L1 码 | L1 | error | 显式契约违例 |
| `nudo:interface-*` | L1/接口 | 按现表 | 侧车分层 |
| **`nudo:entry-may-throw`**（新） | L2 | **error**（默认） | 入口未消化 may-throw |
| `nudo:may-throw`（保留） | test 报告 / L2 线索 | warning → 可被 L2 升格 | case 路径可能抛（含内部） |
| **`nudo:unknown-inference`**（新或并入） | 引擎债 | warning/error（可配） | 出口或签名出现真 `unknown`（失败） |
| `nudo:unknown-recv` | 引擎债 | warning | unknown 接收者成员访问；**不得**替代 L2 throws 建模 |
| `nudo:no-method` | 引擎/L1 | 按现表 | 已知 prim 上非法方法 |

名称可在实现时微调，但 **L2 入口 throws 必须是独立、默认 error、可 ignore 的码**，不得与「内部 may-throw warning」共用一个永不挡 CI 的码。

---

## 6. 与 TypeScript 的对照（帮助文案用）

| TS | Nudo |
|----|------|
| 类型写在源里 / IDE hover | Day 0：`nudo check` 打印 signatures；`nudo test` 打印调用点 case |
| `tsc --noEmit` | `nudo check`（成功时仍打印 signatures，不静默） |
| `any.prop` 不报错 | 入口上对 `any` 的危险操作进入 **throws 域**；L2 可 error |
| 无 `tsc show` | **无** `nudo show` / `nudo infer` 一级观察动词；观察是 check/test/IDE 的输出 |

---

## 7. 一级 help（目标文案）

```text
nudo check <path> [--watch]  Gate contracts + entry throws; print signatures (CI)
nudo test <path> [--watch]   Report every inferred case; assert declared expectations
nudo contract <path>         Draft / emit interfaces
nudo export <path>           Project dts / guard / zod
nudo health [paths]          Project health & drift
nudo env harvest pkg         Harvest @types into an env

Day 0   check（读签名）/ test（看 case） · Day 1   contract + check · Ecosystem   export
```

---

## 8. 实现顺序（建议）

1. **展示层**：`formatShape` / CLI / InferJson / LSP inlay —— 入口 `any` vs `unknown` 拆开；throws 上屏；check 默认 signatures；test 默认全量 case。 **[done]**
2. **Abs throws**：`any`/`nullish` 成员访问与危险操作写入 `throwsAbs` 或 may-throw 标记；nested try soft 上浮到外层帧。 **[done]**
3. **check L2**：仅入口；`nudo:entry-may-throw` 默认 error；`--ignore-throws` + 配置；export 形态矩阵覆盖。 **[done]**
4. **命令面**：删除 infer/types/generate/emit/guard/**watch** 一级动词；`export` 三合一；`--emit-cases` → `test --freeze`；watch → `check/test --watch`；**不**做 `check --cases` / `show`。 **[done — 旧动词保留 deprecation，major 再删]**
5. **文档与 gold**：按 conflicts 清单改写；「跑 infer 看真值」改为 `nudo test`；zero-FP 套件区分 L2 off/on；verify:examples 0 fail。 **[done — 主 guides/gold/examples 对齐]**
6. **major**：删除旧动词与旧旗标。 **[pending]**

---

## 9. 非目标

- 不在 body AST 上发明「必填 slot」义务（C0 仍成立；L2 是运行时效果，不是 shape 必填）。
- 不把 `.d.ts` 投影当真理源。
- 不为每个内部函数强制 totality。
- 不在本设计中重写 Abs 代数；只约束产品语义与执法面。

---

## 10. 参考（对齐的现仓片段）

| 片段 | 状态 |
|------|------|
| `packages/core/src/algebra/abs.ts` `any`/`unknown` 注释 | **对齐** §2 |
| `packages/core/src/algebra/generalize.ts` 入口参数 `any` | **对齐** §2 |
| `packages/website/docs/guides/control-flow-narrowing.md` | **对齐** §4（窄化已存在） |
| `docs/design.md` §4.5 throws 一等公民 | **愿景对齐**；TypeValue 笔法需按 Abs 重述 |
| CLI `infer` / `generate` / `emit` / `guard` / check 对无契约 OK | **冲突** — 见 conflicts |
