```audit
title	rootCause	gap	action	status	evidence
collection 查询/静态集合/write/open/close/performance 成员全部声明且调用零错	browser 面契约表	没测该层	keep	keep	—
11 个全局声明；使用时零 ReferenceError；screen/构造器/indexedDB/caches 成员	browser 面契约表	没测该层	keep	keep	—
全部可 new 零错误；ctor:true；Response 实例面；URL/AbortController 保持	browser 面契约表	没测该层	keep	keep	—
instanceof/constructor.name 与宿主一致；12 个构造器实例面都带 brand	browser 面契约表	没测该层	keep	keep	—
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
host oracle: instanceof is true and constructor.name is the class name	dup:browser 面契约表	commit:80f019a6
web: new Event(...) instanceof Event folds to true (was false)	dup:browser 面契约表	commit:80f019a6
web: the real branch of instanceof is reachable (was dead code)	dup:browser 面契约表	commit:80f019a6
web: constructor.name folds to the class name (was "Object")	dup:browser 面契约表	commit:80f019a6
web: other constructors are branded instances	dup:browser 面契约表	commit:80f019a6
every browser constructor's instance face carries a brand	dup:browser 面契约表	commit:80f019a6
new <ctor>() for every browser constructor yields 0 error diagnostics	dup:browser 面契约表	commit:80f019a6
each browser constructor is declared as a fn carrying ctor: true	dup:browser 面契约表	commit:80f019a6
Response is a constructible fn (was objAbs ⇒ 'not a constructor' TypeError)	dup:browser 面契约表	commit:80f019a6
URL / AbortController (pre-existing correct samples) stay constructible	dup:browser 面契约表	commit:80f019a6
every browser global is present in the env globals table	dup:browser 面契约表	commit:80f019a6
using them yields no ReferenceError (and no error-level diagnostic)	dup:browser 面契约表	commit:80f019a6
screen exposes the Screen interface members	dup:browser 面契约表	commit:80f019a6
DOMParser / XMLHttpRequest / Worker / FileReader / IntersectionObserver are constructible	dup:browser 面契约表	commit:80f019a6
indexedDB / caches expose their documented members	dup:browser 面契约表	commit:80f019a6
document collection lookups are callable (no definite TypeError)	dup:browser 面契约表	commit:80f019a6
document.getElementsByTagName returns an array-shaped value	dup:browser 面契约表	commit:80f019a6
document.forms / links / images / scripts are declared	dup:browser 面契约表	commit:80f019a6
document.write / open / close are declared and callable	dup:browser 面契约表	commit:80f019a6
performance.getEntries / clearResourceTimings / toJSON are declared and callable	dup:browser 面契约表	commit:80f019a6
performance.navigation / serverTiming are declared	dup:browser 面契约表	commit:80f019a6
```
