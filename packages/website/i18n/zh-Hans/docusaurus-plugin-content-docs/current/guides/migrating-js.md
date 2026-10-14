---
description: "把已有 JavaScript 包迁到 Nudo：从逻辑生成契约草稿 → 审阅 → 落盘 → check/health 门禁。"
---

# 迁移已有 JS

Nudo **不要求**先写注解。迁移路径是**代码优先**：保留实现，生成可审阅契约，人工收紧，再进 CI。

```text
既有 JS  →  contract --draft  →  人工审阅  →  *.nudo.js  →  check / health / IDE
```

## 0. 前置

```bash
pnpm add -D nudojs @nudojs/lsp
# package.json 可选配置
{
  "nudo": {
    "analysis": { "mode": "exports", "diagnostics": "default", "evalMissingSlot": "off" },
    "contract": { "autoBind": true }
  }
}
```

仓库已有 `tsc` 时见 [与 TypeScript 并存](./coexistence.md)。

## 1. 盘点

```bash
nudo contract src/
nudo check src/
```

`contract` 打印每个顶层导出及其档位；`check` 打印签名（含 L2 入口抛错）。

三档：`handwritten`（已接受的侧车 / `@nudo:contract` —— 由 `check` 执法）、`generated`（固化进 `@generated` 的调用点快照 —— 用法变化时用 `--emit` 刷新）、`implicit`（仅推断展示 —— 你的**草稿候选**）。完整档位表见 [nudo contract](./contract.md#layers)。

## 2. 从逻辑生成草稿

```bash
nudo contract --draft src/lib.js
nudo contract --draft --write src/lib.js --fn greet --fn double
# IDE：CodeLens ⚡ draft contract / VS Code「Nudo: Draft Contract」
```

草稿证据（**不发明** check 义务）：`callsite` / `directive` 证据是最可信起点，`body` 读取仅作建议（类型需人工填），无 case 时 `symbolic` 形状补返回位，无证据的槽保持 TODO 注释。完整证据表见 [nudo contract](./contract.md)。

产物是 `src/lib.nudo.draft.js` — **不** ambient 加载。审阅后复制进 `src/lib.nudo.js`。

样例：[`docs/examples/interface-draft/`](https://github.com/nudojs/nudo/tree/main/docs/examples/interface-draft)。

可运行演示（临时目录：盘点 → draft → 接受 → check）：

```bash
pnpm run migrate-demo
# 在 nudo monorepo 根目录执行 scripts/migrate-demo.sh
```

## 3. 审阅清单

1. **参数** — 调用点形状是否过窄？可放宽（`number()` vs `lit(21)`）。
2. **body 读到的字段** — 仅当**所有**调用方都必须提供时才写成 `shape({ name })`（那才是义务）。
3. **返回** — 写你想执法的契约，不是历史上每一个结果。
4. **手写冲突** — 侧车已有同名绑定时保留手写（draft 不覆盖）。

接受示例：

```js
// src/lib.nudo.js
import { fn, number, shape, string } from "@nudojs/core";

export const double = fn({ x: number() }, number());
export const greet = fn({ user: shape({ name: string() }) }, string());
```

## 4. check 门禁

```bash
nudo check src/
nudo check src/lib.js --json
```

- **handwritten** 违例 → 构建失败。
- **L2** 入口 may-throw 默认是 error —— 可捕获、声明 `@nudo:throws`，或单次运行加 `--ignore-throws`。迁移窗口内优先 `check --profile adoption`：L2 降为 warning（exit 0）、L1 仍是 error；迁移落定后回到默认 strict。详见 [Check 指南](./check.md)。
- **generated** 漂移 → warning（事实 + 刷新），不是新义务。
- **implicit** 展示本身不发明 error。

可选求值提示（默认 **off**）：

```json
{ "nudo": { "analysis": { "evalMissingSlot": "warning" } } }
```

命中已关闭对象形状缺字段时浮出 `nudo:missing-slot` —— 收紧草稿的线索，不是自动契约。

## 5. 固化调用点域（可选）

```bash
nudo contract --emit src/lib.js --fn double --from test/
nudo contract --emit src/lib.js --dry-run --exit-on-diff
```

## 6. IDE / agent

| 表面 | 入口 |
|------|------|
| Hover 档位 | `● contract / hw\|gen\|imp` |
| CodeLens | persist / update / **draft** |
| VS Code | Nudo Output 通道命令 |
| Agent | `nudo.contract` / `nudo.contract.draft` / `nudo.check` |
| CLI | `nudo contract`（`--draft` / `--emit`）、`nudo check`、`nudo health`、`nudo test --freeze` |

## 7. 持续健康

```bash
nudo health src/                         # uncovered fns, drift, analysis errors
nudo test src/lib.js --from test/ --freeze=update
```

版本锁定见 [版本与发布](./versioning.md)（0.x 的 minor 可能破坏；稳定线的 core/service/nudojs 今天均为 1.x，遵循 SemVer——见该页版本表）。

## 不要做的事

- 不要指望 body 里的 `if (p.foo)` 自动变成 check 义务（C0 模型）。
- 不要把 `*.nudo.draft.js` 当正式契约提交 — 先复制进 `*.nudo.js`。
- 不要把 `generated` 快照当成完整 API 义务 — 需要执法时升为手写。

## 参见

- [CLI — `nudo contract --draft`](./cli.md#nudo-contract)
- [Check 指南](./check.md)
- [与 TypeScript 并存](./coexistence.md)
- [vs TypeScript](./vs-typescript.md)
- [LSP 客户端矩阵](./lsp-clients.md)
