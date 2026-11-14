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

## 最近一次（2026-11-13，本机，--mode both，dist 为 ABS 性能改动后重建产物）

```
tsx:  fix-callsite   fixRate=1  timeToGreen≈2253ms（red 1217ms + fix 1036ms）
tsx:  relax-contract fixRate=1  timeToGreen≈2115ms（red 1081ms + fix 1034ms）
dist: fix-callsite   fixRate=1  timeToGreen≈376ms （red 209ms + fix 167ms）
dist: relax-contract fixRate=1  timeToGreen≈371ms （red 195ms + fix 175ms）
fix-rate: 100%（4/4：两口径 × 两场景）
tsx avg 2184ms / max 2253ms · dist avg 374ms / max 376ms
```

- **用户口径（dist）达标且余量很大**：avg 374ms，对 rev 5 的 2000ms 目标有 **5.3×** 余量。
- **开发回路（tsx）仍由进程冷启动主导**：2184ms 略超 2s（+9%），而 red/fix 各约 1.0–1.2s ≈ 两次
  tsx 冷启动 ⇒ 与引擎分析无关（同场景 dist 单次仅 0.2s）。这与「杠杆在常驻面而非把单次调快」的
  判断一致，见 `docs/design/persistent-cache.md`。
- 与 2026-11-04（tsx 2637 / dist 543）的差异是**机器与代码版本共同作用**，跨机器只钉 fix-rate。

## 常驻口径（watch 编辑回路，2026-11-13 新增）

`dx-metrics` 测的是「每次新起一个 CLI 进程」；真实编辑循环走 `check --watch`，进程不重启、
只重算脏集。用 `scripts/edit-loop-metrics.mjs` 测「保存 → 结果刷新」，并拆成两段：

- `debounce` = 写入 → `incremental` banner（**200ms 去抖** + fs 事件调度，见 `shared.ts`）
- `analyze` = `incremental` → `Watching again`（真实增量重算）

dist 口径、干净 `NODE_OPTIONS`、`benchmark/lsp-rounds/starters-oss-semver` 语料：

| 语料 | 被改文件 | debounce | analyze | total |
|---|---|---|---:|---:|---:|
| 单文件 probe | 唯一文件 | 222ms | ~16ms | **~238ms** |
| semver 48 文件 | `lib/index.js`（零扇入） | 221ms | 531ms | **752ms** |
| semver 48 文件 | `lib/ranges/gtr.js`（扇入 3） | 224ms | 620ms | **844ms** |
| semver 48 文件 | `lib/classes/comparator.js` | 222ms | 2223ms | **2445ms** |
| semver 96 文件 | 同上 | 234ms | 2289ms | **2523ms** |

结论：

- **典型编辑（leaf / 低扇入）0.75–0.85s，达标**；**核心文件 2.4–2.5s，超 2s 目标约 20%**。
- 48 与 96 文件的 `analyze` 几乎相同（2223 vs 2289ms）⇒ **与语料总量无关**，由被改文件的
  **依赖链**决定。同一 harness 下「新起进程跑一次 dist check」只要 376ms ⇒ 在最坏路径上
  **常驻复用是负收益**，这是接下来唯一值得动的性能点（不在本报告结论内，见 plan §5）。
- 测量必须避开一个已知窗口：`Watching for changes...` 打印后该轮还有 `buildModuleGraph()`
  未完成，而 `recordVersions()` 在其后才记录指纹基线；在此窗口内写入会被判「未变」而吞掉
  （探针用 `--settle 800` 主动避让）。这是**产品行为缺陷**，不是探针问题：`--settle 0` 时
  **3 轮只有 1 轮触发重算**，`--settle 800` 时 4/4 全部触发。已记入 plan §5 `ABS-18`。

### 增量轮分相（2026-11-13 步骤 0）

`NUDO_WATCH_PROFILE=1`（或 `edit-loop-metrics.mjs --profile`）让 watch 进程把增量轮拆相打到
stderr（默认零输出）。同一语料同一目标（本机、dist、干净 `NODE_OPTIONS`，3 轮）：

| 目标 | dirty | getFiles | dirtyCalc | evict | analyzeSum | graph | round |
|---|---:|---:|---:|---:|---:|---:|---:|
| `lib/classes/comparator.js` | 17 | 7.4–8.4 | 0.4–1.3 | 0.2–0.7 | 3317–3324 | 14.2–14.7 | 3341–3350 |
| `lib/ranges/gtr.js` | 3 | 7.7–8.3 | 0.4–1.3 | 0.2–0.6 | 1020–1026 | 15.0–17.5 | 1044–1053 |
| 冷启动（48 文件） | 48 | — | — | — | 4733–4788 | 12.5–12.7 | 4759–4814 |

逐文件（hub 轮）：`classes/range.js` **~820ms**、`test/acceptance.test.js` **~425–461ms**、
`ranges/subset.js` ~231–236ms、`lib/index.js` ~181–225ms，其余 13 个 ~100–140ms；
leaf 轮三文件：`acceptance.test.js` ~464–488ms、`lib/index.js` ~263–277ms、`gtr` 自身 ~249–293ms。

⇒ 增量延迟 ≈ **逐文件 `runCheck` 之和**：`buildModuleGraph` 全量重建 14–18ms、`evictForDependents`
<1ms ⇒ **图增量化没有价值**（上限 ~0.5%）。按签名/导出面跳过 dependents **不 sound**
（dependent 的 `call@` 结果内联 callee 求值行为），且四层缓存都已把依赖内容纳入键 ⇒
语义编辑必须重算；缩短延迟只能靠降单文件分析成本（`ABS-17`）或 worker 并行（`ABS-16` ③），
不是 watch 逐出粒度。上一条「唯一值得动的性能点」按此订正。

**ABS-18 交付后（2026-11-13）**：三件事叠加 —— ① 依赖内容按 `stableAnalyzeKeySource`
投影进指纹；② 增量轮只逐出被改文件（dependents 靠指纹自然 miss/命中）；③ watch 会话内
**复用注入对象**（键 = 分析输入身份）+ **轮内依赖指纹 memo**（同一入口每轮只读一次盘）：

| 目标 | analyze 改前 | ①+② 后 | ③ 后 | ④ gating 复用后 | 单文件探针 |
|---|---:|---:|---:|---:|---|
| hub `classes/comparator.js` | 3313ms | 2597ms | 718ms | **456–473ms** | `analyzeFileAsync` warm hit 9.1ms；inert dep 编辑 + 只逐出被改文件 9.9ms；语义编辑 172ms（正确 miss） |
| leaf `ranges/gtr.js` | 1009ms | 875ms | 345ms | **210ms** | dependents 命中 |
| hub **total**（含 210ms debounce） | 3524ms | 2808ms | 929ms | **667–684ms** | — |

④ = `checkSource` 的 gated 依赖指纹在没有侧车被 gating 剪掉时直接复用轮内 ungated 指纹
（`loaderIdentity` 让 per-call guard/缓存包装参与 memo）；逐文件段耗时变为
注入键 0.1ms + analyze 0.4–0.8ms + checkSource 0.3–3.8ms。

**语义编辑（2026-11-13 实测）**：把「追加尾部注释」换成「追加一条真实导出」后，hub 轮的
整条依赖链键全部翻转：**analyze 1995ms / total 2205ms**（3 轮 1.9–2.0s）；子进程
`/proc/<pid>/stat` 的 CPU/wall ≈ **1.10–1.28** ⇒ CPU-bound（不是 I/O），且 17 个文件彼此独立
⇒ 这是 worker 并行（`ABS-16` ③）唯一还有理论收益的场景；是否值得 L 级架构成本仍待拍板。

### worker 并行可行性 spike（2026-11-13，纯测量）

问：语义编辑的整链重算（17 文件 / ~2s）是否值得 `ABS-16` ③（worker 并行）。数据：

- 逐文件 warm 耗时（真实 watch 增量轮，`[watch-profile]`）：**69–378ms**；
  top：`classes/range.js` **378**、`ranges/simplify.js` 148、`ranges/subset.js` 130、
  `test/acceptance.test.js` 127、`lib/index.js` 126、`classes/comparator.js` 124，其余 ≤99。
  串行 `analyze` = 1908ms；进程 CPU/wall **1.10–1.28** ⇒ CPU-bound。
- **冷态单价**（新进程单文件 `check` 减 242ms 基线）：`range.js` 1475ms（warm 378，**3.9×**）、
  `comparator.js` 307（2.5×）、`ranges/gtr.js` 386（4.7×）、`lib/index.js` 512（4.1×）
  ⇒ 当前单价里约 **60–80% 来自共享热缓存**（模块图 / eval / abs-module / 注入）。
- LPT 估算（按 warm 单价、假设完美共享）：W=2 **983ms** / W=4 **487ms** / W=8 **378ms**
  （下限 = 最大单文件）；若按 cold×3（无共享缓存）计：W=4 1461ms / W=8 1134ms。

⇒ 收益上限存在（W=4 约 0.5s），但前提是**每个 worker 跨轮持有自己的热缓存**，否则首轮有
3–5× 惩罚；随之而来的是模块图/缓存的 N 份复制、逐轮失效同步与 worker 生命周期/取消/输出
契约的复杂度。当前 inert 编辑 0.67s、语义编辑 2.2s，**暂不立项**；触发条件：
真实用户仓库的语义编辑轮 >3s，或出现第二个需要并行分析的消费者（LSP 批量校验）。

**语义编辑自动化复测（2026-11-14）**：`scripts/edit-loop-metrics.mjs --semantic`
（新旗标）让脚本按语义编辑驱动——每轮追加一条真实 `export const` 而非注释，
结束时还原。默认语料 48 文件 / hub `classes/comparator.js`：debounce **211ms** ·
analyze **2002ms** · total **2213ms**（3/3 轮）。仍低于 3s 触发线 ⇒ `ABS-16` ③
继续 parked；复测命令：
`pnpm run edit-loop-metrics -- --semantic --rounds 3 --profile`。


**剩余成本**：`[check-profile]` 逐文件显示注入键 **0.1ms** + `analyzeFileAsync` **0.4–0.8ms** +
`checkSource` **0.3–3.8ms**；每文件 12–39ms 的差额主要是 `loadCheckCache`（配置/磁盘缓存装配）
与报告渲染/打印。被改文件自身仍是全量重算（~170ms）。

## 最近一次（历史）（2026-11-04，--mode both，dist 为引擎债修复波后全仓重建产物）

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
| `dx-metrics` | **看到红 → 修绿** 要多久、文档路径是否闭环（每步新起进程） |
| `edit-loop-metrics` | **保存 → 结果刷新** 要多久（`check --watch` 常驻，只重算脏集） |

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
node scripts/edit-loop-metrics.mjs --rounds 3                        # 常驻口径（watch 编辑回路）
node scripts/edit-loop-metrics.mjs --target <file> --rounds 3        # 指定编辑对象（如 hub 文件）
# 若要同步本报告数字：更新上方「最近一次」小节的实测值
```

`edit-loop-metrics.mjs` 用追加注释的方式驱动「文件变了」（语义与错误面都不变），
结束时**还原语料**；`--keep` 保留改动、`--cpu-prof-dir <dir>` 采集 watch 进程栈、
`--settle <ms>` 调整轮次间隔（默认 800，用于避开上面那个 `recordVersions` 窗口）。
