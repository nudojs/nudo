# packages/core/src/algebra/__tests__/algebra-eval-core.test.ts

模块套件：求值面：其余核心语义。

审计：230 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
litC(1n)：builder 带 prim bigint（改前无 prim ⇒ Abs 落 number 兜底）；契约 Abs 的 shape 是 prim bigint（不是 number）；guard 面：渲染含 typeof data === "bigint"，且 guard(1n) === true（改前假红）；union 成员：union(lit(1n)) 的 shape 也是 prim bigint（改前落 boolean 兜底）；实例化口径：bigint 字	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
A1 赋值：计算键先于 RHS（原生 k,v）；A2 赋值：对象先于计算键先于 RHS（原生 f,k,v）；A3 下标赋值：a[i++] = i + 10（原生 11,0|1）；A4 下标赋值：a[i++] = i（原生 1,0|1）；B1 复合赋值：计算键只跑一次且先于 RHS（原生 k,v）；B2 自增：计算键只跑一次（原生 k）；B3 delete：计算键只跑一次（原生 k）；B4 赋值：顺序修正后值仍落位（原生 k,v|2）；B5 自增：键一次且新值落位（原生 k|2	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
副作用保留：被断言的调用仍被调用；throws 域保留：被断言调用的抛错不被吞；return 位的 @nudo:as 同样仍求值；结果取断言值（类型覆盖生效）；负控制：未被标注的相邻语句照常求值；负控制：同样的源码无指令时行为不变（对照）	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
被替换的调用仍被调用（副作用保留）；被替换的调用的抛错域保留（throws 面不被吞）；负控制：未被标注的相邻子表达式照常求值；替换结果取注入值（原表达式的值被取代）	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
Map.keys() 的 rest 解构 → 取剩余键（原生 "b"）；Map.values() 的 rest 解构 → 取剩余值（原生 "2"）；Map.entries() 的 rest 解构 → 取剩余条目元组（原生 "b:2"）；Set.values() 的 rest 解构 → 取剩余元素（原生 "2,3"）；负控制：生成器 rest 解构不受影响（原生 "2"）；负控制：普通数组 rest 解构不受影响（原生 "2,3"）	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
values() 迭代器：push 之后的 for-of 跑满剩余轮数（原生 "2,3"）；values() 迭代器：push 之后的展开取剩余（原生 "2,3"）；keys() 迭代器：push 之后的 for-of 跑满剩余轮数（原生 "1,2"）；entries() 迭代器：push 之后的 for-of 跑满剩余轮数（原生 "1:2,2:3"）；负控制：未变更的数组迭代器 for-of 不受影响（原生 "1,2"）	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
m[Symbol.iterator]() → 集合迭代器（原生 "a:1"，修复前折 never）；s[Symbol.iterator]() → 元素迭代器（原生 1，非 [el,el]）；借调 Map.prototype[Symbol.iterator].call(m) → 集合迭代器（原生 "a:1"）；借调 Set.prototype[Symbol.iterator].call(s) → 元素迭代器（原生 1）；m[Symbol.iterator] 是函数（原生 "fu	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
Set.forEach：回调里删除条目 → 被删条目不再被访问；Set.forEach：回调里新增条目 → 新条目被追加访问；Map.forEach：回调里新增条目 → 新条目被追加访问；Map.forEach：回调里 clear() → 后续条目不再被访问；Map.forEach：回调里改写已有条目的值 → 读到的是新值；for-of（Set）：回调体里删除条目 → 被删条目不再被访问；for-of（Map）：循环体里新增条目 → 新条目被追加访问；for-of（Set）：	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
Map.keys()：迭代期间删除条目 → 被删条目不再被访问（done 提前为 true）；Map.keys()：迭代期间新增条目 → 新条目被追加访问；Map.values()：迭代期间改写已有条目的值 → 读到新值（非陈旧值）；Map.entries()：迭代期间新增条目 → 新条目被追加访问；Set.values()：迭代期间删除元素 → 被删元素不再被访问；Set.entries()：迭代期间新增元素 → 新元素被追加访问；数组 entries()：迭代期间 shi	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
① Map.keys() 的 next().value 是键（不是 [k,v] 条目元组）；① Map.values() 的 next().value 是值（不是条目元组）；① Set.entries() 的 next().value 是 [el, el] 元组（不是元素本身）；① 投影在 live 路径上同样成立（迭代期间新增条目 → 新条目按投影给出）；② for-of 走**当前剩余**：消费一条后接收者新增条目 ⇒ 新条目仍被访问；② for-of 走**当前剩余**	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
Map.keys()：live 视图给键（不是 [k,v] 条目元组）；Map.values()：live 视图给值（不是条目元组）；Map.entries()：live 视图给条目元组；Set.keys()/values()：live 视图给元素；Set.entries()：live 视图给 [el, el] 元组（不是元素本身）	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
gOPN(Math) 非空（此前折 exact 0）；gOPN(Math) 含 'PI'（此前整个自有面被丢弃）；gOPN(JSON) 非空（此前折 exact 0）；Reflect.ownKeys(Math) 非空（此前折 exact 0）；hasOwn(Math,'PI') → true（此前折 exact false）；gOPD(Math,'PI').value → '3.141592653589793'（此前折 exact undefined → 读 .value 定	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
有索引声明 → 成员读返回该值域（string | undefined）；有索引声明 → 值域是 string 时读到 string；无索引声明 → 诚实退 unknown（那才是真正的推断失败）；符号键例外：符号键读不落到索引值域（原生 undefined）	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
sort 后 Object.keys 不含洞位（改前多出 '2'）；sort 后洞位 `in` 判定为 false（改前为 true）；sort 后 HOF 跳过洞位（forEach 回调 2 次、改前 3 次）；sort 后 filter 结果长度 2（改前 3）；自定义比较器分支同样保留洞位；长度不变（洞位仍在数组内）；负控制：toSorted 走 Get 语义把洞写实为 undefined 元素；负控制：真实 undefined 元素仍是自有可枚举键（不是洞）；负控制：	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
字段初始化器直接读 new.target → undefined；字段初始化器里 typeof new.target → "undefined"；字段初始化器里的箭头函数读 new.target → undefined；派生类的字段初始化器 → undefined；静态字段初始化器里的 new.target → undefined（原生 class 定义期求值）；负控制：构造器体里的 new.target 仍是类值（不得被一起清掉）；负控制：字段初始化器的值本身照常落地（不是	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
rest 解构调用 getter（副作用可见，改前为 0）；rest 槽落 getter 的返回值（改前为 undefined）；负控制：对象展开仍触发 getter（同族路径不受影响）；负控制：Object.assign 源仍触发 getter；负控制：被具名解构排除的键，其 getter 只由具名绑定触发一次；负控制：无 getter 的普通 rest 内容不变	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
union 接收者读 .length 带 undefined 臂（改前恒 number）；L1 契约门禁不再假绿：number() 契约被判违约（改前零诊断）；L1 门禁面：签名显示 undefined 臂；负控制：全成员都有 length 的 union 不带 undefined 臂（不制造假红）；负控制：单成员（无 union）读 .length 仍是诚实的 unknown；负控制：字符串 .length 仍是精确值	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
函数声明 freeze 后 isFrozen 可见（修前折 false）；函数声明 freeze 后 isSealed 亦为 true（原生：freeze ⇒ seal）；函数声明 seal 后 isSealed 可见（修前折 false）；别名读：const a = g 后 freeze，isFrozen(a) 仍为 true（修前折 false）；跨调用可见：helper 里 freeze ⇒ 外面读 isFrozen 为 true；跨调用可见：helper 里读 isF	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
typeof Object(1n).valueOf() → "bigint"（修前是 "object"——自信的错值）；String(Object(1n) + 1) → 记 may-throw TypeError（原生确定抛：BigInt 不得与其它类型混算）；Object(1n) + 1 → 记 may-throw TypeError（不经 String 包装的同一混算臂）；String(Object(1n).valueOf()) → "1"（显式取原值后转字符串合法且确定	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
String(Object(Symbol("x")).description) → "x"；typeof Object(Symbol("x")).description → "string"；对照组：Symbol("x").description → "x"（非装箱路径不变）	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
typeof Object("s").valueOf() → "string"（装箱字符串的 valueOf 面）；typeof Object(1).valueOf() → "number"（装箱数字的 valueOf 面）；String(Object("s").valueOf()) → "s"（装箱字符串取原值）	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
函数表达式：四种象限各折原生标签；箭头函数：同步折 Function、async 折 AsyncFunction（原生同款）；对象方法简写：种类随 async × generator 变；类实例方法：种类随 async × generator 变；类静态方法：staticMethodKinds 下传的种类戳生效；负控制：宿主内建函数（无种类戳）仍折 [object Function]；函数声明：同步折 Function、async 折 AsyncFunction（宿主普通函数	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
async 函数 ⇒ [object AsyncFunction]（改前折 [object Function]）；generator ⇒ [object GeneratorFunction]（改前折 [object Function]）；async generator ⇒ [object AsyncGeneratorFunction]（改前折 [object Function]）；负控制：普通函数表达式 ⇒ [object Function]（原生同款）；负控制：箭头函数 ⇒	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
形参按声明类型推断（string），不再是 any；合法 .ts 不再触发 nudo:entry-may-throw 假红；负控制：同形 .js 源行为不变（形参仍是 any，may-throw 仍在）；原生 oracle：upper('x') 返回 'X' 且不抛（node 另起进程对拍）	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
签名是实值（41+1），不是 unknown；不再产生指向错误的 nudo:opaque-result；负控制：普通具名导出行为不变（default 导出不得劫持别的函数）；同源：`export default class C { m() }` 的方法也走 default 槽（不再 unknown）；原生 oracle：ESM 默认槽挂的就是那个函数（node 另起进程对拍）	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
EACCES 依赖 ⇒ 不抛异常，且产出一条明确诊断；真·不存在（miss）⇒ 不报读失败（既有静默语义不变）；读失败轮不得与「真不存在」轮共享 memo（陈旧命中）—— **同一个 loader 闭包**切换行为	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
用户声明的界直接落进形参 pred（不是写死的 x > 0）；负控：没有声明界 ⇒ 不写界（不替用户发明一个更强的默认界）	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
bigint 字面量渲染成 lit(10n)（与 lit(10) 可分）；负控：数字字面量的渲染逐字不变（lit(10) / lit(-0) / number().gt(10)）	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
rest 形参带 arity：必选元数 + 变长标记；负控：默认形参不计入必选元数；非 rest 形参没有 arity 字段	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
relGuardOf 认复合（合取）关系式，并带上其余合取项的界；relGuardOf 异名合取：每个名字各自保留自己的界（issue #185 others）；负控：单一关系式的守卫逐字不变（无 composite / extra 标记）；负控：析取（||）不接守卫（合取才蕴含；析取单项不被蕴含）；端到端：复合关系式的 return 契约证得（改前判「证不出」）；负控：补集方向不接（后续路径不断言否定界 ⇒ 不假绿）	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
core 内部可用（TS 声明类型文本 → Abs 形状）；负控：公共 API 冻结面零新增（该工具不在公共导出里）	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
1.1 生成器对象 ⇒ [] （原生：Object.getOwnPropertySymbols(g()) === []）；1.2 普通对象 / 数组 / 字符串 / 数字 / 函数 / Error / TA ⇒ [] （原生同）；1.3 宿主命名空间对象 ⇒ 1 个 symbol 键 （原生：Math ⇒ [Symbol.toStringTag]）；1.4 负控：键集不可判的接收者仍是保守 symbol[] （不折空）；1.5 负控：nullish 接收者定抛 TypeErr	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
2.1 Object.prototype.toString.call(g()) ⇒ "[object Generator]" （原生同）；2.2 async 生成器 ⇒ "[object AsyncGenerator]" （原生同，既有口径不回归）；2.3 负控：生成器对象仍无自有可枚举属性 / 无自有 symbol 键 （原生同）	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
3.1 try { break } catch {} ⇒ break 穿过 catch，外层循环退出 （原生同）；3.2 try { continue } catch {} ⇒ continue 穿过 catch （原生同）；3.3 try 块内的早退提升：后续路径的值不得被当成函数返回值 （原生：1）；3.4 catch 体 / finally 体内的早退提升同口径 （原生：1 / 2）；3.5 负控：函数体顶层（块外）的早退提升口径不变 （原生：1 / 42）	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
4.1 compare / resolvedOptions ⇒ "function" （原生同）；4.2 负控：已建模的 Intl.NumberFormat 面不回归 （原生同）	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
5.1 继承的 cause ⇒ 读出 unknown （不得读出「确定不存在」）；5.2 继承的 cause ⇒ 存在性确定（原生："cause" in e === true）；5.3 自有 cause 键 ⇒ 值精确 （原生：1）；5.4 负控：无 options / 闭 obj 无 cause 键 ⇒ 确定无 cause 槽 （原生同）	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
6.1 字符串源逐元素 ToNumber ⇒ 精确值 （原生：new Int8Array(["3"])[0] === 3）；6.2 整数 TA 的取值转换（模 2^n 回绕 / 向零截断） （原生同）；6.3 浮点 / bigint 家族同口径 （原生同）；6.4 负控：长度形态（元素不可知）仍是元素域 ∪ undefined （不假精确）	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
具名导入渲染 env 声明的类型（不再退化成裸 fn 的 `() => ?`）；具名导入与命名空间导入给出同一个类型（同一文件、同一导出、两种形态）；签名面不含非法占位符 `?`；调用面返回域 = 声明的 returnType（实参也是原 Abs，不是裸 fn）；负控制：用户模块（桥接 Abs，无声明返回域）两种导入形态同样一致	algebra-eval-core 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
litC(1n)：builder 带 prim bigint（改前无 prim ⇒ Abs 落 number 兜底）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
契约 Abs 的 shape 是 prim bigint（不是 number）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
guard 面：渲染含 typeof data === "bigint"，且 guard(1n) === true（改前假红）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
union 成员：union(lit(1n)) 的 shape 也是 prim bigint（改前落 boolean 兜底）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
实例化口径：bigint 字面量契约带 typeof 义务（与 number/string/boolean 同款）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
schema 面入口：absToConstraint 对 prim bigint 仍返回 undefined（zod 面走 eq 主导支）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
门禁接受集不变：lit(1n) 收到 1n ⇒ 零违例	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
门禁：bigint 字面量契约收到非 bigint 实参 ⇒ 报违例（literal 义务仍在）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
A1 赋值：计算键先于 RHS（原生 k,v）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
A2 赋值：对象先于计算键先于 RHS（原生 f,k,v）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
A3 下标赋值：a[i++] = i + 10（原生 11,0|1）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
A4 下标赋值：a[i++] = i（原生 1,0|1）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
B1 复合赋值：计算键只跑一次且先于 RHS（原生 k,v）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
B2 自增：计算键只跑一次（原生 k）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
B3 delete：计算键只跑一次（原生 k）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
B4 赋值：顺序修正后值仍落位（原生 k,v|2）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
B5 自增：键一次且新值落位（原生 k|2）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
B6 delete：键一次且槽真被删（原生 k|gone）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
C1 负控制：o.a = 2 → 2	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
C2 负控制：o.a += 2 → 3	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
C3 负控制：o.a++ → 2	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
C4 负控制：delete o.a → gone	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
C5 负控制：a[i++] = 5 → 5,0|1	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
C6 负控制：嵌套成员写 o.a.b = 2 → 2	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
C7 负控制：赋值表达式的值 = 写入的值（原生 5|5）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
C8 负控制：delete o.a.b（数据属性链）→ gone	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
副作用保留：被断言的调用仍被调用	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
throws 域保留：被断言调用的抛错不被吞	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
return 位的 @nudo:as 同样仍求值	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
结果取断言值（类型覆盖生效）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：未被标注的相邻语句照常求值	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：同样的源码无指令时行为不变（对照）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
被替换的调用仍被调用（副作用保留）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
被替换的调用的抛错域保留（throws 面不被吞）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：未被标注的相邻子表达式照常求值	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
替换结果取注入值（原表达式的值被取代）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
Map.keys() 的 rest 解构 → 取剩余键（原生 "b"）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
Map.values() 的 rest 解构 → 取剩余值（原生 "2"）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
Map.entries() 的 rest 解构 → 取剩余条目元组（原生 "b:2"）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
Set.values() 的 rest 解构 → 取剩余元素（原生 "2,3"）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：生成器 rest 解构不受影响（原生 "2"）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：普通数组 rest 解构不受影响（原生 "2,3"）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
values() 迭代器：push 之后的 for-of 跑满剩余轮数（原生 "2,3"）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
values() 迭代器：push 之后的展开取剩余（原生 "2,3"）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
keys() 迭代器：push 之后的 for-of 跑满剩余轮数（原生 "1,2"）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
entries() 迭代器：push 之后的 for-of 跑满剩余轮数（原生 "1:2,2:3"）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：未变更的数组迭代器 for-of 不受影响（原生 "1,2"）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
m[Symbol.iterator]() → 集合迭代器（原生 "a:1"，修复前折 never）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
s[Symbol.iterator]() → 元素迭代器（原生 1，非 [el,el]）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
借调 Map.prototype[Symbol.iterator].call(m) → 集合迭代器（原生 "a:1"）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
借调 Set.prototype[Symbol.iterator].call(s) → 元素迭代器（原生 1）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
m[Symbol.iterator] 是函数（原生 "function"）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
for-of 走 m[Symbol.iterator]() → 逐条目（原生 "a=1"）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
m[Symbol.iterator]() 是 live 迭代器：迭代期间的 set 可见（原生 "a,b"）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
借调 Map.prototype[Symbol.iterator].call(m) 是 live 迭代器（原生 "a,b"）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
s[Symbol.iterator]() 是 live 迭代器：迭代期间的 add 可见（原生 "1,2"）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：m.entries() / m.keys() / m.values() 不受影响	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
Set.forEach：回调里删除条目 → 被删条目不再被访问	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
Set.forEach：回调里新增条目 → 新条目被追加访问	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
Map.forEach：回调里新增条目 → 新条目被追加访问	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
Map.forEach：回调里 clear() → 后续条目不再被访问	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
Map.forEach：回调里改写已有条目的值 → 读到的是新值	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
for-of（Set）：回调体里删除条目 → 被删条目不再被访问	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
for-of（Map）：循环体里新增条目 → 新条目被追加访问	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
for-of（Set）：循环体里 clear() → 立即终止	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：静态快照视图不受影响（[...m.keys()] / [...s]）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：数组 / 普通对象的 forEach 不受影响	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
Map.keys()：迭代期间删除条目 → 被删条目不再被访问（done 提前为 true）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
Map.keys()：迭代期间新增条目 → 新条目被追加访问	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
Map.values()：迭代期间改写已有条目的值 → 读到新值（非陈旧值）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
Map.entries()：迭代期间新增条目 → 新条目被追加访问	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
Set.values()：迭代期间删除元素 → 被删元素不再被访问	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
Set.entries()：迭代期间新增元素 → 新元素被追加访问	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
数组 entries()：迭代期间 shift() → 读到移位后的当前内容	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
数组 @@iterator()（= values）：迭代期间 unshift() → 读到移位后的当前内容	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
数组 keys()：迭代期间 push() → 展开取到新增下标	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：无变异时手动迭代器与快照一致	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：迭代器对象仍不是数组（Array.isArray → false）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
① Map.keys() 的 next().value 是键（不是 [k,v] 条目元组）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
① Map.values() 的 next().value 是值（不是条目元组）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
① Set.entries() 的 next().value 是 [el, el] 元组（不是元素本身）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
① 投影在 live 路径上同样成立（迭代期间新增条目 → 新条目按投影给出）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
② for-of 走**当前剩余**：消费一条后接收者新增条目 ⇒ 新条目仍被访问	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
② for-of 走**当前剩余**：消费一条后接收者删除条目 ⇒ 被删条目被跳过	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
② Set 迭代器同口径：消费一条后接收者新增元素 ⇒ 新元素被访问	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：forEach 的 live 路径不受影响	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：用户迭代器协议（@@iterator）不受影响	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
Map.keys()：live 视图给键（不是 [k,v] 条目元组）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
Map.values()：live 视图给值（不是条目元组）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
Map.entries()：live 视图给条目元组	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
Set.keys()/values()：live 视图给元素	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
Set.entries()：live 视图给 [el, el] 元组（不是元素本身）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
gOPN(Math) 非空（此前折 exact 0）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
gOPN(Math) 含 'PI'（此前整个自有面被丢弃）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
gOPN(JSON) 非空（此前折 exact 0）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
Reflect.ownKeys(Math) 非空（此前折 exact 0）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
hasOwn(Math,'PI') → true（此前折 exact false）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
gOPD(Math,'PI').value → '3.141592653589793'（此前折 exact undefined → 读 .value 定抛）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
gOPD(Math,'PI').enumerable → 'false'（原生 Math.PI 不可枚举）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
gOPD(Math,'PI').writable → 'false'（原生 Math.PI 不可写）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：Object.keys(Math) 仍为 0（可枚举面本就空）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：成员读 Math.PI 不受影响	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：用户对象 gOPN / hasOwn / gOPD 不受影响	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：用户对象的不可枚举自有键进 gOPN 面、不进 keys 面	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
有索引声明 → 成员读返回该值域（string | undefined）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
有索引声明 → 值域是 string 时读到 string	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
无索引声明 → 诚实退 unknown（那才是真正的推断失败）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
符号键例外：符号键读不落到索引值域（原生 undefined）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
sort 后 Object.keys 不含洞位（改前多出 '2'）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
sort 后洞位 `in` 判定为 false（改前为 true）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
sort 后 HOF 跳过洞位（forEach 回调 2 次、改前 3 次）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
sort 后 filter 结果长度 2（改前 3）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
自定义比较器分支同样保留洞位	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
长度不变（洞位仍在数组内）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：toSorted 走 Get 语义把洞写实为 undefined 元素	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：真实 undefined 元素仍是自有可枚举键（不是洞）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：sort 之前洞位语义不变（keys 0,2 / forEach 2 次）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：稠密数组排序结果不变	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
字段初始化器直接读 new.target → undefined	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
字段初始化器里 typeof new.target → "undefined"	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
字段初始化器里的箭头函数读 new.target → undefined	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
派生类的字段初始化器 → undefined	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
静态字段初始化器里的 new.target → undefined（原生 class 定义期求值）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：构造器体里的 new.target 仍是类值（不得被一起清掉）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：字段初始化器的值本身照常落地（不是 undefined 化）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
rest 解构调用 getter（副作用可见，改前为 0）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
rest 槽落 getter 的返回值（改前为 undefined）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：对象展开仍触发 getter（同族路径不受影响）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：Object.assign 源仍触发 getter	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：被具名解构排除的键，其 getter 只由具名绑定触发一次	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：无 getter 的普通 rest 内容不变	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
union 接收者读 .length 带 undefined 臂（改前恒 number）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
L1 契约门禁不再假绿：number() 契约被判违约（改前零诊断）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
L1 门禁面：签名显示 undefined 臂	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：全成员都有 length 的 union 不带 undefined 臂（不制造假红）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：单成员（无 union）读 .length 仍是诚实的 unknown	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：字符串 .length 仍是精确值	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
函数声明 freeze 后 isFrozen 可见（修前折 false）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
函数声明 freeze 后 isSealed 亦为 true（原生：freeze ⇒ seal）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
函数声明 seal 后 isSealed 可见（修前折 false）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
别名读：const a = g 后 freeze，isFrozen(a) 仍为 true（修前折 false）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
跨调用可见：helper 里 freeze ⇒ 外面读 isFrozen 为 true	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
跨调用可见：helper 里读 isFrozen 为 true（标志随同一 Abs 门面）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
跨调用可见：helper 里 seal ⇒ 外面读 isSealed 为 true	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
同引用读：g === g 折 true（修前不可判）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
同引用读：两次读同一宿主函数恒等（a === b 折 true）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
同引用读：helper 返回的同一宿主函数与直接读恒等	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
对照：函数表达式的既有行为（freeze 后 isFrozen 恒 true）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：freeze / seal 之前 isFrozen / isSealed 均为 false	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
typeof Object(1n).valueOf() → "bigint"（修前是 "object"——自信的错值）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
String(Object(1n) + 1) → 记 may-throw TypeError（原生确定抛：BigInt 不得与其它类型混算）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
Object(1n) + 1 → 记 may-throw TypeError（不经 String 包装的同一混算臂）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
String(Object(1n).valueOf()) → "1"（显式取原值后转字符串合法且确定）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
typeof Object(1n) → "object"（装箱体本身是对象）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
String(Object(Symbol("x")).description) → "x"	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
typeof Object(Symbol("x")).description → "string"	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
对照组：Symbol("x").description → "x"（非装箱路径不变）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
typeof Object("s").valueOf() → "string"（装箱字符串的 valueOf 面）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
typeof Object(1).valueOf() → "number"（装箱数字的 valueOf 面）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
String(Object("s").valueOf()) → "s"（装箱字符串取原值）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
函数表达式：四种象限各折原生标签	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
箭头函数：同步折 Function、async 折 AsyncFunction（原生同款）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
对象方法简写：种类随 async × generator 变	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
类实例方法：种类随 async × generator 变	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
类静态方法：staticMethodKinds 下传的种类戳生效	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：宿主内建函数（无种类戳）仍折 [object Function]	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
函数声明：同步折 Function、async 折 AsyncFunction（宿主普通函数的种类戳）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
函数声明：generator 折 GeneratorFunction、async generator 折 AsyncGeneratorFunction	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
函数声明：种类戳在**声明提升**下也生效（声明前先调用）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：函数声明的宿主原生标签不被误用（同步声明仍是 Function）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
async 函数 ⇒ [object AsyncFunction]（改前折 [object Function]）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
generator ⇒ [object GeneratorFunction]（改前折 [object Function]）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
async generator ⇒ [object AsyncGeneratorFunction]（改前折 [object Function]）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：普通函数表达式 ⇒ [object Function]（原生同款）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：箭头函数 ⇒ [object Function]（原生同款）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：generator 仍有原生 prototype（Bug 93 面不被新值域破坏）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
形参按声明类型推断（string），不再是 any	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
合法 .ts 不再触发 nudo:entry-may-throw 假红	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：同形 .js 源行为不变（形参仍是 any，may-throw 仍在）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
原生 oracle：upper('x') 返回 'X' 且不抛（node 另起进程对拍）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
签名是实值（41+1），不是 unknown	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
不再产生指向错误的 nudo:opaque-result	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：普通具名导出行为不变（default 导出不得劫持别的函数）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
同源：`export default class C { m() }` 的方法也走 default 槽（不再 unknown）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
原生 oracle：ESM 默认槽挂的就是那个函数（node 另起进程对拍）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
EACCES 依赖 ⇒ 不抛异常，且产出一条明确诊断	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
真·不存在（miss）⇒ 不报读失败（既有静默语义不变）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
读失败轮不得与「真不存在」轮共享 memo（陈旧命中）—— **同一个 loader 闭包**切换行为	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
用户声明的界直接落进形参 pred（不是写死的 x > 0）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控：没有声明界 ⇒ 不写界（不替用户发明一个更强的默认界）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
bigint 字面量渲染成 lit(10n)（与 lit(10) 可分）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控：数字字面量的渲染逐字不变（lit(10) / lit(-0) / number().gt(10)）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
rest 形参带 arity：必选元数 + 变长标记	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控：默认形参不计入必选元数；非 rest 形参没有 arity 字段	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
relGuardOf 认复合（合取）关系式，并带上其余合取项的界	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
relGuardOf 异名合取：每个名字各自保留自己的界（issue #185 others）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控：单一关系式的守卫逐字不变（无 composite / extra 标记）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控：析取（||）不接守卫（合取才蕴含；析取单项不被蕴含）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
端到端：复合关系式的 return 契约证得（改前判「证不出」）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控：补集方向不接（后续路径不断言否定界 ⇒ 不假绿）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
core 内部可用（TS 声明类型文本 → Abs 形状）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控：公共 API 冻结面零新增（该工具不在公共导出里）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
1.1 生成器对象 ⇒ [] （原生：Object.getOwnPropertySymbols(g()) === []）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
1.2 普通对象 / 数组 / 字符串 / 数字 / 函数 / Error / TA ⇒ [] （原生同）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
1.3 宿主命名空间对象 ⇒ 1 个 symbol 键 （原生：Math ⇒ [Symbol.toStringTag]）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
1.4 负控：键集不可判的接收者仍是保守 symbol[] （不折空）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
1.5 负控：nullish 接收者定抛 TypeError （原生同）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
2.1 Object.prototype.toString.call(g()) ⇒ "[object Generator]" （原生同）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
2.2 async 生成器 ⇒ "[object AsyncGenerator]" （原生同，既有口径不回归）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
2.3 负控：生成器对象仍无自有可枚举属性 / 无自有 symbol 键 （原生同）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
3.1 try { break } catch {} ⇒ break 穿过 catch，外层循环退出 （原生同）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
3.2 try { continue } catch {} ⇒ continue 穿过 catch （原生同）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
3.3 try 块内的早退提升：后续路径的值不得被当成函数返回值 （原生：1）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
3.4 catch 体 / finally 体内的早退提升同口径 （原生：1 / 2）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
3.5 负控：函数体顶层（块外）的早退提升口径不变 （原生：1 / 42）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
4.1 compare / resolvedOptions ⇒ "function" （原生同）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
4.2 负控：已建模的 Intl.NumberFormat 面不回归 （原生同）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
5.1 继承的 cause ⇒ 读出 unknown （不得读出「确定不存在」）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
5.2 继承的 cause ⇒ 存在性确定（原生："cause" in e === true）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
5.3 自有 cause 键 ⇒ 值精确 （原生：1）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
5.4 负控：无 options / 闭 obj 无 cause 键 ⇒ 确定无 cause 槽 （原生同）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
6.1 字符串源逐元素 ToNumber ⇒ 精确值 （原生：new Int8Array(["3"])[0] === 3）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
6.2 整数 TA 的取值转换（模 2^n 回绕 / 向零截断） （原生同）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
6.3 浮点 / bigint 家族同口径 （原生同）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
6.4 负控：长度形态（元素不可知）仍是元素域 ∪ undefined （不假精确）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
具名导入渲染 env 声明的类型（不再退化成裸 fn 的 `() => ?`）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
具名导入与命名空间导入给出同一个类型（同一文件、同一导出、两种形态）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
签名面不含非法占位符 `?`	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
调用面返回域 = 声明的 returnType（实参也是原 Abs，不是裸 fn）	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
负控制：用户模块（桥接 Abs，无声明返回域）两种导入形态同样一致	dup:algebra-eval-core 聚合矩阵	commit:6e96354b
```
