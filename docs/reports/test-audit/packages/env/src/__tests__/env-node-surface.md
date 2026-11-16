```audit
title	rootCause	gap	action	status	evidence
宿主谓词齐全；每个都是 (any)=>boolean；模块面 apply 干净	os/ctor/console/spawn/util 契约表	没测该层	keep	keep	—
四兄弟走 apply 面；裸宿主实参不炸；签名干净；原生不抛；零 throw exit	os/ctor/console/spawn/util 契约表	没测该层	keep	keep	—
具名/成员调用零 L2 且口径一致；裸宿主实参不崩；真抛入口仍报 L2	os/ctor/console/spawn/util 契约表	没测该层	keep	keep	—
web env 不声明；非可调用实参记 TypeError 且 env/host 同口径；可调用实参不报	os/ctor/console/spawn/util 契约表	没测该层	keep	keep	—
声明键集与原生一致（除 error）；pid number；output/signal/status 含 null	os/ctor/console/spawn/util 契约表	没测该层	keep	keep	—
公有方法齐全、缺的四个成员零假红、签名按原生拆、Console 可构造	os/ctor/console/spawn/util 契约表	没测该层	keep	keep	—
四个构造器 ctor:true；new 各面不记 may-throw 且实例面完整；无 ctor 的 fn 记 unknown constructibility	os/ctor/console/spawn/util 契约表	没测该层	keep	keep	—
元素 keys = model/speed/times；times 五个 number 成员且与原生键集一致	os/ctor/console/spawn/util 契约表	没测该层	keep	keep	—
字面量路径含全部组件且值与原生一致；声明面完整	path/URL 契约表	没测该层	keep	keep	—
平台成员表声明 parse/format；posix 与顶层同源；win32 平台特定；format 拒绝非对象	path/URL 契约表	没测该层	keep	keep	—
抽象实参 may-throw TypeError；posix.join(123) 必抛	path/URL 契约表	没测该层	keep	keep	—
坏实参必抛 TypeError/值面 never；合法实参照原生精确折叠	path/URL 契约表	没测该层	keep	keep	—
失败必抛 / 成立零抛 / 抽象 may-throw / 缺参 TypeError	fs/stat/assert 契约表	没测该层	keep	keep	—
同步/promise 族在 throwIfNoEntry:false 时含 undefined；默认形态不含	fs/stat/assert 契约表	没测该层	keep	keep	—
同步族记 Error may-throw；existsSync/rmSync force 不抛；成功路径不塌 never；抽象实参同口径	fs/stat/assert 契约表	没测该层	keep	keep	—
"原生 oracle：报告点名的 17 个构造器在真实 Node 上确实存在"	"未建模的宿主构造器被 core 的 `$new` 兜底铸成**空 brand**（闭 obj 无槽）⇒ 成员读 exact undefined ⇒ 再链式读一次就成「定抛 TypeError」（假红）； 未建模的**全局对象** （crypto / performance / navigator …）退化成 unknown + 误导诊断 `nudo:unknown-inference`。 断言：expect(typeof ctor, name).toBe(\"function\");；expect(() => new (ctor as new () => unknown)()).toThrow(TypeError);"	夹具漏形态	keep	keep	—
"env：17 个构造器全部声明，且可构造的带 ctor:true + 实例面"	"未建模的宿主构造器被 core 的 `$new` 兜底铸成**空 brand**（闭 obj 无槽）⇒ 成员读 exact undefined ⇒ 再链式读一次就成「定抛 TypeError」（假红）； 未建模的**全局对象** （crypto / performance / navigator …）退化成 unknown + 误导诊断 `nudo:unknown-inference`。 断言：expect(g.shape.k, `${name} 形状`).toBe(\"fn\");；expect((g.shape as { ctor?: boolean }).ctor, `${name} ctor`).toBe(true);"	夹具漏形态	keep	keep	—
"env：全局对象面（crypto / performance / navigator）已声明且非 unknown"	"未建模的宿主构造器被 core 的 `$new` 兜底铸成**空 brand**（闭 obj 无槽）⇒ 成员读 exact undefined ⇒ 再链式读一次就成「定抛 TypeError」（假红）； 未建模的**全局对象** （crypto / performance / navigator …）退化成 unknown + 误导诊断 `nudo:unknown-inference`。 断言：expect(shapeOf(walk(globalOf(\"crypto\"), \"randomUUID\"), \"crypto.randomUUID\")).toContain(；expect(shapeOf(walk(globalOf(\"per"	夹具漏形态	keep	keep	—
"引擎探针：未建模构造器的成员读不再是 exact undefined（不再定抛 TypeError）"	"未建模的宿主构造器被 core 的 `$new` 兜底铸成**空 brand**（闭 obj 无槽）⇒ 成员读 exact undefined ⇒ 再链式读一次就成「定抛 TypeError」（假红）； 未建模的**全局对象** （crypto / performance / navigator …）退化成 unknown + 误导诊断 `nudo:unknown-inference`。 断言：expect(r.issues.filter((i) => i.code === \"nudo:entry-may-throw\")).toEqual([]);；expect(r.issues.filter((i) => i.code === \""	夹具漏形态	keep	keep	—
"原生 oracle：crypto.randomUUID() 恒返回 string（从不失败）"	"未建模的宿主构造器被 core 的 `$new` 兜底铸成**空 brand**（闭 obj 无槽）⇒ 成员读 exact undefined ⇒ 再链式读一次就成「定抛 TypeError」（假红）； 未建模的**全局对象** （crypto / performance / navigator …）退化成 unknown + 误导诊断 `nudo:unknown-inference`。 断言：expect(typeof crypto.randomUUID()).toBe(\"string\");"	夹具漏形态	keep	keep	—
"host oracle: every host-provided member is typeof function"	"宿主**没有**该成员所属的根全局时为 `null`。 宿主面随 Node 版本漂移：`Temporal` 全局是 Node 26 才进 ESM 全局面的 （Node 24 没有）⇒ `typeof Temporal.Instant` 在旧宿主上直接 `ReferenceError`。 断言：expect(types).toHaveLength(MEMBERS.length);；expect(label.startsWith(\"Temporal.\"), `宿主缺 ${label} 的根全局`).toBe(true);"	没测该层	keep	keep	—
"typeof folds to \"function\" in the node env (was自信的 \"object\")"	"宿主**没有**该成员所属的根全局时为 `null`。 宿主面随 Node 版本漂移：`Temporal` 全局是 Node 26 才进 ESM 全局面的 （Node 24 没有）⇒ `typeof Temporal.Instant` 在旧宿主上直接 `ReferenceError`。 断言：expect(sig?.display, `${label} typeof`).toBe('\"function\"');"	没测该层	keep	keep	—
"AbortSignal.any stays a callable static factory returning AbortSignal"	"后果：`if (typeof X.y === \"function\")` 的特性探测分支被判**恒假** ⇒ 用户会据此删掉真实有效的分支（自信的错字面量）。 断言：expect(any?.shape.k).toBe(\"fn\");；expect("	夹具漏形态	keep	keep	—
"原生 oracle：process.hrtime 是函数，返回 [seconds, nanos]；bigint() 返回 bigint"	"node env 的 `process.hrtime` 被建模成**不可调用的对象** ⇒ `process.hrtime()` 退化成 `unknown` + **误导诊断** `nudo:unknown-inference` （把责任指向用户代码）。 断言：expect(typeof process.hrtime).toBe(\"function\");；expect(Array.isArray(t)).toBe(true);"	夹具漏形态	keep	keep	—
"env：hrtime 是 envFn（可调用）+ 静态槽 bigint"	"node env 的 `process.hrtime` 被建模成**不可调用的对象** ⇒ `process.hrtime()` 退化成 `unknown` + **误导诊断** `nudo:unknown-inference` （把责任指向用户代码）。 断言：expect(hrtime, \"process.hrtime 缺失\").toBeTruthy();；expect(hrtime!.shape.k, \"hrtime 形状\").toBe(\"fn\");"	夹具漏形态	keep	keep	—
"引擎探针：process.hrtime() 推出 number[]，且无 unknown-inference 误导诊断"	"node env 的 `process.hrtime` 被建模成**不可调用的对象** ⇒ `process.hrtime()` 退化成 `unknown` + **误导诊断** `nudo:unknown-inference` （把责任指向用户代码）。 断言：expect(r.issues.filter((i) => i.code === \"nudo:unknown-inference\")).toEqual([]);；expect(r.issues.filter((i) => i.code === \"nudo:entry-may-throw\")).toEqual([]);"	夹具漏形态	keep	keep	—
"原生 oracle：七个成员在真实 Node 上都存在"	"env node 的 `process` 成员表**再缺 7 个真实成员** （`umask` / `getActiveResourcesInfo` / `resourceUsage` / `availableMemory` / `loadEnvFile` / `getBuiltinModule` / `constrainedMemory`）⇒ 正确代码拿到 7 处 `nudo:entry-may-throw` 假红。 `loadEnvFile` 只声明「不抛」的常规路径（原生对**不存在**的文件抛 ENOENT—— 那是错误路径的精度债，见交付报告； 断言：expect(typeof process.umask).toBe(\"f"	没测该层	keep	keep	—
"env：process 面带这 7 个成员"	"env node 的 `process` 成员表**再缺 7 个真实成员** （`umask` / `getActiveResourcesInfo` / `resourceUsage` / `availableMemory` / `loadEnvFile` / `getBuiltinModule` / `constrainedMemory`）⇒ 正确代码拿到 7 处 `nudo:entry-may-throw` 假红。 `loadEnvFile` 只声明「不抛」的常规路径（原生对**不存在**的文件抛 ENOENT—— 那是错误路径的精度债，见交付报告； 断言：expect(shapeOf(walk(env.globals.proc"	没测该层	keep	keep	—
"引擎探针：7 处 nudo:entry-may-throw 假红消失"	"env node 的 `process` 成员表**再缺 7 个真实成员** （`umask` / `getActiveResourcesInfo` / `resourceUsage` / `availableMemory` / `loadEnvFile` / `getBuiltinModule` / `constrainedMemory`）⇒ 正确代码拿到 7 处 `nudo:entry-may-throw` 假红。 `loadEnvFile` 只声明「不抛」的常规路径（原生对**不存在**的文件抛 ENOENT—— 那是错误路径的精度债，见交付报告； 断言：expect(r.issues.filter((i) => i.code"	没测该层	keep	keep	—
"原生 oracle：五个成员在真实 Node 上都存在"	"node env 的 `process` 成员表**缺 5 个真实成员** （`emitWarning` / `abort` / `kill` / `release` / `features`）⇒ 正确代码拿到 5 处 `nudo:entry-may-throw` 假红（成员读出 exact undefined ⇒ 调用 undefined ⇒ 引擎**证明**「必抛 TypeError」）。 值域不用 unknown——否则 `process.features.icu` 退化成 unknown 并误报 nudo:unknown-inference）。 断言：expect(typeof process.emitWarning).to"	没测该层	keep	keep	—
"env：process 面带 emitWarning / abort / kill / release / features"	"node env 的 `process` 成员表**缺 5 个真实成员** （`emitWarning` / `abort` / `kill` / `release` / `features`）⇒ 正确代码拿到 5 处 `nudo:entry-may-throw` 假红（成员读出 exact undefined ⇒ 调用 undefined ⇒ 引擎**证明**「必抛 TypeError」）。 值域不用 unknown——否则 `process.features.icu` 退化成 unknown 并误报 nudo:unknown-inference）。 断言：expect(shapeOf(walk(env.globals.proce"	没测该层	keep	keep	—
"引擎探针：五处 nudo:entry-may-throw 假红消失"	"node env 的 `process` 成员表**缺 5 个真实成员** （`emitWarning` / `abort` / `kill` / `release` / `features`）⇒ 正确代码拿到 5 处 `nudo:entry-may-throw` 假红（成员读出 exact undefined ⇒ 调用 undefined ⇒ 引擎**证明**「必抛 TypeError」）。 值域不用 unknown——否则 `process.features.icu` 退化成 unknown 并误报 nudo:unknown-inference）。 断言：expect(r.issues.filter((i) => i.code"	没测该层	keep	keep	—
"原生 oracle：process.stdin 真的有 setEncoding / pause / resume / read"	"env node：`process.stdin` 只建模 `{on}` ⇒ `process.stdin.setEncoding(\"utf8\")` 被判**定抛 TypeError**（假红； 原生不抛）。 断言：expect(typeof process.stdin.setEncoding).toBe(\"function\");；expect(typeof process.stdin.pause).toBe(\"function\");"	没测该层	keep	keep	—
"env：process.stdin 面带 setEncoding / pause / resume / read 等成员"	"env node：`process.stdin` 只建模 `{on}` ⇒ `process.stdin.setEncoding(\"utf8\")` 被判**定抛 TypeError**（假红； 原生不抛）。 断言：expect(stdin, \"process.stdin 缺失\").toBeTruthy();；expect(shapeOf(walk(stdin, name), `stdin.${name}`)).toContain(\"=>\");"	没测该层	keep	keep	—
"引擎探针：process.stdin.setEncoding(\"utf8\") 不再定抛 TypeError"	"env node：`process.stdin` 只建模 `{on}` ⇒ `process.stdin.setEncoding(\"utf8\")` 被判**定抛 TypeError**（假红； 原生不抛）。 断言：expect(r.issues.filter((i) => i.code === \"nudo:entry-may-throw\")).toEqual([]);；expect(s.throws, `${s.name} 不应有 throws 面`).toBeUndefined();"	没测该层	keep	keep	—
"原生 oracle：stdout / stderr 真的有 on / once / off / emit / write"	"node env 的 `process.stdout` / `process.stderr` 面**只有 `write`** ⇒ `.on(...)` 必抛 TypeError ⇒ L2 门禁假红。 断言：expect(typeof s.on).toBe(\"function\");；expect(typeof s.once).toBe(\"function\");"	没测该层	keep	keep	—
"env：stdout / stderr 面带 on / once / off / emit / write / end 等成员"	"node env 的 `process.stdout` / `process.stderr` 面**只有 `write`** ⇒ `.on(...)` 必抛 TypeError ⇒ L2 门禁假红。 断言：expect(stream, `process.${name} 缺失`).toBeTruthy();；expect(shapeOf(walk(stream, m), `${name}.${m}`)).toContain(\"=>\");"	没测该层	keep	keep	—
"引擎探针：process.stdout.on(...) 不再定抛 TypeError"	"node env 的 `process.stdout` / `process.stderr` 面**只有 `write`** ⇒ `.on(...)` 必抛 TypeError ⇒ L2 门禁假红。 断言：expect(r.issues.filter((i) => i.code === \"nudo:entry-may-throw\")).toEqual([]);；expect(s.throws, `${s.name} 不应有 throws 面`).toBeUndefined();"	没测该层	keep	keep	—
"host oracle: process.title is a string"	"族 15 · 全局 `process` 是**封闭对象**且槽表漏 `title` ⇒ 读 `process.title` 得到 exact `undefined` ⇒ - `process.title.length` 判「确定抛 TypeError」（L2 假红，exit 1）； - `typeof process.title` 折成 **`\"undefined\"`**（宿主 `\"string\"`） ⇒ 特性探测分支被**反向**折叠（控制流也错）。 断言：expect(typeof process.title).toBe(\"string\");；expect(process.title.length).toBeGreaterTha"	夹具漏形态	keep	keep	—
"process.title is declared as string"	"族 15 · 全局 `process` 是**封闭对象**且槽表漏 `title` ⇒ 读 `process.title` 得到 exact `undefined` ⇒ - `process.title.length` 判「确定抛 TypeError」（L2 假红，exit 1）； - `typeof process.title` 折成 **`\"undefined\"`**（宿主 `\"string\"`） ⇒ 特性探测分支被**反向**折叠（控制流也错）。 断言：expect(nodeSlotOf(\"process\", \"title\")).toBeTruthy();"	夹具漏形态	keep	keep	—
"process.title.length folds to number (was definite TypeError)"	"族 15 · 全局 `process` 是**封闭对象**且槽表漏 `title` ⇒ 读 `process.title` 得到 exact `undefined` ⇒ - `process.title.length` 判「确定抛 TypeError」（L2 假红，exit 1）； - `typeof process.title` 折成 **`\"undefined\"`**（宿主 `\"string\"`） ⇒ 特性探测分支被**反向**折叠（控制流也错）。 断言：expect(out.signatures[0]!.display).toBe(\"number\");；expect(out.throwBrands).toEqual([]);"	夹具漏形态	keep	keep	—
"typeof process.title folds to \"string\" (was \"undefined\")"	"族 15 · 全局 `process` 是**封闭对象**且槽表漏 `title` ⇒ 读 `process.title` 得到 exact `undefined` ⇒ - `process.title.length` 判「确定抛 TypeError」（L2 假红，exit 1）； - `typeof process.title` 折成 **`\"undefined\"`**（宿主 `\"string\"`） ⇒ 特性探测分支被**反向**折叠（控制流也错）。 断言：expect(out.signatures[0]!.display).toBe('\"string\"');"	夹具漏形态	keep	keep	—
"control: the same expression shape on process.version stays correct"	"族 15 · 全局 `process` 是**封闭对象**且槽表漏 `title` ⇒ 读 `process.title` 得到 exact `undefined` ⇒ - `process.title.length` 判「确定抛 TypeError」（L2 假红，exit 1）； - `typeof process.title` 折成 **`\"undefined\"`**（宿主 `\"string\"`） ⇒ 特性探测分支被**反向**折叠（控制流也错）。 断言：expect(out.signatures.find((s) => s.name === \"a\")!.display).toBe(\"number\");；expect(out.s"	夹具漏形态	keep	keep	—
"1. 原生 oracle：同步族与 promise 族的 Stats 成员表一致"	"族 29 · `fs/promises` 的结果对象是同步族的**裁剪副本** ——`fsPromisesModule.stat` 只抄了 12 个槽（比同步族少 9 个），且 `readdir` 的 `Dirent` 是**空 shape 的 brand** ⇒ 成员读出 **exact `undefined` / `NaN` / `never`**——那是**确定的错值**，不是精度债。 断言：expect(Object.keys(promised).sort()).toEqual(Object.keys(sync).sort());；expect(typeof (sync as unknown as Record<string"	旧断言钉错	keep	keep	—
"2. 声明面：promise 族的 stat 兑现值含完整成员表（不再是裁剪副本）"	"族 29 · `fs/promises` 的结果对象是同步族的**裁剪副本** ——`fsPromisesModule.stat` 只抄了 12 个槽（比同步族少 9 个），且 `readdir` 的 `Dirent` 是**空 shape 的 brand** ⇒ 成员读出 **exact `undefined` / `NaN` / `never`**——那是**确定的错值**，不是精度债。 断言：expect(inner, \"stat 的返回类型应是 promise\").toBeDefined();；expect(slots[k], `stat 兑现值缺 ${k}`).toBeDefined();"	旧断言钉错	keep	keep	—
"3. 同步族与 promise 族**共用同一张表**（成员集合相等）"	"族 29 · `fs/promises` 的结果对象是同步族的**裁剪副本** ——`fsPromisesModule.stat` 只抄了 12 个槽（比同步族少 9 个），且 `readdir` 的 `Dirent` 是**空 shape 的 brand** ⇒ 成员读出 **exact `undefined` / `NaN` / `never`**——那是**确定的错值**，不是精度债。 断言：expect(promisedSlots).toEqual(syncSlots);"	旧断言钉错	keep	keep	—
"4. Dirent：promise 族的 readdir 元素是**有 shape** 的 Dirent（旧面是空 brand）"	"族 29 · `fs/promises` 的结果对象是同步族的**裁剪副本** ——`fsPromisesModule.stat` 只抄了 12 个槽（比同步族少 9 个），且 `readdir` 的 `Dirent` 是**空 shape 的 brand** ⇒ 成员读出 **exact `undefined` / `NaN` / `never`**——那是**确定的错值**，不是精度债。 断言：expect(inner).toBeDefined();；expect(element, \"readdir 兑现值应是数组\").toBeDefined();"	旧断言钉错	keep	keep	—
"5. 反向钉：promise 族的成员读出**不得**是 exact undefined（旧面裁剪副本）"	"族 29 · `fs/promises` 的结果对象是同步族的**裁剪副本** ——`fsPromisesModule.stat` 只抄了 12 个槽（比同步族少 9 个），且 `readdir` 的 `Dirent` 是**空 shape 的 brand** ⇒ 成员读出 **exact `undefined` / `NaN` / `never`**——那是**确定的错值**，不是精度债。 断言：expect(site.value).toBeDefined();；expect(slots[\"mtimeMs\"], \"mtimeMs 缺槽 ⇒ 读出 exact undefined\").toBeDefined();"	旧断言钉错	keep	keep	—
"6. readdir 的 withFileTypes 分叉：true ⇒ Dirent[]（原生如此）"	"族 29 · `fs/promises` 的结果对象是同步族的**裁剪副本** ——`fsPromisesModule.stat` 只抄了 12 个槽（比同步族少 9 个），且 `readdir` 的 `Dirent` 是**空 shape 的 brand** ⇒ 成员读出 **exact `undefined` / `NaN` / `never`**——那是**确定的错值**，不是精度债。 断言：expect(native[0]?.isFile).toBeTypeOf(\"function\");；expect(element, \"withFileTypes:true ⇒ 元素应是 Dirent\").toBeDefined();"	旧断言钉错	keep	keep	—
```audit-deleted
title	reason	evidence
1. 原生 oracle：同步族对不存在的路径抛 Error（带 code=ENOENT）	dup:fs/stat/assert 契约表	commit:3571e1eb
2. 引擎侧：同步族调用点记一条 may-throw（Error）throw exit	dup:fs/stat/assert 契约表	commit:3571e1eb
3. 反向钉：existsSync 原生永不抛 ⇒ 引擎也不得记 throws	dup:fs/stat/assert 契约表	commit:3571e1eb
4. 反向钉：may-throw ≠ always-throw（成功路径的值面不得塌成 never）	dup:fs/stat/assert 契约表	commit:3571e1eb
5. rmSync：原生 force:true 吞掉 ENOENT（不抛）⇒ 引擎也不得记 throws	dup:fs/stat/assert 契约表	commit:3571e1eb
6. 抽象实参不改变 throws 面（路径判不出存在性 ⇒ 恒为 may-throw）	dup:fs/stat/assert 契约表	commit:3571e1eb
1. 原生 oracle：throwIfNoEntry:false ⇒ 返回 undefined（不抛）	dup:fs/stat/assert 契约表	commit:3571e1eb
2. 原生 oracle：undefined 上的成员读 ⇒ TypeError（返回域必须含 undefined）	dup:fs/stat/assert 契约表	commit:3571e1eb
3. 引擎侧：throwIfNoEntry:false ⇒ 返回域含 undefined（旧面：永不 undefined）	dup:fs/stat/assert 契约表	commit:3571e1eb
4. 反向钉：默认形态（无 throwIfNoEntry:false）⇒ 返回域不含 undefined	dup:fs/stat/assert 契约表	commit:3571e1eb
5. promise 族同口径：兑现值含 undefined	dup:fs/stat/assert 契约表	commit:3571e1eb
6. 反向钉：promise 族默认形态 ⇒ 兑现值不含 undefined	dup:fs/stat/assert 契约表	commit:3571e1eb
7. 声明面：返回域的 undefined 分支由调用点的 options 决定（不是恒有）	dup:fs/stat/assert 契约表	commit:3571e1eb
1. ok(false) ⇒ 必抛 AssertionError（旧实现恒不抛）	dup:fs/stat/assert 契约表	commit:3571e1eb
2. ok(true) ⇒ 零抛（断言成立）	dup:fs/stat/assert 契约表	commit:3571e1eb
3. ok(抽象值) ⇒ may-throw AssertionError（原生在该域上确实可能抛）	dup:fs/stat/assert 契约表	commit:3571e1eb
4. strictEqual(1, 2) ⇒ 必抛 AssertionError；strictEqual(1, 1) ⇒ 零抛	dup:fs/stat/assert 契约表	commit:3571e1eb
5. deepStrictEqual ⇒ 结构判定：相等零抛 / 不等必抛	dup:fs/stat/assert 契约表	commit:3571e1eb
6. notStrictEqual ⇒ 相等必抛 / 不等零抛	dup:fs/stat/assert 契约表	commit:3571e1eb
7. match ⇒ pattern 可判定时精确判定：命中零抛 / 不命中必抛	dup:fs/stat/assert 契约表	commit:3571e1eb
8. fail() ⇒ 恒抛 AssertionError	dup:fs/stat/assert 契约表	commit:3571e1eb
9. strictEqual 缺参 ⇒ 必抛 TypeError（原生 ERR_MISSING_ARGS，不是 AssertionError）	dup:fs/stat/assert 契约表	commit:3571e1eb
1. 实参确定非字符串 ⇒ 必抛 TypeError（原生 oracle 同样必抛）	dup:path/URL 契约表	commit:5eb71d91
2. 必抛的 throws 面品牌是 TypeError、值面是 never	dup:path/URL 契约表	commit:5eb71d91
3. 坏实参**不得**折出自信精确字面量（basename 旧面折 'y.txt'）	dup:path/URL 契约表	commit:5eb71d91
4. 合法实参照旧折叠（不回归）	dup:path/URL 契约表	commit:5eb71d91
5. 抽象实参 ⇒ may-throw TypeError（不是必抛）	dup:path/URL 契约表	commit:5eb71d91
6. posix / win32 平台路径对象同口径（原生 posix.join(123) 也必抛）	dup:path/URL 契约表	commit:5eb71d91
host oracle: posix.parse / win32.parse / posix.format all work	dup:path/URL 契约表	commit:5eb71d91
the platform member tables declare parse / format	dup:path/URL 契约表	commit:5eb71d91
posix.parse folds exactly like the top-level path.parse (single source of truth)	dup:path/URL 契约表	commit:5eb71d91
win32.parse folds platform-specifically (not a definite TypeError)	dup:path/URL 契约表	commit:5eb71d91
posix.format returns a string and rejects non-objects	dup:path/URL 契约表	commit:5eb71d91
1. 字面量路径 ⇒ 实例面含全部 11 个 URL 组件 + toString / toJSON	dup:path/URL 契约表	commit:5eb71d91
2. 成员值与原生一致（href / pathname / protocol …）	dup:path/URL 契约表	commit:5eb71d91
3. 声明面（抽象实参回落面）也是完整 URL 面（旧实现只有 href 一槽）	dup:path/URL 契约表	commit:5eb71d91
4. 反向对照：旧单槽面读 pathname 会得到 exact undefined	dup:path/URL 契约表	commit:5eb71d91
1. cpus() 元素含 times 槽（user/nice/sys/idle/irq 全在）	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
2. 原生 oracle 对拍：声明的 times 成员名 = 原生 os.cpus()[0].times 的键	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
3. 反向钉：times 缺槽 ⇒ 成员读出 exact undefined（原生没有 undefined 成员）	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
1. 四个模块导出构造器都带 ctor:true（URL / URLSearchParams / TextEncoder / TextDecoder）	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
2. new URL(…) ⇒ 不记 unknown-constructibility may-throw + 实例面是 URL 面	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
3. new URLSearchParams(…) ⇒ 不记 may-throw + 实例面带成员表	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
4. new TextEncoder() / new TextDecoder(…) ⇒ 不记 may-throw + 实例面完整	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
5. 反向对照：没有 ctor 标记的 fn 形 callee ⇒ 记 unknown-constructibility may-throw	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
1. 成员表含 node v26 的公有 console 方法集（旧白名单缺 4 个）	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
2. 旧白名单缺的 4 个成员调用**不抛**（假红消除）	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
3. 签名按原生拆（旧实现全部复用同一个 voidFn ⇒ 形参面失真）	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
4. 既有成员面未回归（log/error/warn/info/assert 仍在且可调用）	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
5. `new console.Console()` 不因缺槽被误判为定抛 TypeError	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
1. 声明返回面含原生全部成员（pid / output / signal / status / stdout / stderr）	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
2. 原生 oracle 的键集与 env 声明面一致（error 另计：仅 spawn 失败时出现）	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
3. pid 是 number（不是 undefined）；output 元素是 Buffer | null；signal 是 string | null	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
4. 反向对照：旧 4 槽面读 pid 会得到 exact undefined	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
queueMicrotask is NOT declared in the web env	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
queueMicrotask(1) records TypeError (native throws)	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
the env path and the host path agree	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
a callable callback is not reported as a TypeError	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
具名导入调用面：promisify(readFile) 零 L2（native 必不抛）	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
成员调用面：util.promisify(readFile) 零 L2	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
两种调用口径一致（具名导入 == 成员调用）	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
裸宿主函数实参（inherits(Sub, Object)）零 L2 —— 普通调用面不得崩	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
裸宿主值实参（isDeepStrictEqual）零 L2	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
裸宿主函数实参（fs 同步族的回调位）零 L2 —— 钉住 core 侧根因	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
core 侧根因直钉：relation 实例化遇裸宿主实参不得抛	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
反向对照：真会抛的入口必须报 L2（防永真断言）	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
反向对照：真会抛的宿主调用必须报 L2（防永真断言）	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
1. 四个品牌形参函数都走 apply 面 ⇒ 不进 relation 实例化	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
2. 裸宿主实参 ⇒ 不炸、不记 may-throw、返回值仍是声明面	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
3. 签名面不变（品牌形参仍在签名里，format 干净）	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
4. 原生 oracle：inherits / promisify 都不抛	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
5. 反向对照：品牌形参的 throws 面不得凭空出现（旧假红路径）	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
host oracle: the predicates in question exist and return true	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
the env member set covers every host util.types predicate	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
types.isMap applies to boolean and never throws	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
types.isMap(...) via the module face applies cleanly	dup:os/ctor/console/spawn/util 契约表	commit:f9c356a1
```
