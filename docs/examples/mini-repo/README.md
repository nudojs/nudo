# mini-repo — 多文件集成

风格化小库：ESM 跨文件 + class + async + HOF。

| 文件 | 内容 |
|------|------|
| `validators.js` | `isPositive` / `clamp` |
| `store.js` | `MemoryStore` class |
| `user-service.js` | import、async、HOF |

```bash
pnpm run verify:examples   # 验证本目录命令（见 [../README.md](../README.md) 命令矩阵，四个都 exit 0）
```

观察命令：`pnpm run check <file>`（签名）· `pnpm run test:cli <file>`（case 报告）。
旧动词 `infer` 已 deprecated。

两个支持文件在矩阵里也有独立 test 行（与 `scripts/verify-examples.sh` 钉住的输出一致）：

- `validators.js`：`check` signatures 为 `isPositive(n: any) => boolean` /
  `clamp(n: any, lo: any, hi: any) => any`——**入口无约束参数 = `any`**。
  `test:cli` 打印 `entry@L1  (any) => boolean` 等合成 case。
  （旧文档曾写 `entry@ … unknown`：那是遗留展示口径，已废弃。）
- `store.js`：class 方法经 analyzer 枚举——**会**产生 `MemoryStore.set` / `MemoryStore.get`
  的 `entry@` case（无调用点），**不是**「No functions with @nudo:case directives found.」。
- `user-service.js`：`check` signatures 含 `createService() => { store: MemoryStore, load: (id) => ? }`——
  `MemoryStore` 形状经 import 图进入服务对象。`normalizeId` 可能带 `nudo:unknown-inference`
  warning（真 unknown 返回 = 引擎债，不是 L2）。

`test:cli` 亮点（每行都是逐调用点/逐 case 真值）：

- `fetchUser(7)` → `promise<{ id: 7, name: "u7" }>` —— async 效应链跨文件解析 `normalizeId`
- `sumAges` case `"ages"` → `60` —— HOF 回调经 `reduce` 逐元素累加
- `clamp`（imported）→ `call@L5` 两条记录 `(7, 1, 9999)` / `(5, 1, 9999)` —— 跨文件收窄
- `score(4)` → `5` —— 字面量算术

注意：`sumAges` 用 `@nudo:case` 而不是顶层调用——顶层调用数组实参时，
`check` **不会**因 body 访问 `ages.reduce` 报 arg-structure（C0.1 已移除
body slot 门禁）。若要拦截错误实参形状，需显式 shape 契约（见 `structure/`）。
入口 export 上未消化的 may-throw 属 **L2**（`nudo:entry-may-throw`），与 body slot 无关。
