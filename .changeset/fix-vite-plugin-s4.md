---
"vite-plugin-nudo": minor
---

fix(vite-plugin): 构建期分析面看到**原始 TS 源码**（895 / 900）+ 模块 id 归一化接线

**BREAKING**: 本版本一并生效的三处破坏性行为变化（详见下文
「**Breaking behavior changes（本版本一并生效）**」逐条说明）：

1. **899** —— `nudo.analysis.diagnostics: "off"` **不再抹掉契约门禁**：error 级的
   check 诊断在任何档位（含 `off`）都照常上报、照常拦构建 ⇒ 此前靠 `off` 拿到
   绿灯 CI 的流水线**由绿转红**。
2. **1002** —— `build.logLevel: "silent"` 下插件**什么都不输出**（含汇总行）
   ⇒ 依赖 `[nudo] Analysis complete: …` 这行做日志采集的脚本**取不到**该行。
3. **1018** —— 项目相对 glob 现在生效（`include` / `exclude` 同时对「相对
   `config.root` 的路径」与「绝对路径」求值）⇒ 此前「静默零分析」的工程
   **开始产出诊断**，`failOnError: true` 的构建**由绿转红**。

谁会坏：靠 `diagnostics: "off"` 换「构建期不拦契约」的流水线；依赖静默构建里
那行汇总做采集的脚本；把 `include` / `exclude` 当**装饰**用、靠它压掉整片分析的
工程。

怎么迁移：用 `build.logLevel: "silent"` + `failOnError: false` 换「构建期完全
安静」；`include` / `exclude` 改成**字面语义**（与 `nudo.analysis.*` 同口径）；
契约门禁在构建期生效是有意的 fail-closed 方向，保持现状即可。
`vite-plugin-nudo` 仍是 **pre-1.0**（0.x）：本次按政策以 **minor** 发布
（0.x 的 minor 可能含破坏性变更）。

**Fixes**

- **Bug 895（假红面）**：插件对象**缺** `enforce: "pre"` ⇒ 排在核心插件
  `vite:esbuild` **之后** ⇒ `transform` 收到的是 esbuild 的**转译产物**
  （TS loader 剥光注释）⇒ `.ts` 源里**只存在于注释**的 `@nudo:` 指令全部
  不可见 ⇒ 分析按「无指令普通模块」跑 ⇒ 报出 `nudo check` **不会**报的
  error（同一份文件：CLI 判 OK，`vite build` 红）。插件现在排在
  `vite:esbuild` **之前** ⇒ 看到**原始 TS 源码** ⇒ 指令可见 ⇒ 与 CLI 判同。

- **Bug 900（假绿面 · 895 的反方向）**：同一根因的另一面 —— `.ts` 源里的
  `@nudo:contract` / `@nudo:case` 被 esbuild 删光 ⇒ **门禁静默放绿**
  （同一份契约：`.js` 源报红，`.ts` 源**零诊断**）。修复后 `.ts` 源与 `.js`
  源的**诊断集合一致**。

- **模块 id 归一化接线**：分析 / 诊断一律用**剥掉 query**（`?t=` / `?v=`）
  的 module id ⇒ ① 诊断文本不再带 `?t=`；② `sidecarPathOf` 命中**真实
  侧车** ⇒ HMR 期侧车契约不再静默失效。

- **诊断行号回到源码坐标系**：`enforce: "pre"` 之后诊断行号从「转译产物
  坐标系」回到「**源码坐标系**」—— 这是**预期修复**（诊断**集合**不变，
  位置回到用户写代码的那份文件）。

- **TS 语法兜底**：`enforce: "pre"` ⇒ 插件看到含类型注解的原始 TS 源码 ⇒
  分析面必须吃得住 TS 语法。TS 特有语法（`interface` / 泛型 / `enum` /
  `namespace` / `as const` / `satisfies` / 抽象类 / 参数属性）照常解析；
  解析不了的语法（如装饰器）降级为一条 `Failed to analyze` warning ——
  **构建不炸**。

**Breaking behavior changes（本版本一并生效）**

- **899 —— `nudo.analysis.diagnostics: "off"` 不再抹掉契约门禁**。此前门禁
  诊断（L1 `nudo:constraint-violated` / L2 `nudo:entry-may-throw`）与
  evaluator 诊断合并后一起过滤 ⇒ `off` 项目**零诊断**、`failOnError: true`
  也**照样绿**（坏契约上的绿灯 CI）。现在门禁通道独立：**error 级的 check
  诊断在任何档位（含 `off`）都照常上报、照常拦构建**；显示通道
  （evaluator 诊断、path-env 失败、check 的 warning / info）保持原档位语义。

- **1002 —— `build.logLevel: "silent"` 下插件**什么都不输出**（含汇总行）**。
  汇总行此前走裸 `console.log`，逃出 Vite logger 的管辖 ⇒ 静默构建仍打印
  `[nudo] Analysis complete: N error(s), M warning(s)`，却看不到那 N 条诊断
  （只报数、不给理由）。现在汇总行走 Vite logger ⇒ 静默档下**连汇总行都没有**。

- **1018 —— 项目相对 glob 现在生效**。插件选项的 `include` / `exclude`
  此前只按**绝对 module id** 匹配 ⇒ 项目相对 glob（`other/**` / `src/**`）
  永不命中 ⇒ 与**同名**的项目配置 `nudo.analysis.include` / `exclude`
  **判定相反**。选项现在与 `nudo.analysis.*` **同口径**：同时对「相对
  `config.root` 的路径」与「绝对路径」求值。
  ⚠ **之前「静默零分析」的工程会开始产出诊断**（此前 `exclude: ["other/**"]`
  静默不生效、`include: ["src/**"]` 静默把整份分析归零）。
