# 错误信息对照：Nudo vs TypeScript

> 样例可运行：[`examples/errors/`](./examples/errors/)（CI 钉住 Nudo 真输出）。  
> 目标：同一天业务代码里，**更快看懂、更快修好**。不是转译 tsc 文案。

**共性（每条 Nudo 违例都有）：**

```text
      actual:   <调用点/赋值右侧的 Abs>
      expected: <契约 Pred 或既有形状>
      → <一行怎么改>
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

---

## 1. 数值约束 — `setDelay(0)`

| | |
|---|---|
| **TS** | `Argument of type 'number' is not assignable…` —— 或 **根本不报**（`ms: number` 合法） |
| **Nudo** | `setDelay[ms]: argument ⊭ precondition` · `actual: 0 #exact` · `expected: ms > 0` |
| **为何好修** | 看到的是**值**与**谓词**，不是类型名；`fix:` 直接给出 draft 契约路径 |

样例：`examples/errors/01-constraint-gt.js`

## 2. shape 缺字段 — `greet({ id: 2 })`

| | |
|---|---|
| **TS** | 要先写 `interface User`，否则可能不报或报 Property `name` is missing |
| **Nudo** | `missing field u.name` · `actual: { id: 2 }` · `expected: missing field u.name` |
| **为何好修** | 字段名就在 expected 里；契约在 `user.nudo.js` 一处 |

样例：`02-shape-missing.js` · `09-arg-shape.js`

## 3. 重赋值丢槽 — `config = { host: "y" }`

| | |
|---|---|
| **TS** | 依赖推断对象类型；宽泛 `any`/index 时静默 |
| **Nudo** | `assignment ⊭ existing shape` · `missing slot port` |
| **为何好修** | 左值形状 vs 右值 Abs 并排 |

样例：`03-assign-missing.js`

## 4. 入口 may-throw — `user.name`

| | |
|---|---|
| **TS** | **不展示 throws**；运行时才炸 |
| **Nudo** | 签名带 `throws TypeError` + L2 `entry-may-throw` 进 CI |
| **为何好修** | suggestion 列出 refine / guard / try-catch / `--ignore-throws` |

样例：`04-entry-throws.js` · `l2-export-any.js`

## 5. 返回精化 — `return 0` under `positive`

| | |
|---|---|
| **TS** | 返回 `number` 即过；`0` 合法 |
| **Nudo** | `return value ⊭ @nudo:refine return positive` · `actual: 0` · `expected: return > 0` |
| **为何好修** | 前置/返回对偶，同一套 Pred 语言 |

样例：`05-return-refine.js`

## 6. 真实 JS `+` — `inc("7")` vs 契约

| | |
|---|---|
| **TS** | 常把 `x + 1` 标成 `number`（对 string 实参说谎）或强制收窄 |
| **Nudo** | 无契约：`number \| string`（诚实）；有 `positive`：调用点拦 `-1` |
| **为何好修** | 先看清真实语义，再决定加不加契约 |

样例：`06-plus-truth.js`

## 7. 原始类型赋值 — `n = "str"`

| | |
|---|---|
| **TS** | `Type 'string' is not assignable to type 'number'`（熟悉但无值） |
| **Nudo** | `assignment ⊭ existing shape` · `"str" ⊭ number` · `prim string ⊭ prim number` |
| **为何好修** | 报告里是 **#exact 字面量**，不是抽象类型名 |

样例：`07-prim-assign.js`

## 8. 长度界 — `tag("")`

| | |
|---|---|
| **TS** | `string` 合法；要 `NonEmptyString` 之类品牌类型 |
| **Nudo** | `actual: ""` · `expected: length(s) ≥ 1` |
| **为何好修** | 长度约束是 Pred，不是新类型名 |

样例：`08-length-bound.js`

## 9. 多违例一次给全 — `arm(-1)` + `bump(0)`

| | |
|---|---|
| **TS** | 多行类型错误，嵌套泛型时更糊 |
| **Nudo** | 每条独立 `actual`/`expected`/`fix:`，可并行修 |
| **为何好修** | 列表可扫；GHA 注解落到 PR 行（`check` 自动） |

样例：`10-fix-path.js`

## 10. 修复路径 — `fix: nudo contract --draft`

| | |
|---|---|
| **TS** | 通常只说不能赋值；改接口还是改实参要自己想 |
| **Nudo** | 违例类诊断固定带 **`fix: nudo contract --draft`** |
| **为何好修** | 一键进入可审阅草稿；接受后才是 L1 义务（C0） |

---

## 怎么跑

```bash
pnpm run check docs/examples/errors/01-constraint-gt.js
# …
pnpm run verify:examples   # 十条输出全部钉住
```

相对 tsc 的产品句：**不是「报得更多」，是「报得更真、带证据、带下一步」。**
