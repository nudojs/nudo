# nudo check 在 CI 中的用法

> 产品语义 / 诊断码 / 报告格式 / 金标含义：[`design/cli-semantics.md`](./design/cli-semantics.md) §5。
> 本文只写 **CI 接线**。

## 接线

```yaml
# GitHub Actions 片段（示意）
- run: pnpm install
- run: pnpm run lint
- run: pnpm run build
- run: pnpm run check src/          # 门禁：有 error → exit 1
# 或
- run: pnpm run nudo -- check src/ --json
```

| 命令 | 用途 | exit 1 |
|------|------|--------|
| `pnpm run check <path>` | Day 0/CI 门禁 + 打印 signatures | 任一 error 级诊断（L1 或未 ignore 的 L2） |
| `pnpm run test:cli <path>` | case 报告 + 声明断言 | 仅**声明** `@nudo:case` 断言失败 |
| `pnpm run nudo -- health` | drift / 分析错误 | drift 或 analysis error |
| `pnpm run verify:examples` | 示例命令 × 退出码矩阵 | 矩阵不匹配 |

CI 门禁**只认** `check`（及 `test` 的声明断言、`health` 的 drift）。

## L2（入口 may-throw）

默认 **error**。CI 里可选放宽：

```bash
pnpm run check src/ --ignore-throws TypeError,RangeError
# 或 package.json
"nudo": { "check": { "ignoreThrows": ["TypeError"], "entryThrows": "error" } }
```

- `ignoreThrows` / `entryThrows` **只作用于 L2**，不吞 L1 契约违例。
- 金标与 zero-FP 叙述默认以 **L2 off** 基线为准；开 L2 的 CI 应显式配置或拆期望。

## 精度门禁（本仓库）

| 门禁 | 位置 |
|------|------|
| 人工 recall = precision = 1.0 | `packages/core/src/algebra/__tests__/check-recall-gold.test.ts` |
| shape 精化 | `check-shape-gold.test.ts` |
| case ⊆ refine | `check-case-consistency.test.ts` |
| 真实包零误报 | `check-real-packages.test.ts` / `check-real-commander.test.ts` |
| 示例矩阵 | `docs/examples/README.md` + `scripts/verify-examples.sh` |

```bash
# 真实包扫描（报告态产物）
npx tsx scripts/scan-real-packages.ts commander
# → docs/check-real-packages.md
```

## 报告要点（CI 消费）

- **成功也打印 signatures**；入口无约束参数为 **`any`**。
- issues 为 `actual ⊭ expected`（蕴含失败），不是 tsc 诊断换皮。
- 机器可读：`nudo check <file> --json`（单文件 CheckJson v1）；gate/签名与 `test --json` cases **分命令**。
- 契约测试：`check-json.test.ts`；实现 `packages/core/src/algebra/check-report.ts`。
