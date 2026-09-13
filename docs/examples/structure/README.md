# Structure — Abs leq

结构来自 **推断的 Abs 形状** + body 访问，不必写 interface。

| 文件 | code |
|------|------|
| [`assign.js`](./assign.js) | `nudo:assign-mismatch` |
| [`arg-structure.js`](./arg-structure.js) | `nudo:arg-structure` |

```bash
# 两个都是负例文件：exit 1 是预期（报错行即演示内容）
pnpm run check docs/examples/structure/assign.js
pnpm run check docs/examples/structure/arg-structure.js
```
