# packages/nudojs/src/__tests__/migrate-verify.test.ts

模块套件：40 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"裸字符串 \"TypeError\" ⇒ verify 判绿（与 check 同结论）"	"`nudo migrate verify` 与 `nudo check` 用**不同的 `ignoreThrows` 解析器** ⇒ 同一文件同一配置两个结论（verify 假失败，迁移门禁永远转不绿）。 根因：verify 走 service `checkConfig()` 的**严格** `Array.isArray` 变体 （裸字符串 `\"TypeError\"` 与 `[\"TypeError,RangeError\"]` 元素内逗号都不认）， 而 `nudo check` 走 `configIgnoreThro"	门禁未跑	keep	keep	—
"数组元素内含逗号 [\"TypeError,RangeError\"] ⇒ verify 判绿"	"`nudo migrate verify` 与 `nudo check` 用**不同的 `ignoreThrows` 解析器** ⇒ 同一文件同一配置两个结论（verify 假失败，迁移门禁永远转不绿）。 根因：verify 走 service `checkConfig()` 的**严格** `Array.isArray` 变体 （裸字符串 `\"TypeError\"` 与 `[\"TypeError,RangeError\"]` 元素内逗号都不认）， 而 `nudo check` 走 `configIgnoreThro"	门禁未跑	keep	keep	—
"反向闸：没配 ignoreThrows ⇒ verify 仍判红"	"`nudo migrate verify` 与 `nudo check` 用**不同的 `ignoreThrows` 解析器** ⇒ 同一文件同一配置两个结论（verify 假失败，迁移门禁永远转不绿）。 根因：verify 走 service `checkConfig()` 的**严格** `Array.isArray` 变体 （裸字符串 `\"TypeError\"` 与 `[\"TypeError,RangeError\"]` 元素内逗号都不认）， 而 `nudo check` 走 `configIgnoreThro"	门禁未跑	keep	keep	—
"模块顶层抛（undefined is not a function）⇒ nudoOk: false"	"`nudo migrate verify` 对**模块级求值失败**放绿（`nudo check` 判红 `nudo:internal`）⇒ 迁移闸门假绿。 根因：`migrateVerify` 调 `checkSource` 时**没有装求值回落 collector** （分析器通道装过一次又在自己的收尾处摘掉）⇒ 引擎 internal 回落被静默吞掉 ⇒ 模块的全部导出丢失、零诊断、`nudoOk: true`。"	门禁未跑	keep	keep	—
"同目录的干净文件仍是 OK（反向闸：不得整批打红）"	"`nudo migrate verify` 对**模块级求值失败**放绿（`nudo check` 判红 `nudo:internal`）⇒ 迁移闸门假绿。 根因：`migrateVerify` 调 `checkSource` 时**没有装求值回落 collector** （分析器通道装过一次又在自己的收尾处摘掉）⇒ 引擎 internal 回落被静默吞掉 ⇒ 模块的全部导出丢失、零诊断、`nudoOk: true`。"	门禁未跑	keep	keep	—
"子目录文件拿得到项目级 env 全局 ⇒ verify 判绿"	"`nudo migrate verify` 把**项目级** `package.json#nudo.env` 的相对 路径按「被检文件所在目录」解析 ⇒ 子目录里的文件**永远拿不到**项目级 env ⇒ 误报红（`may throw ReferenceError`），而 `nudo check` 判绿。 修复：verify 侧照抄 check 的分层口径（项目级按 `proj.projectDir` 绝对化 + 文件级按 `dirname(file)`），并把 env 加载失败并入报告（`nudo:env-unr"	门禁未跑	keep	keep	—
"反向闸：文件级 @nudo:env 仍按**文件目录**解析"	"`nudo migrate verify` 把**项目级** `package.json#nudo.env` 的相对 路径按「被检文件所在目录」解析 ⇒ 子目录里的文件**永远拿不到**项目级 env ⇒ 误报红（`may throw ReferenceError`），而 `nudo check` 判绿。 修复：verify 侧照抄 check 的分层口径（项目级按 `proj.projectDir` 绝对化 + 文件级按 `dirname(file)`），并把 env 加载失败并入报告（`nudo:env-unr"	门禁未跑	keep	keep	—
"`.js` 里的类型标注 ⇒ code: syntax-error + nudoOk: false"	"`nudo migrate verify` 对 `.js` 里的 **TS-only 语法**判绿 ⇒ 与 `nudo check` 相反 ⇒ 迁移闸门假绿。 根因：check 面按**扩展名**选解析插件（`parseSource(source, { filename })`： `.js` 不带 TS 插件 ⇒ TS 语法直接 SyntaxError ⇒ pathErrors + exit 1）， verify 只走宽松解析 ⇒ 同一文件 check 红 / verify 绿。"	门禁未跑	keep	keep	—
"`migrate strip` 的 namespace 产物在 verify 面同样是红的"	"`nudo migrate verify` 对 `.js` 里的 **TS-only 语法**判绿 ⇒ 与 `nudo check` 相反 ⇒ 迁移闸门假绿。 根因：check 面按**扩展名**选解析插件（`parseSource(source, { filename })`： `.js` 不带 TS 插件 ⇒ TS 语法直接 SyntaxError ⇒ pathErrors + exit 1）， verify 只走宽松解析 ⇒ 同一文件 check 红 / verify 绿。"	门禁未跑	keep	keep	—
"反向闸：普通 `.js` 仍判绿"	"`nudo migrate verify` 对 `.js` 里的 **TS-only 语法**判绿 ⇒ 与 `nudo check` 相反 ⇒ 迁移闸门假绿。 根因：check 面按**扩展名**选解析插件（`parseSource(source, { filename })`： `.js` 不带 TS 插件 ⇒ TS 语法直接 SyntaxError ⇒ pathErrors + exit 1）， verify 只走宽松解析 ⇒ 同一文件 check 红 / verify 绿。"	门禁未跑	keep	keep	—
"反向闸：`.ts` 里的类型标注照常判绿（严格解析按扩展名选插件）"	"`nudo migrate verify` 对 `.js` 里的 **TS-only 语法**判绿 ⇒ 与 `nudo check` 相反 ⇒ 迁移闸门假绿。 根因：check 面按**扩展名**选解析插件（`parseSource(source, { filename })`： `.js` 不带 TS 插件 ⇒ TS 语法直接 SyntaxError ⇒ pathErrors + exit 1）， verify 只走宽松解析 ⇒ 同一文件 check 红 / verify 绿。"	门禁未跑	keep	keep	—
"nudo check 的签名是精确类型（反向闸：前提成立）"	"反向闸：check 面的签名里不得出现 `unknown`（那才是「harvest 空位被丢」的症状） `nudo migrate verify` 的注入装配器仍用**对象展开**合并 env 模块 （而非 `mergeHarvestUnderEnv`）⇒ 手工 env 与 harvest **同名模块**时，harvest 独有的导出被**整体丢弃** ⇒ 同一文件同一配置，verify 报 `unknown` + 误导性 `nudo:unknown-inference`，而 `nudo check` 报精确类型"	门禁未跑	keep	keep	—
"verify 与 check 的诊断统计一致（不再多出 unknown-inference）"	"`nudo migrate verify` 的注入装配器仍用**对象展开**合并 env 模块 （而非 `mergeHarvestUnderEnv`）⇒ 手工 env 与 harvest **同名模块**时，harvest 独有的导出被**整体丢弃** ⇒ 同一文件同一配置，verify 报 `unknown` + 误导性 `nudo:unknown-inference`，而 `nudo check` 报精确类型。 修复：改用 `mergeHarvestUnderEnv(graph.modules, envMods"	门禁未跑	keep	keep	—
"目录扫描不把 sidecar / .d.ts 当源码：verify 与 check 同绿"	"旧行为：verify 扫到 types.d.ts → 判红 exit 1（比 check 更严） 类型声明 + 一条真错误（旧实现下让 verify 判红）"	门禁未跑	keep	keep	—
"显式 .d.ts 目标与 check 一样被拒（不当源码分析）"	"类型声明 + 一条真错误（旧实现下让 verify 判红）"	门禁未跑	keep	keep	—
"判红文件：stdout 可 JSON.parse；人工报告在 stderr"	"stdout 必须是单一 JSON 文档（旧行为：人工面在前 ⇒ parse 抛错） 人工面走 stderr（stdout 不得混入） L2 entry may-throw（未约束形参上的属性读）→ 门禁判红"	没测该层	keep	keep	—
"判绿文件：stdout 仍是纯 JSON（人类面不出现）"	"L2 entry may-throw（未约束形参上的属性读）→ 门禁判红"	没测该层	keep	keep	—
"无 --json 时人工报告仍在 stdout（人类面不被误伤）"	"L2 entry may-throw（未约束形参上的属性读）→ 门禁判红"	没测该层	keep	keep	—
"文本面：合法文件仍被逐行报告，语法错文件带文件名"	"旧行为：stdout 空（整批中止） 失败行必须带文件名（用户能定位是哪个文件） 第二个合法文件（证明「不是只报第一个」）"	没测该层	keep	keep	—
"--json 面：stdout 非空且可解析，失败项进结果数组"	"旧行为：stdout 0 字节（JSON.parse 抛错） 第二个合法文件（证明「不是只报第一个」）"	没测该层	keep	keep	—
"rewriteTscCommand 认得版本钉住形态 npx tsc@5.4.5"	"`migrate` 的 tsc 调用形态「检测口径与改写口径分裂」： 版本钉住的 `npx tsc@5.4.5` 被 status 计入、却不被 retire 改写 ⇒ 假绿（tsc 门禁原样留在 CI 里，工具却报「已退役」）。"	夹具漏形态	keep	keep	—
"status 计入的每个 tsc 脚本都被 retire 改写（脚本面）"	"检测口径：版本钉住那条也算 tsc 改写口径：两个脚本都被改写，仓库里不再残留 tsc 调用 退役后 status 不再自相矛盾地报「tsc still in scripts」 `migrate` 的 tsc 调用形态「检测口径与改写口径分裂」： 版本钉住的 `npx tsc@5.4.5` 被 status 计入、却不被 retire 改写 ⇒ 假绿（tsc 门禁原样留在 CI 里，工具却报「已退役」）。"	夹具漏形态	keep	keep	—
"workflow 面的版本钉住行同样被计入并改写（CI 行数不多计）"	"`migrate` 的 tsc 调用形态「检测口径与改写口径分裂」： 版本钉住的 `npx tsc@5.4.5` 被 status 计入、却不被 retire 改写 ⇒ 假绿（tsc 门禁原样留在 CI 里，工具却报「已退役」）。"	夹具漏形态	keep	keep	—
"0 个 .ts + tsc 脚本 ⇒ 必须报「tsc still in scripts」"	"期望：tsc 脚本阻塞与 .ts 数量无关（tscScripts.length > 0 即阻塞）。"	没测该层	keep	keep	—
"文本面同样出现该阻塞"	"期望：tsc 脚本阻塞与 .ts 数量无关（tscScripts.length > 0 即阻塞）。"	没测该层	keep	keep	—
"有 .ts + tsc 脚本 ⇒ 仍然报（口径不回退）"	"期望：tsc 脚本阻塞与 .ts 数量无关（tscScripts.length > 0 即阻塞）。"	没测该层	keep	keep	—
"反向闸：没有 tsc 脚本 ⇒ 不得报该阻塞"	"期望：tsc 脚本阻塞与 .ts 数量无关（tscScripts.length > 0 即阻塞）。"	没测该层	keep	keep	—
"基线加载 tsconfig：干净文件与有错文件的诊断不同"	"旧行为：两条基线逐字相同（都是 TS5112「tsconfig 不会被加载」） 有错文件：基线带**该文件**的真实诊断 干净文件：基线无诊断 ⇒ 与有错文件的基线**必然不同** 真实类型错误（strict 下 `x` 可能 undefined）"	没测该层	keep	keep	—
"文本面：干净文件显示 tsc: ok，有错文件显示 tsc: diagnostics"	"真实类型错误（strict 下 `x` 可能 undefined）"	没测该层	keep	keep	—
"文本面：空目录判红并给出引导（与 check 同口径）"	"旧行为：零输出、零诊断、exit 0 根因：verify 的文件收集为空时没有「空 ⇒ 失败/警告」的判定 ⇒ 迁移闸门 （status → strip → verify → retire）里，verify 是唯一用来证明「产物已经能用」 的步骤，对着空目录拿到 exit 0 等于给出一条**无意义但绿色**的通行证。 而 `nudo check` 对**同一个目录**报「No nudo files found」并 exit 1 ⇒ 两个面 对「这里没有任何可分析的文件」给出相反结论。"	门禁未跑	keep	keep	—
"--json 面：stdout 非空且可解析，空集被标成失败"	"根因：verify 的文件收集为空时没有「空 ⇒ 失败/警告」的判定 ⇒ 迁移闸门 （status → strip → verify → retire）里，verify 是唯一用来证明「产物已经能用」 的步骤，对着空目录拿到 exit 0 等于给出一条**无意义但绿色**的通行证。 而 `nudo check` 对**同一个目录**报「No nudo files found」并 exit 1 ⇒ 两个面 对「这里没有任何可分析的文件」给出相反结论。"	门禁未跑	keep	keep	—
"跨模块：verify 不再假绿（与 check 同判红）"	"旧行为：verify 判绿（exit 0）⇒ 迁移闸门放行 CI 门禁拒绝的文件 方向 D：path 型 `@nudo:env`（env 文件必须满足 defineEnv() 契约）。 夹具放在**仓库内**的 tmp/ 下：env 文件要 `import { strLit } from \"@nudojs/core\"` ⇒ 必须能解析到工作区包（仓库外的 tmp 目录解析不到）。"	门禁未跑	keep	keep	—
"@nudo:mock：verify 不再假红（与 check 同判绿）"	"旧行为：verify 判红（mock 没被注入 ⇒ may throw ReferenceError） 方向 D：path 型 `@nudo:env`（env 文件必须满足 defineEnv() 契约）。 夹具放在**仓库内**的 tmp/ 下：env 文件要 `import { strLit } from \"@nudojs/core\"` ⇒ 必须能解析到工作区包（仓库外的 tmp 目录解析不到）。"	门禁未跑	keep	keep	—
"path 型 @nudo:env：verify 与 check 同判绿（env 预载必须同口径）"	"旧行为：verify 判红（env 没被预载 ⇒ may throw ReferenceError） 方向 D：path 型 `@nudo:env`（env 文件必须满足 defineEnv() 契约）。 夹具放在**仓库内**的 tmp/ 下：env 文件要 `import { strLit } from \"@nudojs/core\"` ⇒ 必须能解析到工作区包（仓库外的 tmp 目录解析不到）。"	门禁未跑	keep	keep	—
"坏 @nudo:mock：verify 与 check 同判红（mock 解析失败必须可见）"	"方向 D：path 型 `@nudo:env`（env 文件必须满足 defineEnv() 契约）。 夹具放在**仓库内**的 tmp/ 下：env 文件要 `import { strLit } from \"@nudojs/core\"` ⇒ 必须能解析到工作区包（仓库外的 tmp 目录解析不到）。"	夹具漏形态	keep	keep	—
".cts ⇒ 产物是 .cjs（Bug 26 / tsc 同口径），且 notes 如实说明模块系统未转换"	"与 tsc / Node 解析序一致，且不再与同 stem 的 .ts 争用 index.js 如实警告：`.cjs` 恒按 CommonJS 解析，但 strip 产物仍是源侧 ESM 语法 `migrate strip` 只剥类型、**不改模块系统**：`.cts` 产物里仍是 源侧的 import/export 语法，因此产物形态不得被静默当成 CommonJS。 口径沿革： - 原修复把 `.cts → .js`（不谎称 CommonJS，模块系统由最近的 package.json#type 决定），并在"	夹具漏形态	keep	keep	—
".mts ⇒ 产物仍是 .mjs（ESM 源 ⇒ ESM 产物，映射本来就一致）"	"`migrate strip` 只剥类型、**不改模块系统**：`.cts` 产物里仍是 源侧的 import/export 语法，因此产物形态不得被静默当成 CommonJS。 口径沿革： - 原修复把 `.cts → .js`（不谎称 CommonJS，模块系统由最近的 package.json#type 决定），并在 notes 里如实说明。"	夹具漏形态	keep	keep	—
"rewriteTscCommand 认得路径限定型 tsc"	"`nudo migrate retire` 的 tsc **检测口径与改写口径不一致** ⇒ 路径限定型的 tsc（`./node_modules/.bin/tsc`）被 status 计入、却不被 retire 改写 ⇒ `typescript` 依赖被删、tsc 调用却留着（落盘仓库自相矛盾）。"	没测该层	keep	keep	—
"status 计入的脚本 / CI 行数与改写数一致"	"`nudo migrate retire` 的 tsc **检测口径与改写口径不一致** ⇒ 路径限定型的 tsc（`./node_modules/.bin/tsc`）被 status 计入、却不被 retire 改写 ⇒ `typescript` 依赖被删、tsc 调用却留着（落盘仓库自相矛盾）。"	没测该层	keep	keep	—
"retire 后仓库里不再残留任何 tsc 调用（依赖已删，门禁必须同时退役）"	"退役后 status 不再报「tsc still in scripts」 `nudo migrate retire` 的 tsc **检测口径与改写口径不一致** ⇒ 路径限定型的 tsc（`./node_modules/.bin/tsc`）被 status 计入、却不被 retire 改写 ⇒ `typescript` 依赖被删、tsc 调用却留着（落盘仓库自相矛盾）。"	没测该层	keep	keep	—
```
