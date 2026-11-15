# packages/core/src/algebra/__tests__/algebra-inlay.test.ts

模块：返回位 inlay 渲染。根因集中在五类：同名导出槽按 `env.fns` 名字取值导致标签与锚点串位、匿名 default 导出没有锚点、inlay 未消费用户公理、表达式体箭头锚点落在表达式起点、内部 term id 上屏，以及 `-0`/union 成员在去重与渲染中丢失。原夹具多为普通具名函数与块体，缺口属于夹具形态或整层未测。

```audit
title	rootCause	gap	action	status	evidence
同名槽（`function f` + `exports.f`）不产返回 inlay（不渲染别的函数计算式）	listFunctions 逐节点取锚点、取值却按名走 generalizeFromAst；同名导出槽下标签来自另一函数。旧夹具没有同名槽形态。	夹具漏形态	keep	keep	—
对照：改导出名后两条 inlay 都在，且各自是本函数的计算式	同名槽修复的负控制：不同名时两条 inlay 必须各自取本函数；旧测试没有同名/不同名对照。	夹具漏形态	keep	keep	—
类实例方法与静态方法同名 ⇒ 同样不产 inlay	同名判定从函数面扩展到类实例/静态方法；旧夹具只覆盖顶层导出槽。	夹具漏形态	keep	keep	—
`export default (a) => a + 1` 有返回 inlay	匿名 default 表达式没有绑定名，listFunctions 取不到锚点；旧夹具只覆盖具名导出。	夹具漏形态	keep	keep	—
`export default function (a) { … }`（匿名函数表达式）有返回 inlay	匿名 default 函数表达式同样缺锚点；旧测试未覆盖该声明形态。	夹具漏形态	keep	keep	—
对照：具名 default 导出仍有一条 inlay（不回退）	匿名 default 修复的负控制：具名 default 仍须有一条 inlay；旧断言未在同一路径对拍。	夹具漏形态	keep	keep	—
有公理 ⇒ inlay `0 | number`；无公理 ⇒ `number`；两者不同	inlay 返回位未消费 `@nudo:assume`/invariant 公理，旧测试只比对无公理形状。	没测该层	keep	keep	—
inlay 与 check 面逐字同源（同一 Abs 的两个渲染面）	两面各自渲染导致公理参与度不同；旧测试没有跨面逐字对拍。	门禁未跑	keep	keep	—
公理折出的循环值参与算术（inv#N + 1）⇒ 内部 id 不上屏、退 check 同款形状	公理折叠产生的内部 id 进入了 inlay 文本；旧测试未覆盖公理+算术路径。	没测该层	keep	keep	—
表达式体：锚点在表达式结束处（改前 = 表达式起点 ⇒ 劈开源码行）	表达式体箭头没有块 `{`，锚点回落到表达式起点；旧夹具只覆盖块体。	夹具漏形态	keep	keep	—
块体：锚点仍是 `{` 的位置（不变）	块体锚点是既有正确行为，本行是表达式体改造的负控制；旧测试没有同文件对拍。	夹具漏形态	keep	keep	—
箭头块体：锚点仍是 `{` 的位置（不变）	箭头块体与普通块体锚点同口径，旧测试未显式覆盖箭头块体。	夹具漏形态	keep	keep	—
表达式体（对象字面量）：锚点在字面量之后（不插进字面量内部）	对象字面量表达式体的结束位置受括号影响，旧测试没有该形态。	夹具漏形态	keep	keep	—
提示文本不含 `len#N` 这类内部 id	内部 term id 直接进入 label/tooltip；旧测试只断言语义形状，未检查文本泄漏。	没测该层	keep	keep	—
内部 id 换成稳定可读标识 `len`	修复要求把 id 映射为稳定可读名；旧测试没有跨调用稳定性断言。	没测该层	keep	keep	—
同一份源码多次调用：提示文本逐字相同（稳定）	计数器递增会让同一源码的提示文本漂移；旧测试没有重复调用对拍。	门禁未跑	keep	keep	—
缓存未命中（源码改动 ⇒ 计数器递增）时也不泄漏内部 id	缓存未命中路径的 id 映射未覆盖；旧测试只走缓存命中。	夹具漏形态	keep	keep	—
`-0` 不被渲染成 `0`	渲染面把 -0 折成 0；旧夹具只使用普通数字与前缀。	夹具漏形态	keep	keep	—
union 的 `-0` 臂不被去重键吞掉（0 | -0 两个成员都在）	union 去重键同源于渲染文本，-0/0 被并成一个成员；旧测试未覆盖。	夹具漏形态	keep	keep	—
`-0` 与 `0` 是不同成员（去重键同源于渲染文本）	去重键必须区分 -0/0；旧断言只比较成员数量而非身份。	夹具漏形态	keep	keep	—
```
