# retire-real — 真实 npm 包 `ms` 的 tsc 退役故事

**依赖是真实世界包 [`ms`](https://github.com/vercel/ms)**（毫秒格式化，纯 JS、极常用）。  
不是合成夹具：消费方从 **TS + tsc + @types 形态** 走到 **JS + nudo check**，依赖本身不动。

| | `before/` | `after/` |
|---|---|---|
| 语言 | `src/age.ts` + `ms.d.ts` | `src/age.js` |
| 门禁 | `tsc --noEmit` | `nudo check src` |
| typescript 依赖 | 有 | **无** |
| 真实依赖 | `ms@^2.1.3` | 同左 |
| 标记 | — | `.nudo/migrate-retired.json` |

## 剧本（单向门）

```bash
# 0. 起点：TS 消费真实包
pnpm run nudo -- migrate status docs/examples/retire-real/before/package.json

# 1. 剥注解 → .js（保运行时）
pnpm run nudo -- migrate strip docs/examples/retire-real/before/src/age.ts

# 2. 把原 TS 注解逆向成契约草稿（确认前不执法）
pnpm run nudo -- contract --from-dts docs/examples/retire-real/before/src/age.ts
#   → export const formatAge = fn({ durationMs: number() }, string());
#   审阅后复制进 age.nudo.js（见 after/src/age.nudo.js）

# 3. 门禁（after/ 即终态）
pnpm run check docs/examples/retire-real/after/src/age.js

# 4. 退役 tsc（摘 typescript / scripts 改写）
pnpm run nudo -- migrate retire docs/examples/retire-real/after --dry-run
```

## 诚实边界

- `ms` 无自带 `.d.ts`：before 用最小 `ms.d.ts`（等价 `@types/ms`）。
- 剥除后 `ms()` 返回在分析里是 **unknown**（native/未 harvest）——这是引擎债告警，不是契约失败；契约面参数已是 `number`/`string`。
- 有 `@types/ms` 时 harvest 会自动补签名；也可用 `@nudo:mock` / `refine return` 钉住。

```bash
pnpm run verify:examples   # 本目录命令见 [../README.md](../README.md) 矩阵
```
