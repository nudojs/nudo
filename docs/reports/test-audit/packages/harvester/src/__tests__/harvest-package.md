# packages/harvester/src/__tests__/harvest-package.test.ts

模块套件：harvest 包面（package exports/运行时导出/globals/disk）。

审计：87 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
resolvePackageRoot finds workspace packages；harvestPackage on typescript if available	harvest-package 聚合矩阵	没测该层	keep	keep	—
dtsFileScan: ENOENT 空扫描无标记；读错误（EISDIR）标 unreadable 且不进缓存；packageExportSurface: 入口读不了 ⇒ unresolved（公开面不可知，不折空）；collectDtsFiles: readdir 非 ENOENT 故障（ENOTDIR）计数上浮；ENOENT 静默；harvestPackage: package.json JSON 解析故障计数进 env.stats.skipped	harvest-package 聚合矩阵	没测该层	keep	keep	—
草稿键是 `default`（不是本地名 `helper`）；没有丢失 ⇒ 汇总行不虚增 skipped；**抄进侧车后 `default` 导出真的带上契约**（改前：零义务）	harvest-package 聚合矩阵	没测该层	keep	keep	—
`declare global` 的内容不进包名键（真实的导出仍在）；script 模式 `.d.ts` 的顶层声明不进包名键	harvest-package 聚合矩阵	没测该层	keep	keep	—
目录里的 `.d.ts` **全部**被投影（改前：只投影前 16 个）；第 17+ 个文件的导出**出现在草稿里**；没有截断 ⇒ 汇总行不虚增 skipped；单文件入口不受影响	harvest-package 聚合矩阵	没测该层	keep	keep	—
命名空间成员不落进 globals（不再凭空造出全局 `bar`）；命名空间对象 `Foo` 存在，成员挂在它下面（`Foo.bar`）；命名空间成员仍可调用（`Foo.bar()` 的返回类型是 number）；只有类型的命名空间不产生运行时对象（不凭空多出全局 `_`）；嵌套命名空间：成员留在最深层的命名空间里；两个命名空间的同名成员互不串（不当作 overload 合并）	harvest-package 聚合矩阵	没测该层	keep	keep	—
obj：索引签名 + 开放对象标志往返后仍在；obj：闭合对象**不**被投影成开放对象（不得过度放宽）；tuple：rest 槽往返后仍在；fn：ctor facet 往返后仍在（否则 new 落「可构造性未知」⇒ 假红）；fn：dual-facet 静态槽往返后仍在；ABI 已抬到 v15（A2 残余 callable 进 HarvestSig ⇒ 旧磁盘缓存必须 miss）；反向闸：投影里带 facet 的 HarvestSig 能还原出同样的显示面	harvest-package 聚合矩阵	没测该层	keep	keep	—
提升出的可选属性是 `number | undefined`（不是 `number`）；brand 面与提升面同口径（同一成员两个类型 ⇒ 不得出现）；对照：必选属性不被加上 undefined；对照：brand 面本来就保留 `?`（既有口径不被破坏）	harvest-package 聚合矩阵	没测该层	keep	keep	—
`export default function makeThing()` ⇒ 导出表有 default，没有 makeThing；`export default class Widget {}` ⇒ 导出表有 default，没有 Widget；`export default <局部名>` ⇒ default 取局部绑定的值；桥接层把 globals 的 default 提升成模块的 default 导出（默认导入不再是 unknown）	harvest-package 聚合矩阵	没测该层	keep	keep	—
函数改名再导出 ⇒ 导出表里有 `bar`，值是局部绑定的签名；`export { X as default }` ⇒ default 拿得到局部绑定；const 改名再导出 ⇒ 导出表里是局部常量的类型；`export type { X }`（类型位导出）不是运行时值 ⇒ 不进导出表，且计入 skipped	harvest-package 聚合矩阵	没测该层	keep	keep	—
有自有声明的模块不再丢掉星号再导出的名字；纯别名（没有自有声明）仍然与目标共用同一条记录；多目标星号再导出 ⇒ 名字全都进来	harvest-package 聚合矩阵	没测该层	keep	keep	—
模块记录生成，default = 被导出实体的值，且不产生具名导出；`export = <本地常量>` ⇒ default 是那个常量的值；解析不出来的 `export = <未知名字>` ⇒ 计入 skipped（汇总行有信号）	harvest-package 聚合矩阵	没测该层	keep	keep	—
再导出在前 / 声明在后 ⇒ 两种顺序逐项相同；函数再导出：声明在另一个文件里 ⇒ 两种顺序逐项相同；class 再导出：两种顺序逐项相同，且拿到的是构造签名	harvest-package 聚合矩阵	没测该层	keep	keep	—
顶层 `export = _` ⇒ 收割面有 default（值 = _ 的类型）；桥接层把顶层 `export =` 提升成包的 default 导出（默认导入不再是 unknown）；顶层 `export = <本地类>` ⇒ default 是构造签名	harvest-package 聚合矩阵	没测该层	keep	keep	—
同名真实导出存活（不被接口成员顶掉）；声明顺序不影响结果（realFirst / realLast 同形）；包的导出表里没有「幽灵导出」（接口成员不是模块导出）；包的导出表里真实导出不被挤掉（同名接口成员 + 同名函数导出）；对照：没有同名冲突时，真实导出照常在导出表里	harvest-package 聚合矩阵	没测该层	keep	keep	—
resolvePackageRoot 命中包本体（不是同名 @types）；收割到的是包自带那份声明（string，而不是 @types 的 number）；包本体没有声明时才回落 @types（lodash 形态不回归）	harvest-package 聚合矩阵	没测该层	keep	keep	—
包名键 = 包自身的顶层导出（不是 declare module 记录的同名导出）；子路径说明符拿到子路径自己的导出（不是根包的）；子路径说明符**不回落到包名键**（没有对应文件 ⇒ 落 unknown，不给根包的错值）	harvest-package 聚合矩阵	没测该层	keep	keep	—
`enum` 是运行时导出 ⇒ 进草稿（收割面看得见 `Color`）；`namespace` 是运行时导出 ⇒ 进草稿；匿名 `export default function` 进草稿（键 = `default`）；`export {x} from` / `export * from` **看得见**（逐个 push + note）；投影不了的运行时导出**计入 skipped**（汇总行不再报「0 skipped」）；`export * as ns from` 也是运行时	harvest-package 聚合矩阵	没测该层	keep	keep	—
declare module 记录的导出表只含真实声明（o / real）；磁盘缓存往返保留提升 provenance（冷 / 热两面同结论）	harvest-package 聚合矩阵	没测该层	keep	keep	—
导出面扫描登记 Space（不只是 plain）；包导出表含 Space，且成员 inner 有具体类型	harvest-package 聚合矩阵	没测该层	keep	keep	—
ns-first：helper 是可调用函数（不是命名空间对象）；两种声明顺序给出同一个形态	harvest-package 聚合矩阵	没测该层	keep	keep	—
控制组：单独声明 interface 不产生任何全局（基线）；顶层 `export declare const o: Opts;` ⇒ 成员不进全局面（修前：x / y 都是全局）；模块作用域的同一形态仍然提升（提升路径本身不被削弱）	harvest-package 聚合矩阵	没测该层	keep	keep	—
收割面不产生提升成员（x / y 只在接口内部可见）；emitEnvModule 的 globals 只落真实声明（o），不落提升成员	harvest-package 聚合矩阵	没测该层	keep	keep	—
存在未解析的 export *：helper（模块私有）不得出现在包导出集；对照组：没有 export * 时同样只导出 real（口径一致）；对照：helper 真的导出时照常在导出集里	harvest-package 聚合矩阵	没测该层	keep	keep	—
单个声明字面量往返后 conf = exact（不是 mock）；字面量并集（"\\" | "/"）往返后每个成员仍是字面量；整包序列化 → 回读：字面量不退化（冷 / 热两面同产物）	harvest-package 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
resolvePackageRoot finds workspace packages	dup:harvest-package 聚合矩阵	commit:8fa85177
harvestPackage on typescript if available	dup:harvest-package 聚合矩阵	commit:8fa85177
dtsFileScan: ENOENT 空扫描无标记；读错误（EISDIR）标 unreadable 且不进缓存	dup:harvest-package 聚合矩阵	commit:8fa85177
packageExportSurface: 入口读不了 ⇒ unresolved（公开面不可知，不折空）	dup:harvest-package 聚合矩阵	commit:8fa85177
collectDtsFiles: readdir 非 ENOENT 故障（ENOTDIR）计数上浮；ENOENT 静默	dup:harvest-package 聚合矩阵	commit:8fa85177
harvestPackage: package.json JSON 解析故障计数进 env.stats.skipped	dup:harvest-package 聚合矩阵	commit:8fa85177
草稿键是 `default`（不是本地名 `helper`）	dup:harvest-package 聚合矩阵	commit:8fa85177
没有丢失 ⇒ 汇总行不虚增 skipped	dup:harvest-package 聚合矩阵	commit:8fa85177
**抄进侧车后 `default` 导出真的带上契约**（改前：零义务）	dup:harvest-package 聚合矩阵	commit:8fa85177
`declare global` 的内容不进包名键（真实的导出仍在）	dup:harvest-package 聚合矩阵	commit:8fa85177
script 模式 `.d.ts` 的顶层声明不进包名键	dup:harvest-package 聚合矩阵	commit:8fa85177
目录里的 `.d.ts` **全部**被投影（改前：只投影前 16 个）	dup:harvest-package 聚合矩阵	commit:8fa85177
第 17+ 个文件的导出**出现在草稿里**	dup:harvest-package 聚合矩阵	commit:8fa85177
没有截断 ⇒ 汇总行不虚增 skipped	dup:harvest-package 聚合矩阵	commit:8fa85177
单文件入口不受影响	dup:harvest-package 聚合矩阵	commit:8fa85177
命名空间成员不落进 globals（不再凭空造出全局 `bar`）	dup:harvest-package 聚合矩阵	commit:8fa85177
命名空间对象 `Foo` 存在，成员挂在它下面（`Foo.bar`）	dup:harvest-package 聚合矩阵	commit:8fa85177
命名空间成员仍可调用（`Foo.bar()` 的返回类型是 number）	dup:harvest-package 聚合矩阵	commit:8fa85177
只有类型的命名空间不产生运行时对象（不凭空多出全局 `_`）	dup:harvest-package 聚合矩阵	commit:8fa85177
嵌套命名空间：成员留在最深层的命名空间里	dup:harvest-package 聚合矩阵	commit:8fa85177
两个命名空间的同名成员互不串（不当作 overload 合并）	dup:harvest-package 聚合矩阵	commit:8fa85177
obj：索引签名 + 开放对象标志往返后仍在	dup:harvest-package 聚合矩阵	commit:8fa85177
obj：闭合对象**不**被投影成开放对象（不得过度放宽）	dup:harvest-package 聚合矩阵	commit:8fa85177
tuple：rest 槽往返后仍在	dup:harvest-package 聚合矩阵	commit:8fa85177
fn：ctor facet 往返后仍在（否则 new 落「可构造性未知」⇒ 假红）	dup:harvest-package 聚合矩阵	commit:8fa85177
fn：dual-facet 静态槽往返后仍在	dup:harvest-package 聚合矩阵	commit:8fa85177
ABI 已抬到 v15（A2 残余 callable 进 HarvestSig ⇒ 旧磁盘缓存必须 miss）	dup:harvest-package 聚合矩阵	commit:8fa85177
反向闸：投影里带 facet 的 HarvestSig 能还原出同样的显示面	dup:harvest-package 聚合矩阵	commit:8fa85177
提升出的可选属性是 `number | undefined`（不是 `number`）	dup:harvest-package 聚合矩阵	commit:8fa85177
brand 面与提升面同口径（同一成员两个类型 ⇒ 不得出现）	dup:harvest-package 聚合矩阵	commit:8fa85177
对照：必选属性不被加上 undefined	dup:harvest-package 聚合矩阵	commit:8fa85177
对照：brand 面本来就保留 `?`（既有口径不被破坏）	dup:harvest-package 聚合矩阵	commit:8fa85177
`export default function makeThing()` ⇒ 导出表有 default，没有 makeThing	dup:harvest-package 聚合矩阵	commit:8fa85177
`export default class Widget {}` ⇒ 导出表有 default，没有 Widget	dup:harvest-package 聚合矩阵	commit:8fa85177
`export default <局部名>` ⇒ default 取局部绑定的值	dup:harvest-package 聚合矩阵	commit:8fa85177
桥接层把 globals 的 default 提升成模块的 default 导出（默认导入不再是 unknown）	dup:harvest-package 聚合矩阵	commit:8fa85177
函数改名再导出 ⇒ 导出表里有 `bar`，值是局部绑定的签名	dup:harvest-package 聚合矩阵	commit:8fa85177
`export { X as default }` ⇒ default 拿得到局部绑定	dup:harvest-package 聚合矩阵	commit:8fa85177
const 改名再导出 ⇒ 导出表里是局部常量的类型	dup:harvest-package 聚合矩阵	commit:8fa85177
`export type { X }`（类型位导出）不是运行时值 ⇒ 不进导出表，且计入 skipped	dup:harvest-package 聚合矩阵	commit:8fa85177
有自有声明的模块不再丢掉星号再导出的名字	dup:harvest-package 聚合矩阵	commit:8fa85177
纯别名（没有自有声明）仍然与目标共用同一条记录	dup:harvest-package 聚合矩阵	commit:8fa85177
多目标星号再导出 ⇒ 名字全都进来	dup:harvest-package 聚合矩阵	commit:8fa85177
模块记录生成，default = 被导出实体的值，且不产生具名导出	dup:harvest-package 聚合矩阵	commit:8fa85177
`export = <本地常量>` ⇒ default 是那个常量的值	dup:harvest-package 聚合矩阵	commit:8fa85177
解析不出来的 `export = <未知名字>` ⇒ 计入 skipped（汇总行有信号）	dup:harvest-package 聚合矩阵	commit:8fa85177
再导出在前 / 声明在后 ⇒ 两种顺序逐项相同	dup:harvest-package 聚合矩阵	commit:8fa85177
函数再导出：声明在另一个文件里 ⇒ 两种顺序逐项相同	dup:harvest-package 聚合矩阵	commit:8fa85177
class 再导出：两种顺序逐项相同，且拿到的是构造签名	dup:harvest-package 聚合矩阵	commit:8fa85177
顶层 `export = _` ⇒ 收割面有 default（值 = _ 的类型）	dup:harvest-package 聚合矩阵	commit:8fa85177
桥接层把顶层 `export =` 提升成包的 default 导出（默认导入不再是 unknown）	dup:harvest-package 聚合矩阵	commit:8fa85177
顶层 `export = <本地类>` ⇒ default 是构造签名	dup:harvest-package 聚合矩阵	commit:8fa85177
同名真实导出存活（不被接口成员顶掉）	dup:harvest-package 聚合矩阵	commit:8fa85177
声明顺序不影响结果（realFirst / realLast 同形）	dup:harvest-package 聚合矩阵	commit:8fa85177
包的导出表里没有「幽灵导出」（接口成员不是模块导出）	dup:harvest-package 聚合矩阵	commit:8fa85177
包的导出表里真实导出不被挤掉（同名接口成员 + 同名函数导出）	dup:harvest-package 聚合矩阵	commit:8fa85177
对照：没有同名冲突时，真实导出照常在导出表里	dup:harvest-package 聚合矩阵	commit:8fa85177
resolvePackageRoot 命中包本体（不是同名 @types）	dup:harvest-package 聚合矩阵	commit:8fa85177
收割到的是包自带那份声明（string，而不是 @types 的 number）	dup:harvest-package 聚合矩阵	commit:8fa85177
包本体没有声明时才回落 @types（lodash 形态不回归）	dup:harvest-package 聚合矩阵	commit:8fa85177
包名键 = 包自身的顶层导出（不是 declare module 记录的同名导出）	dup:harvest-package 聚合矩阵	commit:8fa85177
子路径说明符拿到子路径自己的导出（不是根包的）	dup:harvest-package 聚合矩阵	commit:8fa85177
子路径说明符**不回落到包名键**（没有对应文件 ⇒ 落 unknown，不给根包的错值）	dup:harvest-package 聚合矩阵	commit:8fa85177
`enum` 是运行时导出 ⇒ 进草稿（收割面看得见 `Color`）	dup:harvest-package 聚合矩阵	commit:8fa85177
`namespace` 是运行时导出 ⇒ 进草稿	dup:harvest-package 聚合矩阵	commit:8fa85177
匿名 `export default function` 进草稿（键 = `default`）	dup:harvest-package 聚合矩阵	commit:8fa85177
`export {x} from` / `export * from` **看得见**（逐个 push + note）	dup:harvest-package 聚合矩阵	commit:8fa85177
投影不了的运行时导出**计入 skipped**（汇总行不再报「0 skipped」）	dup:harvest-package 聚合矩阵	commit:8fa85177
`export * as ns from` 也是运行时导出面 ⇒ 看得见	dup:harvest-package 聚合矩阵	commit:8fa85177
`export import x = require("m")` 不再静默丢弃	dup:harvest-package 聚合矩阵	commit:8fa85177
declare module 记录的导出表只含真实声明（o / real）	dup:harvest-package 聚合矩阵	commit:8fa85177
磁盘缓存往返保留提升 provenance（冷 / 热两面同结论）	dup:harvest-package 聚合矩阵	commit:8fa85177
导出面扫描登记 Space（不只是 plain）	dup:harvest-package 聚合矩阵	commit:8fa85177
包导出表含 Space，且成员 inner 有具体类型	dup:harvest-package 聚合矩阵	commit:8fa85177
ns-first：helper 是可调用函数（不是命名空间对象）	dup:harvest-package 聚合矩阵	commit:8fa85177
两种声明顺序给出同一个形态	dup:harvest-package 聚合矩阵	commit:8fa85177
控制组：单独声明 interface 不产生任何全局（基线）	dup:harvest-package 聚合矩阵	commit:8fa85177
顶层 `export declare const o: Opts;` ⇒ 成员不进全局面（修前：x / y 都是全局）	dup:harvest-package 聚合矩阵	commit:8fa85177
模块作用域的同一形态仍然提升（提升路径本身不被削弱）	dup:harvest-package 聚合矩阵	commit:8fa85177
收割面不产生提升成员（x / y 只在接口内部可见）	dup:harvest-package 聚合矩阵	commit:8fa85177
emitEnvModule 的 globals 只落真实声明（o），不落提升成员	dup:harvest-package 聚合矩阵	commit:8fa85177
存在未解析的 export *：helper（模块私有）不得出现在包导出集	dup:harvest-package 聚合矩阵	commit:8fa85177
对照组：没有 export * 时同样只导出 real（口径一致）	dup:harvest-package 聚合矩阵	commit:8fa85177
对照：helper 真的导出时照常在导出集里	dup:harvest-package 聚合矩阵	commit:8fa85177
单个声明字面量往返后 conf = exact（不是 mock）	dup:harvest-package 聚合矩阵	commit:8fa85177
字面量并集（"\\" | "/"）往返后每个成员仍是字面量	dup:harvest-package 聚合矩阵	commit:8fa85177
整包序列化 → 回读：字面量不退化（冷 / 热两面同产物）	dup:harvest-package 聚合矩阵	commit:8fa85177
```
