# Analysis Scope Config — 分析范围与噪声档

> **状态**：A2 设计 + `analysisConfig()` / `shouldAnalyzeFile` + A1 LSP 接线已落地。
> **出厂默认 `mode = exports`**（`DEFAULT_ANALYSIS_MODE`，`packages/service/src/evaluator/config.ts`）：
> 含 `export` / 侧车 / `@nudo:` 指令的文件进 IDE 分析；**无 export、无侧车**的脚本仍需显式 `mode=all`。
> Escape hatch：`package.json#nudo.analysis.mode = "directives" | "exports" | "all"`。见 §8。
>
> **真理源关系**：配置入口沿用 `package.json#nudo`（不引入 `nudo.json`），
> 与 `nudo.interface.autoBind` 同源。见
> [`design-refine-derivation.md`](./design-refine-derivation.md) §2.2。

---

## 1. 问题

今日 LSP 用 `hasNudoDirectives` 门控：无 `@nudo:` 指令的文件**完全不分析**。
这与「零注解 call-site 推断」产品故事冲突（A1）。一旦默认打开无指令分析，
需要：

1. **范围**：哪些路径进引擎（include / exclude）
2. **噪声**：implicit 推断产生多少诊断
3. **与既有开关的关系**：`interface.autoBind` 管侧车 ambient，不管「分析谁」

---

## 2. 配置形状

```jsonc
// package.json
{
  "nudo": {
    "interface": { "autoBind": true, "emit": [] },
    "analysis": {
      // 路径（相对 projectDir；glob 与 emit 同极简实现）
      // include 空数组/省略 = 不按路径过滤（扩展名仍由 isNudoTargetPath 保证）
      "include": [],
      "exclude": ["**/node_modules/**", "**/dist/**", "**/coverage/**"],
      // 何时分析无指令文件
      // "directives" | "exports" | "all"
      //   directives — 仅含 @nudo: 指令（今日行为，默认过渡期）
      //   exports    — 有 top-level export 或同名 *.nudo.js 侧车
      //   all        — include 命中即分析（IDE 目标态）
      "mode": "directives",
      // implicit / 无契约诊断的噪声档
      // "off" | "errors" | "default" | "verbose"
      //   off      — 显示路径诊断全关（check 门禁仍独立执法）
      //   errors   — 高置信 error（契约 + assign + HOF）；warning/info 静音
      //   default  — errors + 已知 evaluator warning（推荐 all 模式默认）
      //   verbose  — 全量，含 unknown-recv 等（开发 Nudo 本身时用）
      "diagnostics": "default"
    }
  }
}
```

### 归一化类型

```ts
export type AnalysisMode = "directives" | "exports" | "all";
export type DiagnosticsLevel = "off" | "errors" | "default" | "verbose";

export type AnalysisConfig = {
  include: string[];
  exclude: string[];
  mode: AnalysisMode;
  diagnostics: DiagnosticsLevel;
};

export function analysisConfig(config: NudoConfig | null | undefined): AnalysisConfig
```

默认：

| 键 | 默认 | 理由 |
|---|---|---|
| `include` | `**/*.{js,mjs,cjs,ts}`（经 `isNudoTargetPath` 过滤后） | 与现 target 路径一致 |
| `exclude` | `node_modules` / `dist` / `coverage` | 安全默认；emitter 已拒绝 node_modules 侧车 |
| `mode` | `exports` | **出厂默认**（`DEFAULT_ANALYSIS_MODE`）：指令 \| export \| 同名侧车进分析。`directives` 回到保守门禁；`all` 覆盖全部目标路径 |
| `diagnostics` | `errors` for `mode=directives`；`default` for `mode=exports`/`all` | 打开无指令分析时避免刷屏 |

`findProjectConfig` 的「向上找带 `nudo` 键的 package.json」规则不变。

---

## 3. 判定管线

```
打开/编辑 .js
    │
    ├─ isNudoTargetPath?  ──no──► 忽略
    │
    ├─ analysis.exclude 命中? ──yes──► 忽略
    │
    ├─ analysis.include 未命中? ──yes──► 忽略
    │
    └─ mode
         directives → hasNudoDirectives(source)   // 今日
         exports    → hasNudoDirectives || hasSidecar || hasExport
         all        → true
    │
    ▼
  analyze + publish diagnostics（按 diagnostics 档过滤）
```

### 诊断过滤（LSP / CLI 可共用）

| 档 | 发布 |
|---|---|
| `off` | 显示路径诊断过滤为空（含 contract error）；`nudo check` 门禁独立、不受影响 |

> C0.5（可选）：`nudo.analysis.evalMissingSlot` 默认 `off`；开启后仅对**求值命中**的已知对象缺字段发 `nudo:missing-slot` warning。禁止 body AST 预扫描。见 `design-eval-missing-slot.md`。草稿产品路径：`nudo interface --draft` / CodeLens `⚡ draft interface`。
| `errors` | severity=error 的 check 码 + 高置信 evaluator error |
| `default` | errors + 已收录 warning（排除 `unknown-recv` 类） |
| `verbose` | 全部 |

**不按码名白名单维护第二份清单**：优先在 Diagnostic 上加 `confidence` 或复用
severity；过滤在发布层做，不进 core 求值。

---

## 4. 与既有配置的关系

| 键 | 管什么 | 不管什么 |
|---|---|---|
| `nudo.interface.autoBind` | 侧车 ambient 执行 | 是否分析该文件 |
| `nudo.interface.emit` | emit 写盘白名单 | 分析范围 |
| `nudo.analysis.*` | **是否分析 + 诊断噪声** | 契约语义 |

CLI `nudo check <file>` / `nudo infer <file>` **显式路径始终分析**，
不受 `mode=directives` 限制（用户点名即意图）。`analysis.mode` 主要约束
**IDE 全工作区/自动验证** 与 **watch 扫描**。

---

## 5. CLI / watch / Vite

| 入口 | include/exclude | mode |
|---|---|---|
| `nudo check path` | 忽略（点名路径） | 忽略 |
| `nudo watch src` | 应用 include/exclude | **不**应用 mode（与 CLI 目标扫描同规则；mode 只约束 IDE `shouldAnalyzeFile`） |
| vite-plugin | 应用 include/exclude | 应用 mode；`failOnError` 仍看 severity |
| LSP validate | 应用 | 应用；默认档从 config 读 |

---

## 6. 迁移

1. **Phase A2 实现**：`analysisConfig()` + 解析 + 测试。
2. **A1**：LSP `isNudoFile` → `shouldAnalyzeFile(mode)`；文档按 mode 描述文件检测。
3. **默认切换（已落地）**：出厂 `mode=exports` + `diagnostics=default`。**1.x 发布须在 changeset/release notes 写明 intentional default flip**（见 `docs/versioning.md`）；回退配置 `"mode": "directives"`。

---

## 7. 非目标

- 不做独立 `.nudorc` / `nudo.config.js`
- 不在 analysis 里配 refine 语义
- 不用 analysis 绕过 `node_modules` 侧车禁令

---

## 8. 验收（A2 + A1 现状）

A2（`analysisConfig()` 归一化）与 A1（默认 `mode=exports`）均已落地：

- [x] `analysisConfig(undefined)` 返回上表默认（`mode: "exports"`、`evalMissingSlot: "off"`、`callSiteBudget: 3`）
- [x] `package.json#nudo.analysis` 解析与非法值回落（`service/evaluator/config.ts`）
- [x] include/exclude glob（`matchesEmitAllowlist` 同源 glob 实现；`shouldAnalyzeFile` 消费）
- [x] `mode=directives` / `exports` / `all`：`shouldAnalyzeFile` 单测覆盖（`analysis-scope.test.ts`）
- [x] **A1（exports 默认）**：不配 `package.json` 时，带 `export` / 侧车 / `@nudo:` 的 `.js` 进 IDE 分析
- [x] **A1 边界（有意）**：无 export、无侧车、无指令的脚本默认不分析——需 `mode=all`；CLI 点名路径不受 mode 限制
