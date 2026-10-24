---
"@nudojs/env": patch
---

fix(env): node env 的模块面与共享槽面对齐宿主实测（族 61 · 6 条）

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
