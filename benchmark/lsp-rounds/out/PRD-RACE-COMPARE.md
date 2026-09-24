# PRD Race — Nudo vs TypeScript (omp · 同模型双账号)

- **Agent**: oh-my-pi (omp) `-p --mode json`
- **模型**: 同权重 `sensenova-6.8-flash-lite` · **nudo=`sn0/…` · ts=`sn1/…`**（不同账号，限流隔离）
- **LSP**: Nudo 侧仅 `nudo-lsp` · TS 侧仅 `typescript-language-server`
- **指标**: 只记 token（**不算 price**）；session.jsonl 为唯一 usage 源
- **验收**: 两侧 `npm test` **4/4** · 门禁 **OK**

## 1. 主表（成本 · 会话轮次 · 上下文）

| 指标 | Nudo (sn0) | TypeScript (sn1) | Δ (TS−Nudo) |
|------|------------|------------------|-------------|
| **tokenIn** | 20392 | 33165 | 12773 |
| **tokenOut** | 3464 | 3030 | -434 |
| **tokenTotal** | **23856** | **36195** | 12339 |
| **rounds** | **7** | **8** | 1 |
| toolCalls | 14 | 11 | -3 |
| ctxAvg | 23686 | 23090 | -596 |
| **ctxPeak** | 25894 | 25104 | -790 |
| **acceptance** | 4/4 | 4/4 | 0 |
| **bugCount** | 0 | 0 | 0 |

**读法（本轮 seed）：** 两侧都做对了；**Nudo 总 token 更少**（23856 vs 36195，约 34% 节省），轮次略少；ctxPeak 接近。TS 侧 tokenIn 更高 = 单轮上下文更肥。

### 1.1 数据完整性

- Nudo：`/var/folders/2d/97ysh5nn3pnb4gr6zq01k18m0000gp/T/prd-race-nudo-lmEIUh` · omp session 唯一源
- TypeScript：`/var/folders/2d/97ysh5nn3pnb4gr6zq01k18m0000gp/T/prd-race-typescript-TJCiGW`
- 另有一次 nudo seed 因超时截断（formatReceipt 未收尾），不计入主表。


### 1.2 Token 口径补充（session 复盘）

| 口径 | Nudo | TypeScript |
|------|------|------------|
| processed (uncached in + cacheRead) | **165,800** | 184,717 |
| cacheRead | 145,408 | 151,552 |
| nonMessage / 轮 | 15,921 | 15,921 |

Nudo 侧约 8k uncached 花在 CLI `--help` / `check --json` 探索后被取消（零产出）。详见 `TOKEN-ANALYSIS-NUDO.md`。

## 2. 轨迹摘要

| | Nudo | TypeScript |
|---|------|------------|
| 最终门禁 | OK (nudo check) | OK (tsc) |
| NOTES 踩坑 | floor 折扣 · DISCOUNT=实际减额 | floor 顺序 · max(0,·) · 集中校验 |

## 3. AI 质量评审（单独一章 · 盲评）

> **评审模型**：`sn0/sensenova-6.8-flash-lite`（与 Nudo 跑手同账号；与 TS 跑手 `sn1` 不同号）  
> **协议**：只给 PRD + 量表 + 两段源码（`impl-a` / `impl-b`）；**无** token / 轮次 / 选手名 / §1 主表。  
> **揭盲**（评审后）：**impl-a = Nudo** · **impl-b = TypeScript**  
> 原始 JSON：`benchmark/prd-race/out/AI-QUALITY-REVIEW.json`

### 3.1 分项（1–5；过度设计为扣分项，越低越好）

| 子项 | impl-a **(Nudo)** | impl-b **(TypeScript)** | 证据（摘） |
|------|-------------------|-------------------------|------------|
| 正确性 | **4** | **4** | 两例小票逐字节一致；同缺口：subtotal 未校验 NaN/Infinity |
| 契约清晰度 | **5** | **4** | A：TypeError/RangeError 分工 + JSDoc `@throws`；B：interface/判别联合，运行时约束藏在 `invalidItem` |
| 可维护性 | **4** | **4** | A 校验/计算/格式分函数；B 单谓词紧凑但与 PRD 表阅读方向相反 |
| **错误面可修性** | **5** | **2** | A：`item.qty must be an integer`、`coupon.off must be an integer in [1, 100]`；B：一律 `invalid line item` / `invalid coupon` |
| 过度设计（扣分） | 1 | 1 | 两侧均无多余抽象 |

### 3.2 总评（评审模型）

两侧正确性并列 4（示例逐字节一致）；可维护性并列 4。契约清晰度 A 略高。**决定性差距是错误面可修性（5 vs 2）**：调用方仅凭 A 的报错即可改值；B 要加调试才知道哪条约束炸了。

### 3.3 若只留一套

**选择：impl-a（揭盲后 = Nudo）**  
**理由：** 在正确性/维护性打平的前提下，错误面可修性 5 vs 2——A 的诊断直接给出字段与规则，B 的 `invalid line item` 对 agent/人都接近不可行动。

### 3.4 诚实边界

- 评审与 Nudo 跑手同为 `sn0` 账号（同权重，非独立第三方模型）。  
- PRD/文件头含少量工具名痕迹；评审输出仍严格 `impl-a/b`，keepOne=**a**。  
- 单 seed（nudo seed2 / ts seed1）；截断的 nudo seed 不在主表。

## 4. 复现

```bash
node benchmark/prd-race/harness/run.mjs --side nudo --seed 2
node benchmark/prd-race/harness/run.mjs --side typescript --seed 1
```
