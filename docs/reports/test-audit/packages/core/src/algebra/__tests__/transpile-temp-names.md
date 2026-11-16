# packages/core/src/algebra/__tests__/transpile-temp-names.test.ts

模块套件：转译器内部临时名必须避开用户标识符（不变量级回归面）。 本文件是可空链 / 成员路径 / 赋值 / fork / switch / this 载体等全部 发射点的**唯一归属**：缺陷编号只保留在 it 标题的 provenance 中，不再作为 文件名。

审计：88 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
"$label"	表驱动用例：$label；枚举同一不变量下的输入/期望组合，属既有表行补齐。	夹具漏形态	keep	keep	—
__nudoMpObj（assignment 兜底臂的对象载体）→ 8（原生 8；修前：unknown）；__nudoMpOld（assignment 兜底臂的旧值载体）→ 11（原生 11；修前：2）；__nudoMpKey（assignment 兜底臂的计算键载体）→ 11（原生 11；修前：1）；__nudoMpK0（层键载体）→ 2（原生 2；修前：ReferenceError）；__nudoMpC0（中间层持有者载体）→ 6（原生 6；修前：unknown）；__n	transpile-temp-names 聚合矩阵	没测该层	keep	keep	—
撞名时签名面仍拿到精确值（修前：unknown / 错值）；撞名时无假 nudo:opaque-result（整模块 fail-closed 面）	transpile-temp-names 聚合矩阵	没测该层	keep	keep	—
无碰撞时内部临时名逐字保持基名（无 `_k` 后缀）；撞名时改名（`__nudoMpRoot` → `__nudoMpRoot_1`）且仍确定（同源两次逐字相同）；同一源码转译两次 ⇒ 产物逐字相同（确定性）	transpile-temp-names 聚合矩阵	没测该层	keep	keep	—
撞名时签名面拿到精确值（修前：never throws ReferenceError）；撞名时无假 nudo:entry-may-throw（原生不抛 ⇒ 修前是假红）；撞名时无假 nudo:opaque-result（整模块 fail-closed 面）	transpile-temp-names 聚合矩阵	没测该层	keep	keep	—
无碰撞时内部临时名逐字保持基名（无 `_k` 后缀）；无碰撞时正则族临时名逐字保持基名（`__nudoReArgs` / `__v`）；撞名时改名（`__nudoDefR` → `__nudoDefR_1`）且仍确定（同源两次逐字相同）；正则族撞名时改名（`__nudoReArgs` → `__nudoReArgs_1`）且仍确定	transpile-temp-names 聚合矩阵	没测该层	keep	keep	—
撞名时签名面拿到精确值（修前：never throws ReferenceError / 错值）；撞名时无假 nudo:entry-may-throw（原生不抛 ⇒ 修前是假红）；撞名时无假 nudo:opaque-result（整模块 fail-closed 面）	transpile-temp-names 聚合矩阵	没测该层	keep	keep	—
无碰撞时可选链族临时名逐字保持基名（无 `_k` 后缀）；无碰撞时短路族临时名逐字保持基名（`__sc0` / `__test` / `__v` / `__r`）；无碰撞时对象族临时名逐字保持基名（`__v` / `__k` / `__nudoProtoBox`）；撞名时改名（`__nudoReArgs` → `__nudoReArgs_1`）且仍确定（同源两次逐字相同）；撞名时短路族改名（`__test` → `__test_1`）且仍确定；撞名时对象族改名（`__v` →	transpile-temp-names 聚合矩阵	没测该层	keep	keep	—
撞名时签名面拿到精确值 15（修前：20）；撞名时无假 nudo:entry-may-throw（原生不抛 ⇒ 修前是假红）；撞名时无假 nudo:opaque-result（整模块 fail-closed 面）	transpile-temp-names 聚合矩阵	没测该层	keep	keep	—
无碰撞时 setter thunk 形参名逐字保持基名 `__v`（无 `_k` 后缀）；无碰撞时解构 setter thunk 形参名逐字保持基名 `__v`；撞名时改名（`__v` → `__v_1`）且仍确定（同源两次逐字相同）；撞名时改名后 thunk 形参与 args 槽引用同名（成对一致）	transpile-temp-names 聚合矩阵	没测该层	keep	keep	—
触发 B3：switch 臂标志 __cont → 42（原生 42；修前：true）；撞名时快照名改名（`__fk0_a` → `__fk0_a_1`）且声明点与引用点同名；撞名时臂标志名改名（`__cont` → `__cont_1`）且成对一致；无碰撞时 fork 协议名逐字保持基名（产物逐字不变面）	transpile-temp-names 聚合矩阵	没测该层	keep	keep	—
撞名时 IIFE 形参改名（`__v` → `__v_1`）且写目标仍写用户绑定；无碰撞时 IIFE 形参名逐字保持基名 `__v`（产物逐字不变面）	transpile-temp-names 聚合矩阵	没测该层	keep	keep	—
触发 A1：__swAllDone → 42（原生 42；修前：false）；触发 A2：臂体 __swTestRead → 5（原生 5；修前：ReferenceError / never）；触发 A3：__swEval → 7（原生 7；修前：引擎内部函数 Abs）；触发 A4：case 测试读 __swT → "hit"（原生 "hit"；修前："miss"）；触发 A5：共享体名 __swBody0 → 11（原生 11；修前：函数 Abs）；对照 A0：无同名绑定	transpile-temp-names 聚合矩阵	没测该层	keep	keep	—
触发 B1：用户标签块 __nudoSw0 不再吸收 switch break → 1（原生 1；修前：3）；对照 B0：标签名不撞内部标签 ⇒ 1（原生 1）	transpile-temp-names 聚合矩阵	没测该层	keep	keep	—
触发 C1：delete 父对象表达式读 __nudoDelP → true（原生 true；修前：ReferenceError）；触发 C2：delete 计算键表达式读 __nudoDelK → true（原生 true；修前：ReferenceError）；触发 C3：标识符后缀 __old → [5, 6]（原生 [5, 6]；修前：[6, 5]）；触发 C4：私有名前缀自增（接收者形参 __v）→ 1（原生 1；修前：TypeError）；触发 C5：私有名后缀自增	transpile-temp-names 聚合矩阵	没测该层	keep	keep	—
触发 D1：别名载体 __nab0 → 100（原生 100；修前：undefined）；触发 D2：回收载体 __nabs（多名别名）→ 100（原生 100；修前：ReferenceError）；对照 D0：无同名绑定 ⇒ setter 别名写回收同值（5）	transpile-temp-names 聚合矩阵	没测该层	keep	keep	—
撞名时无假 nudo:entry-may-throw（原生不抛 ⇒ 修前 TDZ 路径是假红）；撞名时无假 nudo:opaque-result（整模块 fail-closed 面）	transpile-temp-names 聚合矩阵	没测该层	keep	keep	—
"撞名时分配器改名确定：同源两次转译逐字相同（无 switch 计数器的源）"	"背景： 已约定「引擎内部临时名必须避开用户标识符」 （`transpile/helpers.ts` 的 `internalTmpName` / `internalTmpNameSet`）， 陆续落到 `__nudoMp*` / 调用族 / 可选链 / 短路 / 对象 / 类形参。 本条的落点： - `stmt/statement.ts`（1159-a）：switch 的 **case 测试辅助族**（`__swT` / `__swTV` / `__swTD` / `__swAllDone` / `__swTestRead` / `__swEval` / `__swEvalAll`，及其形参 `__swI` / 循环变量 `__swJ"	夹具漏形态	keep	keep	—
方法形参同名 ⇒ [42, 7]（原生 [42, 7]；修前：重复形参 SyntaxError）；方法非简单形参同名 ⇒ [42, 7]（原生 [42, 7]；修前：SyntaxError）；构造器形参同名 + super() ⇒ [1, 7]（原生 [1, 7]；修前：SyntaxError）；构造器块级同名 + super() 不劫持接收者重绑 ⇒ [1, 9]（原生 [1, 9]；修前：never）；静态方法形参同名 ⇒ [true, 7]（原生 [true, 7]；修	transpile-temp-names 聚合矩阵	没测该层	keep	keep	—
"类表达式静态块：外层同名 + 类名 this ⇒ [5, \"CC\"]（原生 [5, \"CC\"]；修前：tuple 含载体）"	"构造器块级同名 + super() 重绑不得劫持 ⇒ 原生 [1, 9]（修前：never） 断言：expect(tuple(SRC_STATIC_BLOCK_EXPR)).toEqual([5, \"CC\"]);"	夹具漏形态	keep	keep	—
对象方法形参同名 ⇒ [42, 7]（原生 [42, 7]；修前：重复形参 SyntaxError）；对象方法解构形参含同名 ⇒ [42, 7]（原生 [42, 7]；修前：SyntaxError）；对象属性 = 函数表达式形参同名 ⇒ [42, 7]（原生 [42, 7]；修前：SyntaxError）	transpile-temp-names 聚合矩阵	没测该层	keep	keep	—
"方法内嵌套真函数形参同名 ⇒ [1, 2]（原生 [1, 2]；修前：SyntaxError）"	"构造器块级同名 + super() 重绑不得劫持 ⇒ 原生 [1, 9]（修前：never） 断言：expect(tuple(SRC_NESTED_FN)).toEqual([1, 2]);"	夹具漏形态	keep	keep	—
真函数 this 载体；类方法 / 字段 / 静态块 / 访问器；对象方法 / 访问器；箭头捕获方法 this	transpile-temp-names 聚合矩阵	没测该层	keep	keep	—
分配器基名 ⊆ COLLISION_COVERED ∪ ALLOCATOR_GATED；COLLISION_COVERED 不残留已删除的基名；分配器本身对每个基名都避让（撞名 ⇒ <base>_1；无撞名 ⇒ 原名）；发射点不写死内部名（字面量 ⊆ 分配器调用 / const 间接）	transpile-temp-names 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
__nudoMpObj（assignment 兜底臂的对象载体）→ 8（原生 8；修前：unknown）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
__nudoMpOld（assignment 兜底臂的旧值载体）→ 11（原生 11；修前：2）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
__nudoMpKey（assignment 兜底臂的计算键载体）→ 11（原生 11；修前：1）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
__nudoMpK0（层键载体）→ 2（原生 2；修前：ReferenceError）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
__nudoMpC0（中间层持有者载体）→ 6（原生 6；修前：unknown）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
__nudoMpVal（写入值载体）→ 11（原生 11；修前：unknown）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
__nudoMpNew（新值载体）→ 11（原生 11；修前：ReferenceError）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
__nudoMpDelK（delete 键载体）→ "true|undefined"（原生同款；修前：ReferenceError）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
__nudoMpRes（写回结果载体）→ 11（原生 11；修前：unknown）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
派生路径（optional 链 delete 的前缀路径）→ "true|{\"a\":{}}"（原生同款）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
派生路径 + 层键载体 __nudoMpK0 → "true|{\"a\":{}}"（原生同款）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
撞名时签名面仍拿到精确值（修前：unknown / 错值）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
撞名时无假 nudo:opaque-result（整模块 fail-closed 面）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
无碰撞时内部临时名逐字保持基名（无 `_k` 后缀）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
撞名时改名（`__nudoMpRoot` → `__nudoMpRoot_1`）且仍确定（同源两次逐字相同）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
同一源码转译两次 ⇒ 产物逐字相同（确定性）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
撞名时签名面拿到精确值（修前：never throws ReferenceError）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
撞名时无假 nudo:entry-may-throw（原生不抛 ⇒ 修前是假红）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
无碰撞时正则族临时名逐字保持基名（`__nudoReArgs` / `__v`）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
撞名时改名（`__nudoDefR` → `__nudoDefR_1`）且仍确定（同源两次逐字相同）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
正则族撞名时改名（`__nudoReArgs` → `__nudoReArgs_1`）且仍确定	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
撞名时签名面拿到精确值（修前：never throws ReferenceError / 错值）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
无碰撞时可选链族临时名逐字保持基名（无 `_k` 后缀）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
无碰撞时短路族临时名逐字保持基名（`__sc0` / `__test` / `__v` / `__r`）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
无碰撞时对象族临时名逐字保持基名（`__v` / `__k` / `__nudoProtoBox`）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
撞名时改名（`__nudoReArgs` → `__nudoReArgs_1`）且仍确定（同源两次逐字相同）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
撞名时短路族改名（`__test` → `__test_1`）且仍确定	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
撞名时对象族改名（`__v` → `__v_1`）且仍确定	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
撞名时签名面拿到精确值 15（修前：20）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
无碰撞时 setter thunk 形参名逐字保持基名 `__v`（无 `_k` 后缀）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
无碰撞时解构 setter thunk 形参名逐字保持基名 `__v`	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
撞名时改名（`__v` → `__v_1`）且仍确定（同源两次逐字相同）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
撞名时改名后 thunk 形参与 args 槽引用同名（成对一致）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
触发 B3：switch 臂标志 __cont → 42（原生 42；修前：true）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
撞名时快照名改名（`__fk0_a` → `__fk0_a_1`）且声明点与引用点同名	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
撞名时臂标志名改名（`__cont` → `__cont_1`）且成对一致	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
无碰撞时 fork 协议名逐字保持基名（产物逐字不变面）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
撞名时 IIFE 形参改名（`__v` → `__v_1`）且写目标仍写用户绑定	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
无碰撞时 IIFE 形参名逐字保持基名 `__v`（产物逐字不变面）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
触发 A1：__swAllDone → 42（原生 42；修前：false）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
触发 A2：臂体 __swTestRead → 5（原生 5；修前：ReferenceError / never）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
触发 A3：__swEval → 7（原生 7；修前：引擎内部函数 Abs）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
触发 A4：case 测试读 __swT → "hit"（原生 "hit"；修前："miss"）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
触发 A5：共享体名 __swBody0 → 11（原生 11；修前：函数 Abs）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
对照 A0：无同名绑定 ⇒ 测试 / 共享臂路径同值（"hit"）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
触发 B1：用户标签块 __nudoSw0 不再吸收 switch break → 1（原生 1；修前：3）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
对照 B0：标签名不撞内部标签 ⇒ 1（原生 1）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
触发 C1：delete 父对象表达式读 __nudoDelP → true（原生 true；修前：ReferenceError）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
触发 C2：delete 计算键表达式读 __nudoDelK → true（原生 true；修前：ReferenceError）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
触发 C3：标识符后缀 __old → [5, 6]（原生 [5, 6]；修前：[6, 5]）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
触发 C4：私有名前缀自增（接收者形参 __v）→ 1（原生 1；修前：TypeError）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
触发 C5：私有名后缀自增（接收者形参 __old）→ [0, 1]（原生 [0, 1]；修前：TypeError）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
触发 C6：for-in 接收者 __fir{n} 撞用户声明 → 3（原生 3；修前：宿主 SyntaxError）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
触发 C7：for fallback 状态形参 __n → 0（原生 0；修前：3）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
触发 C8：do-while 首轮标记 __nudoDwFirst → 7（原生 7；修前：false）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
触发 C9：rest 形参 __rest_raw → 3（原生 3；修前：SyntaxError）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
触发 C10：解构 IIFE 形参 __d → 5（原生 5；修前：对象）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
对照 C0：无同名绑定 ⇒ delete / 后缀 / 私有名自增 / for-in 接收者同值	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
触发 D1：别名载体 __nab0 → 100（原生 100；修前：undefined）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
触发 D2：回收载体 __nabs（多名别名）→ 100（原生 100；修前：ReferenceError）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
对照 D0：无同名绑定 ⇒ setter 别名写回收同值（5）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
撞名时无假 nudo:entry-may-throw（原生不抛 ⇒ 修前 TDZ 路径是假红）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
方法形参同名 ⇒ [42, 7]（原生 [42, 7]；修前：重复形参 SyntaxError）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
方法非简单形参同名 ⇒ [42, 7]（原生 [42, 7]；修前：SyntaxError）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
构造器形参同名 + super() ⇒ [1, 7]（原生 [1, 7]；修前：SyntaxError）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
构造器块级同名 + super() 不劫持接收者重绑 ⇒ [1, 9]（原生 [1, 9]；修前：never）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
静态方法形参同名 ⇒ [true, 7]（原生 [true, 7]；修前：SyntaxError）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
对象方法形参同名 ⇒ [42, 7]（原生 [42, 7]；修前：重复形参 SyntaxError）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
对象方法解构形参含同名 ⇒ [42, 7]（原生 [42, 7]；修前：SyntaxError）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
对象属性 = 函数表达式形参同名 ⇒ [42, 7]（原生 [42, 7]；修前：SyntaxError）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
真函数 this 载体	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
类方法 / 字段 / 静态块 / 访问器	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
对象方法 / 访问器	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
箭头捕获方法 this	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
分配器基名 ⊆ COLLISION_COVERED ∪ ALLOCATOR_GATED	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
COLLISION_COVERED 不残留已删除的基名	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
分配器本身对每个基名都避让（撞名 ⇒ <base>_1；无撞名 ⇒ 原名）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
发射点不写死内部名（字面量 ⊆ 分配器调用 / const 间接）	dup:transpile-temp-names 聚合矩阵	commit:8fa85177
```
