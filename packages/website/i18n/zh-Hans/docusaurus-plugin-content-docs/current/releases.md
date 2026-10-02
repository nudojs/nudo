---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.6.0 |
| `@nudojs/service` | 1.5.0 |
| `nudojs (CLI)` | 1.3.0 |
| `@nudojs/parser` | 1.3.0 |
| `@nudojs/lsp` | 1.3.0 |
| `@nudojs/env` | 0.4.14 |
| `@nudojs/harvester` | 0.3.0 |
| `vite-plugin-nudo` | 0.4.15 |
| `nudo-vscode` | 0.3.19 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.6.0 {#pkg-core}

## 1.6.0

### Minor Changes

- 2f9717b: 仓库级正确性批次（fix-10，19 项修复 + 3 项设计缺陷修复）
  
  安全与正确性：
  - 类型表达式 AST 白名单，阻断 @nudo:case/@nudo:as RCE（P0）
  - export/绑定名统一消毒（保留字/撞名）
  - 槽位/导出表全部改自有属性读，挡 Object.prototype 成员
  
  类型系统：
  - tuple rest 槽在 leq/widen/运行时/schema/dts 全链路生效
  - x++/x-- 与 +=/-= 同源传播 term/pred/Φ 约束
  - 键通道字面量区分 -0/0（litKeyString）
  - 投影/格式出口统一 ProjectionBudget：环与超深截断可观测
  
  CLI 门禁与契约：
  - health --from 路径错误并入 pathErrors，ok↔exit 单一来源
  - migrate verify 与 health 传 skips，与 nudo check 判定同源
  - 畸形 JSDoc 指令不再静默丢弃/吞行/抛宿主异常
  - case 实参递归深度上限 32（DoS 防护）
  
  服务层：
  - 缓存上限改为显式>env>project，env 形参每次生效
  - 会话 LRU 与 BoundedLruMap 对齐（覆盖写刷新位序，max=0 读 miss）
  - 模块缓存条目携带子树内容指纹，传递失效内聚（DESIGN-002）
  - sidecar 契约身份=导出名、绑定名可别名，保留字/string 导出安全发射（DESIGN-003）
  - @nudo:import 别名查导出表用原始名，miss 出诊断
  
  解析与诊断：
  - eval 诊断补 rest/默认值/具名表达式声明与计算键引用
  - ambient 侧车反查含 .nudo.mjs，后缀集合单一事实源
  
  S2/S5/S6 跟踪批次（BUG-017–028，主会话直修）：
  - 类型推断：collectPredVars 收 assumeFinite 约束；eqLit
    通道 tagged 化（eq(x, lit(undefined)) 可投影）；
    非有限界（NaN/±Infinity）不投影；fn rest 非数组类型
    提升为 (T)[]；可选参数名保留 `?`
  - 门禁与 CLI：check --fix 保持门禁语义（残余 error
    exit 1，旗标组合 usage error）；variadic 旗标吞位置
    参数 → 定向 usage error + `--` 终止符；export 走
    PathError 面（nudo:path-* + nudo:path-io）；
    findProjectConfig 解析失败诊断 + 停步
  - 求值引擎：注入表收集异常 fail-closed（绝不半张表）；
    同名类碰撞 epoch 检测 + 回落观测；EvalCallRecord.threw
    必填 + 桥接 fail-closed（threw 省略 → throwsAbs
    unknown）；tryEvalCall 显式 isAbsVal 守卫
  - LSP / 错误面：validateText 文档 version 门（陈旧
    分析不发布）；诊断 / agent 错误 message 绝对路径
    脱敏（家目录→~、根→.）；注入装配失败上屏挡 exit
  - 观察面：standard-schema 缺键 / 显式 undefined 区分；
    dts 投影可选参数名、fn rest TS 合法性

更早版本（22）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.5.0 {#pkg-service}

## 1.5.0

### Minor Changes

- 2f9717b: 仓库级正确性批次（fix-10，19 项修复 + 3 项设计缺陷修复）
  
  安全与正确性：
  - 类型表达式 AST 白名单，阻断 @nudo:case/@nudo:as RCE（P0）
  - export/绑定名统一消毒（保留字/撞名）
  - 槽位/导出表全部改自有属性读，挡 Object.prototype 成员
  
  类型系统：
  - tuple rest 槽在 leq/widen/运行时/schema/dts 全链路生效
  - x++/x-- 与 +=/-= 同源传播 term/pred/Φ 约束
  - 键通道字面量区分 -0/0（litKeyString）
  - 投影/格式出口统一 ProjectionBudget：环与超深截断可观测
  
  CLI 门禁与契约：
  - health --from 路径错误并入 pathErrors，ok↔exit 单一来源
  - migrate verify 与 health 传 skips，与 nudo check 判定同源
  - 畸形 JSDoc 指令不再静默丢弃/吞行/抛宿主异常
  - case 实参递归深度上限 32（DoS 防护）
  
  服务层：
  - 缓存上限改为显式>env>project，env 形参每次生效
  - 会话 LRU 与 BoundedLruMap 对齐（覆盖写刷新位序，max=0 读 miss）
  - 模块缓存条目携带子树内容指纹，传递失效内聚（DESIGN-002）
  - sidecar 契约身份=导出名、绑定名可别名，保留字/string 导出安全发射（DESIGN-003）
  - @nudo:import 别名查导出表用原始名，miss 出诊断
  
  解析与诊断：
  - eval 诊断补 rest/默认值/具名表达式声明与计算键引用
  - ambient 侧车反查含 .nudo.mjs，后缀集合单一事实源
  
  S2/S5/S6 跟踪批次（BUG-017–028，主会话直修）：
  - 类型推断：collectPredVars 收 assumeFinite 约束；eqLit
    通道 tagged 化（eq(x, lit(undefined)) 可投影）；
    非有限界（NaN/±Infinity）不投影；fn rest 非数组类型
    提升为 (T)[]；可选参数名保留 `?`
  - 门禁与 CLI：check --fix 保持门禁语义（残余 error
    exit 1，旗标组合 usage error）；variadic 旗标吞位置
    参数 → 定向 usage error + `--` 终止符；export 走
    PathError 面（nudo:path-* + nudo:path-io）；
    findProjectConfig 解析失败诊断 + 停步
  - 求值引擎：注入表收集异常 fail-closed（绝不半张表）；
    同名类碰撞 epoch 检测 + 回落观测；EvalCallRecord.threw
    必填 + 桥接 fail-closed（threw 省略 → throwsAbs
    unknown）；tryEvalCall 显式 isAbsVal 守卫
  - LSP / 错误面：validateText 文档 version 门（陈旧
    分析不发布）；诊断 / agent 错误 message 绝对路径
    脱敏（家目录→~、根→.）；注入装配失败上屏挡 exit
  - 观察面：standard-schema 缺键 / 显式 undefined 区分；
    dts 投影可选参数名、fn rest TS 合法性

### Patch Changes

- Updated dependencies [2f9717b]
  - @nudojs/core@1.6.0
  - @nudojs/parser@1.3.0
  - @nudojs/harvester@0.3.0
  - @nudojs/env@0.4.14

更早版本（24）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.3.0 {#pkg-nudojs}

## 1.3.0

### Minor Changes

- 2f9717b: 仓库级正确性批次（fix-10，19 项修复 + 3 项设计缺陷修复）
  
  安全与正确性：
  - 类型表达式 AST 白名单，阻断 @nudo:case/@nudo:as RCE（P0）
  - export/绑定名统一消毒（保留字/撞名）
  - 槽位/导出表全部改自有属性读，挡 Object.prototype 成员
  
  类型系统：
  - tuple rest 槽在 leq/widen/运行时/schema/dts 全链路生效
  - x++/x-- 与 +=/-= 同源传播 term/pred/Φ 约束
  - 键通道字面量区分 -0/0（litKeyString）
  - 投影/格式出口统一 ProjectionBudget：环与超深截断可观测
  
  CLI 门禁与契约：
  - health --from 路径错误并入 pathErrors，ok↔exit 单一来源
  - migrate verify 与 health 传 skips，与 nudo check 判定同源
  - 畸形 JSDoc 指令不再静默丢弃/吞行/抛宿主异常
  - case 实参递归深度上限 32（DoS 防护）
  
  服务层：
  - 缓存上限改为显式>env>project，env 形参每次生效
  - 会话 LRU 与 BoundedLruMap 对齐（覆盖写刷新位序，max=0 读 miss）
  - 模块缓存条目携带子树内容指纹，传递失效内聚（DESIGN-002）
  - sidecar 契约身份=导出名、绑定名可别名，保留字/string 导出安全发射（DESIGN-003）
  - @nudo:import 别名查导出表用原始名，miss 出诊断
  
  解析与诊断：
  - eval 诊断补 rest/默认值/具名表达式声明与计算键引用
  - ambient 侧车反查含 .nudo.mjs，后缀集合单一事实源
  
  S2/S5/S6 跟踪批次（BUG-017–028，主会话直修）：
  - 类型推断：collectPredVars 收 assumeFinite 约束；eqLit
    通道 tagged 化（eq(x, lit(undefined)) 可投影）；
    非有限界（NaN/±Infinity）不投影；fn rest 非数组类型
    提升为 (T)[]；可选参数名保留 `?`
  - 门禁与 CLI：check --fix 保持门禁语义（残余 error
    exit 1，旗标组合 usage error）；variadic 旗标吞位置
    参数 → 定向 usage error + `--` 终止符；export 走
    PathError 面（nudo:path-* + nudo:path-io）；
    findProjectConfig 解析失败诊断 + 停步
  - 求值引擎：注入表收集异常 fail-closed（绝不半张表）；
    同名类碰撞 epoch 检测 + 回落观测；EvalCallRecord.threw
    必填 + 桥接 fail-closed（threw 省略 → throwsAbs
    unknown）；tryEvalCall 显式 isAbsVal 守卫
  - LSP / 错误面：validateText 文档 version 门（陈旧
    分析不发布）；诊断 / agent 错误 message 绝对路径
    脱敏（家目录→~、根→.）；注入装配失败上屏挡 exit
  - 观察面：standard-schema 缺键 / 显式 undefined 区分；
    dts 投影可选参数名、fn rest TS 合法性

### Patch Changes

- Updated dependencies [2f9717b]
  - @nudojs/core@1.6.0
  - @nudojs/service@1.5.0
  - @nudojs/parser@1.3.0
  - @nudojs/harvester@0.3.0

更早版本（21）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.3.0 {#pkg-parser}

## 1.3.0

### Minor Changes

- 2f9717b: 仓库级正确性批次（fix-10，19 项修复 + 3 项设计缺陷修复）
  
  安全与正确性：
  - 类型表达式 AST 白名单，阻断 @nudo:case/@nudo:as RCE（P0）
  - export/绑定名统一消毒（保留字/撞名）
  - 槽位/导出表全部改自有属性读，挡 Object.prototype 成员
  
  类型系统：
  - tuple rest 槽在 leq/widen/运行时/schema/dts 全链路生效
  - x++/x-- 与 +=/-= 同源传播 term/pred/Φ 约束
  - 键通道字面量区分 -0/0（litKeyString）
  - 投影/格式出口统一 ProjectionBudget：环与超深截断可观测
  
  CLI 门禁与契约：
  - health --from 路径错误并入 pathErrors，ok↔exit 单一来源
  - migrate verify 与 health 传 skips，与 nudo check 判定同源
  - 畸形 JSDoc 指令不再静默丢弃/吞行/抛宿主异常
  - case 实参递归深度上限 32（DoS 防护）
  
  服务层：
  - 缓存上限改为显式>env>project，env 形参每次生效
  - 会话 LRU 与 BoundedLruMap 对齐（覆盖写刷新位序，max=0 读 miss）
  - 模块缓存条目携带子树内容指纹，传递失效内聚（DESIGN-002）
  - sidecar 契约身份=导出名、绑定名可别名，保留字/string 导出安全发射（DESIGN-003）
  - @nudo:import 别名查导出表用原始名，miss 出诊断
  
  解析与诊断：
  - eval 诊断补 rest/默认值/具名表达式声明与计算键引用
  - ambient 侧车反查含 .nudo.mjs，后缀集合单一事实源
  
  S2/S5/S6 跟踪批次（BUG-017–028，主会话直修）：
  - 类型推断：collectPredVars 收 assumeFinite 约束；eqLit
    通道 tagged 化（eq(x, lit(undefined)) 可投影）；
    非有限界（NaN/±Infinity）不投影；fn rest 非数组类型
    提升为 (T)[]；可选参数名保留 `?`
  - 门禁与 CLI：check --fix 保持门禁语义（残余 error
    exit 1，旗标组合 usage error）；variadic 旗标吞位置
    参数 → 定向 usage error + `--` 终止符；export 走
    PathError 面（nudo:path-* + nudo:path-io）；
    findProjectConfig 解析失败诊断 + 停步
  - 求值引擎：注入表收集异常 fail-closed（绝不半张表）；
    同名类碰撞 epoch 检测 + 回落观测；EvalCallRecord.threw
    必填 + 桥接 fail-closed（threw 省略 → throwsAbs
    unknown）；tryEvalCall 显式 isAbsVal 守卫
  - LSP / 错误面：validateText 文档 version 门（陈旧
    分析不发布）；诊断 / agent 错误 message 绝对路径
    脱敏（家目录→~、根→.）；注入装配失败上屏挡 exit
  - 观察面：standard-schema 缺键 / 显式 undefined 区分；
    dts 投影可选参数名、fn rest TS 合法性

### Patch Changes

- Updated dependencies [2f9717b]
  - @nudojs/core@1.6.0

更早版本（22）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.3.0 {#pkg-lsp}

## 1.3.0

### Minor Changes

- 2f9717b: 仓库级正确性批次（fix-10，19 项修复 + 3 项设计缺陷修复）
  
  安全与正确性：
  - 类型表达式 AST 白名单，阻断 @nudo:case/@nudo:as RCE（P0）
  - export/绑定名统一消毒（保留字/撞名）
  - 槽位/导出表全部改自有属性读，挡 Object.prototype 成员
  
  类型系统：
  - tuple rest 槽在 leq/widen/运行时/schema/dts 全链路生效
  - x++/x-- 与 +=/-= 同源传播 term/pred/Φ 约束
  - 键通道字面量区分 -0/0（litKeyString）
  - 投影/格式出口统一 ProjectionBudget：环与超深截断可观测
  
  CLI 门禁与契约：
  - health --from 路径错误并入 pathErrors，ok↔exit 单一来源
  - migrate verify 与 health 传 skips，与 nudo check 判定同源
  - 畸形 JSDoc 指令不再静默丢弃/吞行/抛宿主异常
  - case 实参递归深度上限 32（DoS 防护）
  
  服务层：
  - 缓存上限改为显式>env>project，env 形参每次生效
  - 会话 LRU 与 BoundedLruMap 对齐（覆盖写刷新位序，max=0 读 miss）
  - 模块缓存条目携带子树内容指纹，传递失效内聚（DESIGN-002）
  - sidecar 契约身份=导出名、绑定名可别名，保留字/string 导出安全发射（DESIGN-003）
  - @nudo:import 别名查导出表用原始名，miss 出诊断
  
  解析与诊断：
  - eval 诊断补 rest/默认值/具名表达式声明与计算键引用
  - ambient 侧车反查含 .nudo.mjs，后缀集合单一事实源
  
  S2/S5/S6 跟踪批次（BUG-017–028，主会话直修）：
  - 类型推断：collectPredVars 收 assumeFinite 约束；eqLit
    通道 tagged 化（eq(x, lit(undefined)) 可投影）；
    非有限界（NaN/±Infinity）不投影；fn rest 非数组类型
    提升为 (T)[]；可选参数名保留 `?`
  - 门禁与 CLI：check --fix 保持门禁语义（残余 error
    exit 1，旗标组合 usage error）；variadic 旗标吞位置
    参数 → 定向 usage error + `--` 终止符；export 走
    PathError 面（nudo:path-* + nudo:path-io）；
    findProjectConfig 解析失败诊断 + 停步
  - 求值引擎：注入表收集异常 fail-closed（绝不半张表）；
    同名类碰撞 epoch 检测 + 回落观测；EvalCallRecord.threw
    必填 + 桥接 fail-closed（threw 省略 → throwsAbs
    unknown）；tryEvalCall 显式 isAbsVal 守卫
  - LSP / 错误面：validateText 文档 version 门（陈旧
    分析不发布）；诊断 / agent 错误 message 绝对路径
    脱敏（家目录→~、根→.）；注入装配失败上屏挡 exit
  - 观察面：standard-schema 缺键 / 显式 undefined 区分；
    dts 投影可选参数名、fn rest TS 合法性

### Patch Changes

- Updated dependencies [2f9717b]
  - @nudojs/core@1.6.0
  - @nudojs/service@1.5.0
  - @nudojs/parser@1.3.0

更早版本（25）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.4.14 {#pkg-env}

## 0.4.14

### Patch Changes

- Updated dependencies [2f9717b]
  - @nudojs/core@1.6.0

更早版本（21）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.3.0 {#pkg-harvester}

## 0.3.0

### Minor Changes

- 2f9717b: 仓库级正确性批次（fix-10，19 项修复 + 3 项设计缺陷修复）
  
  安全与正确性：
  - 类型表达式 AST 白名单，阻断 @nudo:case/@nudo:as RCE（P0）
  - export/绑定名统一消毒（保留字/撞名）
  - 槽位/导出表全部改自有属性读，挡 Object.prototype 成员
  
  类型系统：
  - tuple rest 槽在 leq/widen/运行时/schema/dts 全链路生效
  - x++/x-- 与 +=/-= 同源传播 term/pred/Φ 约束
  - 键通道字面量区分 -0/0（litKeyString）
  - 投影/格式出口统一 ProjectionBudget：环与超深截断可观测
  
  CLI 门禁与契约：
  - health --from 路径错误并入 pathErrors，ok↔exit 单一来源
  - migrate verify 与 health 传 skips，与 nudo check 判定同源
  - 畸形 JSDoc 指令不再静默丢弃/吞行/抛宿主异常
  - case 实参递归深度上限 32（DoS 防护）
  
  服务层：
  - 缓存上限改为显式>env>project，env 形参每次生效
  - 会话 LRU 与 BoundedLruMap 对齐（覆盖写刷新位序，max=0 读 miss）
  - 模块缓存条目携带子树内容指纹，传递失效内聚（DESIGN-002）
  - sidecar 契约身份=导出名、绑定名可别名，保留字/string 导出安全发射（DESIGN-003）
  - @nudo:import 别名查导出表用原始名，miss 出诊断
  
  解析与诊断：
  - eval 诊断补 rest/默认值/具名表达式声明与计算键引用
  - ambient 侧车反查含 .nudo.mjs，后缀集合单一事实源
  
  S2/S5/S6 跟踪批次（BUG-017–028，主会话直修）：
  - 类型推断：collectPredVars 收 assumeFinite 约束；eqLit
    通道 tagged 化（eq(x, lit(undefined)) 可投影）；
    非有限界（NaN/±Infinity）不投影；fn rest 非数组类型
    提升为 (T)[]；可选参数名保留 `?`
  - 门禁与 CLI：check --fix 保持门禁语义（残余 error
    exit 1，旗标组合 usage error）；variadic 旗标吞位置
    参数 → 定向 usage error + `--` 终止符；export 走
    PathError 面（nudo:path-* + nudo:path-io）；
    findProjectConfig 解析失败诊断 + 停步
  - 求值引擎：注入表收集异常 fail-closed（绝不半张表）；
    同名类碰撞 epoch 检测 + 回落观测；EvalCallRecord.threw
    必填 + 桥接 fail-closed（threw 省略 → throwsAbs
    unknown）；tryEvalCall 显式 isAbsVal 守卫
  - LSP / 错误面：validateText 文档 version 门（陈旧
    分析不发布）；诊断 / agent 错误 message 绝对路径
    脱敏（家目录→~、根→.）；注入装配失败上屏挡 exit
  - 观察面：standard-schema 缺键 / 显式 undefined 区分；
    dts 投影可选参数名、fn rest TS 合法性

### Patch Changes

- Updated dependencies [2f9717b]
  - @nudojs/core@1.6.0
  - @nudojs/parser@1.3.0
  - @nudojs/env@0.4.14

更早版本（21）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.4.15 {#pkg-vite-plugin}

## 0.4.15

### Patch Changes

- Updated dependencies [2f9717b]
  - @nudojs/core@1.6.0
  - @nudojs/service@1.5.0

更早版本（24）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## 0.3.7

- Current published line (Marketplace + Open VS X via release CI).
- Launch the bundled `server/server.js` (compiled `@nudojs/lsp` dist) over IPC instead of `tsx` + `packages/lsp/src/server.ts`. The vsix is self-contained — no monorepo sibling path or tsx loader required at runtime.
- Commands: `nudo.selectCase` / `nudo.contract` / `nudo.contract.draft` / `nudo.contract.emit`.
- Intermediate 0.3.1–0.3.6 were release-CI auto-bumps alongside the monorepo `@nudojs/*` line; see git `Version Packages` commits.

更早版本（2）→ [完整发布历史](./releases-history.md#pkg-vscode)
