---
"@nudojs/core": minor
"@nudojs/service": minor
"@nudojs/parser": minor
"@nudojs/harvester": minor
"nudojs": minor
"@nudojs/lsp": minor
---

仓库级正确性批次（fix-10，19 项修复 + 3 项设计缺陷修复）

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
