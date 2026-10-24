---
"vite-plugin-nudo": minor
---

**BREAKING**: `nudo.analysis.include` 的**字面量条目**现在真的命中
（Bug 1018 同族）——此前不带通配符的条目**永不匹配** ⇒ 整份 allowlist 被
**静默忽略** ⇒ 该工程此前**零诊断**；现在字面条目按路径命中（该文件或该目录）
⇒ 此前零分析的工程**开始产出诊断**，`failOnError: true` 的构建会由绿变红。
env 加载失败（缺文件 / 未知 env 名 / 未导出 `defineEnv()`）此前**完全静默**
⇒ 受影响代码被当成「env 不存在」分析；现在会报出来。

谁会坏：依赖 0.5.x「静默零分析」的项目（把 `nudo.analysis.include` 当**装饰**用、
靠它压掉整片分析的构建流水线）；以及依赖「env 加载失败不阻断构建」的流水线。

怎么迁移：把 `nudo.analysis.include` 写成**字面语义**即可；想继续「整片静音」
请用 `nudo.analysis.diagnostics` 档位，而不是靠不生效的 allowlist。
`vite-plugin-nudo` 仍是 **pre-1.0**（0.x）：本次按政策以 **minor** 发布
（0.x 的 minor 可能含破坏性变更）。

The build plugin reports the env failures it used to drop.

- A path env file that failed to load — a missing file, an unknown env name,
  a file that does not export a `defineEnv()` function — produced no
  diagnostic during a build, so the affected code was analyzed as if the env
  did not exist. The failure is reported now.

- A `nudo.analysis.include` entry without a wildcard never matched, so the
  whole allowlist was silently ignored. A literal entry is matched as a path
  now: it names that file, or that directory.
