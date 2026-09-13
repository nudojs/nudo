# mini-repo — 多文件集成

风格化小库：ESM 跨文件 + class + async + HOF。

| 文件 | 内容 |
|------|------|
| `validators.js` | `isPositive` / `clamp` |
| `store.js` | `MemoryStore` class |
| `user-service.js` | import、async、HOF |

```bash
# 正例：两个命令都 exit 0
pnpm run check docs/examples/mini-repo/user-service.js
pnpm run infer docs/examples/mini-repo/user-service.js
```
