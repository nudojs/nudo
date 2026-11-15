# packages/core/src/algebra/__tests__/soundness-regressions.test.ts

模块套件：跨轮 soundness 回归（数组/Map/Set mutator、抽象臂隔离、at/delete）。

审计：55 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
"abstract if true-arm pop does not leak exact mutated container to post-if"	"断言：expect(shape).not.toBe(\"[1, 2]\");；expect(shape).not.toBe(\"[1,2]\");"	没测该层	keep	keep	—
"false-arm sees pre-fork container when true arm mutates (order-safe)"	"断言：expect(s).toContain(\"30\");；expect(s).toContain(\"undefined\");"	没测该层	keep	keep	—
"member-path mutator in true arm also joins (o.arr.pop)"	"P0.1 数组 mutator 在抽象 if 臂间不得泄漏； 断言：expect(s).toContain(\"undefined\");；expect(s === \"undefined\" ).toBe(false);"	夹具漏形态	keep	keep	—
"both-return early-lift if joins return values (2|3 or number)"	"断言：expect(s === \"2\").toBe(false);；expect(s).toMatch(/2|3|number/);"	没测该层	keep	keep	—
"a.at(0) is first element"	"断言：expect(litValue(r.result)).toEqual({ ok: true, value: \"first\" });"	没测该层	keep	keep	—
"map.delete then get is undefined, not exact old value"	"P0.1 数组 mutator 在抽象 if 臂间不得泄漏； 断言：expect(s).toContain(\"undefined\");；expect(s).not.toBe('\"ok\"');"	夹具漏形态	keep	keep	—
"map.delete then has is exact false"	"P0.1 数组 mutator 在抽象 if 臂间不得泄漏； 断言：expect(litValue(r.result)).toEqual({ ok: true, value: false });"	夹具漏形态	keep	keep	—
"map.clear then get is undefined"	"P0.1 数组 mutator 在抽象 if 臂间不得泄漏； 断言：expect(s).toContain(\"undefined\");"	夹具漏形态	keep	keep	—
"map.delete in one abstract arm makes get join old|undefined (no FN)"	"P0.1 数组 mutator 在抽象 if 臂间不得泄漏； 断言：expect(s).toContain(\"undefined\");"	夹具漏形态	keep	keep	—
"set.delete then has is exact false"	"P0.1 数组 mutator 在抽象 if 臂间不得泄漏； 断言：expect(litValue(r.result)).toEqual({ ok: true, value: false });"	夹具漏形态	keep	keep	—
"set.clear empties membership"	"P0.1 数组 mutator 在抽象 if 臂间不得泄漏； 断言：expect(litValue(r.result)).toEqual({ ok: true, value: false });"	夹具漏形态	keep	keep	—
"set.delete in abstract arm: has is not exact true"	"P0.1 数组 mutator 在抽象 if 臂间不得泄漏； 断言：expect(r.result.conf).not.toBe(\"exact\");；expect(litValue(r.result)).not.toEqual({ ok: true, value: true });"	夹具漏形态	keep	keep	—
"concrete pop drops last element from returned container"	"断言：expect(shape).not.toBe(\"3\");；expect(shape).toMatch(/\\[|arr|tuple/);"	没测该层	keep	keep	—
"concrete no-match continues after switch"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货 断言：expect(litValue(call(src, \"f\", 2).result)).toEqual({ ok: true, value: \"after\" });"	没测该层	keep	keep	—
"abstract keeps after path"	"断言：expect(s).not.toBe('\"one\"');；expect(s).toContain(\"after\");"	没测该层	keep	keep	—
"concrete no-match is undefined not dropped"	"断言：expect(litValue(r.result)).toEqual({ ok: true, value: undefined });"	没测该层	keep	keep	—
"abstract includes fall-through, not exact 1|2 only"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货 断言：expect(s).toContain(\"1\");；expect(s).toContain(\"2\");"	没测该层	keep	keep	—
"if-throw keeps normal path in result and throw in throws"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货 断言：expect(formatAbs(r.result)).toContain(\"ok\");；expect(formatAbs(r.throws)).toContain(\"e\");"	没测该层	keep	keep	—
"x &&= a.pop() when x is null does not pop"	"断言：expect(litValue(call(src, \"f\").result)).toEqual({ ok: true, value: 3 });"	没测该层	keep	keep	—
"x ||= a.pop() under abstract flag is not exact 2"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货 断言：expect(r.result.conf).not.toBe(\"exact\");"	没测该层	keep	keep	—
"abstract branch-sensitive generator conf is not exact [1,3]"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货 断言：expect(r.result.conf).not.toBe(\"exact\");"	没测该层	keep	keep	—
"concrete true still yields [1]"	"断言：expect(formatAbs(r.result)).toContain(\"[1]\");；expect(r.result.conf).toBe(\"exact\");"	没测该层	keep	keep	—
"abstract while does not keep only last body state as exact"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货 断言：expect(formatShape(r.result)).not.toBe(\"8\");；expect(formatShape(r.result)).toBe(\"number\");"	没测该层	keep	keep	—
"if/else assign then read enumerates both arms"	"断言：expect(litValue(call(src, \"f\", true).result)).toEqual({ ok: true, value: 1 });；expect(litValue(call(src, \"f\", false).result)).toEqual({ ok: true, value: 2 });"	没测该层	keep	keep	—
"if/else side effects on x do not accumulate across arms"	"断言：expect(litValue(call(src, \"f\", true).result)).toEqual({ ok: true, value: 1 });；expect(litValue(call(src, \"f\", false).result)).toEqual({ ok: true, value: 2 });"	没测该层	keep	keep	—
"if without else keeps fall-through binding"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货 断言：expect(litValue(call(src, \"f\", false).result)).toEqual({ ok: true, value: 0 });；expect(litValue(call(src, \"f\", true).result)).toEqual({ ok: true, value: 1 });"	没测该层	keep	keep	—
"object slot write joins both arms"	"断言：expect(litValue(call(src, \"f\", true).result)).toEqual({ ok: true, value: 1 });；expect(formatShape(r.result)).not.toBe(\"2\");"	没测该层	keep	keep	—
"abstract number ??= keeps number domain"	"断言：expect(formatShape(r.result)).not.toBe(\"42\");"	没测该层	keep	keep	—
"concrete nullish and non-nullish still correct"	"断言：expect(litValue(call(src, \"f\", null, 7).result)).toEqual({ ok: true, value: 7 });；expect(litValue(call(src, \"f\", 3, 7).result)).toEqual({ ok: true, value: 3 });"	没测该层	keep	keep	—
"pre-try abstract throw still surfaces after nested try-return"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货 断言：expect(formatAbs(r.throws)).toContain(\"pre\");"	没测该层	keep	keep	—
"concrete outer paths still work"	"断言：expect(formatAbs(rt.throws)).toContain(\"pre\");；expect(litValue(rf.result)).toEqual({ ok: true, value: \"done\" });"	没测该层	keep	keep	—
"abstract length is not exact mutated-only"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货 断言：expect(litValue(call(src, \"f\", 1).result)).toEqual({ ok: true, value: 2 });；expect(litValue(call(src, \"f\", 2).result)).toEqual({ ok: true, value: 3 });"	没测该层	keep	keep	—
"concrete case1 falls into case3 side effects"	"断言：expect(litValue(call(src, \"f\", 1).result)).toEqual({ ok: true, value: 2 });；expect(litValue(call(src, \"f\", 2).result)).toEqual({ ok: true, value: 2 });"	没测该层	keep	keep	—
"abstract is not exact last/default only"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货 断言：expect(formatShape(r.result)).not.toBe(\"99\");"	没测该层	keep	keep	—
"for-loop sum under abstract n is not exact 8"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货 断言：expect(litValue(call(src, \"f\", 3).result)).toEqual({ ok: true, value: 3 });；expect(formatShape(r.result)).not.toBe(\"8\");"	没测该层	keep	keep	—
"export call if/else assign then read enumerates arms"	"断言：expect(r.shape.k).toBe(\"sum\");；expect(formatShape(r)).not.toBe(\"0\");"	没测该层	keep	keep	—
"export call if without else keeps fall-through"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货 断言：expect(r.shape.k).toBe(\"sum\");；expect(formatShape(r)).not.toBe(\"1\");"	没测该层	keep	keep	—
"joinAbs(1,2) is sum of members"	"断言：expect(r.shape.k).toBe(\"sum\");；expect(formatShape(r)).toContain(\"1\");"	没测该层	keep	keep	—
"outer let write + nested function param same name still joins"	"P0.1 数组 mutator 在抽象 if 臂间不得泄漏； 断言：expect(litValue(call(src, \"f\", true).result)).toEqual({ ok: true, value: 1 });；expect(litValue(call(src, \"f\", false).result)).toEqual({ ok: true, value: 0 });"	夹具漏形态	keep	keep	—
"arrow param same name as outer write does not drop isolation"	"断言：expect(formatShape(r.result)).not.toBe(\"1\");；expect(formatShape(r.result)).not.toBe(\"0\");"	没测该层	keep	keep	—
"forEach callback param same name keeps outer join"	"断言：expect(formatShape(r.result)).not.toBe(\"1\");"	没测该层	keep	keep	—
"empty tuple for-of does not expand to maxIters"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货 断言：expect(litValue(call(src, \"f\").result)).toEqual({ ok: true, value: 0 });"	没测该层	keep	keep	—
"abstract iterable (arr) widens to unbounded domain (0..n exits covered)"	"断言：expect(shown).toContain(\"number\");；expect(shown).toContain(\"#widened\");"	没测该层	keep	keep	—
"for-of over a number-typed receiver is a definite TypeError (numbers are never iterable)"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货 断言：expect(formatAbs(r.throws)).toContain(\"TypeError\");"	没测该层	keep	keep	—
"concrete tuple for-of still counts exactly"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货 断言：expect(litValue(call(src, \"f\").result)).toEqual({ ok: true, value: 2 });"	没测该层	keep	keep	—
"export call += concrete"	"断言：expect(formatAbs(r)).toBe(\"6 #exact\");"	没测该层	keep	keep	—
"export call += abstract number"	"断言：expect(formatAbs(r)).not.toBe(\"1 #exact\");"	没测该层	keep	keep	—
"export call ??= writes RHS when left null"	"断言：expect(litValue(r)).toEqual({ ok: true, value: 7 });"	没测该层	keep	keep	—
"export call ?? keeps non-nullish domain"	"断言：expect(formatAbs(r)).not.toBe('\"fb\"');；expect(formatShape(r)).toContain(\"number\");"	没测该层	keep	keep	—
"evaluator runs do-while body at least once"	"P0.1 数组 mutator 在抽象 if 臂间不得泄漏； 断言：expect(litValue(call(src, \"f\").result)).toEqual({ ok: true, value: 1 });"	夹具漏形态	keep	keep	—
"export-call do-while agrees"	"断言：expect(formatAbs(r)).toBe(\"1 #exact\");"	没测该层	keep	keep	—
"2 ⊄ 1"	"断言：expect(leqAbs($lit(2), $lit(1)).ok).toBe(false);"	没测该层	keep	keep	—
"number ⊄ lit 1"	"断言：expect(leqAbs(absNum, $lit(1)).ok).toBe(false);"	没测该层	keep	keep	—
"string ⊄ number still fails"	"断言：expect("	没测该层	keep	keep	—
"lit 1 ≤ number prim succeeds"	"断言：expect(leqAbs($lit(1), absNum).ok).toBe(true);"	没测该层	keep	keep	—
```
