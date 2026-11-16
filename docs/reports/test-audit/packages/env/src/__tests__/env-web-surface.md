```audit
title	rootCause	gap	action	status	evidence
Response.body / Headers.getSetCookie / document.location / CustomEvent / Request.duplex	web 面契约表	没测该层	keep	keep	—
宿主 TypeError；TypeError/OperationError 两臂可达；静态声明仍 OperationError；importKey unknown	web 面契约表	没测该层	keep	keep	—
any/abort/timeout 均在；any([]) 零抛	web 面契约表	没测该层	keep	keep	—
无 Response 状态面；保留自身成员；bodyUsed 共有；status/ok undefined、method string	web 面契约表	没测该层	keep	keep	—
searchParams 已声明；get 零抛且折 string | null；其余成员仍在	web 面契约表	没测该层	keep	keep	—
声明 number；读面 number；比较折 boolean 而非硬编码 false	web 面契约表	没测该层	keep	keep	—
mark 返回 PerformanceMark 品牌；.name string；measure 有 name/duration	web 面契约表	没测该层	keep	keep	—
13 个全局已声明；使用它们零 error/零 throw	web 面契约表	没测该层	keep	keep	—
数组元素与对象源 ToNumber 都折精确值	web 面契约表	没测该层	keep	keep	—
自有 cause 读出值；无 options 为 undefined；继承 cause 为 unknown 非 undefined	web 面契约表	没测该层	keep	keep	—
缺省抛 TypeError；[] ⇒ []；抽象实参 unknown	web 面契约表	没测该层	keep	keep	—
Collator / NumberFormat / DateTimeFormat 实例面；未建模子构造器空；Intl 成员集；运行时 typeof	web 面契约表	没测该层	keep	keep	—
fetch / subtle / body / clipboard 品牌；多 reason 保持 unknown；Promise.reject 实参；成员集不变	web 面契约表	没测该层	keep	keep	—
声明面 + 白名单按建模能力推导；未建模仍报；报告自洽；WeakRef/Atomics 对照	web 面契约表	没测该层	keep	keep	—
"host oracle: instanceof is true and constructor.name is the class name"	"族 15 · web env 的浏览器构造器返回**普通对象面**（无 brand） ⇒ `instanceof` **恒假**、`constructor.name` 恒 `\"Object\"` ⇒ 与宿主**相反** ⇒ 真实分支被消成死代码（假绿 + 自信的错值）。 ⚠️ `URLSearchParams` 例外：core 按 **brand 名**路由内建建模并**忽略** env 的槽表（实测 `.get` 折 unknown，`env-` 回归）⇒ 暂不加 brand （见 web.ts 的说明）。 断言：expect(JSON.parse(out)).toEqual({ inst: true, name: \"Event\","	旧断言钉错	keep	keep	—
"web: new Event(...) instanceof Event folds to true (was false)"	"族 15 · web env 的浏览器构造器返回**普通对象面**（无 brand） ⇒ `instanceof` **恒假**、`constructor.name` 恒 `\"Object\"` ⇒ 与宿主**相反** ⇒ 真实分支被消成死代码（假绿 + 自信的错值）。 ⚠️ `URLSearchParams` 例外：core 按 **brand 名**路由内建建模并**忽略** env 的槽表（实测 `.get` 折 unknown，`env-` 回归）⇒ 暂不加 brand （见 web.ts 的说明）。 断言：expect(out.signatures[0]!.display).toBe(\"true\");"	旧断言钉错	keep	keep	—
"web: the real branch of instanceof is reachable (was dead code)"	"族 15 · web env 的浏览器构造器返回**普通对象面**（无 brand） ⇒ `instanceof` **恒假**、`constructor.name` 恒 `\"Object\"` ⇒ 与宿主**相反** ⇒ 真实分支被消成死代码（假绿 + 自信的错值）。 ⚠️ `URLSearchParams` 例外：core 按 **brand 名**路由内建建模并**忽略** env 的槽表（实测 `.get` 折 unknown，`env-` 回归）⇒ 暂不加 brand （见 web.ts 的说明）。 断言：expect(out.signatures[0]!.display).toBe('\"is-event\"');"	旧断言钉错	keep	keep	—
"web: constructor.name folds to the class name (was \"Object\")"	"族 15 · web env 的浏览器构造器返回**普通对象面**（无 brand） ⇒ `instanceof` **恒假**、`constructor.name` 恒 `\"Object\"` ⇒ 与宿主**相反** ⇒ 真实分支被消成死代码（假绿 + 自信的错值）。 ⚠️ `URLSearchParams` 例外：core 按 **brand 名**路由内建建模并**忽略** env 的槽表（实测 `.get` 折 unknown，`env-` 回归）⇒ 暂不加 brand （见 web.ts 的说明）。 断言：expect(out.signatures[0]!.display).toBe('\"Event\"');"	旧断言钉错	keep	keep	—
"web: other constructors are branded instances"	"族 15 · web env 的浏览器构造器返回**普通对象面**（无 brand） ⇒ `instanceof` **恒假**、`constructor.name` 恒 `\"Object\"` ⇒ 与宿主**相反** ⇒ 真实分支被消成死代码（假绿 + 自信的错值）。 ⚠️ `URLSearchParams` 例外：core 按 **brand 名**路由内建建模并**忽略** env 的槽表（实测 `.get` 折 unknown，`env-` 回归）⇒ 暂不加 brand （见 web.ts 的说明）。 断言：expect(out.signatures[0]!.display).toBe(\"[true, true, true]\""	旧断言钉错	keep	keep	—
"every browser constructor's instance face carries a brand"	"族 15 · web env 的浏览器构造器返回**普通对象面**（无 brand） ⇒ `instanceof` **恒假**、`constructor.name` 恒 `\"Object\"` ⇒ 与宿主**相反** ⇒ 真实分支被消成死代码（假绿 + 自信的错值）。 ⚠️ `URLSearchParams` 例外：core 按 **brand 名**路由内建建模并**忽略** env 的槽表（实测 `.get` 折 unknown，`env-` 回归）⇒ 暂不加 brand （见 web.ts 的说明）。 断言：expect(g?.shape.k, `${name} must be a ctor fn`).toBe(\"fn\");；"	旧断言钉错	keep	keep	—
"new <ctor>() for every browser constructor yields 0 error diagnostics"	"族 29 web env 的浏览器构造器缺 `ctor: true`。 根因：`packages/env/src/web.ts` 把浏览器构造器建模成普通可调用 fn（`Response` 甚至是 `objAbs`）⇒ `$new` 走「obj 非构造器 ⇒ 硬 TypeError」或「fn 无 ctor ⇒ 记 unknown-constructibility 假 may-throw」分支 ⇒ L2 门禁对**合法**浏览器代码 报 error（假红）。 断言：expect(out.errorCodes).toEqual([]);；expect(out.throwBrands).toEqual([]);"	夹具漏形态	keep	keep	—
"each browser constructor is declared as a fn carrying ctor: true"	"族 29 web env 的浏览器构造器缺 `ctor: true`。 根因：`packages/env/src/web.ts` 把浏览器构造器建模成普通可调用 fn（`Response` 甚至是 `objAbs`）⇒ `$new` 走「obj 非构造器 ⇒ 硬 TypeError」或「fn 无 ctor ⇒ 记 unknown-constructibility 假 may-throw」分支 ⇒ L2 门禁对**合法**浏览器代码 报 error（假红）。 断言：expect(ctorFlagOf(name), `${name} must be ctor: true`).toBe(true);"	夹具漏形态	keep	keep	—
"Response is a constructible fn (was objAbs ⇒ 'not a constructor' TypeError)"	"族 29 web env 的浏览器构造器缺 `ctor: true`。 根因：`packages/env/src/web.ts` 把浏览器构造器建模成普通可调用 fn（`Response` 甚至是 `objAbs`）⇒ `$new` 走「obj 非构造器 ⇒ 硬 TypeError」或「fn 无 ctor ⇒ 记 unknown-constructibility 假 may-throw」分支 ⇒ L2 门禁对**合法**浏览器代码 报 error（假红）。 断言：expect(instanceSlotOf(\"Response\", \"status\")).toBeTruthy();；expect(instanceSlotOf(\"Resp"	夹具漏形态	keep	keep	—
"URL / AbortController (pre-existing correct samples) stay constructible"	"族 29 web env 的浏览器构造器缺 `ctor: true`。 根因：`packages/env/src/web.ts` 把浏览器构造器建模成普通可调用 fn（`Response` 甚至是 `objAbs`）⇒ `$new` 走「obj 非构造器 ⇒ 硬 TypeError」或「fn 无 ctor ⇒ 记 unknown-constructibility 假 may-throw」分支 ⇒ L2 门禁对**合法**浏览器代码 报 error（假红）。 断言：expect(ctorFlagOf(\"URL\")).toBe(true);；expect(ctorFlagOf(\"AbortController\")).toBe(true)"	夹具漏形态	keep	keep	—
"every browser global is present in the env globals table"	"族 29 env web 的浏览器全局清单缺项 ⇒ **定抛 ReferenceError**（假红）。 根因：env 的 `globals` 表未收录这些浏览器全局 ⇒ 未声明的名字在引擎里是 **未绑定** ⇒ 读它 = ReferenceError ⇒ L2 门禁对合法浏览器代码报 error， 且诊断文案指向完全无关的方向（「re-export `export { x } from` 不是局部绑定」）。 断言：expect(globals[name], `global \"${name}\" missing`).toBeTruthy();"	没测该层	keep	keep	—
"using them yields no ReferenceError (and no error-level diagnostic)"	"族 29 env web 的浏览器全局清单缺项 ⇒ **定抛 ReferenceError**（假红）。 根因：env 的 `globals` 表未收录这些浏览器全局 ⇒ 未声明的名字在引擎里是 **未绑定** ⇒ 读它 = ReferenceError ⇒ L2 门禁对合法浏览器代码报 error， 且诊断文案指向完全无关的方向（「re-export `export { x } from` 不是局部绑定」）。 断言：expect(out.errorCodes).toEqual([]);；expect(out.issues.filter((i) => /ReferenceError/.test(i.message))).toEqua"	没测该层	keep	keep	—
"screen exposes the Screen interface members"	"族 29 env web 的浏览器全局清单缺项 ⇒ **定抛 ReferenceError**（假红）。 根因：env 的 `globals` 表未收录这些浏览器全局 ⇒ 未声明的名字在引擎里是 **未绑定** ⇒ 读它 = ReferenceError ⇒ L2 门禁对合法浏览器代码报 error， 且诊断文案指向完全无关的方向（「re-export `export { x } from` 不是局部绑定」）。 断言：expect(slots?.[name], `screen.${name}`).toBeTruthy();"	没测该层	keep	keep	—
"DOMParser / XMLHttpRequest / Worker / FileReader / IntersectionObserver are constructible"	"族 29 env web 的浏览器全局清单缺项 ⇒ **定抛 ReferenceError**（假红）。 根因：env 的 `globals` 表未收录这些浏览器全局 ⇒ 未声明的名字在引擎里是 **未绑定** ⇒ 读它 = ReferenceError ⇒ L2 门禁对合法浏览器代码报 error， 且诊断文案指向完全无关的方向（「re-export `export { x } from` 不是局部绑定」）。 断言：expect(out.errorCodes).toEqual([]);；expect(out.throwBrands).toEqual([]);"	没测该层	keep	keep	—
"indexedDB / caches expose their documented members"	"族 29 env web 的浏览器全局清单缺项 ⇒ **定抛 ReferenceError**（假红）。 根因：env 的 `globals` 表未收录这些浏览器全局 ⇒ 未声明的名字在引擎里是 **未绑定** ⇒ 读它 = ReferenceError ⇒ L2 门禁对合法浏览器代码报 error， 且诊断文案指向完全无关的方向（「re-export `export { x } from` 不是局部绑定」）。 断言：expect(idb?.[name], `indexedDB.${name}`).toBeTruthy();；expect(caches?.[name], `caches.${name}`).toBeTruthy();"	没测该层	keep	keep	—
"document collection lookups are callable (no definite TypeError)"	"族 29 web env 的 `document` / `performance` 成员表不完整。 根因：env 的成员表是**手写白名单**； 断言：expect(out.errorCodes).toEqual([]);；expect(out.throwBrands).toEqual([]);"	没测该层	keep	keep	—
"document.getElementsByTagName returns an array-shaped value"	"族 29 web env 的 `document` / `performance` 成员表不完整。 根因：env 的成员表是**手写白名单**； 断言：expect(slotOf(\"document\", \"getElementsByTagName\")).toBeTruthy();；expect(out.errorCodes).toEqual([]);"	没测该层	keep	keep	—
"document.forms / links / images / scripts are declared"	"族 29 web env 的 `document` / `performance` 成员表不完整。 根因：env 的成员表是**手写白名单**； 断言：expect(slotOf(\"document\", name), `document.${name}`).toBeTruthy();；expect(out.errorCodes).toEqual([]);"	没测该层	keep	keep	—
"document.write / open / close are declared and callable"	"族 29 web env 的 `document` / `performance` 成员表不完整。 根因：env 的成员表是**手写白名单**； 断言：expect(slotOf(\"document\", name), `document.${name}`).toBeTruthy();；expect(out.errorCodes).toEqual([]);"	没测该层	keep	keep	—
"performance.getEntries / clearResourceTimings / toJSON are declared and callable"	"族 29 web env 的 `document` / `performance` 成员表不完整。 根因：env 的成员表是**手写白名单**； 断言：expect(slotOf(\"performance\", name), `performance.${name}`).toBeTruthy();；expect(out.errorCodes).toEqual([]);"	没测该层	keep	keep	—
"performance.navigation / serverTiming are declared"	"族 29 web env 的 `document` / `performance` 成员表不完整。 根因：env 的成员表是**手写白名单**； 断言：expect(slotOf(\"performance\", name), `performance.${name}`).toBeTruthy();"	没测该层	keep	keep	—
```audit-deleted
title	reason	evidence
1. es env 声明面含 core 已建模的 ES 规范全局	dup:web 面契约表	commit:5e93fbb0
2. core 已建模的全局不再被报「未被覆盖」（白名单按建模能力推导）	dup:web 面契约表	commit:5e93fbb0
3. 真正未建模的全局仍被报（判定不是永真/永假）	dup:web 面契约表	commit:5e93fbb0
4. 报告自洽：同一份报告里签名是精确值、且不再有「未被覆盖」警告	dup:web 面契约表	commit:5e93fbb0
5. 带 @nudo:env es 时也不报「未被覆盖」（env 声明面 + 白名单双保险）	dup:web 面契约表	commit:5e93fbb0
6. WeakRef：core 已精确建模 ⇒ 裸用与带 env 都不报「未被覆盖」	dup:web 面契约表	commit:5e93fbb0
5.1 fetch 的网络错 ⇒ catch 形参是 TypeError 品牌（e.name / e.message 可解）	dup:web 面契约表	commit:5e93fbb0
5.2 crypto.subtle.* ⇒ OperationError 品牌（WebCrypto 规范）	dup:web 面契约表	commit:5e93fbb0
5.3 Request / Response 的 body 读取族 ⇒ TypeError 品牌	dup:web 面契约表	commit:5e93fbb0
5.4 navigator.clipboard ⇒ NotAllowedError 品牌（Clipboard 规范）	dup:web 面契约表	commit:5e93fbb0
5.5 负控：多 reason / 未建模的声明仍是 unknown（不假精确）	dup:web 面契约表	commit:5e93fbb0
5.6 Promise.reject 的拒绝 reason 是实参（声明面 ≡ ES 规范）	dup:web 面契约表	commit:5e93fbb0
5.7 负控：crypto.subtle 的成员集逐字不变（13 个成员，一个不多一个不少）	dup:web 面契约表	commit:5e93fbb0
1.1 Intl.Collator 的实例面含 compare / resolvedOptions（原生原型成员）	dup:web 面契约表	commit:5e93fbb0
1.2 Intl.NumberFormat / DateTimeFormat 的实例面含 format 族（原生原型成员）	dup:web 面契约表	commit:5e93fbb0
1.3 负控：未建模的子构造器（ListFormat / Segmenter / Locale…）实例面不变	dup:web 面契约表	commit:5e93fbb0
1.4 负控：Intl 的成员集逐字不变（9 个子构造器 + 2 个静态）	dup:web 面契约表	commit:5e93fbb0
运行时 typeof new Intl.Collator().compare → "function"（族 65 第 4 条已建模）	dup:web 面契约表	commit:5e93fbb0
2.1 缺省实参 ⇒ 原生**抛 TypeError**（引擎同款：never + may-throw TypeError）	dup:web 面契约表	commit:5e93fbb0
2.2 new AggregateError([]).errors ⇒ [] （原生同款：拷贝而非引用）	dup:web 面契约表	commit:5e93fbb0
2.3 抽象实参 ⇒ errors 保持 unknown（不造副本、不假精确）	dup:web 面契约表	commit:5e93fbb0
3.1 自有 cause 键 ⇒ 读出值（原生同款）	dup:web 面契约表	commit:5e93fbb0
3.2 无 options ⇒ 无 cause 键（保持「无 cause 键 ⇒ 不装槽」口径）	dup:web 面契约表	commit:5e93fbb0
继承的 cause ⇒ 读出 unknown（不是「确定不存在」）	dup:web 面契约表	commit:5e93fbb0
4.1 元素读面 ⇒ 精确值（族 65 第 6 条已建模；原生 new Int8Array([1])[0] === 1）	dup:web 面契约表	commit:5e93fbb0
对象源逐元素 ToNumber ⇒ 精确值（原生同款）	dup:web 面契约表	commit:5e93fbb0
every previously-missing global is declared	dup:web 面契约表	commit:5e93fbb0
using those globals produces zero error diagnostics (was全体假红)	dup:web 面契约表	commit:5e93fbb0
host oracle: mark returns PerformanceMark with .name	dup:web 面契约表	commit:5e93fbb0
mark().name folds to string (was definite TypeError)	dup:web 面契约表	commit:5e93fbb0
mark() is declared as a PerformanceMark brand, not undefined	dup:web 面契约表	commit:5e93fbb0
measure() returns a PerformanceMeasure with .name / .duration	dup:web 面契约表	commit:5e93fbb0
the navigator member table declares hardwareConcurrency	dup:web 面契约表	commit:5e93fbb0
navigator.hardwareConcurrency reads as number (was exact undefined)	dup:web 面契约表	commit:5e93fbb0
the comparison folds to boolean, not a hard-coded false	dup:web 面契约表	commit:5e93fbb0
the location member table declares searchParams	dup:web 面契约表	commit:5e93fbb0
location.searchParams.get('q') does not throw (was definite TypeError)	dup:web 面契约表	commit:5e93fbb0
the read folds to string | null (native Location.searchParams.get)	dup:web 面契约表	commit:5e93fbb0
the other location members are still declared	dup:web 面契约表	commit:5e93fbb0
Request carries NO Response-only status members	dup:web 面契约表	commit:5e93fbb0
Request keeps its own members	dup:web 面契约表	commit:5e93fbb0
bodyUsed is a shared member (Request.bodyUsed exists natively)	dup:web 面契约表	commit:5e93fbb0
r.status reads as undefined (was exact number)	dup:web 面契约表	commit:5e93fbb0
r.ok reads as undefined (was exact boolean)	dup:web 面契约表	commit:5e93fbb0
r.method still reads as string (Request's own member)	dup:web 面契约表	commit:5e93fbb0
Response keeps its status members	dup:web 面契约表	commit:5e93fbb0
the AbortSignal member table declares any	dup:web 面契约表	commit:5e93fbb0
AbortSignal.any([...]) does not throw (was definite TypeError)	dup:web 面契约表	commit:5e93fbb0
AbortSignal.abort / timeout stay declared	dup:web 面契约表	commit:5e93fbb0
host oracle: invalid arguments reject with a TypeError	dup:web 面契约表	commit:5e93fbb0
the TypeError branch is reachable (was dead code)	dup:web 面契约表	commit:5e93fbb0
the OperationError branch stays reachable too	dup:web 面契约表	commit:5e93fbb0
the static declaration keeps OperationError (spec face, not widened)	dup:web 面契约表	commit:5e93fbb0
importKey keeps an honest unknown reason (several reject paths)	dup:web 面契约表	commit:5e93fbb0
host oracle: all four web members exist and are usable	dup:web 面契约表	commit:5e93fbb0
web: Response.body.getReader() is not a definite TypeError	dup:web 面契约表	commit:5e93fbb0
web: Headers.getSetCookie() is declared as string[]	dup:web 面契约表	commit:5e93fbb0
web: document.location.href is declared (document is not closed around it)	dup:web 面契约表	commit:5e93fbb0
node: CustomEvent carries the inherited Event members	dup:web 面契约表	commit:5e93fbb0
node: Request.duplex is declared	dup:web 面契约表	commit:5e93fbb0
```
