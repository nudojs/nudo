# packages/core/src/algebra/__tests__/soundness-regressions.test.ts

模块套件：55 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"abstract if true-arm pop does not leak exact mutated container to post-if"	"P0.1 数组 mutator 在抽象 if 臂间不得泄漏；"	夹具漏形态	keep	keep	—
"false-arm sees pre-fork container when true arm mutates (order-safe)"	"P0.1 数组 mutator 在抽象 if 臂间不得泄漏；"	夹具漏形态	keep	keep	—
"member-path mutator in true arm also joins (o.arr.pop)"	"至少不是「只看见 true 臂」的 exact undefined； 不得只剩无关字面量 P0.1 数组 mutator 在抽象 if 臂间不得泄漏；"	夹具漏形态	keep	keep	—
"both-return early-lift if joins return values (2|3 or number)"	"不得只剩 true 臂 exact 2 P0.1 数组 mutator 在抽象 if 臂间不得泄漏；"	夹具漏形态	keep	keep	—
"a.at(0) is first element"	"此处仅保留 w7 未以同源码覆盖的显式字面量下标 at(0)。 P0.1 数组 mutator 在抽象 if 臂间不得泄漏；"	夹具漏形态	keep	keep	—
"map.delete then get is undefined, not exact old value"	"P0.1 数组 mutator 在抽象 if 臂间不得泄漏；"	夹具漏形态	keep	keep	—
"map.delete then has is exact false"	"P0.1 数组 mutator 在抽象 if 臂间不得泄漏；"	夹具漏形态	keep	keep	—
"map.clear then get is undefined"	"P0.1 数组 mutator 在抽象 if 臂间不得泄漏；"	夹具漏形态	keep	keep	—
"map.delete in one abstract arm makes get join old|undefined (no FN)"	"若侧车约定 string：必须含 undefined，不能只折 exact \"ok\"（假阴性） P0.1 数组 mutator 在抽象 if 臂间不得泄漏；"	夹具漏形态	keep	keep	—
"set.delete then has is exact false"	"P0.1 数组 mutator 在抽象 if 臂间不得泄漏；"	夹具漏形态	keep	keep	—
"set.clear empties membership"	"P0.1 数组 mutator 在抽象 if 臂间不得泄漏；"	夹具漏形态	keep	keep	—
"set.delete in abstract arm: has is not exact true"	"P0.1 数组 mutator 在抽象 if 臂间不得泄漏；"	夹具漏形态	keep	keep	—
"concrete pop drops last element from returned container"	"P0.1 数组 mutator 在抽象 if 臂间不得泄漏；"	夹具漏形态	keep	keep	—
"concrete no-match continues after switch"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"abstract keeps after path"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"concrete no-match is undefined not dropped"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"abstract includes fall-through, not exact 1|2 only"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"if-throw keeps normal path in result and throw in throws"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"x &&= a.pop() when x is null does not pop"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"x ||= a.pop() under abstract flag is not exact 2"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"abstract branch-sensitive generator conf is not exact [1,3]"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"concrete true still yields [1]"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"abstract while does not keep only last body state as exact"	"不得只剩 exact 单成员 last state。 T5 修复后：抽象条件循环携带值 growth-widen 为无上界 prim 域 （旧 `0..8` sum 是 的假 exact 上界形状）。 第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	夹具漏形态	keep	keep	—
"if/else assign then read enumerates both arms"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"if/else side effects on x do not accumulate across arms"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"if without else keeps fall-through binding"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"object slot write joins both arms"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"abstract number ??= keeps number domain"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"concrete nullish and non-nullish still correct"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"pre-try abstract throw still surfaces after nested try-return"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"concrete outer paths still work"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"abstract length is not exact mutated-only"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"concrete case1 falls into case3 side effects"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"abstract is not exact last/default only"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"for-loop sum under abstract n is not exact 8"	"T5 修复后：抽象条件循环携带累加器 growth-widen 为无上界 prim 域 （旧 `0..8` sum 是 的假 exact 上界形状）。 第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	夹具漏形态	keep	keep	—
"export call if/else assign then read enumerates arms"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"export call if without else keeps fall-through"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"joinAbs(1,2) is sum of members"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"outer let write + nested function param same name still joins"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"arrow param same name as outer write does not drop isolation"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"forEach callback param same name keeps outer join"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"empty tuple for-of does not expand to maxIters"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"abstract iterable (arr) widens to unbounded domain (0..n exits covered)"	"单代表迭代 + 增长宽化——计数器域 = 无上界 number（native a.length 任意，{0,1} 不是超集），0 次出口由 number 域覆盖 第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"for-of over a number-typed receiver is a definite TypeError (numbers are never iterable)"	"此前静默迭代为错误） 第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"concrete tuple for-of still counts exactly"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"export call += concrete"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"export call += abstract number"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"export call ??= writes RHS when left null"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"export call ?? keeps non-nullish domain"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"evaluator runs do-while body at least once"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"export-call do-while agrees"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"2 ⊄ 1"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"number ⊄ lit 1"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"string ⊄ number still fails"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
"lit 1 ≤ number prim succeeds"	"第八轮 review P0 回归： - 无 default switch 不得当终止语句 - $switch 隐式 fall-through - fork 臂 throw 不中止兄弟臂 - 逻辑赋值 ||= / &&= / ??= - generator 抽象分支不得 exact 出货"	没测该层	keep	keep	—
```
