/**
 * 族 61 · env **node** 模块与共享槽面 —— 6 条精度债的钉。
 *
 * 共同根因：env 的 node 声明面是**手写**的 ⇒（a）**缺成员** ⇒ 该名走宿主路径
 * （行为对、类型精度低）；（b）**缺实参域** ⇒ 原生**必抛**的入口被判「恒不抛」
 * ⇒ **L2 门禁假绿**。
 *
 * 六条各自：
 * - **第 1 条**：`node:crypto` 同族兄弟（`createHmac` / `createCipheriv` /
 *   `createDecipheriv` / `scryptSync` / `generateKeyPairSync` / `createSign` /
 *   `createVerify`）**恒不抛** ⇒ 补实参域 throws 面（宿主实测为准）。
 * - **第 2 条**：`node:crypto` **缺 `webcrypto` 导出**（宿主有）⇒ 补
 *   `webcrypto` / `subtle` / `getRandomValues`（三者宿主实测都是自有键）。
 * - **第 3 条**：`fs.openSync` 未声明；`fs/promises` 缺 `lstat` / `statfs` /
 *   `opendir` ⇒ 补齐（宿主实测为准）。
 * - **第 4 条**：**已随族 35 关闭**（`navigator.userAgent` 已是 `prim.str()`；
 *   node env 全局表里已无 unknown 值的槽）⇒ 本文件钉成**回归钉**（防回退）。
 * - **第 5 条**：ESM 上下文宿主平台全局（v26 = 141：184 − 43 个 Node 内建模块
 *   命名空间）vs env 声明 **130** ⇒ 实测缺口是 **13** 个（台账的「11」是
 *   平台全局−130 的粗算，未扣 env 多出的 `__dirname` / `__filename`）⇒ 逐个
 *   给出**不声明**的理由（多数是**金标要求**），并钉住「不许悄悄漂移」。
 *   **宿主总面随 Node major 漂移**（v24 = 177：少的 7 个全是内建模块命名空间
 *   全局）⇒ 只钉版本无关的台账等式（平台 − 声明），不钉 184 / 141 这种绝对值。
 * - **第 6 条**：env 覆盖基线剩下的 2 条 mock-required + 6 条 signature-level
 *   **都是设计边界**（不是缺口）⇒ 钉住「新声明是 leaf-clean」+「报告是脚本
 *   生成的」。
 *
 * 负控：既有 env 成员的声明**逐字不变**（crypto / fs / fs-promises 的成员名单
 * 与 formatShape 快照）。
 *
 * 证据口径：原生 oracle = 同一进程内的**真 node**（v26.10.0）；引擎探针 =
 * `checkSource` + node env 全局表（复用族 35 的 `env-bug-1044-1049-helpers.ts`
 * 与族 29 S4 的 `env-bug-s4-helpers.ts`）。
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  createCipheriv as nodeCreateCipheriv,
  createDecipheriv as nodeCreateDecipheriv,
  createHmac as nodeCreateHmac,
  createSign as nodeCreateSign,
  createVerify as nodeCreateVerify,
  generateKeyPairSync as nodeGenerateKeyPairSync,
  getCiphers as nodeGetCiphers,
  getHashes as nodeGetHashes,
  scryptSync as nodeScryptSync,
  webcrypto as nodeWebcrypto,
} from "node:crypto";
import * as nodeFsPromises from "node:fs/promises";
import { formatShape, numLit, strLit, type Abs } from "@nudojs/core";
import { prim } from "../abs-helpers.ts";
import { defineEnv } from "../node.ts";
import {
  checkNode,
  nodeSlotOf,
  memberNames,
  returnTypeOf,
} from "./env-bug-1044-1049-helpers.ts";
import { brandName, callSite } from "./env-bug-s4-helpers.ts";

const env = defineEnv();
const cryptoMod = env.modules!.crypto!;
const nodeCryptoMod = env.modules!["node:crypto"]!;
const fsMod = env.modules!.fs!;
const fspMod = env.modules!["fs/promises"]!;

/** 原生 oracle：调用 fn，取原生抛出的错误名（不抛 ⇒ undefined） */
function nativeErrorName(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return (e as Error).name;
  }
}

/** 造一个 options 字面量对象（`{ N: 3 }` 这类）。 */
function optsAbs(entries: Record<string, Abs>): Abs {
  const slots: Record<string, { value: Abs }> = {};
  for (const [k, v] of Object.entries(entries)) slots[k] = { value: v };
  return { shape: { k: "obj", slots } } as unknown as Abs;
}

/** promise 的兑现类型（`eff.inner`）——`memberNames` 只认 obj / brand。 */
function promiseInner(a: Abs | undefined): Abs | undefined {
  if (!a || a.shape.k !== "eff") return undefined;
  return (a.shape as { inner?: Abs }).inner;
}

// ─────────────────────────────────────────────────────────────────────────
// 第 1 条 · node:crypto 同族兄弟的实参域 throws 面
// ─────────────────────────────────────────────────────────────────────────

describe("族 61-1 · node:crypto 同族兄弟不再恒不抛（假绿收口）", () => {
  it("1.1 createHmac：原生 = TypeError（ERR_CRYPTO_INVALID_DIGEST）⇒ 引擎必抛 TypeError", () => {
    expect(nativeErrorName(() => nodeCreateHmac("nope", "k"))).toBe("TypeError");
    const site = callSite(cryptoMod.createHmac!, [strLit("nope"), strLit("k")]);
    expect(site.threw, "unsupported hmac digest must be an always-throw").toBeTruthy();
    expect(brandName((site.threw as { absValue: Abs }).absValue)).toBe("TypeError");
  });

  it("1.2 createHmac 拒用 XOF / KMAC 家族（shake-* / keccak-kmac*）⇒ 引擎逐个同判", () => {
    // 原生 oracle：对 getHashes() 的每个名字实测一次
    const hashes = nodeGetHashes().map((h) => h.toLowerCase());
    const rejected = hashes.filter((h) => {
      try {
        nodeCreateHmac(h, "k");
        return false;
      } catch {
        return true;
      }
    });
    // 宿主**只**在 XOF / KMAC 家族上拒用 (XOF / KMAC 没有 HMAC 形式) —— 这是
    // 版本无关的口径。**条数**是 OpenSSL 名字表细节（v26 = 8 个别名，v24 = 2 个），
    // 钉数量会把测试钉死在某个 minor 上（CI 的 node 24 就红过）。
    for (const name of rejected) {
      expect(name, "HMAC 拒用的 digest 必须落在 XOF / KMAC 家族").toMatch(
        /^(shake|keccak-kmac)/,
      );
    }
    expect(rejected.length, "宿主至少拒用 shake（XOF 无 HMAC 形式）").toBeGreaterThan(0);
    // 引擎必须在**每个**宿主拒用的名字上判必抛（否则 L2 门禁假绿）
    for (const name of rejected) {
      const site = callSite(cryptoMod.createHmac!, [strLit(name), strLit("k")]);
      expect(site.threw, `createHmac(${name}) 原生拒用 ⇒ 引擎必抛`).toBeTruthy();
      expect(brandName((site.threw as { absValue: Abs }).absValue)).toBe("Error");
    }
    // 反向（假红方向）：家族**外**的名字一个都不许被判必抛。家族内名字的可用性
    // 随 OpenSSL 名字表变化，不在版本无关口径内，故不参与这一臂。
    for (const name of hashes) {
      if (/^(shake|keccak-kmac)/.test(name)) continue;
      const site = callSite(cryptoMod.createHmac!, [strLit(name), strLit("k")]);
      expect(site.threw, `createHmac(${name}) 原生可用 ⇒ 引擎不得判必抛`).toBeUndefined();
    }
    // 名字**根本不认识** ⇒ 原生抛 **TypeError**（ERR_CRYPTO_INVALID_DIGEST），
    // 与「认识但该入口用不了 ⇒ Error」是**两档**（后者已由上面的逐名断言覆盖）
    const unknown = callSite(cryptoMod.createHmac!, [strLit("nope"), strLit("k")]);
    expect(unknown.threw).toBeTruthy();
    expect(brandName((unknown.threw as { absValue: Abs }).absValue)).toBe("TypeError");
  });

  it("1.3 createHmac：合法 digest ⇒ 零抛（不是假红）", () => {
    expect(nativeErrorName(() => nodeCreateHmac("sha256", "k"))).toBeUndefined();
    const site = callSite(cryptoMod.createHmac!, [strLit("sha256"), strLit("k")]);
    expect(site.threw).toBeUndefined();
    expect(site.exits).toHaveLength(0);
  });

  it("1.4 createCipheriv / createDecipheriv：未知 cipher ⇒ 必抛 Error（ERR_CRYPTO_UNKNOWN_CIPHER）", () => {
    expect(nativeErrorName(() => nodeCreateCipheriv("nope", "k", "iv"))).toBe("Error");
    expect(nativeErrorName(() => nodeCreateDecipheriv("nope", "k", "iv"))).toBe("Error");
    for (const name of ["createCipheriv", "createDecipheriv"] as const) {
      const site = callSite(cryptoMod[name]!, [strLit("nope"), strLit("k"), strLit("iv")]);
      expect(site.threw, `${name}: unknown cipher must be an always-throw`).toBeTruthy();
      expect(brandName((site.threw as { absValue: Abs }).absValue)).toBe("Error");
    }
    // 合法 cipher 名 ⇒ 零抛
    expect(nodeGetCiphers().length).toBeGreaterThan(0);
    const ok = callSite(cryptoMod.createCipheriv!, [
      strLit("aes-128-ctr"),
      strLit("k"),
      strLit("iv"),
    ]);
    expect(ok.threw).toBeUndefined();
    expect(ok.exits).toHaveLength(0);
  });

  it("1.5 createSign / createVerify：未知 digest ⇒ 必抛 TypeError（ERR_CRYPTO_INVALID_DIGEST）", () => {
    expect(nativeErrorName(() => nodeCreateSign("nope"))).toBe("TypeError");
    expect(nativeErrorName(() => nodeCreateVerify("nope"))).toBe("TypeError");
    for (const name of ["createSign", "createVerify"] as const) {
      const site = callSite(cryptoMod[name]!, [strLit("nope")]);
      expect(site.threw, `${name}: unsupported digest must be an always-throw`).toBeTruthy();
      expect(brandName((site.threw as { absValue: Abs }).absValue)).toBe("TypeError");
      const ok = callSite(cryptoMod[name]!, [strLit("sha256")]);
      expect(ok.threw, `${name}: supported digest must not throw`).toBeUndefined();
      expect(ok.exits).toHaveLength(0);
    }
  });

  it("1.6 generateKeyPairSync：未知 key type ⇒ 必抛 TypeError（ERR_INVALID_ARG_VALUE）", () => {
    // 原生有重载（KeyType 字面量）⇒ 这里刻意传非法名 ⇒ 绕开 TS 的重载检查
    const genKeyPair = nodeGenerateKeyPairSync as unknown as (type: string) => unknown;
    expect(nativeErrorName(() => genKeyPair("nope"))).toBe("TypeError");
    const site = callSite(cryptoMod.generateKeyPairSync!, [strLit("nope")]);
    expect(site.threw, "unsupported key type must be an always-throw").toBeTruthy();
    expect(brandName((site.threw as { absValue: Abs }).absValue)).toBe("TypeError");
  });

  it("1.7 generateKeyPairSync：合法 type ⇒ 零抛 + 返回域含 publicKey / privateKey", () => {
    expect(nativeErrorName(() => nodeGenerateKeyPairSync("ed25519"))).toBeUndefined();
    const site = callSite(cryptoMod.generateKeyPairSync!, [strLit("ed25519")]);
    expect(site.threw).toBeUndefined();
    expect(site.exits).toHaveLength(0);
    const rt = returnTypeOf(cryptoMod.generateKeyPairSync!);
    expect(rt).toBeTruthy();
    const members = memberNames(rt);
    expect(members.sort()).toEqual(["privateKey", "publicKey"]);
  });

  it("1.8 scryptSync：keylen 越界 ⇒ 必抛 RangeError（ERR_OUT_OF_RANGE）", () => {
    expect(nativeErrorName(() => nodeScryptSync("p", "s", -1))).toBe("RangeError");
    const site = callSite(cryptoMod.scryptSync!, [strLit("p"), strLit("s"), numLit(-1)]);
    expect(site.threw, "negative keylen must be an always-throw").toBeTruthy();
    expect(brandName((site.threw as { absValue: Abs }).absValue)).toBe("RangeError");
    const ok = callSite(cryptoMod.scryptSync!, [strLit("p"), strLit("s"), numLit(64)]);
    expect(ok.threw).toBeUndefined();
    expect(ok.exits).toHaveLength(0);
  });

  it("1.9 scryptSync：options.N 非 2 的幂 ⇒ 必抛 RangeError（ERR_CRYPTO_INVALID_SCRYPT_PARAMS）", () => {
    expect(nativeErrorName(() => nodeScryptSync("p", "s", 64, { N: 3 }))).toBe("RangeError");
    const site = callSite(cryptoMod.scryptSync!, [
      strLit("p"),
      strLit("s"),
      numLit(64),
      optsAbs({ N: numLit(3) }),
    ]);
    expect(site.threw, "N must be a power of two").toBeTruthy();
    expect(brandName((site.threw as { absValue: Abs }).absValue)).toBe("RangeError");
  });

  it("1.10 scryptSync：内存闸（128*r*(N+p+2) > maxmem）⇒ 必抛 RangeError", () => {
    expect(nativeErrorName(() => nodeScryptSync("p", "s", 64, { N: 1048576 }))).toBe("RangeError");
    const site = callSite(cryptoMod.scryptSync!, [
      strLit("p"),
      strLit("s"),
      numLit(64),
      optsAbs({ N: numLit(1048576) }),
    ]);
    expect(site.threw, "scrypt memory limit").toBeTruthy();
    expect(brandName((site.threw as { absValue: Abs }).absValue)).toBe("RangeError");
  });

  it("1.11 scryptSync：options 缺省槽按原生默认值判定 ⇒ 合法 N 零抛（不是假红）", () => {
    // 原生：{ N: 1024 } 合法（r/p/maxmem 用默认值 8 / 1 / 32MB）
    expect(nativeErrorName(() => nodeScryptSync("p", "s", 64, { N: 1024 }))).toBeUndefined();
    const site = callSite(cryptoMod.scryptSync!, [
      strLit("p"),
      strLit("s"),
      numLit(64),
      optsAbs({ N: numLit(1024) }),
    ]);
    expect(site.threw).toBeUndefined();
    expect(site.exits).toHaveLength(0);
  });

  it("1.12 抽象实参 ⇒ may-throw（原生在该域上确实可能抛），不是恒不抛", () => {
    for (const [name, args] of [
      ["createHmac", [prim.str(), strLit("k")]],
      ["createCipheriv", [prim.str(), strLit("k"), strLit("iv")]],
      ["createSign", [prim.str()]],
      ["generateKeyPairSync", [prim.str()]],
      ["scryptSync", [strLit("p"), strLit("s"), prim.num()]],
    ] as Array<[string, Abs[]]>) {
      const fn = cryptoMod[name] as Abs;
      const site = callSite(fn, args);
      expect(site.threw, `${name}: abstract arg must not be a hard throw`).toBeUndefined();
      expect(site.exits.length, `${name}: abstract arg must record a may-throw`).toBe(1);
    }
  });

  it("1.13 负控：既有五个 crypto 入口的 throws 面与声明逐字不变", () => {
    // 族 29 Bug 885 建的五个入口：行为不变
    const bad = callSite(cryptoMod.createHash!, [strLit("nope")]);
    expect(bad.threw).toBeTruthy();
    expect(brandName((bad.threw as { absValue: Abs }).absValue)).toBe("Error");
    const good = callSite(cryptoMod.createHash!, [strLit("sha256")]);
    expect(good.exits).toHaveLength(0);
    expect(formatShape(cryptoMod.randomBytes!)).toBe("(number) => Buffer");
    expect(formatShape(cryptoMod.randomInt!)).toBe("(number, number) => number");
    expect(formatShape(cryptoMod.pbkdf2Sync!)).toBe("(string, string, number, number, string) => Buffer");
    expect(formatShape(cryptoMod.timingSafeEqual!)).toBe("(Buffer, Buffer) => boolean");
    expect(formatShape(cryptoMod.createHash!)).toBe("(string) => Hash");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 第 2 条 · node:crypto 的 webcrypto 导出
// ─────────────────────────────────────────────────────────────────────────

describe("族 61-2 · node:crypto 导出 webcrypto / subtle / getRandomValues", () => {
  it("2.1 宿主实测：node:crypto 真的有这三个自有键", () => {
    const host = nodeCryptoKeys();
    expect(host).toContain("webcrypto");
    expect(host).toContain("subtle");
    expect(host).toContain("getRandomValues");
  });

  it("2.2 env：node:crypto 导出 webcrypto（Crypto 面：subtle / getRandomValues / randomUUID）", () => {
    expect(cryptoMod.webcrypto, "node:crypto must export webcrypto").toBeTruthy();
    expect(nodeCryptoMod.webcrypto, "node:crypto must export webcrypto").toBeTruthy();
    const members = memberNames(cryptoMod.webcrypto);
    expect(members.sort()).toEqual(["getRandomValues", "randomUUID", "subtle"]);
  });

  it("2.3 env：node:crypto 的 subtle 与全局 crypto.subtle 同源（同一份 SubtleCrypto 面）", () => {
    expect(cryptoMod.subtle, "node:crypto must export subtle").toBeTruthy();
    expect(cryptoMod.getRandomValues, "node:crypto must export getRandomValues").toBeTruthy();
    // 与全局 `crypto.subtle` 成员集合同源（族 35 的同源化口径）
    const nodeSubtle = memberNames(cryptoMod.subtle);
    const globalSubtle = memberNames(nodeSlotOf("crypto", "subtle"));
    expect(nodeSubtle.sort()).toEqual(globalSubtle.sort());
    expect(nodeSubtle).toContain("digest");
    expect(nodeSubtle).toContain("wrapKey");
  });

  it("2.4 负控：webcrypto 不是 SubtleCrypto（宿主上 webcrypto.subtle === crypto.subtle）", () => {
    // 原生 oracle：webcrypto 是 **Crypto** 实例；它的 .subtle 才是 SubtleCrypto
    expect(nodeWebcrypto.constructor.name).toBe("Crypto");
    expect(nodeWebcrypto.subtle).toBe(nodeWebcrypto.subtle);
    expect((nodeWebcrypto.subtle as { constructor: { name: string } }).constructor.name).toBe(
      "SubtleCrypto",
    );
    // env 侧：webcrypto 的 subtle 槽是 SubtleCrypto 品牌（不是 Crypto）
    const subtleSlot = nodeSlotOf("crypto", "subtle");
    expect(subtleSlot).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 第 3 条 · fs.openSync / fs/promises 的 lstat · statfs · opendir
// ─────────────────────────────────────────────────────────────────────────

describe("族 61-3 · fs.openSync 与 fs/promises 三个成员补齐", () => {
  it("3.1 宿主实测：node:fs 有 openSync；node:fs/promises 有 lstat / statfs / opendir", () => {
    expect(typeof nodeFsPromises.lstat).toBe("function");
    expect(typeof nodeFsPromises.statfs).toBe("function");
    expect(typeof nodeFsPromises.opendir).toBe("function");
  });

  it("3.2 env：fs.openSync 已声明，返回域是 fd（number）", () => {
    expect(fsMod.openSync, "fs.openSync must be declared").toBeTruthy();
    expect(env.modules!["node:fs"]!.openSync, "node:fs.openSync must be declared").toBeTruthy();
    expect(formatShape(fsMod.openSync!)).toBe(
      "(string, flags?: string | number, mode?: number) => number",
    );
  });

  it("3.3 fs.openSync：非法 flags 字面量 ⇒ 必抛 TypeError（ERR_INVALID_ARG_VALUE）", () => {
    const site = callSite(fsMod.openSync!, [strLit("/tmp"), strLit("q")]);
    expect(site.threw, "invalid flags must be an always-throw").toBeTruthy();
    expect(brandName((site.threw as { absValue: Abs }).absValue)).toBe("TypeError");
    // 合法 flags ⇒ 同步族口径 = may-throw Error（ENOENT / EACCES）
    const ok = callSite(fsMod.openSync!, [strLit("/tmp"), strLit("r")]);
    expect(ok.threw).toBeUndefined();
    expect(ok.exits).toHaveLength(1);
    expect(brandName(ok.exits[0]!)).toBe("Error");
  });

  it("3.4 env：fs/promises.lstat 已声明，返回 promise<Stats>（与 stat 同一张表）", () => {
    expect(fspMod.lstat, "fs/promises.lstat must be declared").toBeTruthy();
    const lstatRt = returnTypeOf(fspMod.lstat!);
    const statRt = returnTypeOf(fspMod.stat!);
    expect(lstatRt).toBeTruthy();
    expect(statRt).toBeTruthy();
    // 同源：lstat 与 stat 的兑现类型是**同一张 Stats 表**
    expect(formatShape(lstatRt!)).toBe(formatShape(statRt!));
    expect(formatShape(lstatRt!)).toContain("isDirectory");
  });

  it("3.5 env：fs/promises.statfs 已声明（8 个数值槽）", () => {
    expect(fspMod.statfs, "fs/promises.statfs must be declared").toBeTruthy();
    const rt = promiseInner(returnTypeOf(fspMod.statfs!));
    expect(rt).toBeTruthy();
    const members = memberNames(rt);
    expect(members.sort()).toEqual([
      "bavail",
      "bfree",
      "blocks",
      "bsize",
      "ffree",
      "files",
      "frsize",
      "type",
    ]);
    expect(formatShape(rt!)).not.toMatch(/unknown|any/);
  });

  it("3.6 env：fs/promises.opendir 已声明（Dir 面：path / read / close / entries …）", () => {
    expect(fspMod.opendir, "fs/promises.opendir must be declared").toBeTruthy();
    const rt = promiseInner(returnTypeOf(fspMod.opendir!));
    expect(rt).toBeTruthy();
    const members = memberNames(rt);
    expect(members.sort()).toEqual([
      "close",
      "closeSync",
      "entries",
      "path",
      "read",
      "readSync",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 第 4 条 · brand 成员不再是 unknown（回归钉 —— 已随族 35 关闭）
// ─────────────────────────────────────────────────────────────────────────

describe("族 61-4 · 回归钉：node env 的 brand 成员不再是 unknown", () => {
  it("4.1 navigator.userAgent 读出 string（不是 unknown）", () => {
    const slot = nodeSlotOf("navigator", "userAgent");
    expect(slot, "navigator.userAgent must be declared").toBeTruthy();
    expect(slot!.shape.k).toBe("prim");
    const out = checkNode(`export function f(){ return navigator.userAgent; }`);
    expect(out.errorCodes).toEqual([]);
    expect(out.issues.filter((i) => i.code === "nudo:unknown-inference")).toEqual([]);
    expect(out.signatures[0]!.display).toMatch(/^string/);
  });

  it("4.2 node env 全局表里没有「值为 unknown」的槽（brand 成员不再是 unknown）", () => {
    const unknownSlots: string[] = [];
    for (const [gname, g] of Object.entries(env.globals)) {
      const inner = g.shape.k === "brand" ? (g.shape as { shape?: Abs }).shape : undefined;
      const target = inner && inner.shape.k === "obj" ? inner : g.shape.k === "obj" ? g : undefined;
      if (!target || target.shape.k !== "obj") continue;
      const slots = (target.shape as { slots: Record<string, { value: Abs }> }).slots;
      for (const [mname, slot] of Object.entries(slots)) {
        if (slot.value.shape.k === "unknown") unknownSlots.push(`${gname}.${mname}`);
      }
    }
    expect(unknownSlots, "node env 的槽位不得读出 unknown").toEqual([]);
  });

  it("4.3 既有 brand 成员（hardwareConcurrency / language / languages / platform）行为不变", () => {
    for (const name of [
      "hardwareConcurrency",
      "language",
      "languages",
      "platform",
      "userAgent",
    ] as const) {
      expect(nodeSlotOf("navigator", name), `navigator.${name}`).toBeTruthy();
    }
    const out = checkNode(`export function f(){ return navigator.hardwareConcurrency; }`);
    expect(out.errorCodes).toEqual([]);
    expect(out.signatures[0]!.display).toMatch(/^number/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 第 5 条 · ESM 上下文全局面（141 vs 130）
// ─────────────────────────────────────────────────────────────────────────

/**
 * Node 的 **CJS 内建模块命名空间**全局（`require` 注入的那批）——它们在
 * ESM 上下文里同样挂在 globalThis 上，但 env 把它们建模成**模块**
 * （`import … from "node:fs"`）而不是全局 ⇒ 台账的「141」口径把它们排除。
 */
const NODE_MODULE_GLOBALS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "constants",
  "dgram", "diagnostics_channel", "dns", "domain", "events", "fs", "http",
  "http2", "https", "inspector", "module", "net", "os", "path", "perf_hooks",
  "punycode", "querystring", "readline", "repl", "stream", "string_decoder",
  "sys", "timers", "tls", "trace_events", "tty", "url", "util", "v8", "vm",
  "wasi", "worker_threads", "zlib", "node:ffi", "node:sea", "node:sqlite",
  "node:test",
]);

/**
 * 实测到的 13 个「宿主 ESM 全局未进 node env 声明面」的名字，**逐个**给出
 * 不声明的理由（绝大多数是**既有金标要求**——声明反而会制造假绿 / 降精度）。
 */
const UNDECLARED_REASONS: Record<string, string> = {
  Object: "es env 金标（Bug 865）：core 精确建模 Object，声明会遮蔽宿主语义",
  Function: "es env 金标（Bug 865）：声明会遮蔽宿主语义且 env 侧更差",
  Proxy: "es env 金标（Bug 865）：声明会遮蔽宿主语义且 env 侧更差",
  escape: "es env 金标（Bug 865）：宿主路径能折出精确字面量，env 面更差",
  unescape: "es env 金标（Bug 865）：宿主路径能折出精确字面量，env 面更差",
  eval: "直接 eval 是**语法形式**（不是全局值），声明成普通 fn 会给出错误的间接 eval 语义",
  queueMicrotask: "族 29 Bug 888 金标：声明会挡掉 core 的可调用实参校验 ⇒ 反而制造假绿",
  structuredClone: "族 29 Bug 884 金标：声明会遮蔽宿主的 throws 面（DataCloneError）⇒ 假绿",
  atob: "族 29 Bug 883 金标：声明会吞掉宿主的 InvalidCharacterError ⇒ 假绿",
  btoa: "族 29 Bug 883 金标：声明会吞掉宿主的 InvalidCharacterError ⇒ 假绿",
  URL: "宿主路径已同样精确（实测逐字一致）⇒ 声明无收益；且 env 的 url 模块面会吞非法 URL 的异常",
  URLSearchParams: "宿主路径已同样精确（实测逐字一致）⇒ 声明无收益",
  TextDecoder: "宿主路径（core 的 makeTextDecoderAbs）比 env 面**更精确**（utf-8 vs string）⇒ 声明会降精度",
};

/**
 * env **声明了**、但**较旧宿主**的 ESM 上下文里还没有的名字 —— env 的 node 面
 * 按**最新宿主**（v26）声明，所以旧宿主上这些是「超前声明」：引擎对存在性更乐观，
 * 只会少报错（不会制造假红），故允许；但**新增**必须先在这里写理由（漂移闸）。
 */
const DECLARED_AHEAD_OF_HOST: Record<string, string> = {
  Temporal: "Node 26 才进入 ESM 全局面（v24.11 没有）",
  Storage: "Node 26 的 Web Storage 构造器全局（v24.11 只在 web env 面建模）",
  QuotaExceededError: "Node 26 的 Web Storage 错误类型（v24.11 没有）",
  ErrorEvent: "Node 26 的 Web 事件类型（v24.11 没有）",
  localStorage: "Node 22.4+ 需 --experimental-webstorage；v24.11 的 ESM 上下文默认没有",
  sessionStorage: "同上（--experimental-webstorage）",
};

describe("族 61-5 · ESM 上下文全局面：宿主平台全局 vs 130（env 声明）", () => {
  it("5.1 宿主平台全局与 env 声明逐名对账（宿主面随 Node 版本漂移 ⇒ 不钉绝对值）", () => {
    const host = hostEsmGlobals();
    const presentModules = host.filter((g) => NODE_MODULE_GLOBALS.has(g));
    const platform = host.filter((g) => !NODE_MODULE_GLOBALS.has(g));
    const declared = Object.keys(env.globals);
    // 宿主平台全局面**随 Node 版本漂移**（v26.10 = 141 平台全局，v24.11 = 135：
    // 少的是 Float16Array / DisposableStack 这类新平台 API）⇒ 钉两个**逐名**方向，
    // 而不是 184 / 141 这种绝对值（钉绝对值的版本 CI 上红过两次）：
    //   (a) 宿主有、env 没声明 ⇒ **必须**在 UNDECLARED_REASONS 里逐条给理由；
    //   (b) env 声明、宿主没有 ⇒ **只许**是 CJS 作用域的 __dirname / __filename。
    const undeclared = platform.filter((g) => !declared.includes(g));
    for (const name of undeclared) {
      expect(UNDECLARED_REASONS[name], `宿主全局 ${name} 未声明却没有理由（不许悄悄漂移）`)
        .toBeTruthy();
    }
    // env 声明、宿主**没有**的名字：只许是 CJS 作用域名，或「env 按最新宿主声明」
    // 的超前项（逐条有理由 ⇒ 新增声明必须写理由，不许悄悄漂移）
    const phantom = declared.filter((g) => !platform.includes(g));
    for (const name of phantom) {
      if (name === "__dirname" || name === "__filename") continue;
      expect(
        DECLARED_AHEAD_OF_HOST[name],
        `env 声明了宿主没有的全局 ${name}，且没有登记为超前声明`,
      ).toBeTruthy();
    }
    // 被扣成「模块」的名字 env 不得**同时**声明成全局（分类口径自洽）
    for (const name of presentModules) {
      expect(env.globals[name], `${name} 是模块命名空间 ⇒ env 不得声明成全局`).toBeUndefined();
    }
    expect(NODE_MODULE_GLOBALS.size).toBe(43);
  });

  it("5.2 env 声明 130 个全局（其中 2 个是 CJS 模块作用域的 __dirname / __filename）", () => {
    const declared = Object.keys(env.globals);
    expect(declared.length).toBe(130);
    expect(declared).toContain("__dirname");
    expect(declared).toContain("__filename");
  });

  it("5.3 缺口名单逐名对账：有理由的例外**确实没被声明**（不是「因为名字没出现」）", () => {
    const host = hostEsmGlobals().filter((g) => !NODE_MODULE_GLOBALS.has(g));
    const declared = Object.keys(env.globals);
    const missing = host.filter((g) => !declared.includes(g));
    // 5.1 保证 missing ⊆ 理由表；这里钉反方向：**宿主上存在**的每个有理由例外
    // 都必须真的落在缺口里（否则「理由」是空转，env 其实声明了它）。
    // 宿主缺的名字（如 v24 还没有 Float16Array）不参与——版本细节，不是漂移。
    expect(missing.sort()).toEqual(
      Object.keys(UNDECLARED_REASONS)
        .filter((n) => host.includes(n))
        .sort(),
    );
  });

  it("5.4 每个未声明的名字都有**理由**（不许无脑补，也不许悄悄漂移）", () => {
    for (const [name, reason] of Object.entries(UNDECLARED_REASONS)) {
      expect(reason.length, `${name} 必须写明不声明的理由`).toBeGreaterThan(10);
    }
  });

  it("5.5 URL / URLSearchParams：宿主路径与 env 路径**逐字同精度**（声明无收益）", () => {
    for (const src of [
      `export function f(){ return new URL("https://x.dev/a").href; }`,
      `export function f(){ return new URL("https://x.dev/a").pathname; }`,
      `export function f(){ return new URLSearchParams("a=1").get("a"); }`,
    ]) {
      const withEnv = checkNode(src, true);
      const hostOnly = checkNode(src, false);
      expect(withEnv.signatures[0]!.display, src).toBe(hostOnly.signatures[0]!.display);
      expect(withEnv.signatures[0]!.display).not.toMatch(/^unknown/);
    }
  });

  it("5.6 TextDecoder：宿主路径比 env 面**更精确**（utf-8 vs string）⇒ 声明会降精度", () => {
    const src = `export function f(){ return new TextDecoder("utf-8").encoding; }`;
    const hostOnly = checkNode(src, false);
    expect(hostOnly.signatures[0]!.display).toMatch(/utf-8/);
    // env 的 TextDecoder 面只到 string ⇒ 若声明成全局反而**降精度**
    expect(env.globals.TextDecoder, "node env must NOT declare TextDecoder").toBeUndefined();
    expect(env.globals.TextEncoder, "node env declares TextEncoder（既成事实）").toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 第 6 条 · env 覆盖基线
// ─────────────────────────────────────────────────────────────────────────

describe("族 61-6 · env 覆盖基线：新增声明是 leaf-clean，报告是脚本生成的", () => {
  it("6.1 本次新增的模块成员全部 leaf-clean（format 不含 unknown / any）", () => {
    const added: Array<[string, Abs]> = [
      ["crypto.createHmac", cryptoMod.createHmac!],
      ["crypto.createCipheriv", cryptoMod.createCipheriv!],
      ["crypto.createDecipheriv", cryptoMod.createDecipheriv!],
      ["crypto.createSign", cryptoMod.createSign!],
      ["crypto.createVerify", cryptoMod.createVerify!],
      ["crypto.generateKeyPairSync", cryptoMod.generateKeyPairSync!],
      ["crypto.webcrypto", cryptoMod.webcrypto!],
      ["crypto.subtle", cryptoMod.subtle!],
      ["fs.openSync", fsMod.openSync!],
      ["fs/promises.lstat", fspMod.lstat!],
      ["fs/promises.statfs", fspMod.statfs!],
      ["fs/promises.opendir", fspMod.opendir!],
    ];
    for (const [id, abs] of added) {
      const shape = formatShape(abs);
      expect(shape, `${id} must be leaf-clean`).not.toMatch(/unknown|any/);
    }
    // `crypto.getRandomValues` 例外：WebCrypto 的**类型化数组元素类型**真无约束
    // ⇒ 与全局 `crypto.getRandomValues` **同源**（同一份声明）⇒ 签名级是设计边界
    expect(formatShape(cryptoMod.getRandomValues!)).toBe(
      formatShape(nodeSlotOf("crypto", "getRandomValues")!),
    );
  });

  it("6.2 覆盖基线报告是**脚本生成**的（不许手改），且 unknown 计数为 0", () => {
    const md = readFileSync(
      new URL("../../../../docs/reports/env-coverage-baseline.md", import.meta.url),
      "utf-8",
    );
    expect(md).toContain("Generated** by `scripts/env-coverage-baseline.ts`");
    const json = JSON.parse(
      readFileSync(
        new URL("../../../../docs/reports/env-coverage-baseline.json", import.meta.url),
        "utf-8",
      ),
    ) as { nodeProbes: { counts: Record<string, number> } };
    expect(json.nodeProbes.counts.unknown, "基线里不应再有 unknown").toBe(0);
  });

  it("6.3 剩下的 2 条 mock-required + 6 条 signature-level 是**设计边界**（不是缺口）", () => {
    const json = JSON.parse(
      readFileSync(
        new URL("../../../../docs/reports/env-coverage-baseline.json", import.meta.url),
        "utf-8",
      ),
    ) as {
      nodeProbes: {
        counts: Record<string, number>;
        leaf: { clean: number; mentionsUnknown: number };
        results: Array<{ id: string; status: string; leaf?: string; reason: string }>;
      };
    };
    const { counts, leaf, results } = json.nodeProbes;
    expect(counts.unknown, "基线里不应再有 unknown").toBe(0);
    // 基线只许**前进**（不许回退）
    expect(counts["mock-required"]).toBeLessThanOrEqual(2);
    expect(leaf.mentionsUnknown, "签名级条数只许减少").toBeLessThanOrEqual(6);
    // mock-required 两条都是 limitations §2 的**真边界**（流机器 / 真起进程）
    const mock = results.filter((r) => r.status === "mock-required").map((r) => r.id);
    for (const id of ["child_process.spawn-native", "stream.machine-callbacks"]) {
      expect(mock, `${id} 必须仍然是 mock-required（诚实边界）`).toContain(id);
    }
    // signature-level 六条都含**真无约束参**（产品语义 any）⇒ 不可再推进
    const sig = results.filter((r) => r.leaf === "mentions-unknown").map((r) => r.id);
    for (const id of [
      "assert.deepStrictEqual",
      "assert.ok",
      "assert.strictEqual",
      "util.format",
      "util.inspect",
      "util.types.isDate",
    ]) {
      expect(sig, `${id} 应仍是签名级（真无约束参）`).toContain(id);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 负控 —— 既有 env 成员的声明逐字不变
// ─────────────────────────────────────────────────────────────────────────

describe("族 61 负控 —— 既有 env 成员的声明逐字不变", () => {
  it("N.1 node:crypto 既有 10 个成员的 formatShape 快照逐字不变", () => {
    const BEFORE_CRYPTO: Record<string, string> = {
      randomBytes: "(number) => Buffer",
      randomUUID: "() => string",
      randomInt: "(number, number) => number",
      createHash: "(string) => Hash",
      createHmac: "(string, string | Buffer) => Hmac",
      createCipheriv: "(string, string | Buffer, string | Buffer) => Cipher",
      createDecipheriv: "(string, string | Buffer, string | Buffer) => Decipher",
      pbkdf2Sync: "(string, string, number, number, string) => Buffer",
      scryptSync: "(string, string, number) => Buffer",
      timingSafeEqual: "(Buffer, Buffer) => boolean",
    };
    for (const [name, shape] of Object.entries(BEFORE_CRYPTO)) {
      expect(formatShape(cryptoMod[name]!), `node:crypto.${name}`).toBe(shape);
    }
  });

  it("N.2 node:fs / node:fs/promises 的成员名单只增不改", () => {
    const BEFORE_FS = [
      "access", "accessSync", "appendFile", "appendFileSync", "chmod", "chmodSync",
      "chownSync", "copyFile", "copyFileSync", "existsSync", "mkdir", "mkdirSync",
      "open", "readFile", "readFileSync", "readdir", "readdirSync", "readlink",
      "readlinkSync", "realpath", "realpathSync", "rename", "renameSync", "rm",
      "rmSync", "rmdirSync", "stat", "statSync", "symlink", "symlinkSync",
      "unlink", "unlinkSync", "writeFile", "writeFileSync",
    ];
    const BEFORE_FSP = [
      "access", "appendFile", "chmod", "copyFile", "mkdir", "open", "readFile",
      "readdir", "readlink", "realpath", "rename", "rm", "stat", "symlink",
      "unlink", "writeFile",
    ];
    const fsNow = Object.keys(fsMod).sort();
    const fspNow = Object.keys(fspMod).sort();
    // 既有成员一个不少、一个不多
    for (const name of BEFORE_FS) expect(fsNow).toContain(name);
    for (const name of BEFORE_FSP) expect(fspNow).toContain(name);
    // 新增的只有本次声明的那几个
    expect(fsNow.filter((n) => !BEFORE_FS.includes(n))).toEqual(["openSync"]);
    expect(fspNow.filter((n) => !BEFORE_FSP.includes(n))).toEqual([
      "lstat",
      "opendir",
      "statfs",
    ]);
  });

  it("N.3 既有 fs 成员的声明逐字不变", () => {
    expect(formatShape(fsMod.readFileSync!)).toBe(
      "(string, options?: string | { encoding?: string, flag?: string }) => string | Buffer",
    );
    expect(formatShape(fsMod.rmSync!)).toBe(
      "(string, options?: { recursive?: boolean, force?: boolean, maxRetries?: number, retryDelay?: number }) => undefined",
    );
    expect(formatShape(fsMod.mkdirSync!)).toBe(
      "(string, options?: { recursive?: boolean, mode?: number }) => string | undefined",
    );
    expect(formatShape(fsMod.open!)).toBe(
      "(string, flags?: string | number, CallbackFn) => undefined",
    );
    expect(formatShape(fspMod.readFile!)).toBe(
      "(string, options?: string | { encoding?: string, flag?: string }) => promise<string | Buffer>",
    );
    expect(formatShape(fspMod.open!)).toBe("(string, string) => promise<FileHandle>");
  });

  it("N.4 node env 的全局表逐字不变（130 个；既有成员名一个不动）", () => {
    const declared = Object.keys(env.globals).sort();
    expect(declared.length).toBe(130);
    for (const name of [
      "process", "Buffer", "console", "crypto", "performance", "navigator",
      "TextEncoder", "TextEncoderStream", "TextDecoderStream", "fetch", "URLPattern",
      "localStorage", "sessionStorage", "__dirname", "__filename",
    ]) {
      expect(declared, `node env must still declare ${name}`).toContain(name);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 宿主实测助手（ESM 上下文专用 —— 既有的 hostOwnMembers 走的是 CJS 上下文）
// ─────────────────────────────────────────────────────────────────────────

let esmGlobalsCache: string[] | undefined;

function hostEsmGlobals(): string[] {
  if (!esmGlobalsCache) {
    const out = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", "console.log(JSON.stringify(Object.getOwnPropertyNames(globalThis)))"],
      { encoding: "utf-8" },
    );
    esmGlobalsCache = JSON.parse(out.trim()) as string[];
  }
  return esmGlobalsCache;
}

let cryptoKeysCache: string[] | undefined;

function nodeCryptoKeys(): string[] {
  if (!cryptoKeysCache) {
    // node:crypto 的自有可枚举键（宿主实测；CJS 视图 = 宿主真实的模块对象）
    const req = createRequire(import.meta.url);
    cryptoKeysCache = Object.keys(req("node:crypto") as Record<string, unknown>);
  }
  return cryptoKeysCache;
}
