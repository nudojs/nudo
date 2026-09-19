# design-cli-semantics-conflicts — 与目标设计冲突的文档/代码清单

> Design source: [`design-cli-semantics.md`](./design-cli-semantics.md)（rev: **无观察动词** — 观察在 check signatures + test case 报告 + IDE）  
> Marker tag: **`DESIGN-CONFLICT:cli-semantics`**  
> Scope: full worktree scan (docs + packages + scripts), excluding `node_modules` / `dist` / CHANGELOG noise where noted.

图例：

| 标记 | 含义 |
|------|------|
| **C-CLI** | 命令面遗留（infer/generate/emit/guard/types/interface/refine/doctor/**watch 一级动词** / --dts / --emit-cases / --callsites） |
| **C-ANY** | `any`/`unknown` 混用或入口参数误标为 `unknown` |
| **C-OBL** | 「义务只来自显式契约 / 无契约不检查」与 L2 入口 throws 冲突 |
| **C-THR** | may-throw 仅 warning、或 unknown-recv 未建模 throws |
| **C-DOC** | 产品叙事/帮助文案与目标 help、Day0/Day1 口径冲突 |
| **ALIGN** | 与设计一致，作对照，不改语义 |

---

## A. 总览（必须改或必须重述）

| ID | 路径 | 标记 | 冲突摘要 |
|----|------|------|----------|
| A1 | `packages/cli/src/index.ts` | **C-CLI C-THR C-ANY** | 注册 `infer`/`types`/`interface`/`doctor`/`generate`/`emit`/`guard`；infer 含 `--dts`/`--callsites`/`--emit-cases`；entry 输出 unknown；check 无 L2 |
| A2 | `packages/core/src/algebra/check.ts` | **C-OBL C-THR** | Abs-only L1；无契约文件对入口 may-throw 不报 error；无 `entry-may-throw` |
| A3 | `packages/core/src/algebra/abs.ts` | **ALIGN** | `any`/`unknown` 注释与 §2 一致——实现应对齐此文件，而非改掉它 |
| A4 | `packages/core/src/algebra/generalize.ts` | **ALIGN**（展示侧冲突） | 入口参数已是 `any`；CLI/文档仍打印 unknown |
| A5 | `packages/core/src/algebra/exec/member-diag.ts` | **C-THR C-ANY** | unknown 接收者 → `unknown-recv` warning；不区分 any vs unknown；不写 throws 域 |
| A6 | `packages/core/src/algebra/ast-eval.ts` / `exec/runtime.ts` / `exec/class.ts` | **C-THR** | 成员访问失败路径与 may-throw 建模不完整（见 §D 代码） |
| A7 | `packages/service/src/analyzer.ts` | **C-THR C-ANY C-CLI** | `entry@` 命名/回退；`nudo:unknown-recv`、`nudo-may-throw` 为 warning；无 L2 |
| A8 | `packages/service/src/infer-json.ts` | **C-ANY C-CLI** | InferJson v1 与 `infer --json` 同构；entry/any 口径待改 |
| A9 | `CLAUDE.md` | **C-CLI C-DOC** | 命令列表含 infer/types/generate/interface；叙事以 infer 为主 |
| A10 | `README.md` | **C-CLI C-ANY C-DOC** | `nudo infer`、`entry@ … unknown`、`--dts`、intension unknown 参数叙述 |

---

## B. 仓库根与设计文档

| ID | 路径 | 标记 | 冲突摘要 |
|----|------|------|----------|
| B1 | `docs/design-cli-semantics.md` | ALIGN | 本设计 |
| B2 | `docs/versioning.md` | **C-OBL C-CLI C-DOC** | 「Contracts only from sidecar/refine/call sites」；`infer` 为产品报告面；未定义 L2 |
| B3 | `docs/nudo-check.md` | **C-OBL C-THR C-CLI** | check 表：`may-throw` 为 warning；无 entry-throws；命令面旧 |
| B4 | `docs/design.md` | **C-CLI**（部分 **ALIGN** throws 愿景） | §4.5 throws 一等公民与 L2 方向一致；TypeValue/CLI 叙事遗留 |
| B5 | `docs/design-typevalue-algebra.md` | **C-CLI C-DOC** | 命令面：`types`/`emit`/`guard`/`generate` |
| B6 | `docs/design-refine-derivation.md` | **C-CLI** | `nudo interface` / `refine` 别名；emit/draft 产品名 |
| B7 | `docs/design-limitations.md` | **C-OBL C-DOC** | 「check 义务只来自显式契约」；无契约无义务叙事 |
| B8 | `docs/design-eval-missing-slot.md` | **C-OBL**（细分 C0 仍成立） | body AST 不发明 slot **保留**；但「without a contract… no obligation to report」未区分 L2 throws |
| B9 | `docs/design-analysis-scope.md` | **C-CLI C-OBL** | `nudo interface --draft` 等旧命令；分析范围叙事 |
| B10 | `docs/design-hof-relations.md` | **C-CLI** | agent `nudo.infer`；checkSource Pred 职责未含 L2 |
| B11 | `docs/design-persistent-cache.md` | **C-CLI**（弱） | 以 `checkSource` CLI 默认路径为缓存面 |
| B12 | `docs/design-kernel-merge.md` | **ALIGN**（弱 C-CLI） | check=蕴含门禁；命令名未展开则冲突轻 |
| B13 | `docs/examples/structure/README.md` | **C-OBL C-DOC** | 「义务只来自声明」无 L2 例外 |
| B14 | `docs/examples/algebra/README.md` | **C-CLI C-ANY** | `pnpm run infer`、`entry@` 回退叙述 |
| B15 | `docs/examples/mini-repo/README.md` | **C-CLI C-ANY** | infer 矩阵、entry@ unknown |
| B16 | `docs/examples/interface-derivation/*` | **C-CLI** | `nudo interface` / generated 注释命令名 |
| B17 | `docs/examples/README.md` | **C-CLI** | 大量 `pnpm run infer` / `--dts` 矩阵行 |
| B18 | `docs/superpowers/**` | **C-CLI C-OBL**（历史计划） | capability-boost 引入 generate；dx-gaps 写 infer/zero-FP/entry@ unknown 上限 |
| B19 | `docs/reports/env-coverage-baseline.*` + `scripts/env-coverage-baseline.ts` | **C-ANY** | 把 `unknown`/`any` 当同一 token 统计；「entry@ fallback is honest」 |
| B20 | `docs/check-real-packages.md` / `docs/ci-nudo-check.md` | **C-CLI C-OBL** | CI 以现行 check/infer 命令与 zero-FP 口径钉死（L2 开启后需拆期望） |

---

## C. Website（英文 + zh-Hans 对称；下列每条通常双份）

标记缩写：路径以 `packages/website/docs/…` 为准；`packages/website/i18n/zh-Hans/docusaurus-plugin-content-docs/current/…` 为镜像，**同等冲突**。

| ID | 路径（en） | 标记 | 冲突摘要 |
|----|------------|------|----------|
| C1 | `guides/cli.md` | **C-CLI C-ANY C-DOC** | 整篇以 `infer`/`interface`/`types`/`generate`/`emit`/`guard`/`doctor` 为一级命令；entry 参数 default **unknown**；`--dts`/`--emit-cases`/`--callsites` |
| C2 | `api/cli-reference.md` | **C-CLI C-ANY C-THR C-DOC** | 命令总表 11 动词；infer/generate/emit/guard 全文；exit code：infer 诊断不挡 CI（与新观察面一致，但命令名冲突）；entry unknown |
| C3 | `guides/check.md` | **C-OBL C-THR C-CLI** | may-throw=warning；无 L2 entry throws；无 `--ignore-throws` |
| C4 | `guides/runtime-generation.md` | **C-CLI C-DOC** | 教 `nudo generate` / `infer --dts` / `infer --json` 当 CI |
| C5 | `guides/callsite-discovery.md` | **C-CLI** | `infer --callsites` / `--emit-cases` 主路径 |
| C6 | `guides/migrating-js.md` | **C-CLI** | interface/doctor/infer --emit-cases 迁移步骤 |
| C7 | `guides/vs-typescript.md` | **C-OBL C-CLI C-DOC** | 「义务只来自显式 interface 或调用点事实」；`nudo emit`/infer `--dts` |
| C8 | `guides/semantics.md` | **C-ANY C-CLI** | 未建模 → unknown；以 `nudo infer` 为验证命令 |
| C9 | `guides/examples.md` | **C-CLI C-THR C-ANY** | 全文 infer 输出；may-throw warning 样例；unknown 组合叙述 |
| C10 | `guides/control-flow-narrowing.md` | **ALIGN**（弱 C-ANY） | 窄化已实现，符合 §4；「unknown condition」措辞需与 any/unknown 区分 |
| C11 | `guides/coexistence.md` | **C-CLI** | `nudo emit` 当 .d.ts 通道 |
| C12 | `guides/vscode.md` / `zed.md` / `lsp-clients.md` | **C-CLI** | IDE 命令对齐 `nudo interface` / agent `nudo.infer` 等 |
| C13 | `intro.md` | **C-OBL C-CLI C-DOC** | Day0=先无契约、infer；Day1=check；无 L2 |
| C14 | `concepts/layers.md` | **C-OBL C-DOC** | Day0 stop here=只要类型；Day1 才 check |
| C15 | `concepts/type-values.md` | **C-ANY** | shape 表将 `unknown`/`any` 并列同一语义格 |
| C16 | `concepts/directives.md` | **C-THR C-ANY** | unknown-recv 样例 |
| C17 | `concepts/abstract-interpretation.md` | ALIGN（弱） | 窄化模型；命令名少则冲突轻 |
| C18 | `api/service.md` | **C-CLI C-ANY** | `infer --dts`/`watch --dts`/`--emit-cases`/entry unknown |
| C19 | `api/agent.md` | **C-CLI C-DOC** | `nudo.infer` 与 CLI infer 同构；无 L2 check 语义 |
| C20 | `api/harvester.md` | **C-ANY C-DOC** | 「entry@ fallback is honest, not a defect」——在 L2 下入口 unknown/throws 不再可简单称 honest |
| C21 | `api/core.md` | **C-ANY** | `unknown` / `any` 同格「Universal set / any value」 |
| C22 | `getting-started/quick-start.md` | **C-CLI C-OBL C-DOC** | infer → 契约 → check 路径；`--dts`；无 L2 第一步 |
| C23 | `design/design-doc.md` | **C-CLI** | `nudo check`/`types`/`test` 命令面；Abs 单轨 ALIGN |
| C24 | `blog/2025-05-27-capability-boost.md` | **C-CLI**（历史） | 推 `nudo generate`；可标 historical |
| C25 | `contributing.md` | **C-CLI**（若含命令） | 以 grep 为准 |

**zh-Hans 镜像（与上表一一对应，全部同样冲突）：**

- `packages/website/i18n/zh-Hans/docusaurus-plugin-content-docs/current/{guides,api,concepts,getting-started,design,intro,blog}/…` 中与 C1–C25 同名文件。

---

## D. 源码（非 CHANGELOG）

### D1. CLI — `packages/cli`

| ID | 路径 | 标记 | 冲突摘要 |
|----|------|------|----------|
| D1.1 | `src/index.ts` | **C-CLI C-ANY C-THR** | 见 A1。`runInfer` 打印 entry unknown；`runGenerate` 为 emit/guard/dts 共用；`runCheck` 无 L2；`runDoctor` 提示 `infer --emit-cases` |
| D1.2 | `src/run-test.ts` | **C-CLI**（弱） | test 保留；需接 `--freeze` 承接 emit-cases |
| D1.3 | `src/__tests__/emit-tsc-roundtrip.test.ts` | **C-CLI**（弱） | 经 service generateFunctionDtsLines；命令面变更时改调用方 |
| D1.4 | `README.md` | **C-CLI C-DOC** | 只教 `nudo infer` / `--dts` |
| D1.5 | `package.json` scripts（root） | **C-CLI** | `pnpm run infer` / examples 脚本 |

### D2. Core — `packages/core`

| ID | 路径 | 标记 | 冲突摘要 |
|----|------|------|----------|
| D2.1 | `src/algebra/abs.ts` | ALIGN | any≠unknown |
| D2.2 | `src/algebra/generalize.ts` | ALIGN | 入口 any |
| D2.3 | `src/algebra/format.ts` | **C-ANY**（展示） | `formatShape` 对 `any`/`unknown` 分支存在；消费者若把入口 any 打成 unknown 是上游问题；确认无「统一成 unknown」逻辑则降级 |
| D2.4 | `src/algebra/check.ts` | **C-OBL C-THR** | 无 L2；`scanLiteralCalls` 对 any/unknown 豁免违例；eval-error 仅分析失败 |
| D2.5 | `src/algebra/scan.ts` | **C-OBL C-ANY** | 「unknown/any 无法证明缺字段」；义务扫描无 L2 throws |
| D2.6 | `src/algebra/leq.ts` | ALIGN（弱） | any 作顶；与产品一致 |
| D2.7 | `src/algebra/surface.ts` / `hof.ts` / `objects.ts` | **C-ANY**（弱） | any/unknown 并列分支——语义允许，需保证运算叙事不混 |
| D2.8 | `src/algebra/exec/member-diag.ts` | **C-THR C-ANY** | unknown-recv only；无 any-member throws |
| D2.9 | `src/algebra/exec/runtime.ts` | **C-THR** | 裸属性 → unknown-recv |
| D2.10 | `src/algebra/exec/class.ts` | **C-THR** | no-method / unknown-recv |
| D2.11 | `src/algebra/ast-eval.ts` | **C-THR**（部分 ALIGN 窄化） | `evalIf` 窄化 **ALIGN §4**；unknown 成员/截断路径 C-THR |
| D2.12 | `src/algebra/interface.ts` / `constraint.ts` | **C-CLI**（弱） | `any()` builder **ALIGN**；interface 产品词与 `contract` 更名冲突 |
| D2.13 | `src/algebra/__tests__/check-recall-gold.test.ts` | **C-OBL C-ANY** | `any-param-call-ok`：「any·无契约参数」期望不报——**L2 开启后金标需拆** |
| D2.14 | `src/algebra/__tests__/scan-interface.test.ts` | **C-OBL** | 「无侧车时…不报」 |
| D2.15 | `src/algebra/__tests__/check-return-contract.test.ts` | **C-OBL** | 「无契约可查，不报」 |
| D2.16 | `src/algebra/__tests__/arithmetic.test.ts` | ALIGN（注释） | 「无契约时 x 是 any」——**与 §2 一致**，可作锚点 |
| D2.17 | `src/algebra/__tests__/hof-*.test.ts` / projection 等 | 弱 C-ANY | any/unknown 测试夹具 |
| D2.18 | `packages/core/README.md` | **C-CLI C-DOC** | 若写 infer 流程 |

### D3. Service — `packages/service`

| ID | 路径 | 标记 | 冲突摘要 |
|----|------|------|----------|
| D3.1 | `src/analyzer.ts` | **C-THR C-ANY C-CLI** | entry@ 回退、unknown-recv、nudo-may-throw warning |
| D3.2 | `src/infer-json.ts` | **C-ANY C-CLI** | 序列化口径 |
| D3.3 | `src/dts-generator.ts` | **C-CLI**（弱） | 与 infer --dts / export 对齐后保留实现 |
| D3.4 | `src/interface-*.ts` / `case-emitter` 相关 | **C-CLI** | interface 命名、emit-cases 写回 |
| D3.5 | `src/analysis-scope.ts` | **C-THR** | `unknown-recv` 进默认噪声过滤表——L2/引擎债诊断策略需重审 |
| D3.6 | `src/__tests__/integration.test.ts` | **C-THR** | 钉 `nudo-may-throw` 为现有行为 |
| D3.7 | `src/__tests__/analyzer.test.ts` / `filter-diagnostics.test.ts` | **C-THR C-ANY** | unknown-recv 过滤期望 |
| D3.8 | `src/__tests__/infer-json.test.ts` / `m3-intension.test.ts` / `infer-real-packages.test.ts` | **C-ANY C-CLI** | entry@ unknown 钉住 |
| D3.9 | `src/__tests__/interface-*.test.ts` / `semantic-tokens-tier.test.ts` | **C-CLI** | interface 命令/分层 |
| D3.10 | `src/__tests__/dts-*.test.ts` / `hof-dts-*.test.ts` | 弱 C-CLI | 投影仍需要；命令面外 |

### D4. LSP / Agent

| ID | 路径 | 标记 | 冲突摘要 |
|----|------|------|----------|
| D4.1 | `packages/lsp/agent-tools.ts` | **C-CLI** | `nudo.infer` / `nudo.interface` 等工具名 |
| D4.2 | `packages/lsp/src/server.ts` | **C-CLI C-ANY** | 诊断/hover/inlay 展示口径 |
| D4.3 | `packages/lsp/agent-skill/SKILL.md` | **C-CLI C-DOC** | 教 agent 旧命令 |
| D4.4 | `packages/lsp/README.md` | **C-CLI** | |
| D4.5 | `packages/lsp/src/__tests__/agent-interface.test.ts` | **C-CLI** | |
| D4.6 | `packages/lsp/src/__tests__/lsp-integration.test.ts` | ALIGN（窄化） | 窄化测试 **对齐 §4** |

### D5. 其它包与脚本

| ID | 路径 | 标记 | 冲突摘要 |
|----|------|------|----------|
| D5.1 | `packages/nudojs/README.md` | **C-CLI C-DOC** | 对外 npm 叙事 |
| D5.2 | `packages/cli/README.md` | **C-CLI** | 见 D1.4 |
| D5.3 | `packages/vite-plugin/**` | 弱 C-CLI | 若文档提 infer |
| D5.4 | `scripts/verify-examples.sh` | **C-CLI C-ANY** | 钉 infer 输出与 entry@ unknown |
| D5.5 | `scripts/migrate-demo.sh` / `scripts/trial.mjs` | **C-CLI** | |
| D5.6 | `package.json` / workspace scripts | **C-CLI** | `infer` script 名 |
| D5.7 | `CLAUDE.md` | **C-CLI C-DOC** | 见 A9 |

### D6. CHANGELOG（标记为 historical，不阻塞语义迁移）

以下文件含旧命令名与 unknown-recv/may-throw 发布说明，**不作为产品规范**，迁移时不必逐条改写，但引用时须标注 historical：

- `packages/{cli,core,service,lsp,env,harvester,nudojs,parser,vite-plugin}/CHANGELOG.md`

---

## E. 金标 / CI 期望（L2 落地时必炸）

| ID | 路径 | 标记 | 说明 |
|----|------|------|------|
| E1 | `packages/core/src/algebra/__tests__/check-gold.test.ts` | **C-OBL** | gold recall/precision=1.0 以「无 L2」执法面为基线 |
| E2 | `packages/core/src/algebra/__tests__/check-recall-gold.test.ts` | **C-OBL C-ANY** | 含 any-param 不报、截断不报等 |
| E3 | `packages/core/src/algebra/__tests__/check-real-packages*.test.ts` / `docs/check-real-packages.md` | **C-OBL C-CLI** | 真实包 zero-FP：入口 may-throw 升 error 后须 **分套件**（L2 off / L2 on + ignore） |
| E4 | `docs/examples/README.md` + `scripts/verify-examples.sh` | **C-CLI C-ANY** | 示例矩阵锁 infer 字符串 |
| E5 | `docs/ci-nudo-check.md` | **C-CLI C-OBL** | CI 步骤命令名与门禁定义 |

---

## F. 对齐锚点（不要改成语义相反）

| ID | 路径 | 为何 ALIGN |
|----|------|------------|
| F1 | `packages/core/src/algebra/abs.ts` | any/unknown 正式定义 |
| F2 | `packages/core/src/algebra/generalize.ts` L693–696 | 入口参数 = any |
| F3 | `packages/core/src/algebra/__tests__/arithmetic.test.ts` 注释 | 「无契约时 x 是 any」 |
| F4 | `packages/website/docs/guides/control-flow-narrowing.md` | 条件窄化已实现 |
| F5 | `packages/lsp/src/__tests__/lsp-integration.test.ts` 窄化用例 | 同上 |
| F6 | `docs/design.md` §4.5 | throws 一等公民愿景（实现按 Abs 重述） |
| F7 | `packages/core/src/algebra/leq.ts` any 作顶 | 与 any=无约束并集一致 |

---

## G. 建议标记落盘方式

1. **本清单**为权威冲突索引（已落盘）。
2. 关键源码/文档文件头追加一行注释（已对下列文件操作）：

```text
DESIGN-CONFLICT:cli-semantics → docs/design-cli-semantics.md / design-cli-semantics-conflicts.md
```

3. 实现阶段按 A → D → E 顺序消化；每消化一项从本清单勾掉并在设计文档 §8 更新状态。
4. CHANGELOG 只标 historical，不进实现 backlog。

---

## H. 扫描命令（复现）

```bash
rg -l 'nudo (infer|generate|emit|guard|types|interface|refine|doctor)' \
  --glob '!**/node_modules/**' --glob '!**/dist/**'

rg -l 'entry@L.*unknown|参数默认为 .unknown.|default to .unknown.' \
  --glob '!**/node_modules/**'

rg -l 'unknown/any|`unknown`/`any`' --glob '!**/node_modules/**'

rg -l 'nudo:may-throw|nudo-may-throw' --glob '!**/node_modules/**'

rg -l '义务只来自|obligations come only|Contracts only from|No evidence' \
  --glob '!**/node_modules/**'
```

---

## I. 统计摘要

> **Status (this branch):** code/CLI **implemented** — primary verbs `check`/`test`/`contract`/`export`/`health`/`env harvest`; L2 `nudo:entry-may-throw` default error + `--ignore-throws` / `package.json#nudo.check.{ignoreThrows,entryThrows}` (CLI **and** LSP); entry unconstrained params display as `any` (true `unknown` = inference failure); `test` prints full case reports and `--json` carries assertion summary + exit 1 on declared failures; old verbs kept as stderr deprecations until next major. **`check --abs` still gates** on L1/L2 errors (observation face, not a CI bypass). L2 collection covers export function / export default / export const arrow / CJS `exports.f=` / explicit throw; try/catch digests soft throws. Invalid `--entry-throws` is rejected; invalid `package.json#nudo.check.entryThrows` warns and stays on `error`.
> **Note:** 本清单是对 **main 基线** 的冲突扫描；website 主 guides / cli-reference / check / service / agent 已按本分支语义校正（test 样例去掉假 entry@+call@ 并存、test --json assertions 摘要、no-signature=warning、check --json 单文件）。
> **Docs:** root CLAUDE.md / README / docs/* / examples / verify-examples 已对齐；website en+zh 抽样已修。
> **Known pre-existing failures to re-gate under L2:** check-real-packages* zero-FP suites stay on `entryThrows:"off"` baseline; L2-on expectations live in check-recall-gold L2 suite + `packages/cli/src/__tests__/cli-semantics-gate.test.ts`.
> **Review P0 status after this fix pass:** (1) L2 export-form false-negatives — fixed + gold/CLI tests; (2) `test --json` exit — fixed; (3) LSP `package.json#nudo.check` — wired. P1: changeset present; `check --abs` gate restored; website honesty pass done; CLI gold added.
> **P2 after follow-up commit:** `formatThrowsAbs` shape-precise (brand/sum/prim/any/unknown); B-path `$tryMark` pushes soft may-throw frames (digest in catch / release without handler, synthetic finally keeps JS legal); ast-eval try-catch **rethrow no longer digests** soft effects; `nudo:unknown-inference` emitted as warning on true-unknown signatures; website check/harvester wording aligned. Remaining non-blocking: root package.json still exposes deprecated infer/types/interface scripts (intentional transition).

| 类别 | 约计 |
|------|------|
| 强冲突源码入口（非测试） | 已在本分支落地（CLI 正门 + L2） |
| 强冲突产品文档（en+zh 镜像计双份） | ~50+ 文件 — 根/ docs / examples 在改；website 仍待 sweep |
| 金标/CI/脚本 | ~10 文件 — verify-examples 与 CI 文档在本分支对齐 |
| ALIGN 锚点 | 7 处（保留） |
| CHANGELOG historical | 9 包 |

**结论：** 与 `design-cli-semantics.md` 冲突的曾是**旧 CLI 产品面、check 执法面（无 L2）、entry@/unknown 展示口径，以及几乎全部用户文档**。代数层 `any`/`unknown` 定义与控制流窄化**不冲突**；本分支已实现 CLI/L2/展示，文档侧按上表继续消化。
