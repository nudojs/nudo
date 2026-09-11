# mini-repo — 多文件集成

风格化小库：ESM 跨文件 + class + async + HOF + 约束算术。

| 文件 | 内容 |
|------|------|
| `validators.js` | `isPositive` / `clamp` |
| `store.js` | `MemoryStore` class |
| `user-service.js` | import、async、HOF |

```bash
npx tsx packages/cli/src/index.ts check docs/examples/mini-repo/user-service.js
npx tsx packages/cli/src/index.ts infer docs/examples/mini-repo/user-service.js
```
