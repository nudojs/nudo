# migrate — 公开 retire tsc 样板包

**checkout-demo**：一个会算小计 / 优惠券 / 收据的小库。左边 TypeScript 起点，右边
`nudo migrate` 退役 tsc 后的终点。这是 **替代 TypeScript** 的最小公开故事——不是共存。

| | before/ | after/ |
|---|---|---|
| 语言 | `.ts` + 注解 | `.js`（行为不变） |
| 门禁 | `tsc --noEmit` | `nudo check src` |
| 依赖 | `typescript` | 无 |
| 标记 | — | `.nudo/migrate-retired.json` |

## 迁移故事（单向门）

```text
status  →  strip  →  verify  →  retire
审计 tsc   剥注解    nudo 门禁    摘掉 tsc
           + draft   （双跑可选）  写标记
```

```bash
# 1. 审计：还剩什么 tsc
pnpm run nudo -- migrate status docs/examples/migrate/before

# 2. 剥注解 → .js（--write 才落盘；本仓示例只 dry-run）
pnpm run nudo -- migrate strip docs/examples/migrate/before/src/math.ts
#   dry  before/src/math.ts → before/src/math.js

# 3. 门禁（迁移期可用 --with-tsc 对照；终态只跑 nudo）
pnpm run nudo -- migrate verify docs/examples/migrate/after/src/math.js

# 4. 退役：摘 typescript 依赖、scripts 改 nudo check、写标记
pnpm run nudo -- migrate retire docs/examples/migrate/before/package.json --dry-run
#   dry-run  removed typescript  ·  typecheck: tsc --noEmit → nudo check .
#   （真写盘去掉 --dry-run；after/ 即终态金标）

# 5.（可选）把原 TS 注解逆向成契约草稿 —— 确认前不执法
pnpm run nudo -- contract --from-dts docs/examples/migrate/before/src/math.ts
#   → @nudo:draft  fn({ price: number(), qty: number() }, number())
#   复制进 math.nudo.js 才成为 L1 义务；再用 number().gt(0) 等加强 Pred
```

**纪律**：双跑只出现在 `verify --with-tsc`；产品出口是 **retire**。after/ 是可提交的终态金标。

## before → after 变了什么

1. **注解消失**：`lineTotal(price: number, qty: number): number` → `lineTotal(price, qty)`
2. **`type Item` 类型别名删除**（TS-only；运行时不存在）
3. **契约不自动发明**：若需要义务，用 `@nudo:refine` / `*.nudo.js`（见 `../constraints/`）
4. **CI 一行换主**：`tsc --noEmit` → `nudo check src`（多文件 JSON 见 `docs/ci-nudo-check.md`）

## 怎么跑

```bash
pnpm run verify:examples   # 本目录命令与退出码见 [../README.md](../README.md) 矩阵
```

观察：`pnpm run check docs/examples/migrate/after/src/math.js`（签名）·
`pnpm run test:cli …`（call@ / entry@）。
