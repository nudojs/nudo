# errors — 错误信息对照（Nudo 文案钉住）

十类常见门禁错误的 **Nudo 真输出**（CI 钉住）。  
与 `tsc` 的并排对照与「为什么更好修」见 [`../../errors-vs-typescript.md`](../../errors-vs-typescript.md)。

| 文件 | 错误类 | Nudo 要点 |
|------|--------|-----------|
| `01-constraint-gt.js` | `constraint-violated` | `0 ⊭ ms > 0`（TS `number` 不报） |
| `02-shape-missing.js` | `constraint-violated` | `missing field user.name` |
| `03-assign-missing.js` | `assign-mismatch` | 重赋值丢 `port` |
| `04-entry-throws.js` | `entry-may-throw` | L2 运行时效果进 CI |
| `05-return-refine.js` | `constraint-violated` | 返回 `0 ⊭ return > 0` |
| `06-plus-truth.js` | `constraint-violated` | 真实 `+` + 契约拦 `"7"` |
| `07-prim-assign.js` | `assign-mismatch` | `number ⊭ string` |
| `08-length-bound.js` | `constraint-violated` | `"" ⊭ min length 1` |
| `09-arg-shape.js` | `constraint-violated` | 传参缺字段 |
| `10-fix-path.js` | 两类违例 | 每条都带 `fix: nudo contract --draft` |

共性（TS 较难给全）：

```text
      actual:   <调用点实参 Abs>
      expected: <契约 Pred>
      → <怎么改>
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

```bash
pnpm run verify:examples   # 钉住上述输出（见 [../README.md](../README.md) 矩阵）
```
