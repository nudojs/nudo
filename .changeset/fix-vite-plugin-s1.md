---
"vite-plugin-nudo": minor
---

fix(vite-plugin): 构建期分析面的「模块 id → 匹配」层归一化（896 / 902 / 903 / 1018 / 1056）

**BREAKING**: 项目相对 `include` / `exclude` 现在真的生效（Bug 1018）——
此前插件选项只按**绝对 module id** 匹配 ⇒ `exclude: ["other/**"]` 静默不生效、
`include: ["src/**"]` 静默把整份分析归零 ⇒ 「静默零分析」的工程此前**零诊断**。
现在选项与 `nudo.analysis.include` / `exclude` **同口径**（绝对路径 **或** 相对
`config.root` 的路径命中即算命中）⇒ 此前零分析的工程**开始产出诊断**，
`failOnError: true` 的构建会由绿变红。

谁会坏：依赖 0.5.x「静默零分析」的项目（把 `include` / `exclude` 当**装饰**用、
靠它压掉整片分析的构建流水线）；以及显式传了 `exclude` 却指望它只作用于项目内
路径的用法（依赖 / 软链依赖现在**一律排除**）。

怎么迁移：把 `include` / `exclude` 写成**字面语义**即可（相对 `config.root` 的 glob
现在与 `nudo.analysis.*` 同口径）；想继续「整片静音」请用
`nudo.analysis.diagnostics` 档位，而不是靠不生效的 glob。`vite-plugin-nudo` 仍是
**pre-1.0**（0.x）：本次按政策以 **minor** 发布（0.x 的 minor 可能含破坏性变更）。

- **Bug 896（虚拟模块）**：Vite 的虚拟模块 id（`\0` 前缀 / `virtual:` 前缀）
  被原样拼成侧车路径 ⇒ 路径含 NUL ⇒ 必读不到 ⇒ **干净模块被判 error**
  （`failOnError: true` 时抛错中断构建）。虚拟 id 现在在分析入口被**跳过**。

- **Bug 902（畸形入参）**：`transform(code = null)` 抛未捕获异常
  （`Cannot read properties of null (reading 'length')`，且异常在插件兜底
  `catch` 之外）。非字符串 `code` 现在被前置拦下，守卫调用也移进 `try`
  ⇒ 任何畸形入参都走「跳过」而不是抛给调用方。

- **Bug 903（HMR query）**：`?t=<timestamp>` / `?v=<hash>` 让 include 失配
  ⇒ 整份文件被跳过 ⇒ **dev 期诊断消失（假绿）**。匹配与分析现在统一用
  **剥掉 query 的 id**。

- **Bug 1018（相对 glob 失效）**：`include` / `exclude` **选项**此前只按
  **绝对 module id** 匹配 ⇒ 项目相对 glob（`other/**` / `src/**`）永不命中
  ⇒ 与**同名**的项目配置 `nudo.analysis.include` / `exclude` **判定相反**。
  选项现在与 `nudo.analysis.*` **同口径**：同时对「相对 `config.root` 的路径」
  与「绝对路径」求值。
  ⚠ **破坏性行为变更**：**项目相对 glob 现在生效** —— 此前
  `exclude: ["other/**"]` 静默不生效、`include: ["src/**"]` 静默把整份分析
  归零；现在两者都按字面语义执行。之前「静默零分析」的工程会开始产出诊断。

- **Bug 1056（软链依赖）**：默认排除的「node_modules 段」规则匹配不到
  **软链工作区依赖**的 realpath id ⇒ 别的包源码被当项目源码分析
  （Vite 红 / 同项目 `nudo check` 绿 ⇒ 跨面矛盾 + 假红）。排除判定前先把 id
  归一化成**依赖图视角** ⇒ 软链依赖与物理目录依赖一致地被排除。
  ⚠ **行为变更**：依赖（`node_modules` 段 / 软链依赖 / 工程根 `config.root`
  之外的路径）现在**一律排除**，即使用户显式传了自定义 `exclude`。
