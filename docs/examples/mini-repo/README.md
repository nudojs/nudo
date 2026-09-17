# mini-repo — 多文件集成

风格化小库：ESM 跨文件 + class + async + HOF。

| 文件 | 内容 |
|------|------|
| `validators.js` | `isPositive` / `clamp` |
| `store.js` | `MemoryStore` class |
| `user-service.js` | import、async、HOF |

```bash
pnpm run verify:examples   # 验证本目录命令（见 ../README.md 命令矩阵，四个都 exit 0）
```

两个支持文件在矩阵里也有独立 infer 行：`validators.js` 的 entry@ 签名展示从
body 推断出的前置（`isPositive: (n: A1) => boolean  where A1 > 0`）；
`store.js` 只含 class——class 方法不单独产生 infer case（infer 报告
`No functions with @nudo:case directives found.`），其形状经 user-service.js
的 import 图进入 `createService()  { store: MemoryStore, … }`。

infer 亮点（每行都是逐调用点/逐 case 真值）：

- `fetchUser(7)` → `promise<{ id: 7, name: "u7" }>` —— async 效应链跨文件解析 `normalizeId`
- `sumAges` case `"ages"` → `60 #exact` —— HOF 回调经 `reduce` 逐元素累加
- `clamp`（imported）→ `call@L5` 两条记录 `(7, 1, 9999)` / `(5, 1, 9999)` —— 跨文件收窄
- `score(4)` → `5` —— 字面量算术

注意：`sumAges` 用 `@nudo:case` 而不是顶层调用——顶层调用数组实参会被
`check` **不会**因 body 访问 `ages.reduce` 报 arg-structure（C0.1 已移除
body slot 门禁）。若要拦截错误实参形状，需显式 shape 契约（见 `structure/`）。
