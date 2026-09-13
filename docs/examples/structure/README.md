# Structure — Abs leq

结构来自 **推断的 Abs 形状** + body 访问，不必写 interface。

| 文件 | 诊断 |
|------|------|
| [`assign.js`](./assign.js) | `nudo:assign-mismatch` |
| [`arg-structure.js`](./arg-structure.js) | `nudo:arg-structure` |

两个都是负例文件：`check` **故意 exit 1**（报错行即演示内容）。  
运行命令与期望退出码见 [../README.md](./README.md) 的命令矩阵；`pnpm run verify:examples` 一次验证全部。
