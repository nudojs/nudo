---
slug: /guides/coexistence
description: JS 用 Nudo、TS 包继续用 tsc——同一 monorepo 里互不打架的配方。
---

# 与 TypeScript 共存

Nudo 与 `tsc` 可以共享仓库。Nudo 面向 **JavaScript**（以及剥掉类型标注后的 `.ts` 源码）；它不替代 `.ts` 优先包上的 TypeScript 编译器。

## 配方 1：JS 包用 Nudo，TS 包用 tsc

```
apps/
  web/          # TypeScript → tsc / ts-node
packages/
  legacy-js/    # 纯 .js → nudo check + Nudo LSP
```

`packages/legacy-js/package.json`：

```json
{
  "nudo": {
    "contract": { "autoBind": true },
    "analysis": { "mode": "exports", "diagnostics": "default" }
  }
}
```

该包的 CI：

```bash
npx nudojs check packages/legacy-js/src
```

**不要**对 `apps/web/**/*.ts` 跑 `nudo check`，除非你有意剥类型分析。

## 配方 2：仅对 `src/**/*.js` 开 Nudo

混合 JS/TS monorepo 的**推荐** `package.json#nudo.analysis`（与 [LSP 客户端矩阵](./lsp-clients.md)同一配方）：

```json
{
  "nudo": {
    "analysis": {
      "include": ["src/**/*.js"],
      "exclude": [
        "**/node_modules/**",
        "**/dist/**",
        "**/coverage/**",
        "**/*.ts",
        "**/*.tsx",
        "**/*.d.ts"
      ],
      "mode": "exports",
      "diagnostics": "default"
    }
  }
}
```

各键的作用：

| 键 | 在混合仓里的作用 |
|----|------------------|
| `include` | 相对项目根的路径白名单。空（默认）= 所有目标路径都可分析；混合仓**务必收窄**，让 tsserver 独占 `.ts`。 |
| `exclude` | 始终保留 `node_modules` / `dist` / `coverage`。再加 `**/*.ts` / `**/*.tsx` / `**/*.d.ts`，避免打开 TS buffer 时触发 Nudo 分析。 |
| `mode` | `exports`（出厂默认）分析含 export / 侧车 / 指令的 JS。见下文「directives vs exports」。 |
| `diagnostics` | IDE 展示档：`default` = error + warning（静音噪声码）；`errors` = 仅 error；`verbose` = 全部诊断不过滤；`off` 静音 IDE 展示路径（CLI `nudo check` 仍执法）。 |

`.ts` 文件交给 tsc。Nudo LSP 仍会对匹配 `include` 且 `analysis.mode` 为 `exports` / `all` 的已打开 `.js` 文件提供 hover/inlay。

> **默认注意**：`nudo.analysis.mode` 出厂默认为 `exports`（含 `export` / 侧车 / 指令的文件进引擎）；`all` 可全量分析，`directives` 可回到保守门禁。具名路径的 CLI（`nudo check src/lib.js`）不受 mode 限制。

### 何时用 `mode=directives` vs `mode=exports`

| 场景 | 推荐 mode | 原因 |
|------|-----------|------|
| 混合仓日常 IDE；JS 包由 Nudo 负责 | `"exports"`（默认） | 带导出的模块进入分析；无 export 的辅助脚本保持安静。 |
| 大 JS 树初次接入，只要已经写了 Nudo 指令的文件 | `"directives"` | 仅含 `@nudo:*` 的文件（及 check 侧车路径）出 IDE 诊断；噪声最低。 |
| CI / 脚本要覆盖所有 JS 目标路径 | `"all"`（CLI/watch 多于 IDE） | 所有 `.js`/`.mjs`/`.ts` 目标路径都分析；请配紧 `include`。 |
| 需要 hover 非 export 内部符号但不想看诊断 | 保持 `"exports"` + 局部 `diagnostics: "off"`，或用具名路径 CLI | 展示层 `off` 不会关闭 `nudo check`。 |

## 配方 3：渐进契约

1. 先观察——`nudo check` / `nudo test`，不需要指令。
2. 某个函数需要 CI 门禁时，在旁边加一个 `<file>.nudo.js` 侧车。
3. `nudo check` 只执法**手写**侧车；`@generated` 段是事实 + drift，不产生新义务。

## 配方：混合 JS/TS monorepo（避免双重错误风暴） {#recipe-mixed-js-ts-no-double-error-storm}

「打开 monorepo 后 tsserver 和 Nudo 一起吼」的分步处理：

1. **确认职责切分。** TypeScript 管 `.ts`/`.tsx`；Nudo 管 JS 目标（`.js`/`.mjs`；仅在有意分析时才碰剥类型后的 `.ts`）。
2. **收窄 JS 包**：在关心的 JS 所在的**包**里写配方 2 的 `include`/`exclude`（引擎向上查找时，最近的带 `nudo` 键的 `package.json` 生效）。
3. **大树可先保守。** 临时 `"mode": "directives"`，只有已标注文件亮灯；include/exclude 确认无误后再切回 `"exports"`。
4. **Reload 窗口**（VS Code：*Developer: Reload Window*），让 language server 重新读 `package.json#nudo.analysis`。watcher 通常也会跟进 `package.json` 变更，但 reload 最稳。
5. **打开一个已知正常的 JS 文件**（`exports` 模式下含 `export`，或含 `@nudo:*`）。应只看到该文件的 Nudo 诊断，而不是旁边 `.ts` 上 tsserver 错误的第二份拷贝。
6. **再打开旁边的 `.ts`。** 应由 tsserver 报告；若 exclude 覆盖 `**/*.ts`（或未命中 include），Nudo 应保持安静。若 Nudo 仍在分析 TS，说明 `exclude`/`include` 没落到真正带 `nudo` 键的包上。
7. **同一行 JS 若仍出现重复信息**，通常是*不同工具*（tsserver `checkJs` vs Nudo）。可关掉该包的 `checkJs`，或让 Nudo 保持 `mode=directives` / `diagnostics=errors`，使 Nudo 只做窄契约通道而不是第二套 checker。
8. **可选静音：** 对噪声包设 `"diagnostics": "errors"` 或 `"off"`；契约就绪后再按包打开。

客户端矩阵中指向本节的 Known gaps 行：[lsp-clients.md](./lsp-clients.md) —「次要 server 诊断可能与 tsserver 噪声叠加」。

## 不要做的事

- 不要指望 Nudo 理解 TypeScript 类型语法（条件类型、`infer` 等）。
- 不要让两个工具在冲突严重级别下扫同一 `.ts` 源——请拆路径。
- 不要把 `.d.ts` 投影（`nudo export --format dts`）当真理源——Abs 才是；`.d.ts` 是单向兼容通道。
- 不要在没有 `include` 的混合 monorepo 上对 IDE 开 `mode: "all"`——双重错误风暴多半由此而来。

## IDE

在已有 TS server 旁安装 Nudo VS Code 扩展即可共存：TS 处理 `.ts`，Nudo 按 `nudo.analysis.mode` 分析 `.js`。

> **默认注意**：`analysis.mode` 出厂默认为 `exports`（含 `export` / 侧车 / 指令的文件进引擎）；`all` 可全量分析，`directives` 可回到保守门禁。

维护者打包 / 发布说明清单：[`packages/vscode/RELEASE_CHECKLIST.md`](https://github.com/nudojs/nudo/blob/main/packages/vscode/RELEASE_CHECKLIST.md)。LSP 公开面：[`packages/lsp/PUBLIC_API.md`](https://github.com/nudojs/nudo/blob/main/packages/lsp/PUBLIC_API.md)。

## 参见

- [LSP 客户端矩阵](./lsp-clients.md) — 非 VS Code 配方 + Known gaps 跟踪
- [VS Code 扩展](./vscode.md)
- [版本与发布](./versioning.md) — 会「制造诊断」的默认值翻转在 1.x 上是 major
