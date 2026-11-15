# packages/core/src/algebra/__tests__/transpile-temp-names.test.ts

模块套件：转译器内部临时名必须避开用户标识符（不变量级回归面）。 本文件是可空链 / 成员路径 / 赋值 / fork / switch / this 载体等全部 发射点的**唯一归属**：缺陷编号只保留在 it 标题的 provenance 中，不再作为 文件名。

审计：88 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
"__nudoMpObj（assignment 兜底臂的对象载体）→ 8（原生 8；修前：unknown）"	"触发 2：旧值载体 `__nudoMpOld` 与用户同名 ⇒ 原生 12（修前：13） 断言：expect(v(src)).toBe(8);"	夹具漏形态	keep	keep	—
"__nudoMpOld（assignment 兜底臂的旧值载体）→ 11（原生 11；修前：2）"	"触发 2：旧值载体 `__nudoMpOld` 与用户同名 ⇒ 原生 12（修前：13） 断言：expect(v(src)).toBe(11);"	夹具漏形态	keep	keep	—
"__nudoMpKey（assignment 兜底臂的计算键载体）→ 11（原生 11；修前：1）"	"触发 2：旧值载体 `__nudoMpOld` 与用户同名 ⇒ 原生 12（修前：13） 断言：expect(v(src)).toBe(11);"	夹具漏形态	keep	keep	—
"__nudoMpK0（层键载体）→ 2（原生 2；修前：ReferenceError）"	"触发 2：旧值载体 `__nudoMpOld` 与用户同名 ⇒ 原生 12（修前：13） 断言：expect(v(src)).toBe(2);"	夹具漏形态	keep	keep	—
"__nudoMpC0（中间层持有者载体）→ 6（原生 6；修前：unknown）"	"触发 2：旧值载体 `__nudoMpOld` 与用户同名 ⇒ 原生 12（修前：13） 断言：expect(v(src)).toBe(6);"	夹具漏形态	keep	keep	—
"__nudoMpVal（写入值载体）→ 11（原生 11；修前：unknown）"	"触发 2：旧值载体 `__nudoMpOld` 与用户同名 ⇒ 原生 12（修前：13） 断言：expect(v(src)).toBe(11);"	夹具漏形态	keep	keep	—
"__nudoMpNew（新值载体）→ 11（原生 11；修前：ReferenceError）"	"触发 2：旧值载体 `__nudoMpOld` 与用户同名 ⇒ 原生 12（修前：13） 断言：expect(v(src)).toBe(11);"	夹具漏形态	keep	keep	—
"__nudoMpDelK（delete 键载体）→ \"true|undefined\"（原生同款；修前：ReferenceError）"	"触发 2：旧值载体 `__nudoMpOld` 与用户同名 ⇒ 原生 12（修前：13） 断言：expect(v(src)).toBe(\"true|undefined\");"	夹具漏形态	keep	keep	—
"__nudoMpRes（写回结果载体）→ 11（原生 11；修前：unknown）"	"触发 2：旧值载体 `__nudoMpOld` 与用户同名 ⇒ 原生 12（修前：13） 断言：expect(v(src)).toBe(11);"	夹具漏形态	keep	keep	—
"派生路径（optional 链 delete 的前缀路径）→ \"true|{\\\"a\\\":{}}\"（原生同款）"	"断言：expect(v(src)).toBe('true|{\"a\":{}}');"	没测该层	keep	keep	—
"派生路径 + 层键载体 __nudoMpK0 → \"true|{\\\"a\\\":{}}\"（原生同款）"	"回归钉：成员路径 / 赋值族的引擎**内部临时名**（`__nudoMp*`）必须 与用户标识符**避让**。 背景： 已约定「生成名必须避开用户标识符」 （`transpile/helpers.ts` 的 `internalTmpName`）。 断言：expect(v(src)).toBe('true|{\"a\":{}}');"	没测该层	keep	keep	—
"撞名时签名面仍拿到精确值（修前：unknown / 错值）"	"触发 2：旧值载体 `__nudoMpOld` 与用户同名 ⇒ 原生 12（修前：13） 断言：expect(sigOf(SRC_ROOT)).toBe(\"4\");；expect(sigOf(SRC_OLD)).toBe(\"12\");"	夹具漏形态	keep	keep	—
"撞名时无假 nudo:opaque-result（整模块 fail-closed 面）"	"触发 2：旧值载体 `__nudoMpOld` 与用户同名 ⇒ 原生 12（修前：13） 断言：expect(issueCodes(src)).not.toContain(\"nudo:opaque-result\");"	夹具漏形态	keep	keep	—
"无碰撞时内部临时名逐字保持基名（无 `_k` 后缀）"	"回归钉：成员路径 / 赋值族的引擎**内部临时名**（`__nudoMp*`）必须 与用户标识符**避让**。 背景： 已约定「生成名必须避开用户标识符」 （`transpile/helpers.ts` 的 `internalTmpName`）。 断言：expect(js).toContain(\"__nudoMpRoot\");；expect(js).not.toMatch(/__nudoMp[A-Za-z0-9_]*_1\\b/);"	没测该层	keep	keep	—
"撞名时改名（`__nudoMpRoot` → `__nudoMpRoot_1`）且仍确定（同源两次逐字相同）"	"回归钉：成员路径 / 赋值族的引擎**内部临时名**（`__nudoMp*`）必须 与用户标识符**避让**。 背景： 已约定「生成名必须避开用户标识符」 （`transpile/helpers.ts` 的 `internalTmpName`）。 断言：expect(a).toBe(b);；expect(a).toContain(\"__nudoMpRoot_1\");"	没测该层	keep	keep	—
"同一源码转译两次 ⇒ 产物逐字相同（确定性）"	"回归钉：成员路径 / 赋值族的引擎**内部临时名**（`__nudoMp*`）必须 与用户标识符**避让**。 背景： 已约定「生成名必须避开用户标识符」 （`transpile/helpers.ts` 的 `internalTmpName`）。 断言：expect(a).toBe(b);"	没测该层	keep	keep	—
"撞名时签名面拿到精确值（修前：never throws ReferenceError）"	"引擎求值是否以 ReferenceError 收场（TDZ / 未声明引用） 断言：expect(sig(SRC_VALUE)).toBe(\"5\");；expect(sig(SRC_TARGET)).toBe('\"2|1\"');"	没测该层	keep	keep	—
"撞名时无假 nudo:entry-may-throw（原生不抛 ⇒ 修前是假红）"	"回归钉：调用族（`exec/transpile/expr/call.ts`）的引擎**内部临时名** 必须与用户标识符**避让**。 背景： 已约定「引擎内部临时名必须避开用户标识符」 （`transpile/helpers.ts` 的 `internalTmpName`），把该口径落到 `__nudoMp*` 族（member-path / assignment）。 断言：expect(issueCodes(src)).not.toContain(\"nudo:entry-may-throw\");"	没测该层	keep	keep	—
"撞名时无假 nudo:opaque-result（整模块 fail-closed 面）"	"回归钉：调用族（`exec/transpile/expr/call.ts`）的引擎**内部临时名** 必须与用户标识符**避让**。 背景： 已约定「引擎内部临时名必须避开用户标识符」 （`transpile/helpers.ts` 的 `internalTmpName`），把该口径落到 `__nudoMp*` 族（member-path / assignment）。 断言：expect(issueCodes(src)).not.toContain(\"nudo:opaque-result\");"	没测该层	keep	keep	—
"无碰撞时内部临时名逐字保持基名（无 `_k` 后缀）"	"回归钉：调用族（`exec/transpile/expr/call.ts`）的引擎**内部临时名** 必须与用户标识符**避让**。 背景： 已约定「引擎内部临时名必须避开用户标识符」 （`transpile/helpers.ts` 的 `internalTmpName`），把该口径落到 `__nudoMp*` 族（member-path / assignment）。 断言：expect(js).toContain(\"__nudoDefR\");；expect(js).not.toMatch(/__nudoDefR[A-Za-z0-9_]*_1\\b/);"	没测该层	keep	keep	—
"无碰撞时正则族临时名逐字保持基名（`__nudoReArgs` / `__v`）"	"回归钉：调用族（`exec/transpile/expr/call.ts`）的引擎**内部临时名** 必须与用户标识符**避让**。 背景： 已约定「引擎内部临时名必须避开用户标识符」 （`transpile/helpers.ts` 的 `internalTmpName`），把该口径落到 `__nudoMp*` 族（member-path / assignment）。 断言：expect(js).toContain(\"__nudoReArgs\");；expect(js).toContain(\"__v\");"	没测该层	keep	keep	—
"撞名时改名（`__nudoDefR` → `__nudoDefR_1`）且仍确定（同源两次逐字相同）"	"回归钉：调用族（`exec/transpile/expr/call.ts`）的引擎**内部临时名** 必须与用户标识符**避让**。 背景： 已约定「引擎内部临时名必须避开用户标识符」 （`transpile/helpers.ts` 的 `internalTmpName`），把该口径落到 `__nudoMp*` 族（member-path / assignment）。 断言：expect(a).toBe(b);；expect(a).toContain(\"__nudoDefR_1\");"	没测该层	keep	keep	—
"正则族撞名时改名（`__nudoReArgs` → `__nudoReArgs_1`）且仍确定"	"回归钉：调用族（`exec/transpile/expr/call.ts`）的引擎**内部临时名** 必须与用户标识符**避让**。 背景： 已约定「引擎内部临时名必须避开用户标识符」 （`transpile/helpers.ts` 的 `internalTmpName`），把该口径落到 `__nudoMp*` 族（member-path / assignment）。 断言：expect(a).toBe(b);；expect(a).toContain(\"__nudoReArgs_1\");"	没测该层	keep	keep	—
"撞名时签名面拿到精确值（修前：never throws ReferenceError / 错值）"	"引擎求值是否以 ReferenceError 收场（TDZ / 未声明引用） 断言：expect(sig(SRC_A1)).toBe(\"true\");；expect(sig(SRC_A2)).toBe(\"true\");"	没测该层	keep	keep	—
"撞名时无假 nudo:entry-may-throw（原生不抛 ⇒ 修前是假红）"	"回归钉：剩余族的引擎**内部临时名**必须与用户标识符**避让**。 背景： 已约定「引擎内部临时名必须避开用户标识符」 （`transpile/helpers.ts` 的 `internalTmpName` / `internalTmpNameSet`）， 落到 `__nudoMp*` 族，落到调用族（`expr/call.ts`）。 断言：expect(issueCodes(src)).not.toContain(\"nudo:entry-may-throw\");"	没测该层	keep	keep	—
"撞名时无假 nudo:opaque-result（整模块 fail-closed 面）"	"回归钉：剩余族的引擎**内部临时名**必须与用户标识符**避让**。 背景： 已约定「引擎内部临时名必须避开用户标识符」 （`transpile/helpers.ts` 的 `internalTmpName` / `internalTmpNameSet`）， 落到 `__nudoMp*` 族，落到调用族（`expr/call.ts`）。 断言：expect(issueCodes(src)).not.toContain(\"nudo:opaque-result\");"	没测该层	keep	keep	—
"无碰撞时可选链族临时名逐字保持基名（无 `_k` 后缀）"	"回归钉：剩余族的引擎**内部临时名**必须与用户标识符**避让**。 背景： 已约定「引擎内部临时名必须避开用户标识符」 （`transpile/helpers.ts` 的 `internalTmpName` / `internalTmpNameSet`）， 落到 `__nudoMp*` 族，落到调用族（`expr/call.ts`）。 断言：expect(js).toContain(\"__nudoReArgs\");；expect(js).toContain(\"$__oc\");"	没测该层	keep	keep	—
"无碰撞时短路族临时名逐字保持基名（`__sc0` / `__test` / `__v` / `__r`）"	"回归钉：剩余族的引擎**内部临时名**必须与用户标识符**避让**。 背景： 已约定「引擎内部临时名必须避开用户标识符」 （`transpile/helpers.ts` 的 `internalTmpName` / `internalTmpNameSet`）， 落到 `__nudoMp*` 族，落到调用族（`expr/call.ts`）。 断言：expect(jsSimple).toContain(\"__sc0\");；expect(jsSimple).not.toMatch(/__sc0[A-Za-z0-9_]*_1\\b/);"	没测该层	keep	keep	—
"无碰撞时对象族临时名逐字保持基名（`__v` / `__k` / `__nudoProtoBox`）"	"回归钉：剩余族的引擎**内部临时名**必须与用户标识符**避让**。 背景： 已约定「引擎内部临时名必须避开用户标识符」 （`transpile/helpers.ts` 的 `internalTmpName` / `internalTmpNameSet`）， 落到 `__nudoMp*` 族，落到调用族（`expr/call.ts`）。 断言：expect(js).toContain(\"__nudoProtoBox\");；expect(js).not.toMatch(/__nudoProtoBox[A-Za-z0-9_]*_1\\b/);"	没测该层	keep	keep	—
"撞名时改名（`__nudoReArgs` → `__nudoReArgs_1`）且仍确定（同源两次逐字相同）"	"回归钉：剩余族的引擎**内部临时名**必须与用户标识符**避让**。 背景： 已约定「引擎内部临时名必须避开用户标识符」 （`transpile/helpers.ts` 的 `internalTmpName` / `internalTmpNameSet`）， 落到 `__nudoMp*` 族，落到调用族（`expr/call.ts`）。 断言：expect(a).toBe(b);；expect(a).toContain(\"__nudoReArgs_1\");"	没测该层	keep	keep	—
"撞名时短路族改名（`__test` → `__test_1`）且仍确定"	"回归钉：剩余族的引擎**内部临时名**必须与用户标识符**避让**。 背景： 已约定「引擎内部临时名必须避开用户标识符」 （`transpile/helpers.ts` 的 `internalTmpName` / `internalTmpNameSet`）， 落到 `__nudoMp*` 族，落到调用族（`expr/call.ts`）。 断言：expect(a).toBe(b);；expect(a).toContain(\"__test_1\");"	没测该层	keep	keep	—
"撞名时对象族改名（`__v` → `__v_1`）且仍确定"	"回归钉：剩余族的引擎**内部临时名**必须与用户标识符**避让**。 背景： 已约定「引擎内部临时名必须避开用户标识符」 （`transpile/helpers.ts` 的 `internalTmpName` / `internalTmpNameSet`）， 落到 `__nudoMp*` 族，落到调用族（`expr/call.ts`）。 断言：expect(a).toBe(b);；expect(a).toContain(\"__v_1\");"	没测该层	keep	keep	—
"撞名时签名面拿到精确值 15（修前：20）"	"「实参在 IIFE 外求值 ⇒ 不构成遮蔽」这一判定在 RHS 面上**成立**（钉住： 修复**不得**改动实参面的语义）。 断言：expect(sig(SRC_A1)).toBe(\"15\");；expect(sig(SRC_A2)).toBe(\"15\");"	没测该层	keep	keep	—
"撞名时无假 nudo:entry-may-throw（原生不抛 ⇒ 修前是假红）"	"回归钉：剩余族的引擎**内部临时名**必须与用户标识符**避让**。 背景： 已约定「引擎内部临时名必须避开用户标识符」 （`transpile/helpers.ts` 的 `internalTmpName` / `internalTmpNameSet`）， 落到 `__nudoMp*` 族，落到调用族（`expr/call.ts`）。 断言：expect(issueCodes(src)).not.toContain(\"nudo:entry-may-throw\");"	没测该层	keep	keep	—
"撞名时无假 nudo:opaque-result（整模块 fail-closed 面）"	"背景： 已建立统一口径——**引擎内部临时名 必须避开用户标识符**（否则用户同名绑定被引擎 `const`/`var`/形参遮蔽 ⇒ **自信错值** 或 TDZ **ReferenceError** ⇒ 闸门**假红**； 模块级同名还会撞出 重复声明 SyntaxError ⇒ **整模块 fail-closed** ⇒ 闸门**假绿**）。 断言：expect(issueCodes(src)).not.toContain(\"nudo:opaque-result\");"	旧断言钉错	keep	keep	—
"无碰撞时 setter thunk 形参名逐字保持基名 `__v`（无 `_k` 后缀）"	"「实参在 IIFE 外求值 ⇒ 不构成遮蔽」这一判定在 RHS 面上**成立**（钉住： 修复**不得**改动实参面的语义）。 断言：expect(js).not.toMatch(/__v[A-Za-z0-9_]*_1\\b/);"	没测该层	keep	keep	—
"无碰撞时解构 setter thunk 形参名逐字保持基名 `__v`"	"「实参在 IIFE 外求值 ⇒ 不构成遮蔽」这一判定在 RHS 面上**成立**（钉住： 修复**不得**改动实参面的语义）。 断言：expect(js).not.toMatch(/__v[A-Za-z0-9_]*_1\\b/);"	没测该层	keep	keep	—
"撞名时改名（`__v` → `__v_1`）且仍确定（同源两次逐字相同）"	"「实参在 IIFE 外求值 ⇒ 不构成遮蔽」这一判定在 RHS 面上**成立**（钉住： 修复**不得**改动实参面的语义）。 断言：expect(a).toBe(b);；expect(a).toContain(\"__v_1\");"	没测该层	keep	keep	—
"撞名时改名后 thunk 形参与 args 槽引用同名（成对一致）"	"背景： 已建立统一口径——**引擎内部临时名 必须避开用户标识符**（否则用户同名绑定被引擎 `const`/`var`/形参遮蔽 ⇒ **自信错值** 或 TDZ **ReferenceError** ⇒ 闸门**假红**； 模块级同名还会撞出 重复声明 SyntaxError ⇒ **整模块 fail-closed** ⇒ 闸门**假绿**）。 断言：expect(js).toMatch(/\\([A-Za-z_$][\\w$]*, __v_1\\) => \\{/);；expect(js).toContain(\"$arguments([__v_1])\");"	旧断言钉错	keep	keep	—
"触发 B3：switch 臂标志 __cont → 42（原生 42；修前：true）"	"「实参在 IIFE 外求值 ⇒ 不构成遮蔽」这一判定在 RHS 面上**成立**（钉住： 修复**不得**改动实参面的语义）。 断言：expect(vArgs(SRC_B3, 1)).toBe(42);"	没测该层	keep	keep	—
"撞名时快照名改名（`__fk0_a` → `__fk0_a_1`）且声明点与引用点同名"	"背景： 已建立统一口径——**引擎内部临时名 必须避开用户标识符**（否则用户同名绑定被引擎 `const`/`var`/形参遮蔽 ⇒ **自信错值** 或 TDZ **ReferenceError** ⇒ 闸门**假红**； 模块级同名还会撞出 重复声明 SyntaxError ⇒ **整模块 fail-closed** ⇒ 闸门**假绿**）。 断言：expect(js).toContain(\"const __fk0_a_1 = $copy(a, __fkCopyMemo);\");；expect(js).toContain(\"a = $copy(__fk0_a_1, __fkArmMemo);\");"	旧断言钉错	keep	keep	—
"撞名时臂标志名改名（`__cont` → `__cont_1`）且成对一致"	"背景： 已建立统一口径——**引擎内部临时名 必须避开用户标识符**（否则用户同名绑定被引擎 `const`/`var`/形参遮蔽 ⇒ **自信错值** 或 TDZ **ReferenceError** ⇒ 闸门**假红**； 模块级同名还会撞出 重复声明 SyntaxError ⇒ **整模块 fail-closed** ⇒ 闸门**假绿**）。 断言：expect(js).toContain(\"let __cont_1 = true;\");；expect(js).toContain(\"if ($isForkExit(e)) __cont_1 = false;\");"	旧断言钉错	keep	keep	—
"无碰撞时 fork 协议名逐字保持基名（产物逐字不变面）"	"背景： 已建立统一口径——**引擎内部临时名 必须避开用户标识符**（否则用户同名绑定被引擎 `const`/`var`/形参遮蔽 ⇒ **自信错值** 或 TDZ **ReferenceError** ⇒ 闸门**假红**； 模块级同名还会撞出 重复声明 SyntaxError ⇒ **整模块 fail-closed** ⇒ 闸门**假绿**）。 断言：expect(js).toContain(\"const __fk0_out = $copy(out, __fkCopyMemo);\");；expect(js).toContain(\"let __cont = true;\");"	旧断言钉错	keep	keep	—
"撞名时 IIFE 形参改名（`__v` → `__v_1`）且写目标仍写用户绑定"	"「实参在 IIFE 外求值 ⇒ 不构成遮蔽」这一判定在 RHS 面上**成立**（钉住： 修复**不得**改动实参面的语义）。 断言：expect(js).toContain(\"((__v_1) =>\");；expect(js).toContain(\"return __v = __v_1;\");"	没测该层	keep	keep	—
"无碰撞时 IIFE 形参名逐字保持基名 `__v`（产物逐字不变面）"	"「实参在 IIFE 外求值 ⇒ 不构成遮蔽」这一判定在 RHS 面上**成立**（钉住： 修复**不得**改动实参面的语义）。 断言：expect(js).toContain(\"((__v) =>\");；expect(js).toContain(\"return a = __v;\");"	没测该层	keep	keep	—
"触发 A1：__swAllDone → 42（原生 42；修前：false）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值） 断言：expect(v(SRC_A1)).toBe(42);；expect(sig(SRC_A1)).toBe(\"42\");"	没测该层	keep	keep	—
"触发 A2：臂体 __swTestRead → 5（原生 5；修前：ReferenceError / never）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值） 断言：expect(v(SRC_A2)).toBe(5);；expect(refError(SRC_A2)).toBe(false);"	没测该层	keep	keep	—
"触发 A3：__swEval → 7（原生 7；修前：引擎内部函数 Abs）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值） 断言：expect(v(SRC_A3)).toBe(7);；expect(sig(SRC_A3)).toBe(\"7\");"	没测该层	keep	keep	—
"触发 A4：case 测试读 __swT → \"hit\"（原生 \"hit\"；修前：\"miss\"）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值） 断言：expect(v(SRC_A4)).toBe(\"hit\");；expect(sig(SRC_A4)).toBe('\"hit\"');"	没测该层	keep	keep	—
"触发 A5：共享体名 __swBody0 → 11（原生 11；修前：函数 Abs）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值） 断言：expect(v(SRC_A5)).toBe(11);；expect(sig(SRC_A5)).toBe(\"11\");"	没测该层	keep	keep	—
"对照 A0：无同名绑定 ⇒ 测试 / 共享臂路径同值（\"hit\"）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值） 断言：expect(v(CTRL_A)).toBe(\"hit\");；expect(sig(CTRL_A)).toBe('\"hit\"');"	没测该层	keep	keep	—
"触发 B1：用户标签块 __nudoSw0 不再吸收 switch break → 1（原生 1；修前：3）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值） 断言：expect(v(SRC_B1)).toBe(1);；expect(sig(SRC_B1)).toBe(\"1\");"	没测该层	keep	keep	—
"对照 B0：标签名不撞内部标签 ⇒ 1（原生 1）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值） 断言：expect(v(CTRL_B)).toBe(1);；expect(sig(CTRL_B)).toBe(\"1\");"	没测该层	keep	keep	—
"触发 C1：delete 父对象表达式读 __nudoDelP → true（原生 true；修前：ReferenceError）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值） 断言：expect(v(SRC_C1)).toBe(true);；expect(refError(SRC_C1)).toBe(false);"	没测该层	keep	keep	—
"触发 C2：delete 计算键表达式读 __nudoDelK → true（原生 true；修前：ReferenceError）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值） 断言：expect(v(SRC_C2)).toBe(true);；expect(refError(SRC_C2)).toBe(false);"	没测该层	keep	keep	—
"触发 C3：标识符后缀 __old → [5, 6]（原生 [5, 6]；修前：[6, 5]）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值） 断言：expect(tuple(SRC_C3)).toEqual([5, 6]);；expect(sig(SRC_C3)).toBe(\"[5, 6]\");"	没测该层	keep	keep	—
"触发 C4：私有名前缀自增（接收者形参 __v）→ 1（原生 1；修前：TypeError）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值） 断言：expect(v(SRC_C4)).toBe(1);；expect(sig(SRC_C4)).toBe(\"1\");"	没测该层	keep	keep	—
"触发 C5：私有名后缀自增（接收者形参 __old）→ [0, 1]（原生 [0, 1]；修前：TypeError）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值） 断言：expect(tuple(SRC_C5)).toEqual([0, 1]);；expect(sig(SRC_C5)).toBe(\"[0, 1]\");"	没测该层	keep	keep	—
"触发 C6：for-in 接收者 __fir{n} 撞用户声明 → 3（原生 3；修前：宿主 SyntaxError）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值） 断言：expect(v(SRC_C6)).toBe(3);；expect(sig(SRC_C6)).toBe(\"3\");"	没测该层	keep	keep	—
"触发 C7：for fallback 状态形参 __n → 0（原生 0；修前：3）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值） 断言：expect(v(SRC_C7)).toBe(0);；expect(sig(SRC_C7)).toBe(\"0\");"	没测该层	keep	keep	—
"触发 C8：do-while 首轮标记 __nudoDwFirst → 7（原生 7；修前：false）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值） 断言：expect(v(SRC_C8)).toBe(7);；expect(sig(SRC_C8)).toBe(\"7\");"	没测该层	keep	keep	—
"触发 C9：rest 形参 __rest_raw → 3（原生 3；修前：SyntaxError）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值） 断言：expect(v(SRC_C9)).toBe(3);；expect(sig(SRC_C9)).toBe(\"3\");"	没测该层	keep	keep	—
"触发 C10：解构 IIFE 形参 __d → 5（原生 5；修前：对象）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值） 断言：expect(v(SRC_C10)).toBe(5);；expect(sig(SRC_C10)).toBe(\"5\");"	没测该层	keep	keep	—
"对照 C0：无同名绑定 ⇒ delete / 后缀 / 私有名自增 / for-in 接收者同值"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值） 断言：expect(v(CTRL_C1)).toBe(true);；expect(tuple(CTRL_C2)).toEqual([5, 6]);"	没测该层	keep	keep	—
"触发 D1：别名载体 __nab0 → 100（原生 100；修前：undefined）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值） 断言：expect(v(SRC_D1)).toBe(100);；expect(sig(SRC_D1)).toBe(\"100\");"	没测该层	keep	keep	—
"触发 D2：回收载体 __nabs（多名别名）→ 100（原生 100；修前：ReferenceError）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值） 断言：expect(v(SRC_D2)).toBe(100);；expect(refError(SRC_D2)).toBe(false);"	没测该层	keep	keep	—
"对照 D0：无同名绑定 ⇒ setter 别名写回收同值（5）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值） 断言：expect(v(CTRL_D)).toBe(5);；expect(sig(CTRL_D)).toBe(\"5\");"	没测该层	keep	keep	—
"撞名时无假 nudo:entry-may-throw（原生不抛 ⇒ 修前 TDZ 路径是假红）"	"对照 B0：标签名不撞内部标签 ⇒ 原生 1（修前/修后同值） 断言：expect(issueCodes(src), name).not.toContain(\"nudo:entry-may-throw\");"	没测该层	keep	keep	—
"撞名时无假 nudo:opaque-result（整模块 fail-closed 面）"	"背景： 已约定「引擎内部临时名必须避开用户标识符」 （`transpile/helpers.ts` 的 `internalTmpName` / `internalTmpNameSet`）， 陆续落到 `__nudoMp*` / 调用族 / 可选链 / 短路 / 对象 / 类形参。 本条的落点： - `stmt/statement.ts`（1159-a）：switch 的 **case 测试辅助族**（`__swT` / `__swTV` / `__swTD` / `__swAllDone` / `__swTestRead` / `__swEval` / `__swEvalAll`，及其形参 `__swI` / 循环变量 `__swJ"	夹具漏形态	keep	keep	—
"撞名时分配器改名确定：同源两次转译逐字相同（无 switch 计数器的源）"	"背景： 已约定「引擎内部临时名必须避开用户标识符」 （`transpile/helpers.ts` 的 `internalTmpName` / `internalTmpNameSet`）， 陆续落到 `__nudoMp*` / 调用族 / 可选链 / 短路 / 对象 / 类形参。 本条的落点： - `stmt/statement.ts`（1159-a）：switch 的 **case 测试辅助族**（`__swT` / `__swTV` / `__swTD` / `__swAllDone` / `__swTestRead` / `__swEval` / `__swEvalAll`，及其形参 `__swI` / 循环变量 `__swJ"	夹具漏形态	keep	keep	—
"方法形参同名 ⇒ [42, 7]（原生 [42, 7]；修前：重复形参 SyntaxError）"	"构造器块级同名 + super() 重绑不得劫持 ⇒ 原生 [1, 9]（修前：never） 断言：expect(tuple(SRC_METHOD_PARAM)).toEqual([42, 7]);"	夹具漏形态	keep	keep	—
"方法非简单形参同名 ⇒ [42, 7]（原生 [42, 7]；修前：SyntaxError）"	"构造器块级同名 + super() 重绑不得劫持 ⇒ 原生 [1, 9]（修前：never） 断言：expect(tuple(SRC_METHOD_DEFAULT_SELF)).toEqual([42, 7]);"	夹具漏形态	keep	keep	—
"构造器形参同名 + super() ⇒ [1, 7]（原生 [1, 7]；修前：SyntaxError）"	"构造器块级同名 + super() 重绑不得劫持 ⇒ 原生 [1, 9]（修前：never） 断言：expect(tuple(SRC_CTOR_SUPER)).toEqual([1, 7]);"	夹具漏形态	keep	keep	—
"构造器块级同名 + super() 不劫持接收者重绑 ⇒ [1, 9]（原生 [1, 9]；修前：never）"	"构造器块级同名 + super() 重绑不得劫持 ⇒ 原生 [1, 9]（修前：never） 断言：expect(tuple(SRC_CTOR_SUPER_BLOCK)).toEqual([1, 9]);"	夹具漏形态	keep	keep	—
"静态方法形参同名 ⇒ [true, 7]（原生 [true, 7]；修前：SyntaxError）"	"构造器块级同名 + super() 重绑不得劫持 ⇒ 原生 [1, 9]（修前：never） 断言：expect(tuple(SRC_STATIC_METHOD_PARAM)).toEqual([true, 7]);"	夹具漏形态	keep	keep	—
"类表达式静态块：外层同名 + 类名 this ⇒ [5, \"CC\"]（原生 [5, \"CC\"]；修前：tuple 含载体）"	"构造器块级同名 + super() 重绑不得劫持 ⇒ 原生 [1, 9]（修前：never） 断言：expect(tuple(SRC_STATIC_BLOCK_EXPR)).toEqual([5, \"CC\"]);"	夹具漏形态	keep	keep	—
"对象方法形参同名 ⇒ [42, 7]（原生 [42, 7]；修前：重复形参 SyntaxError）"	"构造器块级同名 + super() 重绑不得劫持 ⇒ 原生 [1, 9]（修前：never） 断言：expect(tuple(SRC_OBJ_METHOD)).toEqual([42, 7]);"	夹具漏形态	keep	keep	—
"对象方法解构形参含同名 ⇒ [42, 7]（原生 [42, 7]；修前：SyntaxError）"	"构造器块级同名 + super() 重绑不得劫持 ⇒ 原生 [1, 9]（修前：never） 断言：expect(tuple(SRC_OBJ_METHOD_DESTR)).toEqual([42, 7]);"	夹具漏形态	keep	keep	—
"对象属性 = 函数表达式形参同名 ⇒ [42, 7]（原生 [42, 7]；修前：SyntaxError）"	"构造器块级同名 + super() 重绑不得劫持 ⇒ 原生 [1, 9]（修前：never） 断言：expect(tuple(SRC_OBJ_FNEXPR)).toEqual([42, 7]);"	夹具漏形态	keep	keep	—
"方法内嵌套真函数形参同名 ⇒ [1, 2]（原生 [1, 2]；修前：SyntaxError）"	"构造器块级同名 + super() 重绑不得劫持 ⇒ 原生 [1, 9]（修前：never） 断言：expect(tuple(SRC_NESTED_FN)).toEqual([1, 2]);"	夹具漏形态	keep	keep	—
"真函数 this 载体"	"回归钉：this 载体名（`__this`）必须避开用户标识符。 背景： 已约定「引擎内部 临时名必须避开用户标识符」——撞名的两种失效形态（同作用域重复词法声明 ⇒ 产物非法 JS ⇒ 整模块 fail-closed； 断言：expect(v(CTRL_FN)).toBe(42);"	夹具漏形态	keep	keep	—
"类方法 / 字段 / 静态块 / 访问器"	"回归钉：this 载体名（`__this`）必须避开用户标识符。 背景： 已约定「引擎内部 临时名必须避开用户标识符」——撞名的两种失效形态（同作用域重复词法声明 ⇒ 产物非法 JS ⇒ 整模块 fail-closed； 断言：expect(tuple(CTRL_CLASS)).toEqual([42, 47, 2, 1]);"	夹具漏形态	keep	keep	—
"对象方法 / 访问器"	"回归钉：this 载体名（`__this`）必须避开用户标识符。 背景： 已约定「引擎内部 临时名必须避开用户标识符」——撞名的两种失效形态（同作用域重复词法声明 ⇒ 产物非法 JS ⇒ 整模块 fail-closed； 断言：expect(tuple(CTRL_OBJ)).toEqual([7, 7]);"	夹具漏形态	keep	keep	—
"箭头捕获方法 this"	"回归钉：this 载体名（`__this`）必须避开用户标识符。 背景： 已约定「引擎内部 临时名必须避开用户标识符」——撞名的两种失效形态（同作用域重复词法声明 ⇒ 产物非法 JS ⇒ 整模块 fail-closed； 断言：expect(v(CTRL_ARROW)).toBe(49);"	夹具漏形态	keep	keep	—
"分配器基名 ⊆ COLLISION_COVERED ∪ ALLOCATOR_GATED"	"这不是白名单：新增基名必须要么补端到端撞名例进 COLLISION_COVERED，要么 显式登记到本表并说明端到端不可构造的理由。 断言：expect(uncovered).toEqual([]);"	夹具漏形态	keep	keep	—
"COLLISION_COVERED 不残留已删除的基名"	"这不是白名单：新增基名必须要么补端到端撞名例进 COLLISION_COVERED，要么 显式登记到本表并说明端到端不可构造的理由。 断言：expect([...COLLISION_COVERED].filter((b) => !bases.has(b))).toEqual([]);"	夹具漏形态	keep	keep	—
"分配器本身对每个基名都避让（撞名 ⇒ <base>_1；无撞名 ⇒ 原名）"	"这不是白名单：新增基名必须要么补端到端撞名例进 COLLISION_COVERED，要么 显式登记到本表并说明端到端不可构造的理由。 断言：expect(bad).toEqual([]);"	夹具漏形态	keep	keep	—
"发射点不写死内部名（字面量 ⊆ 分配器调用 / const 间接）"	"发射点门禁：`__` 基名字面量必须出现在分配器调用实参内，或经 const 间接作为分配器入参（含数组/对象常量的一层闭包）。 断言：expect(hardcodedInternalNames()).toEqual([]);"	夹具漏形态	keep	keep	—
"$label"	表驱动用例：$label；枚举同一不变量下的输入/期望组合，属既有表行补齐。	夹具漏形态	keep	keep	—
```
