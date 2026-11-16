# packages/parser/src/__tests__/parser-syntax.test.ts

模块套件：字面量/语法面（数字/字符串/八进制/对象/结构/表达式）。

审计：45 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
纯结构字面量与嵌套结构仍正常解析	字符串/结构字面量整段校验	没测该层	keep	keep	—
case 期望值尾随文本不折成 tuple/obj，并报 nudo:directive-syntax	字符串/结构字面量整段校验	没测该层	keep	keep	—
尾随成员访问 / 加法 / 尾部文本都不折进结构（落 unknown）	字符串/结构字面量整段校验	没测该层	keep	keep	—
case 见证携带 cooked 值，且值里不残留字面反斜杠	字符串/结构字面量整段校验	没测该层	keep	keep	—
转义按 JS 语义解释，普通单/双引号字符串不变	字符串/结构字面量整段校验	没测该层	keep	keep	—
"does not fold \"a\" + \"b\" into a literal value"	"回归：`@nudo:case` **期望值**面的字符串字面量**贪婪切片**。 旧实现的守卫只做 `startsWith(quote) && endsWith(quote)` ⇒ `\"a\" + \"b\"` 的首引号在 0、末引号在末尾 ⇒ `slice(1, -1)` 把**两个独立字面量之间的 运算符文本**一起吞进值里 ⇒ 折出 `a\" + \"b`（谁也没写过的**自信错值**） ⇒ 断言假红，诊断里的 expected 是一段无意义文本。 断言：expect([\"unknown\", \"never\"]).toContain(abs.shape.k);；expect(abs.term).toBeUndefined();"	旧断言钉错	keep	keep	—
"does not fold longer concatenations either"	"断言：expect(parseCaseArgExpr('\"x\" + \"y\" + \"z\"').shape.k).toBe(\"unknown\");；expect(parseCaseArgExpr(\"'a' + 'b'\").shape.k).toBe(\"unknown\");"	没测该层	keep	keep	—
"expected value of a case directive is unknown, not a wrong string"	"回归：`@nudo:case` **期望值**面的字符串字面量**贪婪切片**。 旧实现的守卫只做 `startsWith(quote) && endsWith(quote)` ⇒ `\"a\" + \"b\"` 的首引号在 0、末引号在末尾 ⇒ `slice(1, -1)` 把**两个独立字面量之间的 运算符文本**一起吞进值里 ⇒ 折出 `a\" + \"b`（谁也没写过的**自信错值**） ⇒ 断言假红，诊断里的 expected 是一段无意义文本。 断言：expect(d).toBeDefined();；expect(expected).toBeDefined();"	旧断言钉错	keep	keep	—
"emits nudo:directive-syntax for the unrecognized expected value"	"回归：`@nudo:case` **期望值**面的字符串字面量**贪婪切片**。 旧实现的守卫只做 `startsWith(quote) && endsWith(quote)` ⇒ `\"a\" + \"b\"` 的首引号在 0、末引号在末尾 ⇒ `slice(1, -1)` 把**两个独立字面量之间的 运算符文本**一起吞进值里 ⇒ 折出 `a\" + \"b`（谁也没写过的**自信错值**） ⇒ 断言假红，诊断里的 expected 是一段无意义文本。 断言：expect(diags.length).toBeGreaterThan(0);；expect(diags.some((d) => d.code === \"nudo:directive"	旧断言钉错	keep	keep	—
"a single literal is still accepted"	"回归：`@nudo:case` **期望值**面的字符串字面量**贪婪切片**。 旧实现的守卫只做 `startsWith(quote) && endsWith(quote)` ⇒ `\"a\" + \"b\"` 的首引号在 0、末引号在末尾 ⇒ `slice(1, -1)` 把**两个独立字面量之间的 运算符文本**一起吞进值里 ⇒ 折出 `a\" + \"b`（谁也没写过的**自信错值**） ⇒ 断言假红，诊断里的 expected 是一段无意义文本。 断言：expect(litValue(parseCaseArgExpr('\"abc\"'))).toEqual({ ok: true, value: \"abc\" });"	旧断言钉错	keep	keep	—
"括号包裹与一元符号"	"断言：expect(valueOf(\"(7)\")).toBe(7);；expect(valueOf(\"( 7 )\")).toBe(7);"	没测该层	keep	keep	—
"bigint 字面量（7n）保留 bigint 类型与值"	"回归：case 见证 / 期望值的**表达式形态**（括号 / 一元 / 模板字面量 / bigint / 进制内分隔符）落 unknown —— 而 unknown 是顶类型 （`leqAbs(actual, unknown)` 恒 ok）⇒ 断言**空洞通过**（期望侧）与 见证满足任何契约（见证侧）= 假绿。 断言：expect(abs.shape.k).toBe(\"prim\");；expect((abs.shape as { type: string }).type).toBe(\"bigint\");"	夹具漏形态	keep	keep	—
"无插值模板字面量 ⇒ 字符串字面量"	"回归：`@nudo:case` **期望值**面的字符串字面量**贪婪切片**。 旧实现的守卫只做 `startsWith(quote) && endsWith(quote)` ⇒ `\"a\" + \"b\"` 的首引号在 0、末引号在末尾 ⇒ `slice(1, -1)` 把**两个独立字面量之间的 运算符文本**一起吞进值里 ⇒ 折出 `a\" + \"b`（谁也没写过的**自信错值**） ⇒ 断言假红，诊断里的 expected 是一段无意义文本。 断言：expect(valueOf(\"`x`\")).toBe(\"x\");；expect(valueOf(\"`hello`\")).toBe(\"hello\");"	旧断言钉错	keep	keep	—
"进制内的数字分隔符"	"断言：expect(valueOf(\"0b1_0\")).toBe(2);；expect(valueOf(\"0o1_7\")).toBe(15);"	没测该层	keep	keep	—
"case 见证 / 期望值不再落 unknown（空洞通过的根因）"	"回归：case 见证 / 期望值的**表达式形态**（括号 / 一元 / 模板字面量 / bigint / 进制内分隔符）落 unknown —— 而 unknown 是顶类型 （`leqAbs(actual, unknown)` 恒 ok）⇒ 断言**空洞通过**（期望侧）与 见证满足任何契约（见证侧）= 假绿。 断言：expect(cases).toHaveLength(4);；expect(litValue(cases[0]!.argsAbs[0]!)).toEqual({ ok: true, value: 7 });"	夹具漏形态	keep	keep	—
"非字面量的表达式仍不认识（不折错值）"	"断言：expect(parseCaseArgExpr(\"1 + 2\").shape.k).toBe(\"unknown\");；expect(parseCaseArgExpr(\"a ? b : c\").shape.k).toBe(\"unknown\");"	没测该层	keep	keep	—
"0 开头 + 全八进制数字 ⇒ 八进制"	"回归：legacy octal（`0` 开头 + 全八进制数字）被 `Number(\"017\")` 按**十进制**读成 17（native sloppy 是 15 = 八进制）⇒ 见证 / 期望值折出 **自信的错值**（假红 / 假绿）。 分隔符跟在多位数前导 0 后面是 JS 语法错 ⇒ 不认识。 断言：expect(numOf(\"017\")).toBe(15);；expect(numOf(\"010\")).toBe(8);"	旧断言钉错	keep	keep	—
"0 开头且含 8/9 ⇒ sloppy 十进制（与 native sloppy 一致）"	"回归：legacy octal（`0` 开头 + 全八进制数字）被 `Number(\"017\")` 按**十进制**读成 17（native sloppy 是 15 = 八进制）⇒ 见证 / 期望值折出 **自信的错值**（假红 / 假绿）。 分隔符跟在多位数前导 0 后面是 JS 语法错 ⇒ 不认识。 断言：expect(numOf(\"08\")).toBe(8);；expect(numOf(\"09\")).toBe(9);"	旧断言钉错	keep	keep	—
"现代进制字面量不受影响（0o / 0b / 0x）"	"断言：expect(numOf(\"0o17\")).toBe(15);；expect(numOf(\"0b101\")).toBe(5);"	没测该层	keep	keep	—
"分隔符跟在多位数前导 0 后面是 JS 语法错 ⇒ 不认识（不折错值）"	"回归：legacy octal（`0` 开头 + 全八进制数字）被 `Number(\"017\")` 按**十进制**读成 17（native sloppy 是 15 = 八进制）⇒ 见证 / 期望值折出 **自信的错值**（假红 / 假绿）。 分隔符跟在多位数前导 0 后面是 JS 语法错 ⇒ 不认识。 断言：expect(parseCaseArgExpr(\"0_1\").shape.k).toBe(\"unknown\");；expect(parseCaseArgExpr(\"01_0\").shape.k).toBe(\"unknown\");"	旧断言钉错	keep	keep	—
"case 见证 / 期望值按八进制取值"	"回归：legacy octal（`0` 开头 + 全八进制数字）被 `Number(\"017\")` 按**十进制**读成 17（native sloppy 是 15 = 八进制）⇒ 见证 / 期望值折出 **自信的错值**（假红 / 假绿）。 分隔符跟在多位数前导 0 后面是 JS 语法错 ⇒ 不认识。 断言：expect(cases).toHaveLength(2);；expect(litValue(cases[0]!.argsAbs[0]!)).toEqual({ ok: true, value: 15 });"	旧断言钉错	keep	keep	—
"指数 / 进制 / 分隔符 / 前导点 / 尾点 / 一元正号"	"回归：case 实参 / 期望值的数字文法只认一条十进制正则 （/^-?\\d+(\\.\\d+)?$/）⇒ 指数 / 进制 / 分隔符 / 前导点 / 尾点 / 一元 等 **合法** JS 数字写法全部落 unknown —— 而 unknown 是顶类型 （`leqAbs(actual, unknown)` 恒 ok）⇒ 见证满足任何契约 = 假绿。 断言：expect(numOf(\"1e3\")).toBe(1000);；expect(numOf(\"1e-3\")).toBe(0.001);"	没测该层	keep	keep	—
"Infinity / NaN 是数值常量形态（不再落 unknown）"	"回归：case 实参 / 期望值的数字文法只认一条十进制正则 （/^-?\\d+(\\.\\d+)?$/）⇒ 指数 / 进制 / 分隔符 / 前导点 / 尾点 / 一元 等 **合法** JS 数字写法全部落 unknown —— 而 unknown 是顶类型 （`leqAbs(actual, unknown)` 恒 ok）⇒ 见证满足任何契约 = 假绿。 断言：expect(numOf(\"Infinity\")).toBe(Infinity);；expect(numOf(\"-Infinity\")).toBe(-Infinity);"	没测该层	keep	keep	—
"case 见证值不再是 unknown（假绿根因：见证满足任何契约）"	"回归：case 实参 / 期望值的数字文法只认一条十进制正则 （/^-?\\d+(\\.\\d+)?$/）⇒ 指数 / 进制 / 分隔符 / 前导点 / 尾点 / 一元 等 **合法** JS 数字写法全部落 unknown —— 而 unknown 是顶类型 （`leqAbs(actual, unknown)` 恒 ok）⇒ 见证满足任何契约 = 假绿。 断言：expect(cases).toHaveLength(4);；expect(values.map((v) => (v.ok ? v.value : \"<none>\"))).toEqual(["	没测该层	keep	keep	—
"非法写法仍落 unknown（不折出自信的错值）"	"回归：case 实参 / 期望值的数字文法只认一条十进制正则 （/^-?\\d+(\\.\\d+)?$/）⇒ 指数 / 进制 / 分隔符 / 前导点 / 尾点 / 一元 等 **合法** JS 数字写法全部落 unknown —— 而 unknown 是顶类型 （`leqAbs(actual, unknown)` 恒 ok）⇒ 见证满足任何契约 = 假绿。 断言：expect(parseCaseArgExpr(\"0_1\").shape.k).toBe(\"unknown\");；expect(parseCaseArgExpr(\"1__0\").shape.k).toBe(\"unknown\");"	没测该层	keep	keep	—
"getter property → unknown + named diagnostic"	"回归：对象字面量里**无顶层冒号**的属性（getter / 方法简写 / 简写属性）不得被**静默丢弃**。 改前 `parseObjectLiteral` 对 `findTopLevelColon(entry) === -1` 直接 `continue` ⇒ 该属性从 mock 值 / 期望值里**无声消失** ⇒ mock 变成 **自信的错值**（`cfg.port` 读出 `undefined` 而不是 8080）且**零诊断**。 断言：expect(abs.shape.k).toBe(\"unknown\");；expect("	旧断言钉错	keep	keep	—
"method shorthand → unknown + named diagnostic"	"回归：对象字面量里**无顶层冒号**的属性（getter / 方法简写 / 简写属性）不得被**静默丢弃**。 改前 `parseObjectLiteral` 对 `findTopLevelColon(entry) === -1` 直接 `continue` ⇒ 该属性从 mock 值 / 期望值里**无声消失** ⇒ mock 变成 **自信的错值**（`cfg.port` 读出 `undefined` 而不是 8080）且**零诊断**。 断言：expect(abs.shape.k).toBe(\"unknown\");；expect("	旧断言钉错	keep	keep	—
"shorthand property → unknown + named diagnostic"	"回归：对象字面量里**无顶层冒号**的属性（getter / 方法简写 / 简写属性）不得被**静默丢弃**。 改前 `parseObjectLiteral` 对 `findTopLevelColon(entry) === -1` 直接 `continue` ⇒ 该属性从 mock 值 / 期望值里**无声消失** ⇒ mock 变成 **自信的错值**（`cfg.port` 读出 `undefined` 而不是 8080）且**零诊断**。 断言：expect(abs.shape.k).toBe(\"unknown\");；expect("	旧断言钉错	keep	keep	—
"a single unsupported property rejects the whole literal (fail-closed, no half-value)"	"回归：对象字面量里**无顶层冒号**的属性（getter / 方法简写 / 简写属性）不得被**静默丢弃**。 改前 `parseObjectLiteral` 对 `findTopLevelColon(entry) === -1` 直接 `continue` ⇒ 该属性从 mock 值 / 期望值里**无声消失** ⇒ mock 变成 **自信的错值**（`cfg.port` 读出 `undefined` 而不是 8080）且**零诊断**。 断言：expect(abs.shape.k).toBe(\"unknown\");"	旧断言钉错	keep	keep	—
"properties with a top-level colon still parse and stay diagnostic-free"	"回归：对象字面量里**无顶层冒号**的属性（getter / 方法简写 / 简写属性）不得被**静默丢弃**。 改前 `parseObjectLiteral` 对 `findTopLevelColon(entry) === -1` 直接 `continue` ⇒ 该属性从 mock 值 / 期望值里**无声消失** ⇒ mock 变成 **自信的错值**（`cfg.port` 读出 `undefined` 而不是 8080）且**零诊断**。 断言：expect(abs.shape.k).toBe(\"obj\");；expect(diags).toHaveLength(0);"	旧断言钉错	keep	keep	—
"shape({ a: number().optional() }) → optional slot"	"回归：`@nudo:case` **期望值**里的 shape 槽必须保留 **optional** 标记。 改前 `constraintToCaseArgAbs` 只投影 `field.constraint`、丢掉 `field.optional` ⇒ 期望 Abs 里可选槽变**必填** ⇒ 缺该字段的**合法** 实际值被判 `[FAIL]`（该绿却红），且报出的 `expected` 文案不带 `?` ——而契约（侧车）面同一文法正确 ⇒ 两面自相矛盾。 断言：expect(slots.a!.optional).toBe(true);；expect(formatAbs(parseCaseArgExpr(\"shape({ a:"	没测该层	keep	keep	—
"partial(shape({ a: number() })) → optional slot"	"回归：`@nudo:case` **期望值**里的 shape 槽必须保留 **optional** 标记。 改前 `constraintToCaseArgAbs` 只投影 `field.constraint`、丢掉 `field.optional` ⇒ 期望 Abs 里可选槽变**必填** ⇒ 缺该字段的**合法** 实际值被判 `[FAIL]`（该绿却红），且报出的 `expected` 文案不带 `?` ——而契约（侧车）面同一文法正确 ⇒ 两面自相矛盾。 断言：expect(slots.a!.optional).toBe(true);"	没测该层	keep	keep	—
"required field stays required (no over-widening)"	"回归：`@nudo:case` **期望值**里的 shape 槽必须保留 **optional** 标记。 改前 `constraintToCaseArgAbs` 只投影 `field.constraint`、丢掉 `field.optional` ⇒ 期望 Abs 里可选槽变**必填** ⇒ 缺该字段的**合法** 实际值被判 `[FAIL]`（该绿却红），且报出的 `expected` 文案不带 `?` ——而契约（侧车）面同一文法正确 ⇒ 两面自相矛盾。 断言：expect(slots.a!.optional).toBeUndefined();；expect(formatAbs(parseCaseArgExpr(\"shape"	没测该层	keep	keep	—
"mixed shape keeps per-field optional flags"	"回归：`@nudo:case` **期望值**里的 shape 槽必须保留 **optional** 标记。 改前 `constraintToCaseArgAbs` 只投影 `field.constraint`、丢掉 `field.optional` ⇒ 期望 Abs 里可选槽变**必填** ⇒ 缺该字段的**合法** 实际值被判 `[FAIL]`（该绿却红），且报出的 `expected` 文案不带 `?` ——而契约（侧车）面同一文法正确 ⇒ 两面自相矛盾。 断言：expect(slots.a!.optional).toBe(true);；expect(slots.b!.optional).toBeUndefined();"	没测该层	keep	keep	—
"parser contract unchanged: classInstanceMethods skips static members"	"- parser 的 `classInstanceMethods`（`ast-guards.ts`）**跳过** static ⇒ service 的 `collectClassMethods`（`analyzer-ast.ts`）构造出的 `analysis.functions` 里静态方法**不存在** ⇒ `nudo test` / `nudo health` / `nudo contract` 的函数普查与 `nudo check` 不一致。 **裁决（主 agent）**：走 service 侧，用**已导出**的 `getClassMembers` 自行收集 static ⇒ **不改** parser 已发布符号 `c"	夹具漏形态	keep	keep	—
"service-side precondition: getClassMembers sees the static member"	"- parser 的 `classInstanceMethods`（`ast-guards.ts`）**跳过** static ⇒ service 的 `collectClassMethods`（`analyzer-ast.ts`）构造出的 `analysis.functions` 里静态方法**不存在** ⇒ `nudo test` / `nudo health` / `nudo contract` 的函数普查与 `nudo check` 不一致。 **裁决（主 agent）**：走 service 侧，用**已导出**的 `getClassMembers` 自行收集 static ⇒ **不改** parser 已发布符号 `c"	夹具漏形态	keep	keep	—
"service-side precondition: instance member is visible too"	"- parser 的 `classInstanceMethods`（`ast-guards.ts`）**跳过** static ⇒ service 的 `collectClassMethods`（`analyzer-ast.ts`）构造出的 `analysis.functions` 里静态方法**不存在** ⇒ `nudo test` / `nudo health` / `nudo contract` 的函数普查与 `nudo check` 不一致。 **裁决（主 agent）**：走 service 侧，用**已导出**的 `getClassMembers` 自行收集 static ⇒ **不改** parser 已发布符号 `c"	夹具漏形态	keep	keep	—
```

```audit-deleted
title	reason	evidence
interprets \t as TAB	dup:字符串/结构字面量整段校验	commit:2021c6af
interprets \n as LF	dup:字符串/结构字面量整段校验	commit:2021c6af
interprets \\ as one backslash	dup:字符串/结构字面量整段校验	commit:2021c6af
interprets \" as a quote	dup:字符串/结构字面量整段校验	commit:2021c6af
interprets \uXXXX	dup:字符串/结构字面量整段校验	commit:2021c6af
keeps plain strings unchanged	dup:字符串/结构字面量整段校验	commit:2021c6af
case witness carries the cooked (escape-interpreted) value	dup:字符串/结构字面量整段校验	commit:2021c6af
no literal backslash survives in the witness value	dup:字符串/结构字面量整段校验	commit:2021c6af
trailing member access after an array literal is not folded into the tuple	dup:字符串/结构字面量整段校验	commit:2021c6af
two object literals joined by + is not folded into one object	dup:字符串/结构字面量整段校验	commit:2021c6af
member access / trailing text on a literal is not folded into a structure	dup:字符串/结构字面量整段校验	commit:2021c6af
plain structure literals keep parsing (no regression)	dup:字符串/结构字面量整段校验	commit:2021c6af
case expected with trailing text → not a folded structure + nudo:directive-syntax	dup:字符串/结构字面量整段校验	commit:2021c6af
```
