# DX 运营指标基线（C4）

> 内部基线，**不是 CI 门禁**。与 `scripts/learning-cost.mjs` 同级。  
> 运行：`pnpm run dx-metrics` · `pnpm run dx-metrics -- --json` · `pnpm run dx-metrics -- --mode tsx|dist|both`（默认 both）

## 度量什么

| 指标 | 定义 | 目标（rev 5） |
|------|------|----------------|
| **fix-rate** | 按错误面文档路径修完后 check 变绿的比例 | **100%**（文档路径必须可走通） |
| **time-to-green** | 红 → 修 → 绿 的墙钟 | **avg &lt; 2s**（tsx 口径；dist 口径本机 ≈0.55s） |

## 场景

1. **fix-callsite** — `setDelay(0)` ⊭ `ms>0` → 改调用点 `setDelay(250)`  
2. **relax-contract** — 同上 → 侧车 `number().ge(0)`（错误面 “or relax the precondition”）

每条违例的 `fix: nudo contract --draft` / `→ use a value satisfying …` 是 fix-rate 的「文档路径」。若某条路径走不通，fix-rate &lt; 100% = 文档或诊断建议有洞。

## 双口径（--mode）

同一套场景、两种 CLI 传输，回答两个不同问题：

| 口径 | 命令 | 回答 |
|------|------|------|
| `tsx` | `pnpm exec tsx packages/nudojs/src/index.ts check …` | **开发回路**要多久（贡献者日常口径；tsx 冷启动主导，单次 check ≈1.3–1.5s） |
| `dist` | `node packages/nudojs/dist/index.js check …` | **用户口径**要多久（构建产物直跑，跳过 tsx 冷启动，单次 check ≈0.28s） |
| `both`（默认） | 先 tsx 后 dist | 两个都测；fix-rate 聚合覆盖**所有实际执行的口径**——dist &lt;1 = src↔构建产物 drift 信号 |

**dist honest skip**：`packages/nudojs/dist/index.js` 缺失时默认 `both` 只跑 tsx，dist 行/字段如实标注
“skipped — … run `pnpm run build` first”，不伪造数字，退出码只由实际执行的样本决定；
显式 `--mode dist` 在 dist 缺失时直接报错退出（无法测量，不假绿）。

## 最近一次（2026-11-04，本机，--mode both，dist 为引擎债修复波后全仓重建产物）

```
tsx:  fix-callsite   fixRate=1  timeToGreen≈2637ms avg / 2644ms max（单次 check ≈1.3s，tsx 冷启动主导）
tsx:  relax-contract fixRate=1
dist: fix-callsite   fixRate=1  timeToGreen≈543ms avg / 544ms max（单次 check ≈0.27s）
dist: relax-contract fixRate=1
fix-rate: 100%（4/4：两口径 × 两场景）
```

- dist 口径比 tsx **≈4.9×** 快（543ms vs 2637ms）——差距即 tsx 冷启动本身；rev 5 的
  「time-to-green &lt; 2s」目标在 dist 口径（用户实际调用形态）下达标，tsx 口径仍由冷启动主导（与 2026-11-03 单口径基线 2796/2940ms 一致）。
- 与 2026-09-23 基线（avg ≈1.8s）的差异是**机器因子**，非引擎回归；跨机器可钉的只有 fix-rate。

## 与 learning-cost 的分工

| 脚本 | 回答 |
|------|------|
| `learning-cost` | 新手 Day0→Day1 路径要多久 |
| `dx-metrics` | **看到红 → 修绿** 要多久、文档路径是否闭环 |

## 发布面（vs-typescript.md 生成块）

`--md` 输出带 `<!-- dx-metrics:begin/end -->` 标记的 markdown 块（生成日期、双口径模式表
`| mode | fix-rate | time-to-green avg | time-to-green max |` + tsx/dist 两行 + 目标行），
粘贴进 website 的 vs-typescript.md 性能节：

```bash
pnpm run dx-metrics -- --md --lang both   # 推荐：一次测量同时出 en+zh 两块（镜像同数字）
pnpm run dx-metrics -- --md               # 仅 en 块（docs/guides/vs-typescript.md）
pnpm run dx-metrics -- --md --lang zh     # 仅 zh 块（i18n/zh-Hans/…/guides/vs-typescript.md）
```

dist 缺失时块内 dist 行如实标 skipped（含原因与 `pnpm run build` 提示），秒位列为 `—`。

钉面：`packages/website/tests/dx-metrics-publication.test.ts` 实跑 `--json`（默认 both）后钉
**fix-rate（=1，跨机器可复现的主张，硬钉不放松；聚合覆盖所有实际执行口径，tsx 恒在场为 canonical 参照）、
双口径块结构**（标记对、日期、mode 列、tsx 行、dist 行、目标行、fix-rate 数值一致）与
**dist 行与实跑可用性一致**（执行 ⇒ 数值行含实跑 fix-rate；honest-skip ⇒ 如实标 skipped/跳过），
time-to-green 为**逐口径 sanity 上界（< 10s）**。time-to-green 秒数与 2s 目标
**不硬钉**——机器相关量（本机 tsx 冷启动 ≈1.3s/check、dist ≈0.28s/check，2026-09 基线机 ≈0.9s，CI runner
更慢），硬钉必在慢机器上假红（机器因子先例见 benchmark gate 的 `--allow-uniform-shift`），
且本脚本自身的 exit 分级也只把 fix-rate<1 当失败。实跑超 2s 目标时测试以 console.warn
给出「机器慢，非文档漂移」的可区分提示。改文档块后再生成 = 重跑该测试确认 fix-rate 仍复现。

## 主控重跑清单（统一重建 dist 后）

```bash
pnpm run build                                                      # 主控统一构建（本任务禁自行 build）
pnpm run dx-metrics                                                 # 双口径实测（tsx + dist，确认 fix-rate=1）
pnpm run dx-metrics -- --md --lang both                             # 再生 en+zh 同数字块，分别粘贴进
                                                                    #   packages/website/docs/guides/vs-typescript.md
                                                                    #   packages/website/i18n/zh-Hans/docusaurus-plugin-content-docs/current/guides/vs-typescript.md
pnpm vitest run packages/website/tests/dx-metrics-publication.test.ts   # 钉面复核
# 若要同步本报告数字：更新上方「最近一次」小节的实测值
```
