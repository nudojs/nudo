# retire-debug — 真实 npm 包 `debug` 的 tsc 退役故事

**依赖是真实世界包 [`debug`](https://github.com/debug-js/debug)**（visionmedia/debug，日志门面，生态极常用）。  
不是合成夹具：消费方从 **TS + tsc + @types 形态**走到 **JS + nudo check**，依赖本身不动。

| | `before/` | `after/` |
|---|---|---|
| 语言 | `src/logger.ts` + `debug.d.ts` | `src/logger.js` |
| 门禁 | `tsc --noEmit` | `nudo check src` |
| typescript 依赖 | 有 | **无** |
| 真实依赖 | `debug@^4.3.4` | 同左 |
| 标记 | — | `.nudo/migrate-retired.json` |

## 剧本（单向门）

```bash
# 0. 起点：TS 消费真实包
pnpm run nudo -- migrate status docs/examples/retire-debug/before/package.json

# 1. 剥注解 → .js（保运行时）
pnpm run nudo -- migrate strip docs/examples/retire-debug/before/src/logger.ts

# 2. 把原 TS 注解逆向成契约草稿（确认前不执法）
pnpm run nudo -- contract --from-dts docs/examples/retire-debug/before/src/logger.ts
#   → export const createLogger = fn({ namespace: string() }, any());

# 3. 门禁（after/ 即终态）
pnpm run check docs/examples/retire-debug/after/src/logger.js

# 4. 退役 tsc（摘 typescript / scripts 改写 / workflow）
pnpm run nudo -- migrate retire docs/examples/retire-debug/after --dry-run
```

## 诚实边界

- `debug` 无自带 `.d.ts`：before 用最小 `debug.d.ts`（等价 `@types/debug`）。
- 剥除后 `debug()` 返回在分析里是 **unknown**（native/未 harvest）——这是引擎债告警，不是契约失败。
- 有 `@types/debug` 时 harvest 会自动补签名；也可用 `@nudo:mock` / `refine return` 钉住。

公开叙事（含 checkout-demo / `ms`）：网站 [Case study: retire tsc](https://nudojs.github.io/nudo/docs/guides/case-study-retire)。

```bash
pnpm run verify:examples   # 本目录命令见 [../README.md](../README.md) 矩阵
```
