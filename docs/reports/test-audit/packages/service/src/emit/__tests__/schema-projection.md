# packages/service/src/emit/__tests__/schema-projection.test.ts

模块套件：27 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"返回面：zod 源码是 z.literal(10n)（不是 z.unknown()）"	"（service 包不依赖 zod ⇒ 这里按 zod 的**原生语义**建模，不引入新依赖；"	没测该层	keep	keep	—
"形参面：契约申报的 bigint 形参同样投影成 z.literal(10n)"	"（service 包不依赖 zod ⇒ 这里按 zod 的**原生语义**建模，不引入新依赖；"	没测该层	keep	keep	—
"跨面一致：zod 面的接受集 == standard 面（真执行生成产物）"	"standard 面：真执行**生成产物**里的内联校验器（不是只比对节点形态） zod 面：按 zod 的 literal 语义（严格相等）求值 契约申报的唯一合法值被收； （service 包不依赖 zod ⇒ 这里按 zod 的**原生语义**建模，不引入新依赖；"	夹具漏形态	keep	keep	—
"guard 面的字面量条款保真（data === 10n）"	"（service 包不依赖 zod ⇒ 这里按 zod 的**原生语义**建模，不引入新依赖；"	没测该层	keep	keep	—
"跨面一致：guard 面也接受契约申报的 10n（族 48 已修 core 层 prim 兜底缺陷）"	"改前：guard(10n) === false —— shape 条款 `typeof data === \"number\"` 来自 core 的「无 prim ⇒ number」兜底 ⇒ 恒假 ⇒ **假红**（拒收合法值）。 （service 包不依赖 zod ⇒ 这里按 zod 的**原生语义**建模，不引入新依赖；"	没测该层	keep	keep	—
"契约 bigint 路径不再是降级 ⇒ 不产生台账条目（零台账的根因已消除）"	"（service 包不依赖 zod ⇒ 这里按 zod 的**原生语义**建模，不引入新依赖；"	没测该层	keep	keep	—
"负控：观测路径（源码级 bigint）仍留痕（同口径：降级必有台账）"	"改前是 `{k:\"unknown\"}` ⇒ 校验器接受**任何**值 （字符串 / 对象 / 数字都行），与 guard 面 `data === 10n` 接受集不相交。 （service 包不依赖 zod ⇒ 这里按 zod 的**原生语义**建模，不引入新依赖；"	夹具漏形态	keep	keep	—
"负控：确实无法投影的形态仍降级，但留痕可见（既有 dropped 通道）"	"用户类 brand：zod 产物只 import zod ⇒ 名字不在模块作用域 ⇒ 不可 z.instanceof 台账进产物（用户可见） （service 包不依赖 zod ⇒ 这里按 zod 的**原生语义**建模，不引入新依赖；"	没测该层	keep	keep	—
"负控：渲染层降级必须留痕（方言层不得静默放宽成 z.unknown()）"	"（service 包不依赖 zod ⇒ 这里按 zod 的**原生语义**建模，不引入新依赖；"	没测该层	keep	keep	—
"lit(-0) 渲染成 z.literal(-0)，不是 z.literal(0)"	"zod 产物面把 `lit(-0)` 写成 `z.literal(0)` ⇒ **比门禁宽** ⇒ 假绿。 改前：`schemaNodeToZod` 的 `case \"lit\"` 数字分支用模板串 `z.literal(${v})` ⇒ `String(-0) === \"0\"` ⇒ 负号被抹掉 ⇒ 产物写 `z.literal(0)`： export const fInput = z.object({ o: z.object({ v: z.literal(0) }) });"	没测该层	keep	keep	—
"该处标注「已知有损」（zod 的 === 口径区分不了 -0 与 0）"	"zod 产物面把 `lit(-0)` 写成 `z.literal(0)` ⇒ **比门禁宽** ⇒ 假绿。 改前：`schemaNodeToZod` 的 `case \"lit\"` 数字分支用模板串 `z.literal(${v})` ⇒ `String(-0) === \"0\"` ⇒ 负号被抹掉 ⇒ 产物写 `z.literal(0)`： export const fInput = z.object({ o: z.object({ v: z.literal(0) }) });"	没测该层	keep	keep	—
"产物是可执行的 JS，且字面量值确实是 -0（Object.is）"	"zod 产物面把 `lit(-0)` 写成 `z.literal(0)` ⇒ **比门禁宽** ⇒ 假绿。 改前：`schemaNodeToZod` 的 `case \"lit\"` 数字分支用模板串 `z.literal(${v})` ⇒ `String(-0) === \"0\"` ⇒ 负号被抹掉 ⇒ 产物写 `z.literal(0)`： export const fInput = z.object({ o: z.object({ v: z.literal(0) }) });"	没测该层	keep	keep	—
"模块产物（export --format schema）同样保真"	"zod 产物面把 `lit(-0)` 写成 `z.literal(0)` ⇒ **比门禁宽** ⇒ 假绿。 改前：`schemaNodeToZod` 的 `case \"lit\"` 数字分支用模板串 `z.literal(${v})` ⇒ `String(-0) === \"0\"` ⇒ 负号被抹掉 ⇒ 产物写 `z.literal(0)`： export const fInput = z.object({ o: z.object({ v: z.literal(0) }) });"	没测该层	keep	keep	—
"负控制：普通数字字面量不受牵连（逐字 z.literal(42)，无多余注释）"	"zod 产物面把 `lit(-0)` 写成 `z.literal(0)` ⇒ **比门禁宽** ⇒ 假绿。 改前：`schemaNodeToZod` 的 `case \"lit\"` 数字分支用模板串 `z.literal(${v})` ⇒ `String(-0) === \"0\"` ⇒ 负号被抹掉 ⇒ 产物写 `z.literal(0)`： export const fInput = z.object({ o: z.object({ v: z.literal(0) }) });"	没测该层	keep	keep	—
"length(other) is not a string min"	"schema 投影的 pred 必须锚定 self。 回归背景：lengthBound 只认 `fn===\"length\"`、 numericBound 把任意 var 当 self——`length(other)>=1` / `gt(other,0)` 会被 投影成字符串 min(1) / 数字 gt(0)，把无关变量的约束盖到当前值上。"	夹具漏形态	keep	keep	—
"gt(other, 0) is not a number bound"	"schema 投影的 pred 必须锚定 self。 回归背景：lengthBound 只认 `fn===\"length\"`、 numericBound 把任意 var 当 self——`length(other)>=1` / `gt(other,0)` 会被 投影成字符串 min(1) / 数字 gt(0)，把无关变量的约束盖到当前值上。"	夹具漏形态	keep	keep	—
"length(self var) still projects min"	"这里直接断言锚定 length(s) 仍可投影） 长度界按 **UTF-16 码元** 判定（refine），不映射 zod 的码点 API schema 投影的 pred 必须锚定 self。 回归背景：lengthBound 只认 `fn===\"length\"`、 numericBound 把任意 var 当 self——`length(other)>=1` / `gt(other,0)` 会被 投影成字符串 min(1) / 数字 gt(0)，把无关变量的约束盖到当前值上。"	夹具漏形态	keep	keep	—
"length(__nudo_self__) projects min (constraint path)"	"长度界按 **UTF-16 码元** 判定（refine），不映射 zod 的码点 API schema 投影的 pred 必须锚定 self。 回归背景：lengthBound 只认 `fn===\"length\"`、 numericBound 把任意 var 当 self——`length(other)>=1` / `gt(other,0)` 会被 投影成字符串 min(1) / 数字 gt(0)，把无关变量的约束盖到当前值上。"	夹具漏形态	keep	keep	—
"gt(self var) still projects bound"	"schema 投影的 pred 必须锚定 self。 回归背景：lengthBound 只认 `fn===\"length\"`、 numericBound 把任意 var 当 self——`length(other)>=1` / `gt(other,0)` 会被 投影成字符串 min(1) / 数字 gt(0)，把无关变量的约束盖到当前值上。"	夹具漏形态	keep	keep	—
"eq(length(self), 5) is not z.literal(5)"	"schema 投影的 pred 必须锚定 self。 回归背景：lengthBound 只认 `fn===\"length\"`、 numericBound 把任意 var 当 self——`length(other)>=1` / `gt(other,0)` 会被 投影成字符串 min(1) / 数字 gt(0)，把无关变量的约束盖到当前值上。"	夹具漏形态	keep	keep	—
"eq(5, length(self)) reverse is not z.literal(5)"	"schema 投影的 pred 必须锚定 self。 回归背景：lengthBound 只认 `fn===\"length\"`、 numericBound 把任意 var 当 self——`length(other)>=1` / `gt(other,0)` 会被 投影成字符串 min(1) / 数字 gt(0)，把无关变量的约束盖到当前值上。"	夹具漏形态	keep	keep	—
"eq(length(other), 5) is not a literal"	"schema 投影的 pred 必须锚定 self。 回归背景：lengthBound 只认 `fn===\"length\"`、 numericBound 把任意 var 当 self——`length(other)>=1` / `gt(other,0)` 会被 投影成字符串 min(1) / 数字 gt(0)，把无关变量的约束盖到当前值上。"	夹具漏形态	keep	keep	—
"eq(get(self,\"x\"), 5) is not z.literal(5)"	"schema 投影的 pred 必须锚定 self。 回归背景：lengthBound 只认 `fn===\"length\"`、 numericBound 把任意 var 当 self——`length(other)>=1` / `gt(other,0)` 会被 投影成字符串 min(1) / 数字 gt(0)，把无关变量的约束盖到当前值上。"	夹具漏形态	keep	keep	—
"eq(self, lit) still projects literal"	"schema 投影的 pred 必须锚定 self。 回归背景：lengthBound 只认 `fn===\"length\"`、 numericBound 把任意 var 当 self——`length(other)>=1` / `gt(other,0)` 会被 投影成字符串 min(1) / 数字 gt(0)，把无关变量的约束盖到当前值上。"	夹具漏形态	keep	keep	—
"eq(__nudo_self__, lit) still projects literal (constraint path)"	"schema 投影的 pred 必须锚定 self。 回归背景：lengthBound 只认 `fn===\"length\"`、 numericBound 把任意 var 当 self——`length(other)>=1` / `gt(other,0)` 会被 投影成字符串 min(1) / 数字 gt(0)，把无关变量的约束盖到当前值上。"	夹具漏形态	keep	keep	—
"库函数版与生成产物版对 -0 给出逐字相同的消息"	"两份实现逐字一致（修前：库函数 \"-0\" / 产物 \"0\" ⇒ 这里挂） 且消息必须保真到 -0（字面量保真：-0 与 0 在除法 / Math.sign / Object.is 上可观察） standard-schema 生成产物**内联副本**的 `__nudoDescribe` 未处理 `-0` ⇒ 与**库函数副本**（`describeValue`）口径分叉。 生成产物内联版给 `expected 1, got 0` （`String(-0) === \"0\"`）⇒ 同一 schema 在「库校验」与「产物"	夹具漏形态	keep	keep	—
"负控制：期望值本身是 -0 时两份实现都放行（不得把 -0 当成不匹配）"	"standard-schema 生成产物**内联副本**的 `__nudoDescribe` 未处理 `-0` ⇒ 与**库函数副本**（`describeValue`）口径分叉。 生成产物内联版给 `expected 1, got 0` （`String(-0) === \"0\"`）⇒ 同一 schema 在「库校验」与「产物自校验」两个面 上给出**不一致的消息**。"	没测该层	keep	keep	—
```
