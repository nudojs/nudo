# packages/core/src/algebra/__tests__/algebra-transpile.test.ts

模块套件：转译器语句/表达式/类/作用域面。

审计：268 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
f?.(1) ⇒ 1（改前 nudo:internal 崩溃）；f?.name ⇒ 'f'（属性读面同样不崩）；同模块无关导出不受影响；负控制：Abs 基值的可选链短路语义不变	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
实例化谓词含 undefined 臂（shape 分支不再提前 return）；显式 f(undefined) ⇒ 零违例（改前报 object shape at x）；合法对象 f({ a: 1 }) ⇒ 零违例；省略该位 f() ⇒ 零违例（元数检查已放行）；真违例 f({ a: 0 }) ⇒ 报 x.a > 0；负控制：显式 null 仍不被 .optional() 接纳	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
类体内 this.m(-1) ⇒ K.m 参数契约执法（改前零诊断）；负控制：this.m(1) 合法 ⇒ 零违例	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
c["m"](-1) 与 c.m(-1) 同判据；K["s"](-1)（静态成员）⇒ K.s 执法	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
s += 1 步进不再误折 TypeError（原生 3）；n = n + 1 通用步进形态同样 total；test 里的复合赋值（(s+=1)<3）也不误报；负控制：写真正的 const 仍抛 TypeError	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
"%s 收到 1.5 ⇒ 报 x is int"	表驱动用例：%s 收到 1.5 ⇒ 报 x is int；枚举同一不变量下的输入/期望组合，属既有表行补齐。	夹具漏形态	keep	keep	—
"负控制：%s 收到满足某一支的 %s ⇒ 零违例"	表驱动用例：负控制：%s 收到满足某一支的 %s ⇒ 零违例；枚举同一不变量下的输入/期望组合，属既有表行补齐。	夹具漏形态	keep	keep	—
"%s 收到 %s ⇒ 报一条违例（改前假绿）"	表驱动用例：%s 收到 %s ⇒ 报一条违例（改前假绿）；枚举同一不变量下的输入/期望组合，属既有表行补齐。	夹具漏形态	keep	keep	—
去掉 .optional() 的同一契约仍报（控制组）；等价写法 union(base, lit(undefined)) 与 .optional() 结论一致	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
"负控制：%s 收到 undefined ⇒ 零违例（088 不回归）"	表驱动用例：负控制：%s 收到 undefined ⇒ 零违例（088 不回归）；枚举同一不变量下的输入/期望组合，属既有表行补齐。	夹具漏形态	keep	keep	—
"负控制：%s 收到满足界的 %s ⇒ 零违例"	表驱动用例：负控制：%s 收到满足界的 %s ⇒ 零违例；枚举同一不变量下的输入/期望组合，属既有表行补齐。	夹具漏形态	keep	keep	—
the declaring function keeps its mock；other functions do not see the mock (no file-level leak)；injected mocks that no directive declares are kept as fallback	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
解构声明 + @nudo:as：各绑定取覆盖形状的同名槽；解构声明 + @nudo:as：数组模式按位置投影覆盖值；解构声明 + @nudo:as：改名绑定按源键取槽（原生语义）；对照钉：Identifier 形态的覆盖仍生效（行为不退化）；负控制：无指令的同一源码行为不变（不凭空得到覆盖类型）；负控制：覆盖只作用于被标注的那条语句；原 init 仍求值：副作用保留（@nudo:as 是类型覆盖不是求值替换）；原 init 仍求值：throws 域保留（不被覆盖吞掉）	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
对象 / 改名 / 数组 / 嵌套 / rest / 默认值 / export 包装 的子名都进绑定表；绑定表里的值 = 解构出来的槽值（不是 any）；for 头解构：循环体内子名拿到元素槽类型（契约面 signature 不是 any）；端到端：实参来自解构绑定 ⇒ 契约违例被报出（改前静默跳过 = 假绿）；负控制：Identifier 形态仍在绑定表里（本次修改不退化）；负控制：块内解构子名不是顶层绑定；负控制：for 头解构子名不是顶层绑定（循环作用域）	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
入口 Abs 带 undefined 臂（与 union(lit(undefined), number()) 同构）；调用点谓词允许 undefined（`or(<base>, eq(x, undefined))`）；返回位：契约承认 nullish（`return undefined` 不再假红）；端到端：调用点传 undefined ⇒ 零 error（改前 nudo:constraint-violated）；端到端：返回 undefined 的实现对 `number()	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
三形态（说明符语句在类前 / 类后 / 无）的符号面逐字相同；pre 形态（说明符语句在类前）的类方法签名不是 unknown；负控制：`export const q = 1`（声明语句）形态不受影响；check 面：三形态的签名显示逐字相同（不是 unknown）；契约面：类方法返回类型契约违规必须是 error（不是 warning）	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
产物里不再有重复词法声明（修前：同作用域两个 `let __nudoLv0`）；整模块不再 fail-closed：f() 结果 = 原生 4（修前：SyntaxError ⇒ unknown）；check 面：受损导出拿到签名 + 无假 nudo:opaque-result（修前：f 退 unknown + 假 opaque）；负控制：用户不同名时槽名保持原形 `__nudoLv0`（产物逐字不变）	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
f(...args) 展开到 2 参函数 ⇒ 不报元数错（个数不可判 ⇒ 跳过）；add(...xs)（xs 是局部数组）⇒ 不报元数错；数组字面量展开的空洞算一个实参（three(...[1,,3]) ⇒ 3 个）；rest 长度边界在展开处停止（few(1, ...more) 不违反 length <= 1）；负控制：真·少传实参仍然报元数错（不掩盖真违规）；负控制：数组字面量展开的实参个数仍按展开后计（f(...[1,2,3]) 对 2 参函数 ⇒ 多传警告）	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
形参同名 ⇒ 不套顶层函数的元数；局部 const 同名 ⇒ 不套顶层函数的元数；嵌套函数同名 ⇒ 不套顶层函数的元数；for-of 绑定同名 ⇒ 不套顶层函数的元数；解构绑定同名 ⇒ 不套顶层函数的元数；负控制：没有同名遮蔽 ⇒ 顶层函数的元数照常检查（真违规仍报）；负控制：别名绑定仍按别名解析（const f = log ⇒ f() 查 log 的元数）	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
两个函数里的同名局部（new A / new B）不再串味 ⇒ 零违例；负控制：A.m 的契约仍执法（c.m(-1) 报违例）；负控制：B.m 的契约仍执法（c.m(1) 报违例）；形参遮蔽顶层实例 ⇒ 不套用顶层实例的成员契约；重新赋值使成员别名失效（c = {m:x=>x} 之后不再套 C.m 的契约）；负控制：顶层实例的成员契约仍执法（未被遮蔽 / 未重新赋值）	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
JSDoc @param {number} [x] ⇒ h() 不报元数错；JSDoc @param {string} [y="a"] ⇒ 带默认值的方括号形态也算可选；TS x?: number ⇒ h() 不报元数错；TS export function h(x?: number) ⇒ 同样不报（JSDoc/TS 挂在 export 上）；负控制：必需形参少传实参仍然报元数错；负控制：JSDoc 的非方括号 @param 是必填 ⇒ 仍报元数错	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
具名函数表达式：侧车契约绑定 ⇒ 报 constraint-violated（修前：只有 unproven-return + unknown）；与其它导出形态**同口径**（匿名 FE / 箭头 / 对象方法 / exports.greet = 具名 FE）；成员键不串：{ a: function b(){…}, b: () => "bad" } ⇒ a / b 各归各	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
默认形参吃下第 2 个实参 ⇒ 不报超参；真超参（形参位不够）⇒ 仍报 warning；rest 形参吸收多余实参 ⇒ 不报超参；少传必填位 ⇒ 仍是 error（口径不变）；端到端：check 面上 f(1, 2) 不再误报（文档示例 cartTotal(items, couponPercent = 0) 同形）	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
闸门面：整模块不再 fail-closed ⇒ 其它导出的 L2 门禁仍触发；闸门面：常见的 fetch 形态（早退守卫 + await）不再整模块假绿；安全网：关闭 asyncGen 后同一份源仍能编译（生成器路径的兜底）；位置表：成员调用实参 / 成员赋值 / 循环判别式 / case 测试 / 守卫之后 ⇒ 判 thunk	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
导入类实例：const c = new K(); c.m(-1) ⇒ K.m 违例；导入类内联：new K().m(-1) ⇒ K.m 违例；导入类静态：K.s(-1) ⇒ K.s 违例；导入类：合法实参（1 / 5）三种形态都不报；导入普通函数 f(-1) 既有强制不回归（负控制）；导入普通函数 f(5) 不报（负控制）	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
本地类实例：const c = new L(); c.m(-1) ⇒ L.m（既有路径）；本地类内联：new L().m(-1) ⇒ L.m；本地类静态：L.s(-1) ⇒ L.s；本地类：合法实参（1 / 5）不报（负控制）	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
静态同名调用 C.m(-1) ⇒ 只套静态契约（C.static.m）；实例同名调用（new C().m / const c = new C(); c.m）⇒ 实例无契约，零诊断；静态同名调用合法实参 C.m(1) 不报（负控制）；本地类同名：C.m(-1) 只套静态契约，实例调用零诊断	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
extends 且 m 不是 own 方法 ⇒ 零诊断；构造器 this.m = … 覆盖方法 ⇒ 零诊断；接收者被遮蔽（形参 / 局部同名）或重新赋值 ⇒ 零诊断；静态 / 实例交叉调用（K.m 实例方法 / new K().s 静态方法）⇒ 零诊断；getter / computed 成员 ⇒ 零诊断；未契约的导入类方法 ⇒ 零新诊断（不扩面）	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
实例（const c = new L()）：c.m(-1) ⇒ L.m 违例；内联 new：new L().m(-1) ⇒ L.m 违例；静态：L.s(-1) ⇒ L.s 违例；合法实参（1 / 5）三种形态都不报（负控制）；未契约的本地类 ⇒ 零新诊断（不扩面）；本地类方法不进签名普查面（调用点义务 ≠ 签名面扩面）；本地类的侧车契约不绑（未导出名）——与未导出本地函数同口径（parity）；守卫：extends 无 own / 构造器 this.m / getter /	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
匿名 default 类（指令契约）⇒ default.m 违例；匿名 default 类（侧车 default_m）⇒ default.m 违例；匿名 default 类：合法实参不报（负控制）；匿名 default 类未契约 ⇒ 零诊断（不扩面）；具名 export default class K 已可用（负控制，不得回归）；匿名 default 类的静态成员：K.s(-1) ⇒ default.s 违例	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
new ns.K().m(-1) ⇒ K.m 违例；ns.K.s(-1) ⇒ K.s 违例；命名空间：合法实参不报（负控制）；命名空间名被形参 / 局部 const 遮蔽 ⇒ 零诊断（守卫）；命名空间类：实例方法不许当静态、静态不许当实例 ⇒ 零诊断（守卫）；require 的模块命名空间同一路径（const m = require）；命名空间经再导出 index（parity：普通函数 ns.f 也不执法）⇒ 0	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
export { K } from：成员调用执法（不回归）；export * from：成员调用执法（不回归）；别名再导出 export { K as J } from / import+export ⇒ 0（parity：普通函数同样不执法）；再导出环（a ↔ b）终止且零诊断	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
"every same-named user class wins over the builtin dispatch table"	"`$new` 先查内建派发表、从不查用户类注册表 ⇒ 用户同名类被内建 构造器吞掉（`class URL {}` 的实例被判成 host URL）。 修复：用户类优先。 断言：expect(sigOf(r, \"shadowUrl\")).toBe(\"URL\");；expect(sigOf(r, \"shadowError\")).toBe(\"Error\");"	夹具漏形态	keep	keep	—
derived constructor and its call site may throw ReferenceError；normal derived constructors stay total	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
$copy 对非 Abs 宿主值原值返回（不读 .shape）；分支块内写宿主全局可求值（不产生内部异常），且不污染宿主全局；顶层形态（对照组）同样不崩 —— 两种写法结论一致	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
本地调用：契约可选位少传实参 ⇒ 不报 nudo:arg-count；跨文件调用：契约可选位少传实参 ⇒ 不报 nudo:arg-count（与本地同结论）；本地调用：真正缺必填实参仍报（对照组，两位都必填）；跨文件调用：真正缺必填实参仍报（对照组，两位都必填）；两位都传齐 ⇒ 两面都不报元数错	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
builder 层：三个变换都保留 isOptional（改前全部丢失）；入口 Abs 层：字段槽仍是 optional（渲染带 `s?`）；前置条件层：字段谓词不再要求必填（可选字段不进硬 pred）；端到端：合法调用 f({}) 零 error、签名面保留 `s?`（改前 3 条假红）；负控制：不套变换时行为不变（直接把 optional 抬到字段上）；负控制：非可选 shape 经变换后仍必填（不得被顺手放宽）	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
"returns the first getter value (1), not the second (two)"	"`g.m?.()`（可选调用）对同一 getter 读两次 ⇒ 第二次读到不同值， 推断结果错位。 修复：`$invoke`/`$invokeKey` 接受预读值，可选链只读一次。 断言：expect(val(SRC)).toEqual({ ok: true, value: 1 });"	没测该层	keep	keep	—
可选契约 + 源槽存在且为 undefined ⇒ 可赋；对照：必填契约 + 同一源 ⇒ 仍判红；可选契约 + 源值 string | undefined ⇒ 可赋（undefined 臂被吸收）；不得整体放宽：number | undefined ⊄ optional string；null 不被可选槽吸收（strictNullChecks）；源槽标 optional 时：可赋给可选目标槽，不可赋给必填目标槽；源槽缺失：可选目标槽放行、必填目标槽判红（既有口径）；非空值仍按	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
optional 契约 + `{ a: undefined }` / `{}` / `{ a: 'x' }` 全部放行；required 契约 + `{ a: undefined }` 仍判红（对照）；required 契约 + `{ a: 'x' }` 放行（对照的正例）；optional 契约不吸收 null / 错 prim（不整体放宽）	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
optional 契约 + 见证 `{ a: undefined }` ⇒ 不报 case-inconsistency；required 契约 + 同一见证 ⇒ 仍报 case-inconsistency（对照）；optional 契约：见证 `{ a: 'x' }` 放行、`{ a: 1 }` / `{ a: null }` 仍报	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
class 声明被调 → throws TypeError（此前 unknown + never）；class 声明被调（try/catch 吸收）→ catch 命中 TypeError；非空类表达式被调 → throws TypeError；空类体类表达式被调（$classExpr 快路径）→ throws TypeError；控制组：new A() 正常构造；静态方法调用正常；普通函数调用正常	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
Object.keys 剔除不可枚举自有键（宿主同键集）；Object.values 同键集；Object.entries 同键集（键值对不重复发布不可枚举键）；JSON.stringify 只序列化可枚举自有键；Object.assign 只拷可枚举自有键；spread 只拷可枚举自有键；五个枚举面 + for-in + gOPN 同结论（引擎内部不再互斥）；描述符面：gOPD 说 x 是「自有 + 不可枚举」的数据属性；单变量对照：普通对象（同一 defineProper	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
this.x = v 对 module.exports 可见（不再定抛）；只用顶层 this 的 CJS 源（无 export 语法）：this.x = v 不再定抛，槽进导出面；ESM 源顶层 this 仍是 undefined（原生一致）⇒ this.x = v 抛	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
"无 unproven-return，返回面是 number"	"旧行为：前提槽非 pTrue ⇒ **整体**关掉 callee 契约面的采用（#152 的 soundness 护栏）。 一条与本次调用无关的惰性公理（如 `p <= q`，p/q 是调用方 的局部量）会把调用方的返回类型退化成 `any`，并造出假红 （nudo:unproven-return / nudo:entry-may-throw）。 断言：expect(r.issues.some((i) => i.code === \"nudo:unproven-return\")).toBe(false);；expect(sigOf(r, \"sim\")).toContain(\"number\");"	没测该层	keep	keep	—
不产生假红（unproven-return 不在）；返回面仍是 number（旧行为退化成 any）	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
采用被跳过 ⇒ 返回面不可证（unproven-return 在）；不得出现靠引理折出的假证明（assume-relied 不在）	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
实例方法显式 throw ⇒ 报 nudo:entry-may-throw（改前：零 error / exit 0）；静态方法与顶层函数口径不变（各 1 条 L2）；实例方法必抛 ⇒ 签名面为 never（改前：unknown = 谎称「推断失败」）；eval 层：实例方法体必抛 ⇒ 调用返回 never + throws TypeError（无回归）	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
实例方法 ⇒ analyzed 且 throws 域带 TypeError（改前：absent / 无证据）；静态方法口径不变（仍走 $staticInvoke）；export default class 的实例方法同样走实例桥（导出槽兜底）	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
g().x++（不可写回的 update 目标）⇒ 报 nudo:entry-may-throw（改前：零 error）；delete (g() + 1)（非成员 delete 目标）⇒ 报 nudo:entry-may-throw（改前：零 error）；fail-closed 证据可被 @nudo:throws Error 显式放行（用户可自证有意 fail-fast）；同模块的**其它**入口不做过度断言（原生下它们并不抛）；eval 层：可分析的孪生表达式记 Type	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
转译器拒绝 ⇒ 结局是 unanalyzable（不是 analyzed / absent）；可分析的入口 ⇒ 结局仍是 analyzed（fail-closed 不得误伤正常路径）	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
带 `this: T` 的函数声明：实参按**实参位**绑定（`this` 不占位）；带 `this: T` 的函数声明：形参表里没有 `this`；带 `this: T` 的类方法：形参表里没有 `this`；带 `this: T` 的类方法：模块装载成功（产物语法合法，不抛 SyntaxError）	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
identifier named this is skipped from the formal param table；this does not appear in display / signature / contract names；generalize keeps only the real runtime params；check signature lists one param, not two；a param literally named this ca	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
模型层：默认形参带 optional 标记、普通形参不带；端到端（读侧）：f(a, b = 1) 赋给「只需 1 个必选元」的 fn ⇒ 可赋值；反向控制：f(a, b)（无默认）⇒ 不可赋值（必选 2 > 目标必选 1）；反向控制：f(a, b = 1) 赋给「0 个必选元」的 fn ⇒ 仍不可赋值（a 是必选）；缺省标记时回退名字后缀判据（既有行为不变）；公开口径 requiredFnArity 一字不改	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
箭头函数：默认形参位标为可省略；箭头函数：普通形参位不标为可省略；必选元数按标记算：`(x = 1) => x` 赋给「0 个必选元」的 fn ⇒ 可赋值；反向控制：无默认值的 `(x, y)` 赋给「0 个必选元」的 fn ⇒ 不可赋值；反向控制：默认形参**不**抹掉前面形参的必选性（`(x, y = 1)` 仍需 1 个）	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
default param is marked optional；pattern with a default value is optional, bare pattern is not；the marker is independent of the display name (no name-suffix guessing)	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
合法调用 sum(1, 2) 不报违例（rest 实参聚合成 [1, 2] 再与 array 契约比）；sum(1, -2) 报违例，且 actual 是整个聚合值 [1, -2]（不是首个实参 1）	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
同名时：静态方法改名 C.static.m，实例方法保名 C.m；同名时：按名查找 C.m 命中的是**实例**方法的注释块；同名时：两条契约各自可见（互不顶替）；只有静态方法时：scope 名仍是 C.m（与普查面同名，不改名）；只有实例方法时：scope 名仍是 C.m（对照）；同名时：普查面仍只登记 C.m（族 11 口径未变）	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
exports.f = function ⇒ scope 名是导出槽名 f；module.exports.f = function ⇒ scope 名是 f；module.exports = function ⇒ scope 名是 default；module.exports = function inner() ⇒ 回退内层 id（普查面同口径）；exports.f = 箭头 ⇒ scope 名是 f；语句级 JSDoc 挂到 CJS scope 上（不再蒸发）；L1 契约	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
union(number(), string()) 收到 true ⇒ 判违例（改前 0 违例 = 假绿）；union(number(), boolean()) 收到 'x' ⇒ 判违例（改前 0 违例 = 假绿）；union(number(), lit('a')) 收到 true ⇒ 判违例（改前 0 违例 = 假绿）；union(number(), string()) 收到 's' ⇒ 放行（成员域内的实参不误伤）；union(number(), string()) 收到	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
shape 成员：union(user, lit(1)) 收到 { id: "x" } 报违例；形态①：array 成员——union(array(number()), lit(1)) 收到 ["x"] 报违例；形态②：嵌套 shape 成员——收到 { a: { b: "x" } } 报违例；形态③：成员带界——union(number().gt(0), shape({a:number()})) 收到 { a: "x" } 报违例；析取语义：任一成员满足即放行（不误报）；标	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
memberToFn 收下本地类实例成员（c.m ⇒ C.m）；c.m(-1) 违反类方法契约 ⇒ nudo:constraint-violated；满足契约的实参不报（c.m(1) 放行）	algebra-transpile 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
f?.(1) ⇒ 1（改前 nudo:internal 崩溃）	dup:algebra-transpile 聚合矩阵	commit:212feaea
f?.name ⇒ 'f'（属性读面同样不崩）	dup:algebra-transpile 聚合矩阵	commit:212feaea
同模块无关导出不受影响	dup:algebra-transpile 聚合矩阵	commit:212feaea
负控制：Abs 基值的可选链短路语义不变	dup:algebra-transpile 聚合矩阵	commit:212feaea
实例化谓词含 undefined 臂（shape 分支不再提前 return）	dup:algebra-transpile 聚合矩阵	commit:212feaea
显式 f(undefined) ⇒ 零违例（改前报 object shape at x）	dup:algebra-transpile 聚合矩阵	commit:212feaea
合法对象 f({ a: 1 }) ⇒ 零违例	dup:algebra-transpile 聚合矩阵	commit:212feaea
省略该位 f() ⇒ 零违例（元数检查已放行）	dup:algebra-transpile 聚合矩阵	commit:212feaea
真违例 f({ a: 0 }) ⇒ 报 x.a > 0	dup:algebra-transpile 聚合矩阵	commit:212feaea
负控制：显式 null 仍不被 .optional() 接纳	dup:algebra-transpile 聚合矩阵	commit:212feaea
类体内 this.m(-1) ⇒ K.m 参数契约执法（改前零诊断）	dup:algebra-transpile 聚合矩阵	commit:212feaea
负控制：this.m(1) 合法 ⇒ 零违例	dup:algebra-transpile 聚合矩阵	commit:212feaea
c["m"](-1) 与 c.m(-1) 同判据	dup:algebra-transpile 聚合矩阵	commit:212feaea
K["s"](-1)（静态成员）⇒ K.s 执法	dup:algebra-transpile 聚合矩阵	commit:212feaea
s += 1 步进不再误折 TypeError（原生 3）	dup:algebra-transpile 聚合矩阵	commit:212feaea
n = n + 1 通用步进形态同样 total	dup:algebra-transpile 聚合矩阵	commit:212feaea
test 里的复合赋值（(s+=1)<3）也不误报	dup:algebra-transpile 聚合矩阵	commit:212feaea
负控制：写真正的 const 仍抛 TypeError	dup:algebra-transpile 聚合矩阵	commit:212feaea
去掉 .optional() 的同一契约仍报（控制组）	dup:algebra-transpile 聚合矩阵	commit:212feaea
等价写法 union(base, lit(undefined)) 与 .optional() 结论一致	dup:algebra-transpile 聚合矩阵	commit:212feaea
the declaring function keeps its mock	dup:algebra-transpile 聚合矩阵	commit:212feaea
other functions do not see the mock (no file-level leak)	dup:algebra-transpile 聚合矩阵	commit:212feaea
injected mocks that no directive declares are kept as fallback	dup:algebra-transpile 聚合矩阵	commit:212feaea
解构声明 + @nudo:as：各绑定取覆盖形状的同名槽	dup:algebra-transpile 聚合矩阵	commit:212feaea
解构声明 + @nudo:as：数组模式按位置投影覆盖值	dup:algebra-transpile 聚合矩阵	commit:212feaea
解构声明 + @nudo:as：改名绑定按源键取槽（原生语义）	dup:algebra-transpile 聚合矩阵	commit:212feaea
对照钉：Identifier 形态的覆盖仍生效（行为不退化）	dup:algebra-transpile 聚合矩阵	commit:212feaea
负控制：无指令的同一源码行为不变（不凭空得到覆盖类型）	dup:algebra-transpile 聚合矩阵	commit:212feaea
负控制：覆盖只作用于被标注的那条语句	dup:algebra-transpile 聚合矩阵	commit:212feaea
原 init 仍求值：副作用保留（@nudo:as 是类型覆盖不是求值替换）	dup:algebra-transpile 聚合矩阵	commit:212feaea
原 init 仍求值：throws 域保留（不被覆盖吞掉）	dup:algebra-transpile 聚合矩阵	commit:212feaea
对象 / 改名 / 数组 / 嵌套 / rest / 默认值 / export 包装 的子名都进绑定表	dup:algebra-transpile 聚合矩阵	commit:212feaea
绑定表里的值 = 解构出来的槽值（不是 any）	dup:algebra-transpile 聚合矩阵	commit:212feaea
for 头解构：循环体内子名拿到元素槽类型（契约面 signature 不是 any）	dup:algebra-transpile 聚合矩阵	commit:212feaea
端到端：实参来自解构绑定 ⇒ 契约违例被报出（改前静默跳过 = 假绿）	dup:algebra-transpile 聚合矩阵	commit:212feaea
负控制：Identifier 形态仍在绑定表里（本次修改不退化）	dup:algebra-transpile 聚合矩阵	commit:212feaea
负控制：块内解构子名不是顶层绑定	dup:algebra-transpile 聚合矩阵	commit:212feaea
负控制：for 头解构子名不是顶层绑定（循环作用域）	dup:algebra-transpile 聚合矩阵	commit:212feaea
入口 Abs 带 undefined 臂（与 union(lit(undefined), number()) 同构）	dup:algebra-transpile 聚合矩阵	commit:212feaea
调用点谓词允许 undefined（`or(<base>, eq(x, undefined))`）	dup:algebra-transpile 聚合矩阵	commit:212feaea
返回位：契约承认 nullish（`return undefined` 不再假红）	dup:algebra-transpile 聚合矩阵	commit:212feaea
端到端：调用点传 undefined ⇒ 零 error（改前 nudo:constraint-violated）	dup:algebra-transpile 聚合矩阵	commit:212feaea
端到端：返回 undefined 的实现对 `number().optional()` 返回契约 ⇒ 零 error	dup:algebra-transpile 聚合矩阵	commit:212feaea
负控制：非可选位传 undefined 仍是 error（不得被整体放宽）	dup:algebra-transpile 聚合矩阵	commit:212feaea
check 签名面与 .d.ts 对同一形参的可选性一致（签名面含 undefined）	dup:algebra-transpile 聚合矩阵	commit:212feaea
对照组：对象字段位的 .optional() 仍是「键可缺席」，槽值不带 undefined	dup:algebra-transpile 聚合矩阵	commit:212feaea
三形态（说明符语句在类前 / 类后 / 无）的符号面逐字相同	dup:algebra-transpile 聚合矩阵	commit:212feaea
pre 形态（说明符语句在类前）的类方法签名不是 unknown	dup:algebra-transpile 聚合矩阵	commit:212feaea
负控制：`export const q = 1`（声明语句）形态不受影响	dup:algebra-transpile 聚合矩阵	commit:212feaea
check 面：三形态的签名显示逐字相同（不是 unknown）	dup:algebra-transpile 聚合矩阵	commit:212feaea
契约面：类方法返回类型契约违规必须是 error（不是 warning）	dup:algebra-transpile 聚合矩阵	commit:212feaea
产物里不再有重复词法声明（修前：同作用域两个 `let __nudoLv0`）	dup:algebra-transpile 聚合矩阵	commit:212feaea
整模块不再 fail-closed：f() 结果 = 原生 4（修前：SyntaxError ⇒ unknown）	dup:algebra-transpile 聚合矩阵	commit:212feaea
check 面：受损导出拿到签名 + 无假 nudo:opaque-result（修前：f 退 unknown + 假 opaque）	dup:algebra-transpile 聚合矩阵	commit:212feaea
负控制：用户不同名时槽名保持原形 `__nudoLv0`（产物逐字不变）	dup:algebra-transpile 聚合矩阵	commit:212feaea
f(...args) 展开到 2 参函数 ⇒ 不报元数错（个数不可判 ⇒ 跳过）	dup:algebra-transpile 聚合矩阵	commit:212feaea
add(...xs)（xs 是局部数组）⇒ 不报元数错	dup:algebra-transpile 聚合矩阵	commit:212feaea
数组字面量展开的空洞算一个实参（three(...[1,,3]) ⇒ 3 个）	dup:algebra-transpile 聚合矩阵	commit:212feaea
rest 长度边界在展开处停止（few(1, ...more) 不违反 length <= 1）	dup:algebra-transpile 聚合矩阵	commit:212feaea
负控制：真·少传实参仍然报元数错（不掩盖真违规）	dup:algebra-transpile 聚合矩阵	commit:212feaea
负控制：数组字面量展开的实参个数仍按展开后计（f(...[1,2,3]) 对 2 参函数 ⇒ 多传警告）	dup:algebra-transpile 聚合矩阵	commit:212feaea
形参同名 ⇒ 不套顶层函数的元数	dup:algebra-transpile 聚合矩阵	commit:212feaea
局部 const 同名 ⇒ 不套顶层函数的元数	dup:algebra-transpile 聚合矩阵	commit:212feaea
嵌套函数同名 ⇒ 不套顶层函数的元数	dup:algebra-transpile 聚合矩阵	commit:212feaea
for-of 绑定同名 ⇒ 不套顶层函数的元数	dup:algebra-transpile 聚合矩阵	commit:212feaea
解构绑定同名 ⇒ 不套顶层函数的元数	dup:algebra-transpile 聚合矩阵	commit:212feaea
负控制：没有同名遮蔽 ⇒ 顶层函数的元数照常检查（真违规仍报）	dup:algebra-transpile 聚合矩阵	commit:212feaea
负控制：别名绑定仍按别名解析（const f = log ⇒ f() 查 log 的元数）	dup:algebra-transpile 聚合矩阵	commit:212feaea
两个函数里的同名局部（new A / new B）不再串味 ⇒ 零违例	dup:algebra-transpile 聚合矩阵	commit:212feaea
负控制：A.m 的契约仍执法（c.m(-1) 报违例）	dup:algebra-transpile 聚合矩阵	commit:212feaea
负控制：B.m 的契约仍执法（c.m(1) 报违例）	dup:algebra-transpile 聚合矩阵	commit:212feaea
形参遮蔽顶层实例 ⇒ 不套用顶层实例的成员契约	dup:algebra-transpile 聚合矩阵	commit:212feaea
重新赋值使成员别名失效（c = {m:x=>x} 之后不再套 C.m 的契约）	dup:algebra-transpile 聚合矩阵	commit:212feaea
负控制：顶层实例的成员契约仍执法（未被遮蔽 / 未重新赋值）	dup:algebra-transpile 聚合矩阵	commit:212feaea
JSDoc @param {number} [x] ⇒ h() 不报元数错	dup:algebra-transpile 聚合矩阵	commit:212feaea
JSDoc @param {string} [y="a"] ⇒ 带默认值的方括号形态也算可选	dup:algebra-transpile 聚合矩阵	commit:212feaea
TS x?: number ⇒ h() 不报元数错	dup:algebra-transpile 聚合矩阵	commit:212feaea
TS export function h(x?: number) ⇒ 同样不报（JSDoc/TS 挂在 export 上）	dup:algebra-transpile 聚合矩阵	commit:212feaea
负控制：必需形参少传实参仍然报元数错	dup:algebra-transpile 聚合矩阵	commit:212feaea
负控制：JSDoc 的非方括号 @param 是必填 ⇒ 仍报元数错	dup:algebra-transpile 聚合矩阵	commit:212feaea
具名函数表达式：侧车契约绑定 ⇒ 报 constraint-violated（修前：只有 unproven-return + unknown）	dup:algebra-transpile 聚合矩阵	commit:212feaea
与其它导出形态**同口径**（匿名 FE / 箭头 / 对象方法 / exports.greet = 具名 FE）	dup:algebra-transpile 聚合矩阵	commit:212feaea
成员键不串：{ a: function b(){…}, b: () => "bad" } ⇒ a / b 各归各	dup:algebra-transpile 聚合矩阵	commit:212feaea
默认形参吃下第 2 个实参 ⇒ 不报超参	dup:algebra-transpile 聚合矩阵	commit:212feaea
真超参（形参位不够）⇒ 仍报 warning	dup:algebra-transpile 聚合矩阵	commit:212feaea
rest 形参吸收多余实参 ⇒ 不报超参	dup:algebra-transpile 聚合矩阵	commit:212feaea
少传必填位 ⇒ 仍是 error（口径不变）	dup:algebra-transpile 聚合矩阵	commit:212feaea
端到端：check 面上 f(1, 2) 不再误报（文档示例 cartTotal(items, couponPercent = 0) 同形）	dup:algebra-transpile 聚合矩阵	commit:212feaea
闸门面：整模块不再 fail-closed ⇒ 其它导出的 L2 门禁仍触发	dup:algebra-transpile 聚合矩阵	commit:212feaea
闸门面：常见的 fetch 形态（早退守卫 + await）不再整模块假绿	dup:algebra-transpile 聚合矩阵	commit:212feaea
安全网：关闭 asyncGen 后同一份源仍能编译（生成器路径的兜底）	dup:algebra-transpile 聚合矩阵	commit:212feaea
位置表：成员调用实参 / 成员赋值 / 循环判别式 / case 测试 / 守卫之后 ⇒ 判 thunk	dup:algebra-transpile 聚合矩阵	commit:212feaea
导入类实例：const c = new K(); c.m(-1) ⇒ K.m 违例	dup:algebra-transpile 聚合矩阵	commit:212feaea
导入类内联：new K().m(-1) ⇒ K.m 违例	dup:algebra-transpile 聚合矩阵	commit:212feaea
导入类静态：K.s(-1) ⇒ K.s 违例	dup:algebra-transpile 聚合矩阵	commit:212feaea
导入类：合法实参（1 / 5）三种形态都不报	dup:algebra-transpile 聚合矩阵	commit:212feaea
导入普通函数 f(-1) 既有强制不回归（负控制）	dup:algebra-transpile 聚合矩阵	commit:212feaea
导入普通函数 f(5) 不报（负控制）	dup:algebra-transpile 聚合矩阵	commit:212feaea
本地类实例：const c = new L(); c.m(-1) ⇒ L.m（既有路径）	dup:algebra-transpile 聚合矩阵	commit:212feaea
本地类内联：new L().m(-1) ⇒ L.m	dup:algebra-transpile 聚合矩阵	commit:212feaea
本地类静态：L.s(-1) ⇒ L.s	dup:algebra-transpile 聚合矩阵	commit:212feaea
本地类：合法实参（1 / 5）不报（负控制）	dup:algebra-transpile 聚合矩阵	commit:212feaea
静态同名调用 C.m(-1) ⇒ 只套静态契约（C.static.m）	dup:algebra-transpile 聚合矩阵	commit:212feaea
实例同名调用（new C().m / const c = new C(); c.m）⇒ 实例无契约，零诊断	dup:algebra-transpile 聚合矩阵	commit:212feaea
静态同名调用合法实参 C.m(1) 不报（负控制）	dup:algebra-transpile 聚合矩阵	commit:212feaea
本地类同名：C.m(-1) 只套静态契约，实例调用零诊断	dup:algebra-transpile 聚合矩阵	commit:212feaea
extends 且 m 不是 own 方法 ⇒ 零诊断	dup:algebra-transpile 聚合矩阵	commit:212feaea
构造器 this.m = … 覆盖方法 ⇒ 零诊断	dup:algebra-transpile 聚合矩阵	commit:212feaea
接收者被遮蔽（形参 / 局部同名）或重新赋值 ⇒ 零诊断	dup:algebra-transpile 聚合矩阵	commit:212feaea
静态 / 实例交叉调用（K.m 实例方法 / new K().s 静态方法）⇒ 零诊断	dup:algebra-transpile 聚合矩阵	commit:212feaea
getter / computed 成员 ⇒ 零诊断	dup:algebra-transpile 聚合矩阵	commit:212feaea
未契约的导入类方法 ⇒ 零新诊断（不扩面）	dup:algebra-transpile 聚合矩阵	commit:212feaea
实例（const c = new L()）：c.m(-1) ⇒ L.m 违例	dup:algebra-transpile 聚合矩阵	commit:212feaea
内联 new：new L().m(-1) ⇒ L.m 违例	dup:algebra-transpile 聚合矩阵	commit:212feaea
静态：L.s(-1) ⇒ L.s 违例	dup:algebra-transpile 聚合矩阵	commit:212feaea
合法实参（1 / 5）三种形态都不报（负控制）	dup:algebra-transpile 聚合矩阵	commit:212feaea
未契约的本地类 ⇒ 零新诊断（不扩面）	dup:algebra-transpile 聚合矩阵	commit:212feaea
本地类方法不进签名普查面（调用点义务 ≠ 签名面扩面）	dup:algebra-transpile 聚合矩阵	commit:212feaea
本地类的侧车契约不绑（未导出名）——与未导出本地函数同口径（parity）	dup:algebra-transpile 聚合矩阵	commit:212feaea
守卫：extends 无 own / 构造器 this.m / getter / computed ⇒ 零诊断	dup:algebra-transpile 聚合矩阵	commit:212feaea
守卫：形参遮蔽 / 实例重新赋值 / 类名重新赋值 / static↔实例交叉 ⇒ 零诊断	dup:algebra-transpile 聚合矩阵	commit:212feaea
匿名 default 类（指令契约）⇒ default.m 违例	dup:algebra-transpile 聚合矩阵	commit:212feaea
匿名 default 类（侧车 default_m）⇒ default.m 违例	dup:algebra-transpile 聚合矩阵	commit:212feaea
匿名 default 类：合法实参不报（负控制）	dup:algebra-transpile 聚合矩阵	commit:212feaea
匿名 default 类未契约 ⇒ 零诊断（不扩面）	dup:algebra-transpile 聚合矩阵	commit:212feaea
具名 export default class K 已可用（负控制，不得回归）	dup:algebra-transpile 聚合矩阵	commit:212feaea
匿名 default 类的静态成员：K.s(-1) ⇒ default.s 违例	dup:algebra-transpile 聚合矩阵	commit:212feaea
new ns.K().m(-1) ⇒ K.m 违例	dup:algebra-transpile 聚合矩阵	commit:212feaea
ns.K.s(-1) ⇒ K.s 违例	dup:algebra-transpile 聚合矩阵	commit:212feaea
命名空间：合法实参不报（负控制）	dup:algebra-transpile 聚合矩阵	commit:212feaea
命名空间名被形参 / 局部 const 遮蔽 ⇒ 零诊断（守卫）	dup:algebra-transpile 聚合矩阵	commit:212feaea
命名空间类：实例方法不许当静态、静态不许当实例 ⇒ 零诊断（守卫）	dup:algebra-transpile 聚合矩阵	commit:212feaea
require 的模块命名空间同一路径（const m = require）	dup:algebra-transpile 聚合矩阵	commit:212feaea
命名空间经再导出 index（parity：普通函数 ns.f 也不执法）⇒ 0	dup:algebra-transpile 聚合矩阵	commit:212feaea
export { K } from：成员调用执法（不回归）	dup:algebra-transpile 聚合矩阵	commit:212feaea
export * from：成员调用执法（不回归）	dup:algebra-transpile 聚合矩阵	commit:212feaea
别名再导出 export { K as J } from / import+export ⇒ 0（parity：普通函数同样不执法）	dup:algebra-transpile 聚合矩阵	commit:212feaea
再导出环（a ↔ b）终止且零诊断	dup:algebra-transpile 聚合矩阵	commit:212feaea
derived constructor and its call site may throw ReferenceError	dup:algebra-transpile 聚合矩阵	commit:212feaea
normal derived constructors stay total	dup:algebra-transpile 聚合矩阵	commit:212feaea
$copy 对非 Abs 宿主值原值返回（不读 .shape）	dup:algebra-transpile 聚合矩阵	commit:212feaea
分支块内写宿主全局可求值（不产生内部异常），且不污染宿主全局	dup:algebra-transpile 聚合矩阵	commit:212feaea
顶层形态（对照组）同样不崩 —— 两种写法结论一致	dup:algebra-transpile 聚合矩阵	commit:212feaea
本地调用：契约可选位少传实参 ⇒ 不报 nudo:arg-count	dup:algebra-transpile 聚合矩阵	commit:212feaea
跨文件调用：契约可选位少传实参 ⇒ 不报 nudo:arg-count（与本地同结论）	dup:algebra-transpile 聚合矩阵	commit:212feaea
本地调用：真正缺必填实参仍报（对照组，两位都必填）	dup:algebra-transpile 聚合矩阵	commit:212feaea
跨文件调用：真正缺必填实参仍报（对照组，两位都必填）	dup:algebra-transpile 聚合矩阵	commit:212feaea
两位都传齐 ⇒ 两面都不报元数错	dup:algebra-transpile 聚合矩阵	commit:212feaea
builder 层：三个变换都保留 isOptional（改前全部丢失）	dup:algebra-transpile 聚合矩阵	commit:212feaea
入口 Abs 层：字段槽仍是 optional（渲染带 `s?`）	dup:algebra-transpile 聚合矩阵	commit:212feaea
前置条件层：字段谓词不再要求必填（可选字段不进硬 pred）	dup:algebra-transpile 聚合矩阵	commit:212feaea
端到端：合法调用 f({}) 零 error、签名面保留 `s?`（改前 3 条假红）	dup:algebra-transpile 聚合矩阵	commit:212feaea
负控制：不套变换时行为不变（直接把 optional 抬到字段上）	dup:algebra-transpile 聚合矩阵	commit:212feaea
负控制：非可选 shape 经变换后仍必填（不得被顺手放宽）	dup:algebra-transpile 聚合矩阵	commit:212feaea
可选契约 + 源槽存在且为 undefined ⇒ 可赋	dup:algebra-transpile 聚合矩阵	commit:212feaea
对照：必填契约 + 同一源 ⇒ 仍判红	dup:algebra-transpile 聚合矩阵	commit:212feaea
可选契约 + 源值 string | undefined ⇒ 可赋（undefined 臂被吸收）	dup:algebra-transpile 聚合矩阵	commit:212feaea
不得整体放宽：number | undefined ⊄ optional string	dup:algebra-transpile 聚合矩阵	commit:212feaea
null 不被可选槽吸收（strictNullChecks）	dup:algebra-transpile 聚合矩阵	commit:212feaea
源槽标 optional 时：可赋给可选目标槽，不可赋给必填目标槽	dup:algebra-transpile 聚合矩阵	commit:212feaea
源槽缺失：可选目标槽放行、必填目标槽判红（既有口径）	dup:algebra-transpile 聚合矩阵	commit:212feaea
非空值仍按谓词判定（可选槽不是无条件放行）	dup:algebra-transpile 聚合矩阵	commit:212feaea
undefined 只在槽内被吸收：`{ a: string } | undefined` ⊄ `{ a?: string }`	dup:algebra-transpile 聚合矩阵	commit:212feaea
optional 契约 + `{ a: undefined }` / `{}` / `{ a: 'x' }` 全部放行	dup:algebra-transpile 聚合矩阵	commit:212feaea
required 契约 + `{ a: undefined }` 仍判红（对照）	dup:algebra-transpile 聚合矩阵	commit:212feaea
required 契约 + `{ a: 'x' }` 放行（对照的正例）	dup:algebra-transpile 聚合矩阵	commit:212feaea
optional 契约不吸收 null / 错 prim（不整体放宽）	dup:algebra-transpile 聚合矩阵	commit:212feaea
optional 契约 + 见证 `{ a: undefined }` ⇒ 不报 case-inconsistency	dup:algebra-transpile 聚合矩阵	commit:212feaea
required 契约 + 同一见证 ⇒ 仍报 case-inconsistency（对照）	dup:algebra-transpile 聚合矩阵	commit:212feaea
optional 契约：见证 `{ a: 'x' }` 放行、`{ a: 1 }` / `{ a: null }` 仍报	dup:algebra-transpile 聚合矩阵	commit:212feaea
class 声明被调 → throws TypeError（此前 unknown + never）	dup:algebra-transpile 聚合矩阵	commit:212feaea
class 声明被调（try/catch 吸收）→ catch 命中 TypeError	dup:algebra-transpile 聚合矩阵	commit:212feaea
非空类表达式被调 → throws TypeError	dup:algebra-transpile 聚合矩阵	commit:212feaea
空类体类表达式被调（$classExpr 快路径）→ throws TypeError	dup:algebra-transpile 聚合矩阵	commit:212feaea
控制组：new A() 正常构造；静态方法调用正常；普通函数调用正常	dup:algebra-transpile 聚合矩阵	commit:212feaea
Object.keys 剔除不可枚举自有键（宿主同键集）	dup:algebra-transpile 聚合矩阵	commit:212feaea
Object.values 同键集	dup:algebra-transpile 聚合矩阵	commit:212feaea
Object.entries 同键集（键值对不重复发布不可枚举键）	dup:algebra-transpile 聚合矩阵	commit:212feaea
JSON.stringify 只序列化可枚举自有键	dup:algebra-transpile 聚合矩阵	commit:212feaea
Object.assign 只拷可枚举自有键	dup:algebra-transpile 聚合矩阵	commit:212feaea
spread 只拷可枚举自有键	dup:algebra-transpile 聚合矩阵	commit:212feaea
五个枚举面 + for-in + gOPN 同结论（引擎内部不再互斥）	dup:algebra-transpile 聚合矩阵	commit:212feaea
描述符面：gOPD 说 x 是「自有 + 不可枚举」的数据属性	dup:algebra-transpile 聚合矩阵	commit:212feaea
单变量对照：普通对象（同一 defineProperty）结论一致	dup:algebra-transpile 聚合矩阵	commit:212feaea
重定义为可枚举后重新进入枚举视图（标志不是一次性丢弃）	dup:algebra-transpile 聚合矩阵	commit:212feaea
连续两次 defineProperty 收紧不同键：两套 flags 都保留	dup:algebra-transpile 聚合矩阵	commit:212feaea
this.x = v 对 module.exports 可见（不再定抛）	dup:algebra-transpile 聚合矩阵	commit:212feaea
只用顶层 this 的 CJS 源（无 export 语法）：this.x = v 不再定抛，槽进导出面	dup:algebra-transpile 聚合矩阵	commit:212feaea
ESM 源顶层 this 仍是 undefined（原生一致）⇒ this.x = v 抛	dup:algebra-transpile 聚合矩阵	commit:212feaea
不产生假红（unproven-return 不在）	dup:algebra-transpile 聚合矩阵	commit:212feaea
返回面仍是 number（旧行为退化成 any）	dup:algebra-transpile 聚合矩阵	commit:212feaea
采用被跳过 ⇒ 返回面不可证（unproven-return 在）	dup:algebra-transpile 聚合矩阵	commit:212feaea
不得出现靠引理折出的假证明（assume-relied 不在）	dup:algebra-transpile 聚合矩阵	commit:212feaea
实例方法显式 throw ⇒ 报 nudo:entry-may-throw（改前：零 error / exit 0）	dup:algebra-transpile 聚合矩阵	commit:212feaea
静态方法与顶层函数口径不变（各 1 条 L2）	dup:algebra-transpile 聚合矩阵	commit:212feaea
实例方法必抛 ⇒ 签名面为 never（改前：unknown = 谎称「推断失败」）	dup:algebra-transpile 聚合矩阵	commit:212feaea
eval 层：实例方法体必抛 ⇒ 调用返回 never + throws TypeError（无回归）	dup:algebra-transpile 聚合矩阵	commit:212feaea
实例方法 ⇒ analyzed 且 throws 域带 TypeError（改前：absent / 无证据）	dup:algebra-transpile 聚合矩阵	commit:212feaea
静态方法口径不变（仍走 $staticInvoke）	dup:algebra-transpile 聚合矩阵	commit:212feaea
export default class 的实例方法同样走实例桥（导出槽兜底）	dup:algebra-transpile 聚合矩阵	commit:212feaea
g().x++（不可写回的 update 目标）⇒ 报 nudo:entry-may-throw（改前：零 error）	dup:algebra-transpile 聚合矩阵	commit:212feaea
delete (g() + 1)（非成员 delete 目标）⇒ 报 nudo:entry-may-throw（改前：零 error）	dup:algebra-transpile 聚合矩阵	commit:212feaea
fail-closed 证据可被 @nudo:throws Error 显式放行（用户可自证有意 fail-fast）	dup:algebra-transpile 聚合矩阵	commit:212feaea
同模块的**其它**入口不做过度断言（原生下它们并不抛）	dup:algebra-transpile 聚合矩阵	commit:212feaea
eval 层：可分析的孪生表达式记 TypeError 效果；不可分析的那个连模块都起不来	dup:algebra-transpile 聚合矩阵	commit:212feaea
转译器拒绝 ⇒ 结局是 unanalyzable（不是 analyzed / absent）	dup:algebra-transpile 聚合矩阵	commit:212feaea
可分析的入口 ⇒ 结局仍是 analyzed（fail-closed 不得误伤正常路径）	dup:algebra-transpile 聚合矩阵	commit:212feaea
带 `this: T` 的函数声明：实参按**实参位**绑定（`this` 不占位）	dup:algebra-transpile 聚合矩阵	commit:212feaea
带 `this: T` 的函数声明：形参表里没有 `this`	dup:algebra-transpile 聚合矩阵	commit:212feaea
带 `this: T` 的类方法：形参表里没有 `this`	dup:algebra-transpile 聚合矩阵	commit:212feaea
带 `this: T` 的类方法：模块装载成功（产物语法合法，不抛 SyntaxError）	dup:algebra-transpile 聚合矩阵	commit:212feaea
identifier named this is skipped from the formal param table	dup:algebra-transpile 聚合矩阵	commit:212feaea
this does not appear in display / signature / contract names	dup:algebra-transpile 聚合矩阵	commit:212feaea
generalize keeps only the real runtime params	dup:algebra-transpile 聚合矩阵	commit:212feaea
check signature lists one param, not two	dup:algebra-transpile 聚合矩阵	commit:212feaea
a param literally named this cannot exist (this is a reserved word)	dup:algebra-transpile 聚合矩阵	commit:212feaea
模型层：默认形参带 optional 标记、普通形参不带	dup:algebra-transpile 聚合矩阵	commit:212feaea
端到端（读侧）：f(a, b = 1) 赋给「只需 1 个必选元」的 fn ⇒ 可赋值	dup:algebra-transpile 聚合矩阵	commit:212feaea
反向控制：f(a, b)（无默认）⇒ 不可赋值（必选 2 > 目标必选 1）	dup:algebra-transpile 聚合矩阵	commit:212feaea
反向控制：f(a, b = 1) 赋给「0 个必选元」的 fn ⇒ 仍不可赋值（a 是必选）	dup:algebra-transpile 聚合矩阵	commit:212feaea
缺省标记时回退名字后缀判据（既有行为不变）	dup:algebra-transpile 聚合矩阵	commit:212feaea
公开口径 requiredFnArity 一字不改	dup:algebra-transpile 聚合矩阵	commit:212feaea
箭头函数：默认形参位标为可省略	dup:algebra-transpile 聚合矩阵	commit:212feaea
箭头函数：普通形参位不标为可省略	dup:algebra-transpile 聚合矩阵	commit:212feaea
必选元数按标记算：`(x = 1) => x` 赋给「0 个必选元」的 fn ⇒ 可赋值	dup:algebra-transpile 聚合矩阵	commit:212feaea
反向控制：无默认值的 `(x, y)` 赋给「0 个必选元」的 fn ⇒ 不可赋值	dup:algebra-transpile 聚合矩阵	commit:212feaea
反向控制：默认形参**不**抹掉前面形参的必选性（`(x, y = 1)` 仍需 1 个）	dup:algebra-transpile 聚合矩阵	commit:212feaea
default param is marked optional	dup:algebra-transpile 聚合矩阵	commit:212feaea
pattern with a default value is optional, bare pattern is not	dup:algebra-transpile 聚合矩阵	commit:212feaea
the marker is independent of the display name (no name-suffix guessing)	dup:algebra-transpile 聚合矩阵	commit:212feaea
合法调用 sum(1, 2) 不报违例（rest 实参聚合成 [1, 2] 再与 array 契约比）	dup:algebra-transpile 聚合矩阵	commit:212feaea
sum(1, -2) 报违例，且 actual 是整个聚合值 [1, -2]（不是首个实参 1）	dup:algebra-transpile 聚合矩阵	commit:212feaea
同名时：静态方法改名 C.static.m，实例方法保名 C.m	dup:algebra-transpile 聚合矩阵	commit:212feaea
同名时：按名查找 C.m 命中的是**实例**方法的注释块	dup:algebra-transpile 聚合矩阵	commit:212feaea
同名时：两条契约各自可见（互不顶替）	dup:algebra-transpile 聚合矩阵	commit:212feaea
只有静态方法时：scope 名仍是 C.m（与普查面同名，不改名）	dup:algebra-transpile 聚合矩阵	commit:212feaea
只有实例方法时：scope 名仍是 C.m（对照）	dup:algebra-transpile 聚合矩阵	commit:212feaea
同名时：普查面仍只登记 C.m（族 11 口径未变）	dup:algebra-transpile 聚合矩阵	commit:212feaea
exports.f = function ⇒ scope 名是导出槽名 f	dup:algebra-transpile 聚合矩阵	commit:212feaea
module.exports.f = function ⇒ scope 名是 f	dup:algebra-transpile 聚合矩阵	commit:212feaea
module.exports = function ⇒ scope 名是 default	dup:algebra-transpile 聚合矩阵	commit:212feaea
module.exports = function inner() ⇒ 回退内层 id（普查面同口径）	dup:algebra-transpile 聚合矩阵	commit:212feaea
exports.f = 箭头 ⇒ scope 名是 f	dup:algebra-transpile 聚合矩阵	commit:212feaea
语句级 JSDoc 挂到 CJS scope 上（不再蒸发）	dup:algebra-transpile 聚合矩阵	commit:212feaea
L1 契约在 CJS 形态上生效（与 ESM 同口径）	dup:algebra-transpile 聚合矩阵	commit:212feaea
@nudo:throws 在 CJS 形态上生效（不再假红）	dup:algebra-transpile 聚合矩阵	commit:212feaea
L2 门禁：CJS 形态的 @nudo:throws 抑制不再失效	dup:algebra-transpile 聚合矩阵	commit:212feaea
对照：ESM 形态行为不变	dup:algebra-transpile 聚合矩阵	commit:212feaea
指令面的绑定名与普查面（分析面）对齐	dup:algebra-transpile 聚合矩阵	commit:212feaea
union(number(), string()) 收到 true ⇒ 判违例（改前 0 违例 = 假绿）	dup:algebra-transpile 聚合矩阵	commit:212feaea
union(number(), boolean()) 收到 'x' ⇒ 判违例（改前 0 违例 = 假绿）	dup:algebra-transpile 聚合矩阵	commit:212feaea
union(number(), lit('a')) 收到 true ⇒ 判违例（改前 0 违例 = 假绿）	dup:algebra-transpile 聚合矩阵	commit:212feaea
union(number(), string()) 收到 's' ⇒ 放行（成员域内的实参不误伤）	dup:algebra-transpile 聚合矩阵	commit:212feaea
union(number(), string()) 收到 1 ⇒ 放行（成员域内的实参不误伤）	dup:algebra-transpile 聚合矩阵	commit:212feaea
负控制：没有契约的形参收到任何实参 ⇒ 零违例（违例来自契约，不是引擎噪声）	dup:algebra-transpile 聚合矩阵	commit:212feaea
shape 成员：union(user, lit(1)) 收到 { id: "x" } 报违例	dup:algebra-transpile 聚合矩阵	commit:212feaea
形态①：array 成员——union(array(number()), lit(1)) 收到 ["x"] 报违例	dup:algebra-transpile 聚合矩阵	commit:212feaea
形态②：嵌套 shape 成员——收到 { a: { b: "x" } } 报违例	dup:algebra-transpile 聚合矩阵	commit:212feaea
形态③：成员带界——union(number().gt(0), shape({a:number()})) 收到 { a: "x" } 报违例	dup:algebra-transpile 聚合矩阵	commit:212feaea
析取语义：任一成员满足即放行（不误报）	dup:algebra-transpile 聚合矩阵	commit:212feaea
标量成员侧不被消费侧重复产出诊断（union 标量面归谓词通道）	dup:algebra-transpile 聚合矩阵	commit:212feaea
基线对照：非 union 的 shape 契约仍然报违例（消费侧没把普通 shape 放跑）	dup:algebra-transpile 聚合矩阵	commit:212feaea
memberToFn 收下本地类实例成员（c.m ⇒ C.m）	dup:algebra-transpile 聚合矩阵	commit:212feaea
c.m(-1) 违反类方法契约 ⇒ nudo:constraint-violated	dup:algebra-transpile 聚合矩阵	commit:212feaea
满足契约的实参不报（c.m(1) 放行）	dup:algebra-transpile 聚合矩阵	commit:212feaea
```
