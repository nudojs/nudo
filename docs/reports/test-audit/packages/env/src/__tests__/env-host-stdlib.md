```audit
title	rootCause	gap	action	status	evidence
畸形入参记 URIError/never；合法入参零抛且精确；抽象入参 string + may-throw；四全局有 throws 面	Buffer/crypto/text/URI 契约表	没测该层	keep	keep	—
web env 不声明；裸调 TypeError；new 干净；env/host 同口径	Buffer/crypto/text/URI 契约表	没测该层	keep	keep	—
web env 不声明；非法 label 记 RangeError；默认干净；env/host 同口径；合法 label 精确	Buffer/crypto/text/URI 契约表	没测该层	keep	keep	—
宿主可克隆成功/不可克隆抛；env 不声明；引擎 throws 面回归且 env 不改变结论	Buffer/crypto/text/URI 契约表	没测该层	keep	keep	—
core 对照组：executor 两臂 ⇒ boom；Promise.resolve ⇒ 无 boom；env 三个 promise ⇒ boom	Buffer/crypto/text/URI 契约表	没测该层	keep	keep	—
迭代器非数组、无 length/index、带 @@iterator；web 展开合法；FormData 同径	Buffer/crypto/text/URI 契约表	没测该层	keep	keep	—
数组/浮点 TypedArray 拒绝；整数 TypedArray 保持同一性；参数域非 Array	Buffer/crypto/text/URI 契约表	没测该层	keep	keep	—
五个入口越界必抛对应品牌；合法零抛；抽象 may-throw	Buffer/crypto/text/URI 契约表	没测该层	keep	keep	—
宿主 Buffer.of 返回 Buffer；env 静态 of 是变长 fn；调用零 throws	Buffer/crypto/text/URI 契约表	没测该层	keep	keep	—
四个名字不是 Buffer 静态；env 不声明；读面 unknown；模块面在 node:buffer	Buffer/crypto/text/URI 契约表	没测该层	keep	keep	—
宿主真值；env 实例槽 number/ArrayBuffer/number；引擎读出精确类型	Buffer/crypto/text/URI 契约表	没测该层	keep	keep	—
宿主 new Buffer 正常；env ctor:true + Buffer 实例面；引擎零假红	Buffer/crypto/text/URI 契约表	没测该层	keep	keep	—
web env 不声明；非法输入记 InvalidCharacterError；合法 base64 精确折叠；env/host 同口径	host stdlib 契约表	没测该层	keep	keep	—
performance/navigator/crypto.subtle/Response static 的宿主成员均被覆盖	host stdlib 契约表	没测该层	keep	keep	—
performance/navigator/web subtle/node subtle 的未知成员仍确定缺失	host stdlib 契约表	没测该层	keep	keep	—
四 API 声明/可调用；既有成员不变；node/web 成员集同源	host stdlib 契约表	没测该层	keep	keep	—
locks/request/query 声明；实例面同源；既有成员不变	host stdlib 契约表	没测该层	keep	keep	—
六成员声明/可调用；nodeTiming obj；timerify 返回 fn；已有成员不变	host stdlib 契约表	没测该层	keep	keep	—
静态工厂返回 Response 品牌；实例 json 仍是 promise	host stdlib 契约表	没测该层	keep	keep	—
```audit-deleted
title	reason	evidence
静态 `Response.json` 的返回域是 brand `Response`，且不是 promise	dup:host stdlib 契约表	commit:64ded59c
静态 `Response.json(x)` 的引擎签名是 `Response`（不是 promise）	dup:host stdlib 契约表	commit:64ded59c
实例 `response.json()` 仍是 promise（不得被改成同步）	dup:host stdlib 契约表	commit:64ded59c
静态面三个工厂（error / json / redirect）都仍在，且都返回 `Response` 品牌	dup:host stdlib 契约表	commit:64ded59c
6 个宿主真实成员都被声明（不再缺槽）	dup:host stdlib 契约表	commit:64ded59c
6 个成员都可调用（不落进「确定缺失」）	dup:host stdlib 契约表	commit:64ded59c
`performance.nodeTiming` 是对象（宿主上不是函数）	dup:host stdlib 契约表	commit:64ded59c
`performance.timerify(fn)` 的返回域是可调用的（宿主返回包装函数，不是 undefined）	dup:host stdlib 契约表	commit:64ded59c
已声明的成员行为不变：`now` / `mark` / `measure` / `getEntries*` 仍可调用	dup:host stdlib 契约表	commit:64ded59c
`navigator.locks` 被声明（不再是 exact undefined）	dup:host stdlib 契约表	commit:64ded59c
`navigator.locks.request(...)` 不被判「确定缺失」	dup:host stdlib 契约表	commit:64ded59c
`navigator.locks.query()` 也被声明	dup:host stdlib 契约表	commit:64ded59c
`Navigator` 实例面与 `navigator` 全局面同源（同一份槽表）	dup:host stdlib 契约表	commit:64ded59c
已声明的成员行为不变：hardwareConcurrency / language / languages / userAgent / platform	dup:host stdlib 契约表	commit:64ded59c
deriveKey / deriveBits / wrapKey / unwrapKey 被声明	dup:host stdlib 契约表	commit:64ded59c
调用不再被判「确定缺失」（合法浏览器代码不再被 L2 门禁挡住）	dup:host stdlib 契约表	commit:64ded59c
已声明的成员行为不变：digest / encrypt / decrypt / sign / verify / generateKey / importKey / exportKey	dup:host stdlib 契约表	commit:64ded59c
node env 与 web env 的 `crypto.subtle` 成员集合同源（两 env 不再自相矛盾）	dup:host stdlib 契约表	commit:64ded59c
`performance.notARealMember()` 仍判「确定抛 TypeError」	dup:host stdlib 契约表	commit:64ded59c
`navigator.notARealMember` 仍读出 undefined（不是全放行）	dup:host stdlib 契约表	commit:64ded59c
web env `crypto.subtle.notAMember()` 仍判「确定抛 TypeError」	dup:host stdlib 契约表	commit:64ded59c
node env `crypto.subtle.notAMember()` 仍读出 undefined（不是全放行）	dup:host stdlib 契约表	commit:64ded59c
performance（node env）	dup:host stdlib 契约表	commit:64ded59c
navigator（node env）	dup:host stdlib 契约表	commit:64ded59c
crypto.subtle（node env 与 web env）	dup:host stdlib 契约表	commit:64ded59c
Response 静态面（node env 与 web env）	dup:host stdlib 契约表	commit:64ded59c
atob / btoa are NOT declared in the web env (host fallback)	dup:host stdlib 契约表	commit:64ded59c
atob('!!!') records InvalidCharacterError	dup:host stdlib 契约表	commit:64ded59c
btoa('✓') records InvalidCharacterError	dup:host stdlib 契约表	commit:64ded59c
valid base64 still folds to the exact string (no precision loss)	dup:host stdlib 契约表	commit:64ded59c
the host-fallback path and the env path agree (same source, same verdict)	dup:host stdlib 契约表	commit:64ded59c
原生 oracle：new Buffer(1) / new Buffer("ab") 正常返回（仅弃用警告，不抛）	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
env：Buffer 是 fn 形全局且带 ctor:true，实例面是 Buffer 形状	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
引擎探针：new Buffer(1) 不再是「never throws TypeError」	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
原生 oracle：Buffer.alloc(4) 的三个成员是真值（不是 undefined）	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
env：Buffer 实例形状带三个槽，且类型正确	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
引擎探针：三个成员读出 number / ArrayBuffer / number（不再是 exact undefined）	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
host oracle: the four names are not Buffer statics (they are module exports)	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
the env Buffer static table no longer declares them	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
calling Buffer.isUtf8(...) is no longer a confident value (was green)	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
Buffer.constants.MAX_LENGTH is no longer a confident number	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
the module face node:buffer declares them at module scope	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
原生 oracle：Buffer.of 存在且返回 Buffer（长度 2）	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
env：Buffer 静态面带 of（变长 fn）	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
引擎探针：Buffer.of(1, 2) 不再定抛 TypeError	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
1. createHash：不支持的算法名 ⇒ 必抛 Error（旧实现恒不抛）	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
2. randomBytes：size 越界 ⇒ 必抛 RangeError；合法 size 零抛	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
3. randomInt：max <= min ⇒ 必抛 RangeError；合法区间零抛	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
4. pbkdf2Sync：iterations = 0 ⇒ 必抛 RangeError；合法参数零抛	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
5. timingSafeEqual：长度不等 ⇒ RangeError（env 的 Buffer 面不建模长度 ⇒ may-throw）	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
6. 抽象实参 ⇒ may-throw（原生在该域上确实可能抛）	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
host oracle: array argument throws, TypedArray is returned by identity	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
array literal argument is rejected (was green)	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
legal integer TypedArray is not a throw and keeps its identity	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
float TypedArray is rejected by the host → rejected by the env	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
the declared parameter domain is integer TypedArrays, never a JS Array	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
host oracle: keys() is an Iterator, not an Array	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
node: Array.isArray(headers.keys()) folds to false (was true)	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
node: keys() has no array length / index (was number / string)	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
node: the declared face is an iterator object (has @@iterator), not arr	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
web: spreading headers.keys() is legal (was may-throw TypeError)	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
FormData entries are iterators too (both envs)	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
带 rejected 通道的 promise（executor fork）⇒ catch 臂活	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
确定 fulfilled 的 promise（Promise.resolve）⇒ catch 臂死（原生同款）	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
反向对照：把「带 rejected 通道」换成「确定 fulfilled」⇒ 断言必须失败	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
fs/promises.readFile ⇒ catch 臂是活代码	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
fetch（web）⇒ catch 臂是活代码	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
crypto.subtle.digest（node 全局 crypto）⇒ catch 臂是活代码	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
原生 oracle：structuredClone 对不可克隆值抛错（不是恒不抛）	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
env：node env 不声明 structuredClone（回落宿主路径）	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
引擎探针：带 node env 时 structuredClone 仍有 throws 面（假绿修掉）	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
引擎探针：不开 env 时结论一致（env 不再改变门禁结论）	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
Bug 288 口径：可克隆实参（{ a: 1 }）native 不抛 ⇒ 引擎不得记 throws 面	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
TextDecoder is NOT declared in the web env (it shadowed core's exact model)	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
new TextDecoder('bad-$$') records RangeError (not TypeError)	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
new TextDecoder() is clean	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
the env path and the host path agree on the error brand	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
core's exact model still folds a known label (encoding slot)	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
TextEncoder / TextDecoder are NOT declared in the web env	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
bare TextEncoder() records TypeError (native: class without new)	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
bare TextDecoder('utf-8') records TypeError (native: class without new)	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
new TextEncoder() / new TextDecoder() are clean	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
the env path and the host path agree on the bare-call verdict	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
1. 畸形 % 序列 ⇒ 记 URIError（原生恒抛，门禁必须红）	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
2. 合法入参 ⇒ **不**抛（不误红）且值精确	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
3. 抽象实参 ⇒ 回落声明域 string（不折自信精确字面量）+ may-throw URIError	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
4. 四个 URI 全局都声明了 throws 面（errBrand('URIError')）	dup:Buffer/crypto/text/URI 契约表	commit:e70012d2
```
