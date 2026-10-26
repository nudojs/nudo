# @nudojs/env

## 0.5.3

### Patch Changes

- e3b8791: Reading a member of a built-in prototype, a branded value or a namespace now
  returns what JavaScript returns instead of a confident `undefined`.
  
  - A built-in prototype object had no table for its own members, so
    `Map.prototype[Symbol.toStringTag]` returned `undefined` instead of `"Map"`,
    `RegExp.prototype.flags` returned `undefined` instead of `""` and
    `Error.prototype.name` returned `undefined` instead of `"Error"`. The
    prototype objects of the built-ins now carry their own symbol members,
    their own data properties and their own methods.
  - A value of a built-in brand whose class was derived from a built-in — an
    instance of `class M extends Set` — lost the whole built-in prototype
    face: `s.add` returned `undefined` even though `"add" in s` said `true`.
    The two answers contradicted each other. The prototype chain is now
    resolved to the first built-in owner, and a member defined by the
    derived class still wins.
  - `Object.prototype.toString.call(Math)` reported `[object Math]` but
    `Math[Symbol.toStringTag]` returned `undefined`. A namespace object now
    exposes its `Symbol.toStringTag`.
  - `Symbol.prototype.description` returned the string `"undefined"` and did
    not record a throw; it now throws a `TypeError`, like the specification
    says.
  - `Map.prototype.size` and `Set.prototype.size` returned `"undefined"` and
    did not record a throw; they now throw a `TypeError`.
  - `Intl.NumberFormat.prototype.format` returned `undefined` and did not
    record a throw; reading a brand-check accessor of an `Intl` prototype now
    throws a `TypeError`.
  - A member that does not exist on a `number`, `boolean` or `bigint` primitive
    folded to `unknown`, which made every later read of that value look
    harmless. It now folds to `undefined`, so the later read is still
    recognised as a possible `TypeError`.
  - `Symbol()` instances resolved `toString` and `toLocaleString` to the
    matching members of `Object.prototype`, losing the brand check. The brand
    check is now performed.
  - The `constructor` of a class value resolved to a built-in constructor
    named after the class, so `Widget.constructor === Function` was `false`.
    It is now `true`.
  - A getter-only static accessor accepted a write; it now throws a `TypeError`
    in strict mode, like the instance-level accessors already did.
  - The `prototype` property of a class value was missing its
    "not writable" flag, so `A.prototype = {}` silently wrote through. It is
    now rejected with a `TypeError`.
  - `process.env` and `process.versions` were shown as
    `Record<string, string | undefined>` but reading `process.env.HOME`
    returned `unknown`, and the difference was reported as a failed
    inference. The read now uses the declared index domain.
  - A host or namespace object such as `Math` only projected its enumerable
    own properties, so `Object.getOwnPropertyNames(Math)` returned `0` and
    `Math.PI` could not be read at all, even though the object was marked as
    exactly known. All own properties are projected now, and the descriptor
    flags are recorded, so the enumerable face still matches the original.
- a1c093f: 族 62（片 W12）：env 的 **ES / Web 内建构造器声明面**精度 —— 5 条台账里 **1 条 env 侧真修**、**3 条由同批 core 收口**、**1 条复核后为非缺陷**。
  
  **真修 · 第 5 条（Bug 890 精度）：env promise 的拒绝 reason 逐声明可见。**
  `promiseOf(inner)` 加**可选**拒绝 reason（缺省仍是 `unknown` ⇒ 其余声明逐字不变），
  逐声明给出**规范规定**的 reason：
  
  - `fetch` ⇒ `TypeError`（网络错 / 非法 URL）∪ `AbortError`（信号 abort 的默认 reason）；
  - `Request` / `Response` 的 body 读取族（`json` / `text` / `arrayBuffer` / `blob` / `formData`）⇒ `TypeError`（WHATWG Fetch「consume body」：流出错 / JSON 解析失败）；
  - `crypto.subtle.*`（`digest` / `encrypt` / `decrypt` / `sign` / `verify` / `generateKey` / `deriveKey` / `deriveBits` / `wrapKey` / `unwrapKey` / `exportKey`）⇒ `OperationError` DOMException（WebCrypto 规范）；
  - `navigator.clipboard.readText` / `writeText` ⇒ `NotAllowedError` DOMException（Clipboard 规范）；
  - `Promise.reject(reason)`（**声明面**）⇒ 拒绝 reason 就是实参（ES 规范）。
  
  效果：`catch (e)` 的形参不再恒为 `unknown` ⇒ `e.name` / `e.message` **可解**
  （此前 `e.message` 折出 unknown ⇒ 拿不到）。
  
  **声明面 · 第 1 条（Bug 332）：Intl 子构造器的实例方法面。**
  `Intl.Collator` / `Intl.NumberFormat` / `Intl.DateTimeFormat` 的**实例面**
  补上原生原型成员（`compare` / `format` / `formatToParts` / `formatRange` /
  `formatRangeToParts` / `resolvedOptions`），方法值 + 参数/返回面齐备。
  
  **其余 3 条已由同批 core 收口**（`fix-core-remaining-65`）：第 1 条的**运行时**面
  （`typeof new Intl.Collator().compare` 现折精确 `"function"`）、第 3 条
  （继承的 `cause` 不再折「确定不存在」，现为 `unknown` —— 原生是 `1`，
  引擎取**不假精确**的口径）、第 4 条（`new Int8Array(["3"])[0]` 折 `3`，
  类型化数组元素值面已建模）。第 2 条不是缺陷：原生 `new AggregateError()`
  **抛 TypeError**，引擎同判（该入口报 `nudo:entry-may-throw` TypeError），
  台账「`errors = []`」的前提与原生不符。
  
  **env 包的 `exports` map 未动**（无新增导出面）；`promiseOf` 只加了**可选**形参。
- 9f26414: fix(env): env 成员表对齐宿主实测（族 35 · Bug 1044 / 1047 / 1048 / 1049）
  
  env 的成员表是**手写**的 ⇒ 两个方向的错都会进产品面：**缺**成员 ⇒ 闭 obj 缺槽
  ⇒ 成员读出 **exact `undefined`**（确定的错值）⇒ 调用即「确定抛 TypeError」⇒
  **L2 门禁假红**；**写错返回域** ⇒ 宿主必抛的调用被判安全 ⇒ **L2 门禁假绿**。
  本批把四条从未被任何批次处理过的成员表缺陷一并对齐，并补上**宿主实测护栏**。
  
  - **Bug 1044（node env · `Response` 静态面 · 假绿）**：`Response.json` 的返回域
    写成了 `promise<unknown>`（WHATWG Fetch / undici：静态 `Response.json`
    **同步**返回 `Response`）⇒ `.then(...)` 被判安全而宿主必抛
    （`TypeError: Response.json(...).then is not a function`）。改成 `Response`
    **实例面**（brand），读面与宿主一致（`.status` → number、`.then` → exact
    `undefined`），与 web env 的静态面同源；**实例面**的 `json`（读 body ⇒ 真
    promise）保持不动。
    *已知偏差*：`.then(...)` 这一具体形态**仍不**被 L2 门禁标出——core 的
    「确定不可调用成员」判定只覆盖**平 obj 接收者**，brand 接收者的缺槽成员
    被调用时不记抛（core 侧问题，本包改不到）。
  - **Bug 1047（node env · `performance` · 假红）**：补齐宿主真实存在的 6 个成员
    —— `toJSON` / `clearResourceTimings`（Performance Level 2 标准面，web env
    早已补过 ⇒ 两 env 不对称）/ `eventLoopUtilization` / `nodeTiming` /
    `setResourceTimingBufferSize` / `timerify`（perf_hooks 面）。`nodeTiming` 按
    宿主实测建模为**对象**，`timerify` 的返回域是**可调用**面（宿主返回包装函数，
    不是 `undefined`）。
  - **Bug 1048（node env · `navigator` · 假红）**：补 `locks`（Web Locks API，W3C
    标准，浏览器 + node 24+ 都有）⇒ `navigator.locks` 不再读出 exact `undefined`，
    `navigator.locks.request(...)` 不再被判「确定抛 TypeError」。
  - **Bug 1049（web env · `crypto.subtle` · 假红）**：补 4 个标准 WebCrypto API
    —— `deriveKey` / `deriveBits`（Level 1）/ `wrapKey` / `unwrapKey`（Level 2）
    ⇒ node env 同一对象早已声明前两个的**两 env 自相矛盾**消失。
  
  **两 env 同源**：node env 的 `crypto.subtle` 同步补上 `wrapKey` / `unwrapKey`，
  node / web 两 env 的 `crypto.subtle` 成员集合同源；web env 的 `navigator` 同步
  补上 `locks`。node env 内部把 `performance`（全局对象面 + `Performance` 实例面）、
  `navigator`（全局对象面 + `Navigator` 实例面）与 `crypto.subtle`（`crypto` 全局面
  + `SubtleCrypto` 实例面）改为**共用一份槽表**，杜绝「一处补了一处没补」的漂移。
  
  **宿主实测护栏**：新增回归钉，对 `performance` / `navigator` / `crypto.subtle` /
  `Response` 各断言「**宿主实测成员名 ⊆ env 表成员名**」（真 node 子进程跑
  `Object.getOwnPropertyNames` 对照 env 表），并带**负控**（宿主没有的成员仍被判
  「确定缺失」）⇒ 证明没有把整张表改成全放行。
- 67abd92: fix(env): node env 面的 4 处假绿 / 口径不一致收尾（族 64）
  
  env 的 node 声明面是**手写**的 ⇒ 宿主**必抛**的路径被判「恒不抛」⇒
  **L2 门禁假绿**。本批按**宿主实测**（node v26.10.0）逐条收口。
  
  **第 1 条 · 全局 `TextEncoder` 是 class，裸调必抛 TypeError（真修）。**
  宿主实测：`TextEncoder()` ⇒ TypeError（"Class constructor TextEncoder cannot be
  invoked without 'new'"）；旧声明是**普通 fn 面** ⇒ 裸调落「返回声明类型、
  **永不抛**」⇒ 假绿。现在**在 env 侧声明成类值**（core 的 Bug 272 判据：
  `ctor: true` + 单一 rest 形参 `"_rest"` ⇒ 裸调定抛 TypeError，**与原生同形**），
  `apply` 返回**声明实例面** ⇒ `new TextEncoder()` 的实例面
  （`encoding` / `encode` / `encodeInto`）**不丢**——不像「删声明回落宿主」那样
  退成 `undefined`（那是**确定的错值**，宿主真值是 `"utf-8"`）。
  副作用（诚实记录）：签名显示从 `() => TextEncoder` 变为 `(_rest) => TextEncoder`
  ——与 core 自己对**类表达式**的显示口径（`(_rest) => ?`）同款。
  
  **第 2 条 · `node:url` 的 `URL` 不再吞掉原生异常（真修，调用面）。**
  apply 的 catch 分支此前 `return undefined` ⇒ 非法 URL 被静默吞掉（恒不抛）；
  现在套 **Bug 881**（`fileURLToPath`）同款范式：非法 URL ⇒ 记 **TypeError**
  throws 面；抽象实参 ⇒ 原生可能抛 ⇒ 同样记 may-throw TypeError；合法 URL ⇒
  零抛 + 字面量 `href`（字面量精度不回归）。
  *已知偏差（core 侧 A 类债）*：core 的 `$new` 只取 `AbsApplyResult` 的 `abs`
  （**throws 面被丢**）⇒ env 层无法表达「构造期必抛」⇒
  `new URL("not a url")` 仍恒不抛；已在钉里记录现状，待 core 修复后改写。
  
  **第 3 条 · `util` / `querystring` 的 `escape` / `unescape`（无需改动，已钉）。**
  宿主实测：`require("node:util").escape === undefined`（util **没有**这两个
  成员）、`require("node:querystring").escape` 是函数（querystring **有**）⇒
  env 的 querystring 面与宿主一致，util 面也**没有**多声明 ⇒ 任务书前提里的
  「util 多声明」实为**误归因**（声明在 querystring 面，宿主同样有）⇒ 不改，
  只钉住与宿主一致。
  
  **第 4 条 · `crypto.subtle` 的拒绝 reason（不改，保持 `unknown`，已钉）。**
  宿主实测：node 的 WebCrypto 与浏览器**不同**——拒绝 reason ∈
  `{NotSupportedError, TypeError, OperationError, DataError}`（**从不是**
  OperationError 唯一值）⇒ 按 `promiseOf` 的契约（reason 必须是**全部**拒绝
  路径的公共上界，否则是 wrong-exact）node env 的 reason 必须保持 `unknown`；
  web env 的 `OperationError` 是**浏览器口径**（WebCrypto 规范）⇒ 跨 env
  不同源是**宿主事实**，不是缺陷 ⇒ 不改，只钉住。
  
  **负控**：族 61 的既有声明**逐字不变**——node env 仍是 **130** 个全局、
  `node:crypto` / `node:fs` / `node:fs/promises` 的成员名单与 formatShape 不变。
  **env 包的 `exports` map 未动**（无新增导出面）。
- 3d66f5a: fix(env): node env 的模块面与共享槽面对齐宿主实测（族 61 · 6 条）
  
  node env 的声明面是**手写**的 ⇒ 两个方向的错都会进产品面：**缺成员** ⇒ 该名
  走宿主路径（行为对、类型精度低）；**缺实参域** ⇒ 原生**必抛**的入口被判
  「恒不抛」⇒ **L2 门禁假绿**。本批按**宿主实测**（node v26.10.0）补齐六条。
  
  - **`node:crypto` 同族兄弟不再恒不抛（假绿）**：旧实现只给
    `createHash` / `randomBytes` / `randomInt` / `pbkdf2Sync` / `timingSafeEqual`
    建了实参域；`createHmac` / `createCipheriv` / `createDecipheriv` /
    `scryptSync` / `generateKeyPairSync`（以及新增的 `createSign` / `createVerify`）
    原生必抛的调用被判安全。现在按宿主实测建 throws 面：
    - `createHmac`：**不认识**的 digest 名 ⇒ `TypeError`
      （ERR_CRYPTO_INVALID_DIGEST）；**认识但 HMAC 用不了**的名字
      （`shake-*` / `keccak-kmac-*`，8 个）⇒ `Error`（OpenSSL 错误）——两档
      错误品牌与原生一致；合法 digest 零抛。
    - `createCipheriv` / `createDecipheriv`：未知 cipher ⇒ `Error`
      （ERR_CRYPTO_UNKNOWN_CIPHER）。
    - `createSign` / `createVerify`：不认识的 digest 名 ⇒ `TypeError`。
    - `generateKeyPairSync`（**新增成员**）：不支持的 key type ⇒ `TypeError`
      （ERR_INVALID_ARG_VALUE）；合法 type 零抛，返回域是
      `{ publicKey, privateKey }`（KeyObject 面）。
    - `scryptSync`：`keylen` 越界 ⇒ `RangeError`；`options.N` 非 2 的幂 ⇒
      `RangeError`；内存闸 `128*r*(N+p+2) > maxmem` ⇒ `RangeError`；options
      缺省槽按原生默认值（r=8 / p=1 / maxmem=32MB）判定 ⇒ 合法参数零抛。
      *已知偏差*：key / iv 的**长度**校验与 `generateKeyPairSync` 的
      `options`（`modulusLength` / `namedCurve`）域**未建模**。
  - **`node:crypto` 导出 `webcrypto`（缺口）**：宿主 `require("node:crypto")`
    自带 `webcrypto` / `subtle` / `getRandomValues` 三个自有键，env 一个都没导出
    ⇒ 这三个名走宿主路径。现在补上：`webcrypto` 是 **`Crypto` 面**
    （`subtle` / `getRandomValues` / `randomUUID`），`subtle` 与全局
    `crypto.subtle` **同源**（共用族 35 的 `subtleCryptoSlots` 一份槽表）。
  - **`node:fs` / `node:fs/promises` API 面补齐（缺口）**：`fs.openSync`
    此前**未声明** ⇒ 补上（返回 fd（number）；路径不存在 ⇒ may-throw `Error`
    （ENOENT 语义，同 fs 同步族口径）；**非法 flags 字符串** ⇒ 必抛 `TypeError`
    （ERR_INVALID_ARG_VALUE）；flags 缺省 = `"r"`）；`fs/promises` 补
    `lstat`（**与 `stat` 同一张 Stats 表**）、`statfs`（8 个数值槽）、
    `opendir`（`Dir` 面：`path` / `read` / `readSync` / `close` / `closeSync` /
    `entries`）。
  - **回归钉（已随族 35 关闭）**：`navigator.userAgent` 已是 `prim.str()`，
    node env 全局表里**没有**读出 `unknown` 的槽 ⇒ 钉成回归钉防回退。
  - **ESM 上下文全局面（141 vs 130）**：宿主实测 ESM 上下文 184 个全局，减去
    43 个 Node 内建模块命名空间 = **141**；env 声明 **130**（多出
    `__dirname` / `__filename` 两个 CJS 模块作用域名）⇒ **真实缺口是 13 个**
    （台账的「11」是 141−130 的粗算）。13 个**逐个**给出**不声明**的理由：
    `Object` / `Function` / `Proxy` / `escape` / `unescape`（es env 金标要求，
    声明会遮蔽 core 的精确语义）、`eval`（直接 eval 是语法形式）、
    `queueMicrotask` / `structuredClone` / `atob` / `btoa`（族 29 Bug 883 / 884 /
    888 金标：声明会**遮蔽宿主的 throws 面** ⇒ 反而制造假绿）、
    `URL` / `URLSearchParams`（宿主路径已同样精确，声明无收益）、
    `TextDecoder`（宿主路径比 env 面**更精确**：`utf-8` vs `string` ⇒ 声明会降
    精度）。
  - **env 覆盖基线**：`docs/reports/env-coverage-baseline.{json,md}` 用
    `scripts/env-coverage-baseline.ts` **重新生成**（未手改）。数字未变
    （node resolved 75/77、leaf-clean 69、signature-level 6、unknown 0、
    mock-required 2）——剩下的 2 条 mock-required（流机器 / 真起进程）与 6 条
    signature-level（`assert.*` / `util.*` 的**真无约束参**）都是
    `docs/design/limitations.md` 记的**设计边界**，不是缺口。
  
  **负控**：既有 env 成员的声明**逐字不变**——`node:crypto` 既有 10 个成员、
  `node:fs` / `node:fs/promises` 既有成员名单与 formatShape、以及 node env 的
  130 个全局全部不变；本次只**新增**成员（crypto 6 个 / fs 1 个 /
  fs-promises 3 个）。
- 69e67d3: Env declarations can now report that a host call throws, and can police
  the types of the arguments they are given.
  
  - `envFn` used to swallow whatever the host function threw: the `apply`
    wrapper caught every exception and returned the declared return type, so
    a declaration such as `atob("!!!")` looked like a call that never
    throws. The wrapper now returns through core's existing throws channel
    (`makeAbsApplyResult`), so a native exception is recorded as a
    may-throw at the call site, the same way a user-written `throw` is. An
    apply that returns a bare value still means "does not throw", and an
    apply that returns its own throws face keeps it.
  - The error brand of a native exception is taken from `error.name`, with
    `"Error"` as the fallback for a non-`Error` throw. Declarations whose
    host throws a brand that is not a standard error name — `atob` and
    `btoa` throw a `DOMException` named `InvalidCharacterError` — pass the
    brand explicitly through the new declaration-side `throws` option.
  - The new declaration-side `enforceArgs` option checks each argument
    against the declared parameter type before the host call happens. An
    argument that definitely does not fit makes the call throw a
    `TypeError`; an argument the engine cannot pin down (an `unknown`, an
    `any`, or a value that is not exact) makes the call possibly throw a
    `TypeError`. The check is opt-in, per declaration.
  - `envFnVariadic` accepts the same `throws` and `enforceArgs` options and
    passes them on; for a variadic declaration only the required
    parameters are checked.
  - The declaration helpers involved — `envFn`, `envFnVariadic`,
    `errBrand(name)` (builds an error-brand value) and the `EnvApplyImpl`
    apply signature — are internal to the package (`src/abs-helpers.ts`)
    and are not part of its `exports` surface: `@nudojs/env/es`, `/web` and
    `/node` export only `defineEnv` and the `EnvDefinition` type.
- 69e67d3: The web environment now describes the browser the way the browser behaves.
  
  - The browser constructors are constructible again. `Response`, `Request`,
    `Headers`, `URLSearchParams`, `EventTarget`, `Event` and `CustomEvent` are
    declared with `ctor: true`, so `new X()` no longer reports a may-throw for
    a call that the browser makes happily. `Response` used to be a plain
    object rather than a function at all, which made `new Response()` a
    definite `TypeError`; it is now a constructor whose static `json`,
    `redirect` and `error` live on the constructor itself.
  - `Request` no longer copies the whole member table of `Response`. The
    status members `ok`, `status`, `statusText`, `redirected` and `type`
    belong to `Response` only — a native `Request` has no `status` at all —
    so reading `request.status` now yields `undefined` instead of a number.
    `Request` keeps its own members (`method`, `body`, `mode`, `credentials`,
    `cache`, `redirect`, `referrer`, `referrerPolicy`, `integrity`, `signal`,
    `keepalive`, `duplex`, `destination`) and shares `bodyUsed` with
    `Response`.
  - `document` and `performance` list their members. A member the table left
    out used to read as `undefined`, and calling it was reported as a
    definite `TypeError` — on `document.getElementsByTagName`,
    `document.forms`, `document.write`, `performance.getEntries` and the
    rest. The collections read as arrays, and `performance` also exposes
    `navigation`, `serverTiming` and `timeOrigin`.
  - The global list covers the browser globals that were missing: `alert`,
    `screen`, `DOMParser`, `XMLHttpRequest`, `Worker`, `FileReader`,
    `matchMedia`, `IntersectionObserver`, `getComputedStyle`, `indexedDB` and
    `caches`. Reading an undeclared global is a `ReferenceError`, so the
    missing ones were reported on perfectly ordinary browser code.
  - `navigator.hardwareConcurrency` is declared. It used to read as
    `undefined`, which made `navigator.hardwareConcurrency > 4` fold to
    `false` without a word of complaint; it is a number now.
  - `AbortSignal.any` is declared, so combining signals no longer reads as a
    definite `TypeError`.
  - `location.searchParams` is declared, so `location.searchParams.get("q")`
    no longer reads as a definite `TypeError`; it returns `string | null`.
  - `atob`, `btoa`, `TextEncoder` and `TextDecoder` are no longer declared
    by the environment, because the host models them more precisely than the
    environment did. `atob("!!!")` used to look like a call that never
    throws; it now reports the `InvalidCharacterError` the browser raises,
    and valid base64 still folds to the exact string. `new TextDecoder` with
    an unsupported label reported a `TypeError`; it now reports the
    `RangeError` the browser raises. `TextEncoder` and `TextDecoder` are
    classes, so calling either without `new` reports the `TypeError` the
    browser raises, and calling them with `new` reports nothing.
  - `queueMicrotask` is no longer declared by the environment. The
    declaration shadowed the check that the argument is callable, so
    `queueMicrotask(1)` looked like a call that never throws; it now reports
    the `TypeError` the browser raises.
- 69e67d3: The node environment now covers the globals Node actually has, and stops
  shadowing the host built-ins it does not need to model.
  
  - The node environment used to declare 41 globals. The remaining host
    globals were unmodelled, so `new BroadcastChannel("x").name` and
    friends were cast into an empty brand: reading a member gave
    `undefined`, and reading it twice gave a definite `TypeError`. The
    environment now declares the host constructors — with their instance
    faces, and with `ctor: true` for the ones Node can actually construct
    and `ctor: false` for the ones it cannot (`AbortSignal`,
    `MessagePort`) — together with the global objects `crypto`,
    `performance` and `navigator`. Reading `crypto.randomUUID()` now gives
    a `string` instead of `unknown` plus a misleading
    `nudo:unknown-inference` diagnostic that blamed the user's code.
    Built-ins that core already models exactly (`URL`, `URLSearchParams`,
    `TextDecoder`, `Proxy`, the error and typed-array families) are still
    not declared, so their precise behaviour is not shadowed.
  - `Buffer` is a constructor now. It was declared as a plain object, so
    `new Buffer(1)` was a definite `TypeError` although Node returns a
    buffer. The static side (`from`, `alloc`, `of`, …) hangs off the
    constructor and points at the same buffer shape as the instance side.
  - The `Buffer` instance face gained `byteLength`, `buffer` and
    `byteOffset`. They used to read as `undefined` where Node reports `4`,
    an `ArrayBuffer` and `0`.
  - The three process streams (`stdin`, `stdout`, `stderr`) share one
    socket face. `process.stdout` only had `write` and `process.stdin`
    only had `on`, so `process.stdout.on("data", …)` and
    `process.stdin.setEncoding("utf8")` were definite `TypeError`s.
  - The `process` face gained twelve real members: `emitWarning`, `abort`,
    `kill`, `release`, `features`, `umask`, `getActiveResourcesInfo`,
    `resourceUsage`, `availableMemory`, `loadEnvFile`, `getBuiltinModule`
    and `constrainedMemory`. `process.features` is an open map over
    `boolean | string | undefined` values, so reading a flag no longer
    degrades to `unknown`.
  - `process.hrtime` is callable again. It was declared as an object, so
    `process.hrtime()` became `unknown` and produced a misleading
    `nudo:unknown-inference` diagnostic; it now returns a
    `[seconds, nanoseconds]` array, with `hrtime.bigint()` as a static
    member.
  - The node environment no longer declares `structuredClone` or
    `queueMicrotask`. Declaring them shadowed the host built-ins and made
    their throws face disappear, so the engine claimed calls that do throw
    never do. Both names now fall back to the host path, which keeps the
    throws face.
- 69e67d3: Node `fs` / `fs/promises` / `path` / `os` declarations now match what the
  host actually does, so the checker no longer reports calls as safe when
  the host throws, and no longer invents values the host cannot produce.
  
  - `os.cpus()` describes the whole per-CPU record. The result was missing
    the `times` member, so reading `cpus()[0].times.user` produced an exact
    `undefined` and the engine concluded the call must throw a `TypeError`.
    The record now carries `times` with `user` / `nice` / `sys` / `idle` /
    `irq`, as the host does.
  - The `node:path` family checks the types of its arguments. A path
    argument that definitely is not a string makes the call throw a
    `TypeError`, which is what the host does — `path.join(123)` and
    `path.isAbsolute(123)` both fail that way. An argument the engine
    cannot pin down makes the call possibly throw instead. A bad argument
    no longer produces a confident value either: `path.basename("/x/y.txt",
    5)` used to report the string `"y.txt"`, a name the host never returns.
    Variadic members (`join`, `resolve`) are checked across every
    argument, and the optional suffix of `basename` still accepts
    `undefined`, as the host does. `path.posix` and `path.win32` follow the
    same rules.
  - The synchronous `node:fs` members report that they may throw. The
    host throws an `Error` (with a `code` such as `ENOENT`) when a path is
    missing or a permission is denied, but the declaration claimed the call
    could never fail. The call is now marked as possibly throwing an
    `Error`; it is not marked as always throwing, because the engine
    cannot know whether the path exists. `existsSync` still never throws,
    and `rmSync` with `force: true` keeps ignoring a missing path.
  - `fs/promises` results use the same member tables as the synchronous
    family. The promise-family result was a trimmed copy, so reading
    `mtimeMs`, `nlink` or `isBlockDevice()` off it produced an exact
    `undefined` instead of the number or boolean the host returns, and
    the `Dirent` of `readdir` had no shape at all. `readdir` now also
    follows the host and returns names when `withFileTypes` is not set and
    directory entries when it is.
  - `statSync` and `fs.promises.stat` report the `undefined` the host
    returns for `throwIfNoEntry: false`. The result was declared as never
    `undefined`, so the checker reported the call as safe and went on to
    give a confident `boolean` or `number` for a member read that the host
    answers with a `TypeError`.
- 69e67d3: The node environment now models the host's real throw and value behaviour for
  its `url`, `crypto`, `child_process`, `util` and `assert` modules.
  
  - `node:url`'s `URL` and `URLSearchParams` and `node:util`'s `TextEncoder`
    and `TextDecoder` are constructors now. They are declared as plain
    functions, so `new URL("https://x.dev/a")` was reported as a call that may
    throw a `TypeError` ("new on function value of unknown constructibility")
    even though the host never throws there. The declarations now carry the
    constructor flag, and the instance faces are unchanged.
  - `node:assert` no longer claims that an assertion never fails. `ok(false)`,
    `strictEqual(1, 2)`, `deepStrictEqual({a:1},{a:2})`, `notStrictEqual(1, 1)`,
    `match("abc", /z/)` and `fail()` throw an `AssertionError` in the host, and
    the declarations now say so: an assertion that is known to fail throws an
    `AssertionError`, an assertion that is known to hold throws nothing, and an
    argument the engine cannot pin down may throw. A missing argument to
    `strictEqual` throws a `TypeError`, the way the host does.
  - `node:url`'s `fileURLToPath` no longer swallows the exception the host
    throws for an invalid URL or a non-`file:` scheme. The call is now reported
    as a call that may throw a `TypeError` instead of quietly returning a
    string.
  - `node:crypto`'s `createHash`, `randomBytes`, `randomInt`, `pbkdf2Sync` and
    `timingSafeEqual` now carry the throw the host throws for an out-of-range
    argument: an unsupported digest name throws an `Error`, an out-of-range
    size, iteration count or key length throws a `RangeError`, and two buffers
    of different lengths throw a `RangeError`.
  - `node:util`'s `promisify`, `callbackify`, `inherits` and
    `isDeepStrictEqual` take their function arguments through the apply path,
    so the argument is no longer bound as a type variable. The signatures are
    unchanged.
  - `url.pathToFileURL` returns the full URL face (eleven components plus
    `toString` and `toJSON`) instead of a one-slot `{ href }` object, so
    reading `.pathname` or `.protocol` no longer yields `undefined`, and
    reading a member of one of them no longer looks like a guaranteed
    `TypeError`.
  - `child_process.spawnSync` returns the full face of the host's result:
    `pid`, `output`, `signal`, `status`, `stdout`, `stderr` and `error`.
    Reading `.pid` no longer yields `undefined`, and reading `.output[0]` no
    longer looks like a guaranteed `TypeError`.
- 69e67d3: 族 29 修复 S5：Bug 861 · 864 · 865 —— es env 的 console 成员表补全（`timeStamp` / `dirxml` / `profile` / `profileEnd` 等缺槽读出 exact undefined ⇒ `console.timeStamp()` 假红「may throw TypeError」）、URI 族改走 core 的 `evalGlobalFn` 建模（`decodeURI("%")` 的 `URIError` 不再被吞 ⇒ L2 假绿修复，抽象实参回落声明域 + may-throw URIError）、es env 补齐 ES 规范全局声明 + service 的「已被覆盖」判定改为按 core 真实建模能力推导（`BigInt` / TypedArray 全家 / `ArrayBuffer` / `DataView` / `AggregateError` / `Function` / `escape` 等不再被报「未被 Nudo 覆盖」，与同一份报告里的精确签名自洽）。
- 69e67d3: 族 29 修复 S6：Bug 882 · Bug 890 —— node:util 品牌形参函数的普通调用面 L2
  假红 + env promise 缺 rejected 通道（catch 臂被当成死代码）。
  
  **Bug 882（core 侧根因）** — `promisify` / `callbackify` / `inherits` /
  `isDeepStrictEqual` 这类**品牌形参**函数在**具名导入**调用面
  （`import { promisify } from "node:util"` ⇒ `promisify(readFile)`）报
  `nudo:entry-may-throw`，而**成员调用**面（`util.promisify(readFile)`）正常
  ⇒ 同一函数两种口径。根因：普通调用面把**裸宿主值**（宿主函数 / 宿主构造器
  / 函数声明绑定）原样灌进 `bindTypeVars`，`arg.shape` 解引用 `undefined` ⇒
  TypeError 冒泡 ⇒ 上层记 may TypeError ⇒ L2 假红（原生必不抛）。
  
  - `packages/core/src/algebra/hof.ts` 的 `bindTypeVars`：**无形状的实参不参与
    类型变量绑定**（此前直接解引用 `arg.shape` 崩）。
  - **普通调用面也做实参归一化**（与成员调用面同款）：`hof.ts` 新增
    `setRawArgNormalizer` 注册钩子，`packages/core/src/algebra/exec/class/invoke.ts`
    在加载期注册 `asAbsVal` 门面 ⇒ 两个调用面共用同一归一化 ⇒ 同一宿主函数恒
    同一 Abs 身份 ⇒ **两种口径一致**。
  
  **Bug 890** — env 造的 promise **没有 rejected 通道** ⇒ core 读成「**确定
  fulfilled**」⇒ `catch` 臂被当成**死代码** ⇒ 引擎给出**确定的错值**（原生
  `fs/promises.readFile` / `fetch` / `crypto.subtle.digest` 都可能拒绝）。
  
  - **core 侧零改动**：`settledFulfilledOf` / `then` / `catch` / `$await` 对
    **带 `rejected` 通道**的 promise 处理已经正确（`rejected !== undefined` ⇒
    不判「确定 fulfilled」；`catch` 走「两臂 join」分支；`$await` 把拒绝臂送进
    throw 通道 ⇒ `try/catch` 可吸收 ⇒ catch 臂可达）。本分片只补回归钉。
  - **env 侧改法（`packages/env/src/abs-helpers.ts` 的 `promiseOf()`）**：给
    promise 形状补上 `rejected` 通道 ⇒ 两臂均可能 ⇒ catch 臂保持活：
  
    ```ts
    export function promiseOf(inner: Abs): Abs {
      return makeAbs(
        { k: "eff", eff: "promise", inner, rejected: unknown },
        undefined,
        undefined,
        "exact",
      );
    }
    ```
  
    （`unknown` = env 侧已有的 unknown Abs——拒绝 reason 不可知 ⇒ 两臂均可能；
    `rejected` 是**态信息**，不进 leq / 指纹 / check 等价。）
- 69e67d3: 族 29 主 agent 收口：跨分片组合出来的 4 个缺口。
  
  - **Bug 884（web 侧）**：`web.ts` 的 `structuredClone` 声明已删（node 侧同款
    修法在 `node.ts`）⇒ 回落宿主内建 ⇒ 不可克隆值的 throws 面（宿主
    `DOMException` / `DataCloneError`）不再被 env 声明整段吃掉 ⇒ L2 门禁恢复。
  - **`enforceArgs` 的并集实参过严**（S3 越界发现，主 agent 修正）：实参是**并集**
    （如 `string | undefined`）时，`leqAbs(sum, pt)` 整体判 false ⇒ 旧实现把它
    当「确定不符 ⇒ 必抛 TypeError」，而原生只在 `undefined` 分支抛 ⇒ 可能假红。
    现在**逐成员**判定：只有**全部分支**都不兼容才判必抛，部分分支不兼容判
    may-throw ⇒ 与原生同口径。
  - **Bug 886 / 889 的组合缺口**（S1 删声明 + S5 覆盖推导撞出来的）：web env 的
    `TextDecoder` 声明已删（宿主才有精确的 `RangeError` 与「类不可裸调」语义），
    但 core 的**构造面** `evalBuiltinNew` 不认 `TextDecoder` ⇒
    ① `nudo test` 报「Built-in API "TextDecoder" is not covered by Nudo's type
    inference」（假阳）；② Abs 面与 `$new` 宿主面口径分裂。现在
    `evalBuiltinNew` 补 `case "TextDecoder"` ⇒ 两侧同 builder
    （`makeTextDecoderAbs`），假阳消失。
  - **「已被覆盖」判定里的手写例外已删**（族 29 Bug 865 的根因收口）：core 其实
    已精确建模 `WeakRef`（`evalBuiltinNew` 的 `case "WeakRef"`），但三条既有
    service 契约把 `WeakRef` 当作「未被覆盖的全局」样例钉住，于是判定里留了
    一张手写例外表——那正是 Bug 865 要消灭的「手写白名单」换了个地方继续写。
    现在例外表删除，三条契约的**样例全局**换成真正未被建模的宿主全局
    `Atomics`（core 无 `Atomics` 建模面；它是 `globalThis` 里的数据属性 ⇒
    不触发访问器副作用），契约的**意图**（未建模全局要报 `builtin-unknown`、
    且不与 `unknown-global` 双报）完全保留。
- Updated dependencies [02aa122]
- Updated dependencies [6ec8afc]
- Updated dependencies [7fea13a]
- Updated dependencies [bb8e201]
- Updated dependencies [5c750f2]
- Updated dependencies [e3b8791]
- Updated dependencies [8a5bf7e]
- Updated dependencies [8542f44]
- Updated dependencies [f11510a]
- Updated dependencies [5c750f2]
- Updated dependencies [29d766d]
- Updated dependencies [e3b8791]
- Updated dependencies [e3b8791]
- Updated dependencies [6e5344a]
- Updated dependencies [f896290]
- Updated dependencies [a069994]
- Updated dependencies [7fea13a]
- Updated dependencies [8bf3fd0]
- Updated dependencies [5749924]
- Updated dependencies [0f67015]
- Updated dependencies [2d96c29]
- Updated dependencies [e3b8791]
- Updated dependencies [f6538a2]
- Updated dependencies [e3b8791]
- Updated dependencies [2af2bae]
- Updated dependencies [2af2bae]
- Updated dependencies [2af2bae]
- Updated dependencies [2af2bae]
- Updated dependencies [2af2bae]
- Updated dependencies [2af2bae]
- Updated dependencies [2af2bae]
- Updated dependencies [e424592]
- Updated dependencies [e424592]
- Updated dependencies [e424592]
- Updated dependencies [e424592]
- Updated dependencies [ec0a9e4]
- Updated dependencies [ec0a9e4]
- Updated dependencies [ec0a9e4]
- Updated dependencies [ec0a9e4]
- Updated dependencies [ec0a9e4]
- Updated dependencies [ec0a9e4]
- Updated dependencies [0366b6d]
- Updated dependencies [0366b6d]
- Updated dependencies [0366b6d]
- Updated dependencies [0366b6d]
- Updated dependencies [0366b6d]
- Updated dependencies [0366b6d]
- Updated dependencies [0366b6d]
- Updated dependencies [ec0a9e4]
- Updated dependencies [c325a10]
- Updated dependencies [c325a10]
- Updated dependencies [b37321b]
- Updated dependencies [e2880fd]
- Updated dependencies [e59c991]
- Updated dependencies [e59c991]
- Updated dependencies [e59c991]
- Updated dependencies [e59c991]
- Updated dependencies [e59c991]
- Updated dependencies [e59c991]
- Updated dependencies [3d79864]
- Updated dependencies [e2880fd]
- Updated dependencies [e2880fd]
- Updated dependencies [e2880fd]
- Updated dependencies [e2880fd]
- Updated dependencies [e2880fd]
- Updated dependencies [e2880fd]
- Updated dependencies [da4fbfc]
- Updated dependencies [da4fbfc]
- Updated dependencies [da4fbfc]
- Updated dependencies [da4fbfc]
- Updated dependencies [da4fbfc]
- Updated dependencies [da4fbfc]
- Updated dependencies [da4fbfc]
- Updated dependencies [da4fbfc]
- Updated dependencies [5dd89ca]
- Updated dependencies [97f28ed]
- Updated dependencies [97f28ed]
- Updated dependencies [97f28ed]
- Updated dependencies [97f28ed]
- Updated dependencies [97f28ed]
- Updated dependencies [97f28ed]
- Updated dependencies [e2880fd]
- Updated dependencies [5c750f2]
- Updated dependencies [4d1a249]
- Updated dependencies [af09752]
- Updated dependencies [fcaa9e9]
- Updated dependencies [7fea13a]
- Updated dependencies [9ccffb3]
- Updated dependencies [e9fdaa7]
- Updated dependencies [7fea13a]
- Updated dependencies [69e67d3]
- Updated dependencies [69e67d3]
- Updated dependencies [b0878e3]
- Updated dependencies [a069994]
- Updated dependencies [493b8c2]
- Updated dependencies [d7ae28a]
- Updated dependencies [edc7590]
- Updated dependencies [5c750f2]
- Updated dependencies [ed4d259]
- Updated dependencies [e20c128]
- Updated dependencies [abff33b]
- Updated dependencies [e3b8791]
- Updated dependencies [5c750f2]
- Updated dependencies [c80456a]
- Updated dependencies [e6c4586]
- Updated dependencies [f87c9f9]
- Updated dependencies [5c750f2]
- Updated dependencies [a3c95a4]
- Updated dependencies [e3b8791]
- Updated dependencies [7fea13a]
- Updated dependencies [d56cbd7]
- Updated dependencies [e5b3f38]
- Updated dependencies [089d4ec]
- Updated dependencies [ed4d259]
- Updated dependencies [f896290]
- Updated dependencies [169ed52]
- Updated dependencies [169ed52]
- Updated dependencies [169ed52]
- Updated dependencies [02aa122]
- Updated dependencies [f47fd50]
- Updated dependencies [5c750f2]
- Updated dependencies [d2cf3cf]
- Updated dependencies [27cc16a]
- Updated dependencies [27cc16a]
- Updated dependencies [fbca6fb]
- Updated dependencies [535adcd]
- Updated dependencies [5c750f2]
- Updated dependencies [535adcd]
- Updated dependencies [e3b8791]
- Updated dependencies [b6abab4]
- Updated dependencies [356172a]
- Updated dependencies [ebe909e]
- Updated dependencies [e3b8791]
- Updated dependencies [a069994]
- Updated dependencies [369a42d]
- Updated dependencies [29d766d]
- Updated dependencies [7fea13a]
- Updated dependencies [56f308e]
- Updated dependencies [5c750f2]
- Updated dependencies [7fd7468]
- Updated dependencies [ed4d259]
- Updated dependencies [f896290]
- Updated dependencies [ae69b28]
- Updated dependencies [5c750f2]
  - @nudojs/core@1.16.0

## 0.5.2

### Patch Changes

- Updated dependencies [4513a45]
  - @nudojs/core@1.15.2

## 0.5.1

### Patch Changes

- Updated dependencies [76dee40]
- Updated dependencies [3f3b080]
- Updated dependencies [a3a5dee]
- Updated dependencies [3338ae5]
- Updated dependencies [471ddb3]
- Updated dependencies [2ab2f46]
- Updated dependencies [babee2b]
- Updated dependencies [4c6666b]
- Updated dependencies [1fed4a4]
- Updated dependencies [70631ed]
- Updated dependencies [367ef5a]
- Updated dependencies [8dd2b50]
- Updated dependencies [725c8e4]
  - @nudojs/core@1.15.1

## 0.5.0

### Minor Changes

- 8faa2b0: **BREAKING** (runtime floor): `engines.node` raised from `>=20` to `>=22` on all published packages. Node 20 reached end-of-life on 2026-04-30, and the nightly engine-smoke matrix only covers Node 22 (the `packageManager`-pinned pnpm already requires `node:sqlite`, i.e. Node >= 22.5, to orchestrate at all). No code or API changes — installs on Node 20 will now warn per npm `engines` semantics.

### Patch Changes

- Updated dependencies [aae0f96]
- Updated dependencies [1ccff57]
- Updated dependencies [8faa2b0]
  - @nudojs/core@1.15.0

## 0.4.42

### Patch Changes

- Updated dependencies [c19bd48]
  - @nudojs/core@1.14.1

## 0.4.41

### Patch Changes

- Updated dependencies [0d9e7de]
  - @nudojs/core@1.14.0

## 0.4.40

### Patch Changes

- Updated dependencies [f5c0c6e]
  - @nudojs/core@1.13.0

## 0.4.39

### Patch Changes

- Updated dependencies [e4e491f]
- Updated dependencies [1881f97]
- Updated dependencies [1881f97]
- Updated dependencies [8466793]
  - @nudojs/core@1.12.0

## 0.4.38

### Patch Changes

- Updated dependencies [08d7a55]
  - @nudojs/core@1.11.3

## 0.4.37

### Patch Changes

- Updated dependencies [82eaae8]
  - @nudojs/core@1.11.2

## 0.4.36

### Patch Changes

- Updated dependencies [612d64f]
  - @nudojs/core@1.11.1

## 0.4.35

### Patch Changes

- Updated dependencies [cce5e58]
- Updated dependencies [16cda31]
- Updated dependencies [cce5e58]
  - @nudojs/core@1.11.0

## 0.4.34

### Patch Changes

- Updated dependencies [8806e93]
  - @nudojs/core@1.10.2

## 0.4.33

### Patch Changes

- Updated dependencies [96090cd]
  - @nudojs/core@1.10.1

## 0.4.32

### Patch Changes

- Updated dependencies [334b914]
- Updated dependencies [94197eb]
- Updated dependencies [b8db17b]
- Updated dependencies [5e275df]
  - @nudojs/core@1.10.0

## 0.4.31

### Patch Changes

- Updated dependencies [2af4016]
- Updated dependencies [2af4016]
  - @nudojs/core@1.9.4

## 0.4.30

### Patch Changes

- Updated dependencies [b6495c6]
- Updated dependencies [04a6d1d]
  - @nudojs/core@1.9.3

## 0.4.29

### Patch Changes

- Updated dependencies [c8e0417]
  - @nudojs/core@1.9.2

## 0.4.28

### Patch Changes

- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
  - @nudojs/core@1.9.1

## 0.4.27

### Patch Changes

- Updated dependencies [aeb6f7e]
  - @nudojs/core@1.9.0

## 0.4.26

### Patch Changes

- Updated dependencies [05c2c8c]
- Updated dependencies [33239da]
- Updated dependencies [3588ddd]
- Updated dependencies [c647af8]
  - @nudojs/core@1.8.0

## 0.4.25

### Patch Changes

- Updated dependencies [427da20]
- Updated dependencies [427da20]
  - @nudojs/core@1.7.10

## 0.4.24

### Patch Changes

- Updated dependencies [b14ac2d]
  - @nudojs/core@1.7.9

## 0.4.23

### Patch Changes

- Updated dependencies [58b7938]
  - @nudojs/core@1.7.8

## 0.4.22

### Patch Changes

- 92e6a5f: fix(core,env): L2 entry-may-throw 假阳性两处（issue #105 / #106）——1.3.5 的 builtin throws 语义对齐（2e5aeb35）引入的回归面：
  
  - **#105 typeof 守卫后的 any 不再记假 may-throw**：`$narrowTypeOf` 此前只剪 sum 成员，裸 `any`（无约束入口参数）在守卫事实臂原样保留 → `RegExp.exec/test(v)` 的 subject ToString 档位按 any 记 may-throw。修复：事实臂（keep=true）any 健全窄化为对应 prim（string/number/boolean/bigint/symbol，term/pred/conf 保留；补集臂与 object/function/undefined 不可表示、unknown fail-closed 令牌均保守保留）。npm-safe `parseVersion`（`typeof v !== 'string'` + `if (!m) return null` 双守卫 + 捕获组读）恢复干净。无守卫的 `exec(any)` 仍如实报（原生 `exec(Symbol())` 抛 TypeError，与 check-gold 的 scale(x) 口径一致）。
  - **#106 env 声明构造器不再报 constructibility 假抛**：env 的 Error 族声明为无名 envFn——`$new` 的按名派发（evalBuiltinNew → errorBrandAbs）拿不到名字，落到通用 fn 分支的 unknown-constructibility 门；`$class` 的 extends 门同样只见 ctor:undefined，`class ApiError extends Error` 定义期误报。修复：`envFn` 支持 `ctor` facet 并给 relationFn 路径补 `name` 盖章；Error 族 / Date / Promise / URL / AbortController / EventEmitter / stream 族声明 ctor:true（Symbol 声明 ctor:false——原生非构造器，`new Symbol()` / `extends Symbol` 仍定抛）；`$new` 的 ctor:true-无-impl 路径回落声明 returnType（保实例面精度，AbortController/EventEmitter 不丢方法槽）。`new Error('lit')` / `new TypeError('lit')` / `new ApiError(...)` / `class extends Error` 在 env 下恢复干净；`new Error(anyMsg)` 仍如实报 message ToString may-throw（node 实测 `new Error(Symbol())` 抛 TypeError，与无 env 宿主路径同口径）。
- Updated dependencies [d6fa067]
- Updated dependencies [92e6a5f]
  - @nudojs/core@1.7.7

## 0.4.21

### Patch Changes

- Updated dependencies [856d8bf]
  - @nudojs/core@1.7.6

## 0.4.20

### Patch Changes

- Updated dependencies [4c3fafd]
  - @nudojs/core@1.7.5

## 0.4.19

### Patch Changes

- Updated dependencies [0fd8e1a]
  - @nudojs/core@1.7.4

## 0.4.18

### Patch Changes

- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
  - @nudojs/core@1.7.3

## 0.4.17

### Patch Changes

- Updated dependencies [446914f]
- Updated dependencies [446914f]
- Updated dependencies [a00bccc]
- Updated dependencies [39332ca]
- Updated dependencies [446914f]
  - @nudojs/core@1.7.2

## 0.4.16

### Patch Changes

- Updated dependencies [ef514a8]
  - @nudojs/core@1.7.1

## 0.4.15

### Patch Changes

- Updated dependencies [f6ec0e8]
  - @nudojs/core@1.7.0

## 0.4.14

### Patch Changes

- Updated dependencies [2f9717b]
  - @nudojs/core@1.6.0

## 0.4.13

### Patch Changes

- Updated dependencies [64ca356]
  - @nudojs/core@1.5.0

## 0.4.12

### Patch Changes

- f10066d: fix: repository-scale bug hunt — algebra, CLI, IDE, cache, release hardening
  
  Correctness (core algebra / check):
  - `Symbol() < 1` now TypeError (cmp relational ops); `eq`/`ne` unchanged
  - bare prim contracts reject obj/arr/tuple/fn/brand/eff returns
  - `lit(undefined)` is a real literal (`LitValueResult {ok,value}` tagged path)
  - empty-sum reduce guards (DEC-006); explicit re-exports win over `export *`
  - projection fidelity: tuple holes, tuple-rest parens, schema eq-app anchoring
  
  Design refactors (additive public API):
  - `LitValueResult` + bigint in `LiteralValue`
  - `AbsApplyResult {abs,throws}` + `callTranspiledExportApply` (sole wrap point) + `$call` throws routing
  - `directive-scan` single-source extractors; directives bind AST nearest Function (nested/class/object methods)
  - `stablePathKey` / `stablePathKeyGraph` for L0/LSP/CLI/disk path identity
  
  Product / CLI / migrate:
  - `check --json` path errors enter the CheckJson envelope (`pathErrors`, `ok:false`); ok↔exit single source
  - migrate: missing paths error (no parent `package.json` fallthrough); retire is atomic with rollback; rewritten paths are single-quoted
  - malformed directives warn instead of silent drop; `@nudo:skip` requires explicit types
  
  Service / cache:
  - disk-cache atomic write + portable path keys (incl. maxForks in cache key)
  - pure memo replays may-throw; bounded memo maps; sidecar EACCES ≠ missing
  
  IDE / extension:
  - LSP path-key unify (Windows drive forms); directive diag watermark; hover follows G2 scope
  - VS Code client catches start/sendRequest; selectCase rollback
  
  Release / CI supply chain:
  - `gen-llms` confines slug writes under build root (path-escape fix)
  - gate-major: 2.x / major jumps / first 1.0.0 need `confirm_major`; 1.x train auto-publishes
  - release: quoted secrets, tag whitelist + semver precedence incl. prerelease, pinned website actions
- Updated dependencies [f10066d]
  - @nudojs/core@1.4.0

## 0.4.11

### Patch Changes

- Updated dependencies [8df9215]
  - @nudojs/core@1.3.1

## 0.4.10

### Patch Changes

- Updated dependencies [6bc08c7]
- Updated dependencies [d925692]
- Updated dependencies [c717017]
  - @nudojs/core@1.3.0

## 0.4.9

### Patch Changes

- 662aeb5: fix(env): env-declared `Number`/`Array`/`Promise`/`Date` no longer shadow away call/construct
  
  Declaring `nudo.env` (e.g. `"es"`) bound these globals as namespace-only
  `objAbs` objects. Once shadowed, `Number(x)` and `new Array(n)` found nothing
  callable/constructible and degraded to `unknown` — the opposite of the host
  identity path (no env), which folds via `GLOBAL_FNS` / `$new`'s `cls === Array`.
  
  Dual-facet globals now model both faces (issue #58 option 1):
  
  - Abs `fn` may carry static `slots` (`Number.isFinite`, `Array.isArray`, …).
    `$get` / `$in` read them; `typeof` stays `"function"`.
  - `$new` dispatches Abs constructors by name through `evalBuiltinNew`
    (Array/Date/Promise/Number/String/Boolean/Map/Set/Error), instead of only
    the Error/Promise special cases.
  - ES env declares `Number`/`Array`/`Promise`/`Date` as callable `envFn` with
    static slots and a ctor `name`, so call, construct, and statics all keep
    builtin semantics under env shadowing.
  
  `Number(s)` folds to `number`, `new Array(n)` to a holey tuple, and
  `Number.isInteger` / `Array.isArray` stay precise with `nudo.env` declared.
- Updated dependencies [662aeb5]
  - @nudojs/core@1.2.2

## 0.4.8

### Patch Changes

- 5494f67: fix(env): `Math.min` / `Math.max` / `Math.hypot` are variadic
  
  The ES env declared them as binary (`envFn([prim.num(), prim.num()], num)`), so
  `Math.min(a, b, c)` — the ordinary usage — no longer matched the arity, and the
  call degraded to `unknown`. On a real project this turned an OSA
  Damerau–Levenshtein implementation into `unknown` and failed 8 case assertions
  the moment `nudo.env` was declared.
  
  They now use `envFnVariadic(prim.num(), prim.num(), { apply: numImplVAbs(...) })`:
  any number of literal numeric args fold (`Math.min(3, 1, 2) === 1`), and
  non-literal args yield `number` instead of `unknown`.
- Updated dependencies [7b8df37]
- Updated dependencies [af8cb68]
- Updated dependencies [ff37d91]
  - @nudojs/core@1.2.1

## 0.4.7

### Patch Changes

- Updated dependencies [5ff4202]
- Updated dependencies [5ff4202]
  - @nudojs/core@1.2.0

## 0.4.6

### Patch Changes

- Updated dependencies [634932f]
  - @nudojs/core@1.1.4

## 0.4.5

### Patch Changes

- Updated dependencies [3bf9997]
  - @nudojs/core@1.1.3

## 0.4.4

### Patch Changes

- Updated dependencies [c1f3e93]
  - @nudojs/core@1.1.2

## 0.4.3

### Patch Changes

- Updated dependencies [86d1f87]
- Updated dependencies [892899d]
- Updated dependencies [faccd76]
  - @nudojs/core@1.1.1

## 0.4.2-beta.0

### Patch Changes

- Updated dependencies [22baf33]
- Updated dependencies [0e1432a]
- Updated dependencies [3c3f9d2]
- Updated dependencies
- Updated dependencies [279d73a]
  - @nudojs/core@3.0.0-beta.0

## 0.4.1

### Patch Changes

- Updated dependencies [69ebbf6]
  - @nudojs/core@2.1.0

## 0.4.0

### Minor Changes

- 9731238: **BREAKING (behavior)** `@nudojs/service`: handwritten `@nudojs/env` now **wins** over harvest / module-graph modules on overlapping module keys and export names (`mergeHarvestUnderEnv`). This is the documented B8 priority — harvest only fills missing slots — but analysis results on projects that relied on harvest overwriting a handwritten env export will change.

  Migration: remove or update the conflicting handwritten `@nudojs/env` slot if you needed harvest's version; otherwise no code change. Conflicts emit a `nudo:env-harvest-conflict` warning listing overwritten module/export names.

  Also in this service major (additive public surface, riding the required major for the priority change):

  - Public harvest helpers: `mergeHarvestUnderEnv` (optional per-call `onConflict`), `setEnvHarvestConflictCollector` (returns previous; save/restore for nested analysis), `getEnvHarvestConflictCollector`, `clearNodeHarvestCache`, `getNodeHarvestCacheSize`, `isHarvestNodeDisabled`, `HARVEST_NODE_DEFAULT_*`. Negative harvest outcomes (`not-found` / `no-dts` / `failed`) are cached in-process; `NUDO_HARVEST_NODE=off` stays explicit and uncached. `clearNodeHarvestCache()` also drops `not-found` misses so a later `@types/node` install is visible in-process. `nudo:env-harvest-conflict` warnings point at the conflicting import specifier when found (file-level `line 0` otherwise).
  - `@nudojs/env` (minor): `events` / `stream` / `querystring`; high-frequency `util` slots; **Promise APIs only under `fs.promises` / `node:fs/promises`** (callback-style `fs.readFile` etc. no longer pretend to return Promise). Optional Node params (`path.basename` ext, `url.URL` base) keep typed labels (`ext?: string`) but are **not** required slots — `requiredFnArity` skips `?` / `...`.
  - `@nudojs/core` (patch): `formatShape` renders fn rest labels (`...paths`) and optional labels (`options?`) as `...name: T` / `name?: T`. `leqAbs` fn arity uses **required** slots only (`requiredFnArity` skips `...rest` / `name?`): src is assignable to tgt iff `src.required ≤ tgt.required` (TS-like — rest src ⊑ required tgt; required src ⊭ rest tgt when src requires args). Pairwise `paramTypes` contravariance is unchanged.
  - `@nudojs/lsp` (patch): freeze inventory in `public-api.ts` (also exported as `@nudojs/lsp/public-api`); agent slash requests register from `NUDO_AGENT_TOOL_NAMES`; `selectCase` / `getActiveCases` are editor executeCommand + slash-only (not dot-form custom requests).

  Migration for env consumers who need bit-stable hover/format strings: pin `@nudojs/env` `~0.3.0` after the next release, and prefer **leaf-clean** coverage counts (empty `{  }` shapes are not leaf-clean) over raw resolved ratios.

### Patch Changes

- Updated dependencies [9731238]
  - @nudojs/core@2.0.1

## 0.3.0

### Minor Changes

- aea83f6: **BREAKING** (fix-2: close TypeScript DX gaps):

  - **C0.1 contract model:** body-AST required-slot inference removed. `nudo:arg-structure` now means HOF argument not callable / arity mismatch only. Obligations come from explicit `*.nudo.js` / `@nudo:refine` contracts or call-site facts; no evidence → any. Migration: add a sidecar shape contract where you need structure checks.
  - **A1 analysis default:** `package.json#nudo.analysis.mode` shipped default is now `exports` (was `directives`). Files with `export` / sidecar / `@nudo:` directives are analyzed by IDE/build. Escape hatch: `"mode": "directives"` (previous silence) or `"all"` (every target path). Named-path CLI commands still analyze the named file regardless of mode.

  Release notes / policy: `docs/versioning.md`. Scope defaults: `docs/design/cli-semantics.md`.

  Feature highlights (after accepting the defaults above):

  - Core algebra: Map/Set literal tracking + fork join, loop early-return fold, catch param binding, `==`/`!=` fold, logical assignment, HOF relations, class-method sidecar keys (`Class.method` / `Class_method`, local declaration name for `export { Local as Public }`)
  - Interface product: `nudo interface --draft` (code-first contracts), enforcement tiers, CJS/default/class export forms
  - IDE: LSP buffer-aware sidecars, quickfix/code actions, validate cancel + debounce, diagnostics tiers, agent/LSP parity
  - Scale: disk CheckJson cache, analysis session memo, call-site budget, watch invalidation (sidecar/config/env)
  - dts projection quality (tsc-clean HOF/unions), vite-plugin aligned to `analysis.mode`

### Patch Changes

- Updated dependencies [aea83f6]
  - @nudojs/core@2.0.0

## 0.2.5

### Patch Changes

- 61b8a6c: Fix soundness issues in Abs evaluation:

  - `parseInt` honors hex/octal/binary prefixes and explicit radix (no forced radix 10)
  - `Array.isArray` returns unknown boolean for any/unknown/sum, and sees through brand
  - `Date.now()` is an unknown number, not a folded wall-clock timestamp
  - strict numeric bounds win over non-strict at equal value (order-independent)
  - `boundsSatisfiable` no longer downgrades strict bounds via redundant ge/le
  - structural `absShapeKey` stops join/dedup collapsing distinct arrays, overloads, brands
  - `denoteGuard` renders NaN/±Infinity correctly
  - `String.split` with non-literal separator returns `arr<string>`, not a 1-tuple

- Updated dependencies [61b8a6c]
  - @nudojs/core@1.0.1

## 0.2.4

### Patch Changes

- Updated dependencies [0fd253f]
- Updated dependencies [a2aac9e]
- Updated dependencies [0f0b7d5]
- Updated dependencies [de47d84]
- Updated dependencies [78f6752]
  - @nudojs/core@1.0.0

## 0.2.3

### Patch Changes

- Updated dependencies [1d6bb01]
- Updated dependencies [1d233a7]
  - @nudojs/core@0.4.0

## 0.2.2

### Patch Changes

- df1726c: Make `@nudo:env` actually affect inference: declaration-only fnSigs (readFileSync) now become relationFns instead of unknown-on-call, B-path `$invoke` implements string methods and filters union members, and `collectAbsCallRecords` merges env modules so call@ cases no longer overwrite correct B-path results.
- bee69d4: Publish built dist instead of TypeScript source: packages now ship compiled ESM + .d.ts, CLI bin gets a shebang, `nudo --version` reads the real package version, and `nudo check` accepts multiple paths.
- Updated dependencies [21427eb]
- Updated dependencies [df1726c]
- Updated dependencies [bee69d4]
- Updated dependencies [8d85d99]
  - @nudojs/core@0.3.1

## 0.2.1

### Patch Changes

- Updated dependencies [5786fa5]
- Updated dependencies [5786fa5]
  - @nudojs/core@0.3.0

## 0.2.0

### Minor Changes

- 0fd0718: Merge the three environment packages into one: `@nudojs/env-es`, `@nudojs/env-web`, `@nudojs/env-node` are replaced by a single `@nudojs/env` package with subpath exports `@nudojs/env/es`, `@nudojs/env/web`, `@nudojs/env/node`.

  Move agent-facing tools from the standalone MCP server into the language server: `@nudojs/mcp` is removed. `@nudojs/lsp` now exposes `nudo.whatIf`, `nudo.suggestCase`, `nudo.trace`, `nudo.selectCase`, and `nudo.getActiveCases` via `workspace/executeCommand` (custom-request aliases `nudo/whatIf` etc. included), adds pull-mode diagnostics, and works on files that are not open in the editor (disk fallback). `nudo.whatIf` now actually applies the given type bindings — previously they were ignored. AI agents connect through any LSP↔MCP bridge (cclsp, mcpls, agent-lsp) or a native LSP client; an installable agent skill ships at `packages/lsp/agent-skill/SKILL.md`.
