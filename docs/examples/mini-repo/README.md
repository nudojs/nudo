# mini-repo — 多文件集成

风格化小库：ESM 跨文件 + class + async + HOF。

| 文件 | 内容 |
|------|------|
| `validators.js` | `isPositive` / `clamp` |
| `store.js` | `MemoryStore` class |
| `user-service.js` | import、async、HOF |

```bash
# 正例：两个命令都 exit 0（infer 输出含调用点 case，无警告）
pnpm run check docs/examples/mini-repo/user-service.js
pnpm run infer docs/examples/mini-repo/user-service.js
```

infer 亮点（每行都是逐调用点/逐 case 真值）：

- `fetchUser(7)` → `Promise<{ id: 7, name: "u7" }>` —— async 效应链跨文件解析 `normalizeId`
- `sumAges` case `"ages"` → `60 #exact` —— HOF 回调经 `reduce` 逐元素累加
- `clamp`（imported）→ `call@L5` 两条记录 `(7, 1, 9999)` / `(5, 1, 9999)` —— 跨文件收窄
- `score(4)` → `5` —— 字面量算术

注意：`sumAges` 用 `@nudo:case` 而不是顶层调用——顶层调用数组实参会被
`check` 的 arg-structure 门禁拦截（body 访问 `ages.reduce`，实参数组 ⊭ 对象
形状 `{ reduce }`）。这正是 `nudo:arg-structure` 的语义（见 `structure/`）。
