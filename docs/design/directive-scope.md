# 指令作用域与抽取单源契约（D6=G2 · D5=F1）

> 状态：产品契约。回归锁：`packages/parser/src/__tests__/directive-scope-g2.test.ts`、
> `packages/parser/src/__tests__/file-directives-prefix.test.ts`。

## 1. 作用域（G2）

函数级指令绑定 **AST 最近 Function**，不再「顶层 only」。

**Function 站点**（都算「最近 Function」）：

| 形态 | 绑定名 | 例 |
|---|---|---|
| `function f() {}` / `export function f() {}` | `f` | 顶层 / nested 同规则 |
| `const f = () => {}` / `const f = function() {}` | `f` | 注释带在 VariableDeclaration 上 |
| `export default function () {}` / `export default () => {}` | `default` | |
| class method `m`（含 nested class） | `C.m` | `Calculator.add` |
| object method `m` | `owner.m` | `api.get` |
| 具名 FunctionExpression | 其 id | `function inner() {}` 传参 |
| 匿名 | `<anonymous>` | 不可按名寻址 |

**规则**：

1. 同一函数上的 `@nudo:case` 与 `@nudo:contract`（及 `@nudo:throws` / `@nudo:budget`）**同时可见**——
   共用 `listFnDirectiveScopes` / `findFnDirectiveScope`（`core/algebra/directive-scan.ts`）。
2. 注释带在**非函数**语句上时不绑函数（不留孤儿指令）。
3. 文件级指令（`@nudo:env` / `@nudo:mock-module` / `@nudo:import`）**不绑函数**，全文件可见。

## 2. 前缀与文法字段

| 字段 | 契约 |
|---|---|
| 行注释前缀 | `//` 与 `///` 等价；`////` 不是指令 |
| 块注释 | JSDoc `/** … */` 有效（续行 `*` 前缀剥掉）；字符串/模板/块注释**正文**里的同形文本不是指令 |
| 多行实参 | `@nudo:case` 实参跨行（平衡括号）；续行 ` * ` 前缀剥掉 |
| `=> expected` | 允许续行 `=>`；不吞下一个 `@nudo:` 标签 |
| env 名 token | `\w+` 或 path-like（`./x` / `../x` / `/x` / `*.ts|js|mjs|cjs|tsx|jsx`） |

## 3. 抽取单源（F1）

**实现**住在 `packages/core/src/algebra/directive-scan.ts`（parser 依赖 core，反向会成包环）。
`@nudojs/parser` re-export 文本级 API 作为**产品面**；core refine / load-deps / check-case-scan
与 nudojs CLI **只消费**，不再自带正则文法。

| API | 消费方 |
|---|---|
| `listFnDirectiveScopes` / `findFnDirectiveScope` / `fnDirectiveCommentLines` | parser `extractDirectives`、refine（contract/throws/budget）、check-case-scan |
| `extractFileEnvNames` | parser `extractFileDirectives`、nudojs `fileEnvNamesFromText`、load-deps |
| `extractMockModuleRecords` | parser、load-deps |
| `extractNudoImportRecords` | refine `extractNudoImports`、load-deps |
| `scanCaseTags` | parser、check-case-scan |
| `scanContractSegments` / `scanThrowsDecl` / `scanBudgetDecl` | refine |
| `parseEnvPayload` / `parseMockModulePayload` / `parseNudoImportPayload` | 上述全部路径的载荷文法 |

改文法字段只改 `directive-scan.ts` 一处；契约测试锁住 parser/core/nudojs 对同一源码指令集合一致。
