# 公平简报：用好各自类型面（等价 = 成本函数，不是工具名）

两侧都用**同一模型、同一权重**。公平 ≠ 表面对称：**禁止**跨侧文体模仿、禁止类型面武器化；**必须**用满各自类型系统的常规优势。

## 等价的定义（成本模型，不是工具名）

两个工具 **isometric**，当且仅当在成本模型三轴上同阶，**不是**名字像：

| 轴 | 含义 | 谁付 |
|---|---|---|
| `known` | 事先已知 | 0 |
| `learn` | 一次性学会（文档/培训/摸索） | 一次性 |
| `call` | 每次使用 | 每次 |

`tsc --noEmit` ↔ `nudo check` 在这三轴上同阶（known + call），**尽管名字完全不同**。
真正贵的是 `learn≈∞` 的活（为学会一门工具发明 DSL、摸运行时）——那才是真会、不是解题。

**测量点**：报告里单独记「工具同构偏离」（发明工具 / 摸 --help / 读 monorepo），
**不要**把这类 learn 开销记进「解 PRD 的成本」。实现工作量才是 PRD 成本。

## TS 习惯 → Nudo 同构对照表（学这一张，≤3 分钟）

| 你想… | TS 惯用 | **Nudo 同构** | 成本 |
|---|---|---|---|
| 全量类型检查 | `npm run gate`（`tsc --noEmit`） | **`npm run gate`**（`nudo check src`） | call |
| 用例/单测 | `npm test` | **`npm test`**（`node --test`） | call |
| debug 见证 | （无）/ 断言 | **`@nudo:case "n" (…)`** + `nudo test src` | call |
| 期待报错 | `@ts-expect-error` | 负例调用点（`check` 报红）或 node:test 断言 throws | call |
| 补类型源 | 写 `.d.ts` | **`*.nudo.js` 侧车**（builder 从 `@nudojs/core` 导入） | call |
| 看签名 | 跳定义/看 dts | **`nudo check src` 签名输出** | call |
| 新契约草稿 | 猜 `T` / 写 JSDoc | **`nudo contract --draft`** | call |
| 问「改了 X 会怎样」 | 猜 / 重跑 | **`nudo check src --what-if …`** | call |

**禁止**（记「工具同构偏离」）：
1. 为找「Nudo 版的 X」去 `--help` / 读工具链仓库 / `packages/**` / grep monorepo —— **对照表已给**。
2. 发明对照表外的命令或产物（换输出路径、换 flag、找「nudo test 的输出格式」）。
3. 用错误类型的工具硬凑（当 `nudo` 不是 `tsc` / 不是 vitest 去用）。

**机制知识仍可看**（这是解题依据，**不是**偏离）：`PRD-TEST-READ.md`、用户仓库里的 `*.nudo.js` 与 `@nudo:case`。
**用户语言**（这题的名词 = 分账/支付对账）可查。其它一律项目内 + 对照表。

## 各自用满类型面

**TypeScript 常规优势（用满）**
- 写清 `.ts` **类型注解** + `.d.ts`：联合/字面量/判别可辨识联合；`checkJs`+`// @ts-check` 也行。
- `tsc --noEmit` 是门；用 `@ts-expect-error` 标注**期待报错**。
- 纯计算函数写类型，不必 mock IO；算法守卫（断言不变量）合法。
- **禁止** JSDoc 炮弹仿类型注解（TS 面的常规写法是 `.ts` 注解 / `.d.ts` / `@ts-check`）。

**Nudo 常规优势（用满）**
- **推断**为主：裸 JS，靠参数谓词 + 调用点/case **推断**返回结构；不要模仿 TS 注解文体。
- **有意 fail-fast**：函数上 **`@nudo:throws Error`** 一行申报（勿用 `_probe` 摸 guard）。
- **源级契约**只写谓词：`@nudo:contract` + `*.nudo.js` builder（从 `@nudojs/core` 导入）。语法见 `PRD-TEST-READ.md`。
- **`@nudo:case`** 是 debug 见证；义务只来自侧车 / `@nudo:contract` / `@nudo:throws`。
- 复杂域（金额、时间、状态机）写契约，让 typechecker 蕴含规则。

## 产出判据（双侧同一条）

1. 功能正确、handle PRD 非 happy path；
2. 测试覆盖边界（**含至少 1 条负例 / 期望报错**）；
3. 到达时展示「新代码里**捕获一个真 bug**」的证据（诊断 / 期望报错测试 / 契约蕴含）；
4. **`npm run ci` 绿**后才报告完成。
