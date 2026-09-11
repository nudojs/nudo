# nudo check 在 CI 中的用法

> 门禁语义：对 JS 源码做约束蕴含检查；有 `error` 则退出码 1。
> 类型代数在 `@nudojs/core`，无独立 kernel 包。

## 本地

```bash
# 单文件
npx tsx packages/cli/src/index.ts check path/to/file.js

# 或扫描脚本（多文件/包）
npx tsx scripts/scan-npm-package.ts commander
```

## GitHub Actions 示例

```yaml
name: nudo-check
on: [push, pull_request]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: pnpm install
      - name: Type-as-computation gate
        run: |
          # 对 src 下入口文件跑 check；任一 FAILED → 失败
          set -e
          for f in $(find src -name '*.js' -not -path '*/node_modules/*' | head -50); do
            echo "==> $f"
            npx tsx packages/cli/src/index.ts check "$f"
          done
```

## 与 tsc 的关系（现阶段）

| | `tsc --noEmit` | `nudo check` |
|---|---|---|
| 赋值/结构检查 | 完备 | 不做 |
| 约束（`x>0`）+ 字面量调用 | 做不到 | **做** |
| 零注解 JS | 需 checkJs | 默认 |
| 建议 | 大 TS 仓仍用 tsc | JS 仓 / 存量代码 / Agent 流水线 |

**推荐双跑**：TS 项目继续 tsc；纯 JS 或渐进迁移目录用 `nudo check` 作补充门禁。

## 退出码

- `0`：OK  
- `1`：存在 `severity=error` 的 issue（如 `nudo:constraint-violated`）
