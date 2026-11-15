# packages/core/src/algebra/__tests__/transpile-temp-names.test.ts

模块套件：88 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"__nudoMpObj（assignment 兜底臂的对象载体）→ 8（原生 8；修前：unknown）"	"触发 2：旧值载体 `__nudoMpOld` 与用户同名 ⇒ 原生 12（修前：13）"	夹具漏形态	keep	keep	—
"__nudoMpOld（assignment 兜底臂的旧值载体）→ 11（原生 11；修前：2）"	"触发 2：旧值载体 `__nudoMpOld` 与用户同名 ⇒ 原生 12（修前：13）"	夹具漏形态	keep	keep	—
"__nudoMpKey（assignment 兜底臂的计算键载体）→ 11（原生 11；修前：1）"	"触发 2：旧值载体 `__nudoMpOld` 与用户同名 ⇒ 原生 12（修前：13）"	夹具漏形态	keep	keep	—
"__nudoMpK0（层键载体）→ 2（原生 2；修前：ReferenceError）"	"触发 2：旧值载体 `__nudoMpOld` 与用户同名 ⇒ 原生 12（修前：13）"	夹具漏形态	keep	keep	—
"__nudoMpC0（中间层持有者载体）→ 6（原生 6；修前：unknown）"	"触发 2：旧值载体 `__nudoMpOld` 与用户同名 ⇒ 原生 12（修前：13）"	夹具漏形态	keep	keep	—
"__nudoMpVal（写入值载体）→ 11（原生 11；修前：unknown）"	"触发 2：旧值载体 `__nudoMpOld` 与用户同名 ⇒ 原生 12（修前：13）"	夹具漏形态	keep	keep	—
"__nudoMpNew（新值载体）→ 11（原生 11；修前：ReferenceError）"	"触发 2：旧值载体 `__nudoMpOld` 与用户同名 ⇒ 原生 12（修前：13）"	夹具漏形态	keep	keep	—
"__nudoMpDelK（delete 键载体）→ \"true|undefined\"（原生同款；修前：ReferenceError）"	"触发 2：旧值载体 `__nudoMpOld` 与用户同名 ⇒ 原生 12（修前：13）"	夹具漏形态	keep	keep	—
"__nudoMpRes（写回结果载体）→ 11（原生 11；修前：unknown）"	"触发 2：旧值载体 `__nudoMpOld` 与用户同名 ⇒ 原生 12（修前：13）"	夹具漏形态	keep	keep	—
"派生路径（optional 链 delete 的前缀路径）→ \"true|{\\\"a\\\":{}}\"（原生同款）"	"派生路径用对象字面量重建 MemberPath（丢 MemberPath 上的字段）⇒ 临时名须经**共享的层对象**继承，否则前缀路径仍写死名。 触发 2：旧值载体 `__nudoMpOld` 与用户同名 ⇒ 原生 12（修前：13）"	夹具漏形态	keep	keep	—
"派生路径 + 层键载体 __nudoMpK0 → \"true|{\\\"a\\\":{}}\"（原生同款）"	"触发 2：旧值载体 `__nudoMpOld` 与用户同名 ⇒ 原生 12（修前：13）"	夹具漏形态	keep	keep	—
"撞名时签名面仍拿到精确值（修前：unknown / 错值）"	"触发 2：旧值载体 `__nudoMpOld` 与用户同名 ⇒ 原生 12（修前：13）"	夹具漏形态	keep	keep	—
"撞名时无假 nudo:opaque-result（整模块 fail-closed 面）"	"触发 2：旧值载体 `__nudoMpOld` 与用户同名 ⇒ 原生 12（修前：13）"	夹具漏形态	keep	keep	—
"无碰撞时内部临时名逐字保持基名（无 `_k` 后缀）"	"触发 2：旧值载体 `__nudoMpOld` 与用户同名 ⇒ 原生 12（修前：13）"	夹具漏形态	keep	keep	—
"撞名时改名（`__nudoMpRoot` → `__nudoMpRoot_1`）且仍确定（同源两次逐字相同）"	"触发 2：旧值载体 `__nudoMpOld` 与用户同名 ⇒ 原生 12（修前：13）"	夹具漏形态	keep	keep	—
"同一源码转译两次 ⇒ 产物逐字相同（确定性）"	"触发 2：旧值载体 `__nudoMpOld` 与用户同名 ⇒ 原生 12（修前：13）"	夹具漏形态	keep	keep	—
"撞名时签名面拿到精确值（修前：never throws ReferenceError）"	"引擎求值是否以 ReferenceError 收场（TDZ / 未声明引用）"	没测该层	keep	keep	—
"撞名时无假 nudo:entry-may-throw（原生不抛 ⇒ 修前是假红）"	"引擎求值是否以 ReferenceError 收场（TDZ / 未声明引用）"	没测该层	keep	keep	—
"撞名时无假 nudo:opaque-result（整模块 fail-closed 面）"	"引擎求值是否以 ReferenceError 收场（TDZ / 未声明引用）"	没测该层	keep	keep	—
"无碰撞时内部临时名逐字保持基名（无 `_k` 后缀）"	"引擎求值是否以 ReferenceError 收场（TDZ / 未声明引用）"	没测该层	keep	keep	—
"无碰撞时正则族临时名逐字保持基名（`__nudoReArgs` / `__v`）"	"引擎求值是否以 ReferenceError 收场（TDZ / 未声明引用）"	没测该层	keep	keep	—
"撞名时改名（`__nudoDefR` → `__nudoDefR_1`）且仍确定（同源两次逐字相同）"	"引擎求值是否以 ReferenceError 收场（TDZ / 未声明引用）"	没测该层	keep	keep	—
"正则族撞名时改名（`__nudoReArgs` → `__nudoReArgs_1`）且仍确定"	"引擎求值是否以 ReferenceError 收场（TDZ / 未声明引用）"	没测该层	keep	keep	—
"撞名时签名面拿到精确值（修前：never throws ReferenceError / 错值）"	"引擎求值是否以 ReferenceError 收场（TDZ / 未声明引用）"	没测该层	keep	keep	—
"撞名时无假 nudo:entry-may-throw（原生不抛 ⇒ 修前是假红）"	"引擎求值是否以 ReferenceError 收场（TDZ / 未声明引用）"	没测该层	keep	keep	—
"撞名时无假 nudo:opaque-result（整模块 fail-closed 面）"	"引擎求值是否以 ReferenceError 收场（TDZ / 未声明引用）"	没测该层	keep	keep	—
"无碰撞时可选链族临时名逐字保持基名（无 `_k` 后缀）"	"引擎求值是否以 ReferenceError 收场（TDZ / 未声明引用）"	没测该层	keep	keep	—
"无碰撞时短路族临时名逐字保持基名（`__sc0` / `__test` / `__v` / `__r`）"	"引擎求值是否以 ReferenceError 收场（TDZ / 未声明引用）"	没测该层	keep	keep	—
"无碰撞时对象族临时名逐字保持基名（`__v` / `__k` / `__nudoProtoBox`）"	"引擎求值是否以 ReferenceError 收场（TDZ / 未声明引用）"	没测该层	keep	keep	—
"撞名时改名（`__nudoReArgs` → `__nudoReArgs_1`）且仍确定（同源两次逐字相同）"	"引擎求值是否以 ReferenceError 收场（TDZ / 未声明引用）"	没测该层	keep	keep	—
"撞名时短路族改名（`__test` → `__test_1`）且仍确定"	"引擎求值是否以 ReferenceError 收场（TDZ / 未声明引用）"	没测该层	keep	keep	—
"撞名时对象族改名（`__v` → `__v_1`）且仍确定"	"引擎求值是否以 ReferenceError 收场（TDZ / 未声明引用）"	没测该层	keep	keep	—
"撞名时签名面拿到精确值 15（修前：20）"	"「实参在 IIFE 外求值 ⇒ 不构成遮蔽」这一判定在 RHS 面上**成立**（钉住： 修复**不得**改动实参面的语义）。"	没测该层	keep	keep	—
"撞名时无假 nudo:entry-may-throw（原生不抛 ⇒ 修前是假红）"	"「实参在 IIFE 外求值 ⇒ 不构成遮蔽」这一判定在 RHS 面上**成立**（钉住： 修复**不得**改动实参面的语义）。"	没测该层	keep	keep	—
"撞名时无假 nudo:opaque-result（整模块 fail-closed 面）"	"「实参在 IIFE 外求值 ⇒ 不构成遮蔽」这一判定在 RHS 面上**成立**（钉住： 修复**不得**改动实参面的语义）。"	没测该层	keep	keep	—
"无碰撞时 setter thunk 形参名逐字保持基名 `__v`（无 `_k` 后缀）"	"载体名（起经单元共享分配）不属于本测试的断言面——只钉 1151 自己的 `__v` 基名不遭改名。 「实参在 IIFE 外求值 ⇒ 不构成遮蔽」这一判定在 RHS 面上**成立**（钉住： 修复**不得**改动实参面的语义）。"	没测该层	keep	keep	—
"无碰撞时解构 setter thunk 形参名逐字保持基名 `__v`"	"载体名（起经单元共享分配）不属于本测试的断言面——只钉 1151 自己的 `__v` 基名不遭改名。 「实参在 IIFE 外求值 ⇒ 不构成遮蔽」这一判定在 RHS 面上**成立**（钉住： 修复**不得**改动实参面的语义）。"	没测该层	keep	keep	—
"撞名时改名（`__v` → `__v_1`）且仍确定（同源两次逐字相同）"	"「实参在 IIFE 外求值 ⇒ 不构成遮蔽」这一判定在 RHS 面上**成立**（钉住： 修复**不得**改动实参面的语义）。"	没测该层	keep	keep	—
"撞名时改名后 thunk 形参与 args 槽引用同名（成对一致）"	"thunk 形参：<载体>, __v_1（载体名不钉； 「实参在 IIFE 外求值 ⇒ 不构成遮蔽」这一判定在 RHS 面上**成立**（钉住： 修复**不得**改动实参面的语义）。"	没测该层	keep	keep	—
"触发 B3：switch 臂标志 __cont → 42（原生 42；修前：true）"	"「实参在 IIFE 外求值 ⇒ 不构成遮蔽」这一判定在 RHS 面上**成立**（钉住： 修复**不得**改动实参面的语义）。"	没测该层	keep	keep	—
"撞名时快照名改名（`__fk0_a` → `__fk0_a_1`）且声明点与引用点同名"	"用户绑定仍是 __fk0_a（未被引擎改名） 「实参在 IIFE 外求值 ⇒ 不构成遮蔽」这一判定在 RHS 面上**成立**（钉住： 修复**不得**改动实参面的语义）。"	没测该层	keep	keep	—
"撞名时臂标志名改名（`__cont` → `__cont_1`）且成对一致"	"「实参在 IIFE 外求值 ⇒ 不构成遮蔽」这一判定在 RHS 面上**成立**（钉住： 修复**不得**改动实参面的语义）。"	没测该层	keep	keep	—
"无碰撞时 fork 协议名逐字保持基名（产物逐字不变面）"	"「实参在 IIFE 外求值 ⇒ 不构成遮蔽」这一判定在 RHS 面上**成立**（钉住： 修复**不得**改动实参面的语义）。"	没测该层	keep	keep	—
"撞名时 IIFE 形参改名（`__v` → `__v_1`）且写目标仍写用户绑定"	"「实参在 IIFE 外求值 ⇒ 不构成遮蔽」这一判定在 RHS 面上**成立**（钉住： 修复**不得**改动实参面的语义）。"	没测该层	keep	keep	—
"无碰撞时 IIFE 形参名逐字保持基名 `__v`（产物逐字不变面）"	"「实参在 IIFE 外求值 ⇒ 不构成遮蔽」这一判定在 RHS 面上**成立**（钉住： 修复**不得**改动实参面的语义）。"	没测该层	keep	keep	—
"触发 A1：__swAllDone → 42（原生 42；修前：false）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值）"	没测该层	keep	keep	—
"触发 A2：臂体 __swTestRead → 5（原生 5；修前：ReferenceError / never）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值）"	没测该层	keep	keep	—
"触发 A3：__swEval → 7（原生 7；修前：引擎内部函数 Abs）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值）"	没测该层	keep	keep	—
"触发 A4：case 测试读 __swT → \"hit\"（原生 \"hit\"；修前：\"miss\"）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值）"	没测该层	keep	keep	—
"触发 A5：共享体名 __swBody0 → 11（原生 11；修前：函数 Abs）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值）"	没测该层	keep	keep	—
"对照 A0：无同名绑定 ⇒ 测试 / 共享臂路径同值（\"hit\"）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值）"	没测该层	keep	keep	—
"触发 B1：用户标签块 __nudoSw0 不再吸收 switch break → 1（原生 1；修前：3）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值）"	没测该层	keep	keep	—
"对照 B0：标签名不撞内部标签 ⇒ 1（原生 1）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值）"	没测该层	keep	keep	—
"触发 C1：delete 父对象表达式读 __nudoDelP → true（原生 true；修前：ReferenceError）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值）"	没测该层	keep	keep	—
"触发 C2：delete 计算键表达式读 __nudoDelK → true（原生 true；修前：ReferenceError）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值）"	没测该层	keep	keep	—
"触发 C3：标识符后缀 __old → [5, 6]（原生 [5, 6]；修前：[6, 5]）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值）"	没测该层	keep	keep	—
"触发 C4：私有名前缀自增（接收者形参 __v）→ 1（原生 1；修前：TypeError）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值）"	没测该层	keep	keep	—
"触发 C5：私有名后缀自增（接收者形参 __old）→ [0, 1]（原生 [0, 1]；修前：TypeError）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值）"	没测该层	keep	keep	—
"触发 C6：for-in 接收者 __fir{n} 撞用户声明 → 3（原生 3；修前：宿主 SyntaxError）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值）"	没测该层	keep	keep	—
"触发 C7：for fallback 状态形参 __n → 0（原生 0；修前：3）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值）"	没测该层	keep	keep	—
"触发 C8：do-while 首轮标记 __nudoDwFirst → 7（原生 7；修前：false）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值）"	没测该层	keep	keep	—
"触发 C9：rest 形参 __rest_raw → 3（原生 3；修前：SyntaxError）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值）"	没测该层	keep	keep	—
"触发 C10：解构 IIFE 形参 __d → 5（原生 5；修前：对象）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值）"	没测该层	keep	keep	—
"对照 C0：无同名绑定 ⇒ delete / 后缀 / 私有名自增 / for-in 接收者同值"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值）"	没测该层	keep	keep	—
"触发 D1：别名载体 __nab0 → 100（原生 100；修前：undefined）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值）"	没测该层	keep	keep	—
"触发 D2：回收载体 __nabs（多名别名）→ 100（原生 100；修前：ReferenceError）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值）"	没测该层	keep	keep	—
"对照 D0：无同名绑定 ⇒ setter 别名写回收同值（5）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值）"	没测该层	keep	keep	—
"撞名时无假 nudo:entry-may-throw（原生不抛 ⇒ 修前 TDZ 路径是假红）"	"只对不含类的源断言该码：同一进程内多次 checkSource 会复用**同名类** （`C`）的注册表条目 ⇒ 后一次可能读到前一次无私有字段的类规格 ⇒ 与本条无关的既有 `entry-may-throw`（TypeError）噪声。 对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值）"	夹具漏形态	keep	keep	—
"撞名时无假 nudo:opaque-result（整模块 fail-closed 面）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值）"	没测该层	keep	keep	—
"撞名时分配器改名确定：同源两次转译逐字相同（无 switch 计数器的源）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值）"	没测该层	keep	keep	—
"方法形参同名 ⇒ [42, 7]（原生 [42, 7]；修前：重复形参 SyntaxError）"	"构造器块级同名 + super() 重绑不得劫持 ⇒ 原生 [1, 9]（修前：never）"	夹具漏形态	keep	keep	—
"方法非简单形参同名 ⇒ [42, 7]（原生 [42, 7]；修前：SyntaxError）"	"构造器块级同名 + super() 重绑不得劫持 ⇒ 原生 [1, 9]（修前：never）"	夹具漏形态	keep	keep	—
"构造器形参同名 + super() ⇒ [1, 7]（原生 [1, 7]；修前：SyntaxError）"	"构造器块级同名 + super() 重绑不得劫持 ⇒ 原生 [1, 9]（修前：never）"	夹具漏形态	keep	keep	—
"构造器块级同名 + super() 不劫持接收者重绑 ⇒ [1, 9]（原生 [1, 9]；修前：never）"	"构造器块级同名 + super() 重绑不得劫持 ⇒ 原生 [1, 9]（修前：never）"	夹具漏形态	keep	keep	—
"静态方法形参同名 ⇒ [true, 7]（原生 [true, 7]；修前：SyntaxError）"	"构造器块级同名 + super() 重绑不得劫持 ⇒ 原生 [1, 9]（修前：never）"	夹具漏形态	keep	keep	—
"类表达式静态块：外层同名 + 类名 this ⇒ [5, \"CC\"]（原生 [5, \"CC\"]；修前：tuple 含载体）"	"构造器块级同名 + super() 重绑不得劫持 ⇒ 原生 [1, 9]（修前：never）"	夹具漏形态	keep	keep	—
"对象方法形参同名 ⇒ [42, 7]（原生 [42, 7]；修前：重复形参 SyntaxError）"	"构造器块级同名 + super() 重绑不得劫持 ⇒ 原生 [1, 9]（修前：never）"	夹具漏形态	keep	keep	—
"对象方法解构形参含同名 ⇒ [42, 7]（原生 [42, 7]；修前：SyntaxError）"	"构造器块级同名 + super() 重绑不得劫持 ⇒ 原生 [1, 9]（修前：never）"	夹具漏形态	keep	keep	—
"对象属性 = 函数表达式形参同名 ⇒ [42, 7]（原生 [42, 7]；修前：SyntaxError）"	"构造器块级同名 + super() 重绑不得劫持 ⇒ 原生 [1, 9]（修前：never）"	夹具漏形态	keep	keep	—
"方法内嵌套真函数形参同名 ⇒ [1, 2]（原生 [1, 2]；修前：SyntaxError）"	"构造器块级同名 + super() 重绑不得劫持 ⇒ 原生 [1, 9]（修前：never）"	夹具漏形态	keep	keep	—
"真函数 this 载体"	"构造器块级同名 + super() 重绑不得劫持 ⇒ 原生 [1, 9]（修前：never）"	夹具漏形态	keep	keep	—
"类方法 / 字段 / 静态块 / 访问器"	"构造器块级同名 + super() 重绑不得劫持 ⇒ 原生 [1, 9]（修前：never）"	夹具漏形态	keep	keep	—
"对象方法 / 访问器"	"构造器块级同名 + super() 重绑不得劫持 ⇒ 原生 [1, 9]（修前：never）"	夹具漏形态	keep	keep	—
"箭头捕获方法 this"	"构造器块级同名 + super() 重绑不得劫持 ⇒ 原生 [1, 9]（修前：never）"	夹具漏形态	keep	keep	—
"分配器基名 ⊆ COLLISION_COVERED ∪ ALLOCATOR_GATED"	"发射点门禁：`__` 基名字面量必须出现在分配器调用实参内，或经 const 间接作为分配器入参（含数组/对象常量的一层闭包）。"	夹具漏形态	keep	keep	—
"COLLISION_COVERED 不残留已删除的基名"	"发射点门禁：`__` 基名字面量必须出现在分配器调用实参内，或经 const 间接作为分配器入参（含数组/对象常量的一层闭包）。"	夹具漏形态	keep	keep	—
"分配器本身对每个基名都避让（撞名 ⇒ <base>_1；无撞名 ⇒ 原名）"	"发射点门禁：`__` 基名字面量必须出现在分配器调用实参内，或经 const 间接作为分配器入参（含数组/对象常量的一层闭包）。"	夹具漏形态	keep	keep	—
"发射点不写死内部名（字面量 ⊆ 分配器调用 / const 间接）"	"发射点门禁：`__` 基名字面量必须出现在分配器调用实参内，或经 const 间接作为分配器入参（含数组/对象常量的一层闭包）。"	夹具漏形态	keep	keep	—
```
