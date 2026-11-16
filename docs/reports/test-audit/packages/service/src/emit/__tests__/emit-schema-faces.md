# packages/service/src/emit/__tests__/emit-schema-faces.test.ts

模块套件：schema 投影形态面（brand / bigint / 标准面 / 容器槽位 / 可空包装）。

审计：81 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
bigint 字面量契约正常出结果（改前：抛 Do not know how to serialize a BigInt）；往返保真：Infinity 字面量读回仍是 Infinity（改前：JSON ⇒ null ⇒ lit(null)）；负控制：普通数字字面量契约显示与往返不变	emit-schema-faces 聚合矩阵	没测该层	keep	keep	—
解构形参：出 `<fn>Input` 对象校验器，且**不出**字段级顶层校验器；具名形参：`<fn>_<param>` 仍是真的整参校验器（负控制）；返回面口径：恒名 `<fn>Output`（名字不随符号来源翻转——Bug 614）；没有形参表面时，全部条目按整参处理（退化口径不变）	emit-schema-faces 聚合矩阵	没测该层	keep	keep	—
Infinity 不再被写成 null（产物文本层）；Infinity：产物放行真值、拒绝 null（语义层，Bug 1000 的假红/假绿）；-Infinity 同样保真；bigint 字面量：序列化不抛（修前整条 export 崩溃、零产物）；负控制：普通字面量的产物文本与判定不变；负控制：NaN 不落成 lit(null)，而是按 zod 面同口径降级并记账	emit-schema-faces 聚合矩阵	没测该层	keep	keep	—
生成的 standard 产物在 strict 下 0 诊断；负控制：修前形态（裸 JS helper）在同一检查器下报 TS7006；产物自带类型别名（消费方拿到 unknown 而非 any 的入参面）	emit-schema-faces 聚合矩阵	没测该层	keep	keep	—
gt(0)：放宽 +Infinity，不放宽 -Infinity（-Infinity > 0 为假）；ge(5)：同上（+Infinity 满足 ge）；lt(5)：放宽 -Infinity，不放宽 +Infinity（+Infinity < 5 为假）；le(5)：同上；int 真的排除非有限值 ⇒ 不放宽（`Number.isInteger(±Infinity)` 为假）；多界合取：两端都满足才放宽对应端（gt(0) ∧ lt(10) ⇒ 两端都不满足）；多界合取：同为下	emit-schema-faces 聚合矩阵	没测该层	keep	keep	—
Record<string, string | undefined>（process.env 的 brand）不进产物；Record<string, string>（process.versions 的 brand）不进产物；降级进 dropped 台账（brand 不可表达必须可观测）；负控制：有运行时类的内建仍走 z.instanceof	emit-schema-faces 聚合矩阵	没测该层	keep	keep	—
用户类名不进产物（模块可 import，无 TS2304）；降级必须进 dropped 台账（损失可观测，不是静默）；负控制：运行时全局构造器仍走 z.instanceof（不得过度降级）；负控制：非 brand 形态不受影响	emit-schema-faces 聚合矩阵	没测该层	keep	keep	—
Map / Set / WeakMap / WeakSet 渲染成带实参的泛型；负控制：非泛型 brand（RegExp / Date）与用户类 brand 原样保留；负控制：非法 brand 名仍落 unknown（不泄漏任意标识符）；产物真的能过 tsc --noEmit --strict（改前 TS2314）；改前形态确实红（裸 Map / Set / WeakMap ⇒ TS2314）	emit-schema-faces 聚合矩阵	没测该层	keep	keep	—
库函数版：全局构造器 brand 只放行真实例；生成产物版：与 zod 面 z.instanceof(Date) 同判；负控制：名单外的 brand（用户类）无运行时判据 ⇒ 放行	emit-schema-faces 聚合矩阵	没测该层	keep	keep	—
does not report name-clash for a value-level template and persists the contract；the persisted contract is effective (effectiveContract reads it back)；is idempotent: the second emit reports no change；negative control: a real fn(...) binding	emit-schema-faces 聚合矩阵	没测该层	keep	keep	—
只卷 return 位：第三实参 { throws } 原样保留；改写后门禁真的转绿（引擎复核：无残留诊断）；改前形态（第三实参被卷进 nullable）会造出新的 entry-may-throw —— 回归有效性自证；quickfix 物化：门禁转绿 ⇒ titleKind=fix（可自动落盘）；证不出时降级 review（不自动落盘）；负控制：只有两个实参时照旧只卷 return 位；负控制：已包过 nullable 的 return 位不重复包（既有行为不变）	emit-schema-faces 聚合矩阵	没测该层	keep	keep	—
zod 面不出现 @@sym#1，也不要求该键；standard 面接受运行时真值（own string keys 只有 a）；guard 面接受运行时真值（改前 hasOwn '@@sym#1' 恒假）；迭代器协议槽（symbol + internal）同样不进产物；台账留痕：被摘掉的 symbol 槽进 dropped；负控制：普通字符串槽逐字不变	emit-schema-faces 聚合矩阵	没测该层	keep	keep	—
min(3)：zod 面渲染 `.min(3)`（不再是裸 z.array）；max(2)：zod 面渲染 `.max(2)`；strict gt/lt 归一：length > 3 ⇒ min 4；length < 3 ⇒ max 2；Abs 投影路径：节点带 minLen，standard 面拒收 [1] 放行 [1,2,3]；约束路径（c.element + 数组级 preds）：arr 节点带 minLen；约束路径 → zod 源码保留长度界；maxLen 同样可表达	emit-schema-faces 聚合矩阵	没测该层	keep	keep	—
带洞的元组不可序列化（整条放弃，不静默近似）；formatShape 仍把洞渲染成空槽（观测面不受影响）；带洞的见证不被写进源码（改前会写成 [1, undefined, 3]）；真实分析器：稀疏实参的见证被放弃，源码不被改写；负控制：稠密元组照常固化（洞判据不误伤稠密元组）；负控制：显式 undefined 元素（无洞）仍可表达	emit-schema-faces 聚合矩阵	没测该层	keep	keep	—
zod 面不发布数字下标字段（运行时不存在的自有属性）；standard 面接受真正的生成器对象（改前：required path ['0'] / ['1']）；guard 面不再要求 hasOwn(data, "0")，且真的接受生成器；异步生成器同理（@@asyncIterator 形态）；负控制：普通对象字面量的数字键仍是真实自有属性（不被误剔）	emit-schema-faces 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
bigint 字面量契约正常出结果（改前：抛 Do not know how to serialize a BigInt）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
往返保真：Infinity 字面量读回仍是 Infinity（改前：JSON ⇒ null ⇒ lit(null)）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
负控制：普通数字字面量契约显示与往返不变	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
解构形参：出 `<fn>Input` 对象校验器，且**不出**字段级顶层校验器	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
具名形参：`<fn>_<param>` 仍是真的整参校验器（负控制）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
返回面口径：恒名 `<fn>Output`（名字不随符号来源翻转——Bug 614）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
没有形参表面时，全部条目按整参处理（退化口径不变）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
Infinity 不再被写成 null（产物文本层）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
Infinity：产物放行真值、拒绝 null（语义层，Bug 1000 的假红/假绿）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
-Infinity 同样保真	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
bigint 字面量：序列化不抛（修前整条 export 崩溃、零产物）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
负控制：普通字面量的产物文本与判定不变	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
负控制：NaN 不落成 lit(null)，而是按 zod 面同口径降级并记账	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
生成的 standard 产物在 strict 下 0 诊断	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
负控制：修前形态（裸 JS helper）在同一检查器下报 TS7006	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
产物自带类型别名（消费方拿到 unknown 而非 any 的入参面）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
gt(0)：放宽 +Infinity，不放宽 -Infinity（-Infinity > 0 为假）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
ge(5)：同上（+Infinity 满足 ge）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
lt(5)：放宽 -Infinity，不放宽 +Infinity（+Infinity < 5 为假）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
le(5)：同上	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
int 真的排除非有限值 ⇒ 不放宽（`Number.isInteger(±Infinity)` 为假）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
多界合取：两端都满足才放宽对应端（gt(0) ∧ lt(10) ⇒ 两端都不满足）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
多界合取：同为下界时只放宽 +Infinity（gt(0) ∧ ge(2)）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
负控制：无 refinement 的 number 仍放宽 NaN ∪ ±Infinity（Bug 1001 不回退）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
负控制：lit 精度不受影响	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
Record<string, string | undefined>（process.env 的 brand）不进产物	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
Record<string, string>（process.versions 的 brand）不进产物	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
降级进 dropped 台账（brand 不可表达必须可观测）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
负控制：有运行时类的内建仍走 z.instanceof	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
用户类名不进产物（模块可 import，无 TS2304）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
降级必须进 dropped 台账（损失可观测，不是静默）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
负控制：运行时全局构造器仍走 z.instanceof（不得过度降级）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
负控制：非 brand 形态不受影响	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
Map / Set / WeakMap / WeakSet 渲染成带实参的泛型	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
负控制：非泛型 brand（RegExp / Date）与用户类 brand 原样保留	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
负控制：非法 brand 名仍落 unknown（不泄漏任意标识符）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
产物真的能过 tsc --noEmit --strict（改前 TS2314）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
改前形态确实红（裸 Map / Set / WeakMap ⇒ TS2314）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
库函数版：全局构造器 brand 只放行真实例	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
生成产物版：与 zod 面 z.instanceof(Date) 同判	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
负控制：名单外的 brand（用户类）无运行时判据 ⇒ 放行	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
does not report name-clash for a value-level template and persists the contract	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
the persisted contract is effective (effectiveContract reads it back)	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
is idempotent: the second emit reports no change	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
negative control: a real fn(...) binding is still name-clash (handwritten wins)	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
add mode also replaces the conflicting binding (LSP persist lens path)	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
只卷 return 位：第三实参 { throws } 原样保留	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
改写后门禁真的转绿（引擎复核：无残留诊断）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
改前形态（第三实参被卷进 nullable）会造出新的 entry-may-throw —— 回归有效性自证	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
quickfix 物化：门禁转绿 ⇒ titleKind=fix（可自动落盘）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
证不出时降级 review（不自动落盘）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
负控制：只有两个实参时照旧只卷 return 位	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
负控制：已包过 nullable 的 return 位不重复包（既有行为不变）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
zod 面不出现 @@sym#1，也不要求该键	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
standard 面接受运行时真值（own string keys 只有 a）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
guard 面接受运行时真值（改前 hasOwn '@@sym#1' 恒假）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
迭代器协议槽（symbol + internal）同样不进产物	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
台账留痕：被摘掉的 symbol 槽进 dropped	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
负控制：普通字符串槽逐字不变	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
min(3)：zod 面渲染 `.min(3)`（不再是裸 z.array）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
max(2)：zod 面渲染 `.max(2)`	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
strict gt/lt 归一：length > 3 ⇒ min 4；length < 3 ⇒ max 2	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
Abs 投影路径：节点带 minLen，standard 面拒收 [1] 放行 [1,2,3]	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
约束路径（c.element + 数组级 preds）：arr 节点带 minLen	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
约束路径 → zod 源码保留长度界	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
maxLen 同样可表达（回向同理）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
数组级不可表达的 pred 进 dropped 台账（不得静默丢）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
数组级不可表达的 pred 在约束路径同样进台账（与 Abs 路径同口径）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
负控制：无长度界的数组节点形态不变	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
与 absToConstraint 的衔接：契约 Abs 的数组长度界真的到了节点	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
带洞的元组不可序列化（整条放弃，不静默近似）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
formatShape 仍把洞渲染成空槽（观测面不受影响）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
带洞的见证不被写进源码（改前会写成 [1, undefined, 3]）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
真实分析器：稀疏实参的见证被放弃，源码不被改写	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
负控制：稠密元组照常固化（洞判据不误伤稠密元组）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
负控制：显式 undefined 元素（无洞）仍可表达	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
zod 面不发布数字下标字段（运行时不存在的自有属性）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
standard 面接受真正的生成器对象（改前：required path ['0'] / ['1']）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
guard 面不再要求 hasOwn(data, "0")，且真的接受生成器	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
异步生成器同理（@@asyncIterator 形态）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
负控制：普通对象字面量的数字键仍是真实自有属性（不被误剔）	dup:emit-schema-faces 聚合矩阵	commit:8fa85177
```
