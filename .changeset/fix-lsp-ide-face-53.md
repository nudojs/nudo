---
"@nudojs/lsp": patch
---

LSP IDE 面 8 处用户看得见的缺口（族 53）：语义高亮不再整面消失、指令补全
不再子串误命中、类方法跳转与跨文件引用可解析、`executeCommand` 接位置参数、
`ignoreThrows` 与 CLI 同口径、env 模板变更触发依赖文件复分析、扩展命令面板
补齐 `nudo.selectContract`。

- **语义 token 面在语法非法 buffer 上整面清零**（`semantic-tokens.ts`）：
  `buildSemanticTokens` 遇 `parse` 抛就 `return []` ⇒ 用户改到一半（括号没
  闭合 / 半个表达式）**整个文件的高亮瞬间消失**。现在解析失败走**词法降级**：
  把注释 / 字符串内容挖空（长度与换行不变 ⇒ 坐标不变）后按关键字
  （`function` / `class` / `const` / `let` / `var`）取紧随其后的标识符 ⇒
  **仍有部分 token**。取舍：降级档**只给声明位**上色（成员访问 / 参数 /
  引用位静态不可知 ⇒ 不猜，宁可少上色不可错上色），且**不缓存上次成功结果**
  （旧坐标比清零更坏）。
- **指令补全的前缀过滤是子串匹配**（`server-ide.ts`）：过滤收敛为**纯前缀
  匹配**（`label.startsWith(typed)`），语义写死在 `matchesDirectivePrefix`
  的注释里。⚠ 前缀语义：`@nudo:ca` 只命中 `@nudo:case`（`@nudo:contract`
  的前缀是 `@nudo:co`）；`@nudo:c` 命中**所有**以 `@nudo:c` 开头的指令
  （`@nudo:case` 与 `@nudo:contract` **都**真前缀于它）——被排除的是「不是
  typed 前缀」的 label（子串语义才会把 `@nudo:mock` / `@nudo:replace` 这类
  **含** `c` 的项误纳进来）。
- **方法面未下沉到符号层**（`symbols.ts`）：类 / 对象方法的**方法键不是绑定**
  （绑定表不收它）⇒ 纯函数面 `resolveDefinitionLocations` /
  `resolveReferences` 直接调用时认不出方法（此前只有协议通道内联了一份
  方法判据 ⇒ 纯函数面与协议面口径分裂）。方法面现在下沉到符号层
  （`methodTargetAt`），协议通道改为**委托**符号层 ⇒ 两面同一口径。
- **跨文件方法 references 未接**：references 通道对方法只扫**当前文件**
  ⇒ 跨文件的 `Alpha.run` 调用点不在结果里，而改名面已经会带上它们 ⇒ 用户
  「查引用看不到、一改名却跨文件被改」。方法面现在**跨文件**扫描
  （`collectMethodReferencesAcrossFiles`：`extraFiles` + 打开文档 buffer
  覆盖层），归属（owner）由光标所在文件显式给出 ⇒ 同名不同类（`Beta.run`）
  仍不合并。
- **`executeCommand` 缺位置参数 → 对象桥**（`server.ts`）：IDE 侧历史上用
  **位置参数**发命令（`[uri, …]`），而 executeCommand 通道只认**对象**参数
  ⇒ 位置形态落到兜底分支 ⇒ 协议层 InvalidParams ⇒ 命令 100% 失败（扩展侧
  只能绕道 slash 请求）。`agent-tools.ts` 的 `positionalCommandParams` 统一桥
  `nudo.check` / `nudo.hover` / `nudo.test` / `nudo.whatIf` /
  `nudo.suggestCase` / `nudo.getActiveCases`。对象形态**行为不变**；位置形态
  缺必填项仍报协议层参数形态错误。
- **LSP 侧 `ignoreThrows` 口径与 CLI 分裂**（`gate-config.ts`）：service 的
  `checkConfig` 只认**严格 `string[]`** ⇒ 配置写成 `"TypeError"`（裸字符串）
  或 `["TypeError,RangeError"]`（数组元素内含逗号）时被静默丢成空表 ⇒ IDE
  仍报 `nudo:entry-may-throw`（假红），而 CLI 认这两种写法 ⇒ 同一份
  `package.json` **CLI 绿 / IDE 红**。LSP 侧改为按**同一语义**解析（裸字符串 /
  字符串数组都接受；数组元素内部也按逗号切分；trim 后丢空；非字符串元素忽略），
  并把 CLI 的解析器作为**测试 oracle** 逐值比对。⚠ 根因在 service / core 的
  配置解析层 ⇒ 本次只修 IDE 面（service 层未动）。
- **LSP 的 env 模板无反向边**（`validation.ts`）：watched-files 只按 LSP 自己
  的 `nudoDepParents` 定向重检 ⇒ path 型 `@nudo:env` 模板改了**不一定**触发
  依赖源文件复分析（CLI watch 走 service 的 env 反向边表 ⇒ 两面口径分裂）。
  现在 LSP 直接消费 **service 的同一张表**（`envPathDependents`——解析口径
  同源，不另写一份）⇒ IDE 与 CLI 同口径。
- **manifest 漏登记 `nudo.selectContract`**（`packages/vscode/package.json`）：
  扩展的 handler 认这个命令（languageclient 自动注册 ⇒ CodeLens 可用），
  但 `contributes.commands` 没有它 ⇒ **命令面板里搜不到**。现在登记进 manifest
  （标题与兄弟命令同款风格）。
