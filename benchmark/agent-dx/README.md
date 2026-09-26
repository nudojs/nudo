# Agent DX 对比评测（Nudo vs TypeScript）

**客观指标**，不比「感觉」：**diagTokens · rounds · bugsOpen · silentGreen**。

```bash
node benchmark/agent-dx/run.mjs          # 表格
node benchmark/agent-dx/run.mjs --json   # JSON
```

## 指标定义

| 指标 | 定义 |
|------|------|
| **detectRate** | bug 在门禁上是红的比例（被看见） |
| **silentGreen** | 门禁 exit 0 但**逻辑 bug 仍在**（假绿，bug 出货） |
| **wrongFixGreen** | 「常见错误修法」后门禁变绿（可作弊） |
| **diagTokens** | **仅当门禁报红时**，首个红载荷近似 token（`chars/4`） |
| **rounds** | **文档修法**上的门禁次数 |

每题同一逻辑 bug 的一对夹具：

- `nudo/` — JS + sidecar/refine，`npx nudojs check`
- `ts/` — TS 注解，`pnpm exec tsc --noEmit`

## 题表（5 题）

| # | Bug | 典型错误修法（测 wrongFixGreen） |
|---|-----|----------------------------------|
| 01 | `setDelay(0)` 但约定 `ms > 0` | 只放宽契约为 `number()` |
| 02 | 对象缺 `name` 字段 | 只把 shape 放成 `{}` / 可选 |
| 03 | 赋值丢掉 `port` | 把 `config` 标成 `any` |
| 04 | 入口读 `user.name` 可能炸 | 只加 `!` / 塞个假调用 |
| 05 | 返回约定 `> 0` 却 `return 0` | 只把返回改成 `number()` |

## 最近一次（2026-09-23，本机）

```
task                | detect n/ts | diagTok n/ts (when fired) | wrongFixGreen n/ts | rounds n/ts
01-constraint       | RED/SG      | 101/0                     | true/true          | 1/0
02-shape            | RED/RED     | 96/58                     | true/true          | 1/1
03-assign           | RED/RED     | 98/44                     | false/true         | 1/1
04-entry-throws     | RED/SG      | 124/0                     | false/true         | 1/0
05-return           | RED/SG      | 96/0                      | true/true          | 1/0

detectRate    nudo=5/5   ts=2/5
silentGreen   nudo=0/5   ts=3/5   ← TS 三题假绿
wrongFixGreen nudo=3/5   ts=5/5
avgDiagTokens (detected) nudo=103  ts=51
avgRounds     (detected) nudo=1    ts=1
```

**读法：** TS 的 0 token 往往是 **SG 沉默**——agent 根本看不见 bug；Nudo 多付的是**看见**的 token。

## 与其它套件的分工

| 套件 | 问 |
|------|----|
| `pnpm run agent-eval` | Nudo 自身 10 题红→绿是否 100% |
| `pnpm run agent-dx` | **Nudo vs TS 同 bug 对照**（本项目） |
| `pnpm run dx-metrics` | fix-rate / time-to-green 运营基线 |

## 诚实边界

- 本跑台量的是**检出/假绿/错误修法/诊断载荷/文档路径闭环**，不是完整 LLM agent 轨迹；接真 agent 时在此基础上加轮次 / token 账单即可。
- `tsc` 不报约束 bug 时 `silentGreen=true` —— 这是产品论点，不是作弊：夹具逻辑 bug 在两侧相同。
- `wrongFixGreen` 对 Nudo 也非 0（放宽契约可「作弊」）——契约是产品决定，门禁不能猜意图。

