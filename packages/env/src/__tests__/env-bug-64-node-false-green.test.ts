/**
 * 族 64 · env **node** 面的 4 处假绿 / 口径不一致（收尾片）。
 *
 * 共同根因：env 的 node 声明面是**手写**的 ⇒（a）**类**被声明成普通 fn 面 ⇒
 * 裸调**恒不抛**（原生必抛）⇒ **L2 门禁假绿**；（b）apply 的 catch 分支
 * **吞掉**原生异常 ⇒ 恒不抛；（c）成员面与宿主不一致（多声明 / 少声明）；
 * （d）拒绝 reason 与**宿主实现**不同源。
 *
 * 四条：
 * - **第 1 条** · 全局 `TextEncoder`：原生是 **class**（裸调必抛 TypeError；
 *   宿主实测 v26.10.0：`TextEncoder()` ⇒ TypeError "Class constructor
 *   TextEncoder cannot be invoked without 'new'"），env 却声明成普通 fn 面 ⇒
 *   裸调恒不抛（假绿）。修法：**在 env 侧声明成类值**（core 的 Bug 272 判据：
 *   `ctor: true` + 单一 rest 形参 `"_rest"` ⇒ `isClassValueCallee` 命中 ⇒ 裸调
 *   定抛 TypeError，**与原生同形**）；`apply` 返回**声明实例面** ⇒
 *   `new TextEncoder()` 的实例面（encoding / encode / encodeInto）**不丢**
 *   （删声明回落宿主的话会退成 `undefined`——那是**确定的错值**，宿主真值
 *   是 "utf-8"）。
 * - **第 2 条** · `node:url` 的 `URL`：apply 的 catch 分支 `return undefined`
 *   ⇒ 非法 URL 被静默吞掉（恒不抛）⇒ 套 **Bug 881**（fileURLToPath）同款
 *   范式：非法 URL ⇒ 记 **TypeError** throws 面；抽象实参 ⇒ 原生可能抛 ⇒
 *   同样记 may-throw TypeError。
 * - **第 3 条** · `util` / `querystring` 的 `escape` / `unescape`：**宿主实测**
 *   `require("node:util").escape === undefined`（util **没有**这两个成员）、
 *   `require("node:querystring").escape` 是函数（querystring **有**）⇒ env 的
 *   querystring 面与宿主一致，util 面也**没有**多声明 ⇒ **无需改动**（钉住）。
 * - **第 4 条** · `crypto.subtle` 的拒绝 reason：**宿主实测** node 的 WebCrypto
 *   与浏览器**不同**——node 的拒绝 reason ∈ {NotSupportedError, TypeError,
 *   OperationError, DataError}（**从不是** OperationError 唯一值）⇒ 按
 *   `promiseOf` 的契约（reason 必须是**全部**拒绝路径的公共上界，否则是
 *   wrong-exact）node env 的 reason 必须保持 **`unknown`** ⇒ **保持现状**
 *   （钉住 + 说明跨 env 不同源是**宿主事实**，不是缺陷）。
 *
 * 负控：族 61 的 **130** 个全局 + `node:crypto` / `node:fs` 成员名单
 * **逐字不变**。
 *
 * 证据口径：原生 oracle = 同一进程内的**真 node**（v26.10.0）；引擎探针 =
 * `checkSource` + node env 全局表（复用族 35 的
 * `env-bug-1044-1049-helpers.ts` 与族 29 S4 的 `env-bug-s4-helpers.ts`）。
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { $new, formatShape, strLit, type Abs } from "@nudojs/core";
import { runWithMayThrowSession, setMayThrowCollector } from "@nudojs/core/internal";
import { prim } from "../abs-helpers.ts";
import { defineEnv } from "../node.ts";
import { defineEnv as defineWebEnv } from "../web.ts";
import {
  checkNode,
  memberNames,
  nodeSlotOf,
  returnTypeOf,
  slotOfAbs,
} from "./env-bug-1044-1049-helpers.ts";
import { brandName, callSite } from "./env-bug-s4-helpers.ts";

const env = defineEnv();
const webEnv = defineWebEnv();
const urlMod = env.modules!.url!;
const utilMod = env.modules!.util!;
const qsMod = env.modules!.querystring!;
const cryptoMod = env.modules!.crypto!;

/** 原生 oracle：调用 fn，取原生抛出的错误名（不抛 ⇒ undefined） */
function nativeErrorName(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return (e as Error).name;
  }
}

/** promise 的拒绝 reason（`eff.rejected`）；非 promise ⇒ undefined */
function rejectedReason(a: Abs | undefined): Abs | undefined {
  if (!a || a.shape.k !== "eff") return undefined;
  return (a.shape as { rejected?: Abs }).rejected;
}

// ─────────────────────────────────────────────────────────────────────────
// 第 1 条 · 全局 TextEncoder：类语义（裸调必抛 TypeError）
// ─────────────────────────────────────────────────────────────────────────

describe("族 64-1 · 全局 TextEncoder 是 class（裸调必抛 TypeError，不再恒不抛）", () => {
  it("1.1 裸调 TextEncoder() ⇒ 必抛 TypeError（env 路与宿主路同口径）", () => {
    // 原生 oracle（宿主实测）：class 裸调必抛 TypeError
    // TS 的 lib 类型把 TextEncoder 声明成「只能 new」⇒ 裸调走 unknown 侧的强转
    expect(nativeErrorName(() => (TextEncoder as unknown as () => unknown)())).toBe("TypeError");

    const envPath = checkNode(`export function f(){ return TextEncoder(); }`, true);
    const hostPath = checkNode(`export function f(){ return TextEncoder(); }`, false);
    // env 路：与宿主路**同形**（never throws TypeError）
    expect(envPath.signatures[0]!.display).toBe("never throws TypeError");
    expect(hostPath.signatures[0]!.display).toBe("never throws TypeError");
    // L2 门禁不再假绿：入口 may-throw 报错
    expect(envPath.errorCodes).toContain("nudo:entry-may-throw");
    expect(hostPath.errorCodes).toContain("nudo:entry-may-throw");
  });

  it("1.2 new TextEncoder() ⇒ 不假红 + 实例面不丢（encoding 仍是 string）", () => {
    const out = checkNode(`export function f(){ return new TextEncoder().encoding; }`, true);
    expect(out.signatures[0]!.display, "env 面的实例面必须保留").toBe("string");
    expect(out.issues, "new TextEncoder() 原生不抛 ⇒ 零诊断").toEqual([]);
    // 负控：删声明回落宿主 ⇒ 走**宿主建模**的 TextEncoder 实例面。
    //
    // 旧负控钉的是「回落宿主 ⇒ encoding 退成 undefined（**确定的错值**）」——
    // 那时宿主路**没有** TextEncoder 的实例面建模（成员读折 exact undefined）。
    // **BUG-160**（`tmp/bug-report/sections/BUG-160.md` §期望 vs 实际）已声明
    // 宿主路的正确行为：「`TextEncoder` 的实例面 = `encoding`（只读访问器，
    // 恒 `"utf-8"`）+ `encode` / `encodeInto`（方法）⇒ **成员读不得折
    // undefined**」（宿主实测 `new TextEncoder().encoding === "utf-8"`）。
    // ⇒ 「退成 undefined」这个前提已被 BUG-160 推翻：宿主路现在也拿得到
    // **真值** `"utf-8"`（env 声明面给的是放宽的 `string`，宿主建模给的是
    // 精确字面量 `"utf-8"`）⇒ 负控改钉宿主路的**真值**，不再钉已被
    // BUG-160 判死的「假值 undefined」。
    const hostOut = checkNode(`export function f(){ return new TextEncoder().encoding; }`, false);
    expect(hostOut.signatures[0]!.display).toBe('"utf-8"');
  });

  it("1.3 类值声明：ctor:true + 单一 rest 形参（core 的 Bug 272 判据）", () => {
    const te = env.globals.TextEncoder!;
    expect(te.shape.k).toBe("fn");
    const shape = te.shape as { ctor?: boolean; params?: string[]; returnType?: Abs };
    expect(shape.ctor, "类值必须带 ctor:true").toBe(true);
    expect(shape.params, "类值判据 = 单一 rest 形参 \"_rest\"").toEqual(["_rest"]);
    // 实例面完整（encoding / encode / encodeInto）
    const instance = shape.returnType!;
    expect(memberNames(instance).sort()).toEqual(["encode", "encodeInto", "encoding"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 第 2 条 · node:url 的 URL：非法 URL 不再被吞
// ─────────────────────────────────────────────────────────────────────────

describe("族 64-2 · node:url 的 URL：非法 URL 不再被静默吞掉（记 TypeError throws 面）", () => {
  it("2.1 非法 URL ⇒ 有 TypeError throws 面（旧实现恒不抛）", () => {
    // 原生 oracle：new URL("not a url") ⇒ TypeError（Invalid URL）
    expect(nativeErrorName(() => new URL("not a url"))).toBe("TypeError");

    const site = callSite(urlMod.URL!, [strLit("not a url")]);
    expect(site.threw, "may-throw 不是硬抛").toBeUndefined();
    expect(site.exits).toHaveLength(1);
    expect(brandName(site.exits[0]!)).toBe("TypeError");
  });

  it("2.2 抽象实参 ⇒ 原生可能抛 ⇒ 同样有 TypeError throws 面", () => {
    const site = callSite(urlMod.URL!, [prim.str()]);
    expect(site.threw).toBeUndefined();
    expect(site.exits).toHaveLength(1);
    expect(brandName(site.exits[0]!)).toBe("TypeError");
  });

  it("2.3 合法 URL ⇒ 零抛 + 字面量 href（字面量精度不回归）", () => {
    const site = callSite(urlMod.URL!, [strLit("https://x.dev/a")]);
    expect(site.threw).toBeUndefined();
    expect(site.exits).toHaveLength(0);
    const slots = (site.value!.shape as { slots: Record<string, { value: Abs }> }).slots;
    const term = slots.href!.value.term as { op?: string; value?: unknown };
    expect(term.op).toBe("lit");
    expect(term.value).toBe("https://x.dev/a");
  });

  it("2.4 已知偏差（core 侧 A 类债）：$new 丢弃 apply 的 throws 面 ⇒ new URL(非法) 仍恒不抛", () => {
    // core 的 `$new` 只取 AbsApplyResult 的 `abs`（throws 面被丢）⇒ env 层
    // 无法表达「构造期必抛」⇒ 记为 core 侧架构债。此钉记录**现状**，待 core
    // 修复后改写。
    const mayThrows: { kind: string; cause?: string }[] = [];
    const value = runWithMayThrowSession(() => {
      setMayThrowCollector((e) => mayThrows.push({ kind: e.kind, cause: e.cause }));
      return $new(urlMod.URL!, [strLit("not a url")]);
    });
    expect(value, "new URL(非法) 当前不抛（core 侧债）").toBeTruthy();
    expect(mayThrows, "$new 路径当前丢弃 throws 面").toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 第 3 条 · util / querystring 的 escape / unescape：与宿主一致
// ─────────────────────────────────────────────────────────────────────────

describe("族 64-3 · util 没有 escape / unescape（querystring 有）——与宿主一致", () => {
  it("3.1 宿主实测：util.escape / util.unescape 是 undefined；querystring 的两个都在", () => {
    const req = createRequire(import.meta.url);
    const util = req("node:util") as Record<string, unknown>;
    const qs = req("node:querystring") as Record<string, unknown>;
    expect(util.escape, "宿主：util 没有 escape").toBeUndefined();
    expect(util.unescape, "宿主：util 没有 unescape").toBeUndefined();
    expect(typeof qs.escape, "宿主：querystring 有 escape").toBe("function");
    expect(typeof qs.unescape, "宿主：querystring 有 unescape").toBe("function");
  });

  it("3.2 env 的 util 面没有多声明 escape / unescape（≡ 宿主没有 ⇒ 读出 undefined）", () => {
    // 宿主：`require("node:util").escape === undefined`；`import { escape } from
    // "node:util"` 在宿主是 SyntaxError（没有该导出）⇒ env 的 util 面**不声明**
    // 这两个成员才是与宿主同口径（多声明会让该 import 变成"有"⇒ 偏宽松）。
    expect(Object.keys(utilMod)).not.toContain("escape");
    expect(Object.keys(utilMod)).not.toContain("unescape");
    expect(Object.keys(utilMod).sort()).toEqual([
      "TextDecoder", "TextEncoder", "callbackify", "deprecate", "format",
      "inherits", "inspect", "isDeepStrictEqual", "promisify", "types",
    ]);
  });

  it("3.3 env 的 querystring 面声明了 escape / unescape（≡ 宿主有）", () => {
    expect(Object.keys(qsMod).sort()).toEqual(["escape", "parse", "stringify", "unescape"]);
    expect(formatShape(qsMod.escape!)).toBe("(string) => string");
    expect(formatShape(qsMod.unescape!)).toBe("(string) => string");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 第 4 条 · crypto.subtle 的拒绝 reason：node 侧必须 unknown
// ─────────────────────────────────────────────────────────────────────────

describe("族 64-4 · crypto.subtle 的拒绝 reason：node 宿主实测 ⇒ unknown（不是 wrong-exact 的 OperationError）", () => {
  const SUBTLE_MEMBERS = [
    "digest",
    "encrypt",
    "decrypt",
    "sign",
    "verify",
    "generateKey",
    "deriveKey",
    "deriveBits",
    "wrapKey",
    "unwrapKey",
    "exportKey",
    "importKey",
  ];

  it("4.1 宿主实测：node 的 crypto.subtle 拒绝 reason 不止一种（从不是 OperationError 唯一值）", async () => {
    const { webcrypto } = await import("node:crypto");
    const names = new Set<string>();
    const probes: Array<() => Promise<unknown>> = [
      () => webcrypto.subtle.digest("bogus-algo", new Uint8Array([1])),
      () => (webcrypto.subtle.digest as unknown as () => Promise<unknown>)(),
      () =>
        (webcrypto.subtle.encrypt as unknown as (
          a: unknown,
          b: unknown,
        ) => Promise<unknown>)({ name: "bogus" }, new Uint8Array([1])),
      () => webcrypto.subtle.generateKey({ name: "bogus" }, false, ["sign"]),
      () =>
        (webcrypto.subtle.importKey as unknown as (
          a: unknown,
          b: unknown,
          c: unknown,
          d: unknown,
          e: unknown,
        ) => Promise<unknown>)(
          "raw",
          new Uint8Array([1]),
          { name: "bogus" },
          false,
          ["sign"],
        ),
    ];
    for (const p of probes) {
      try {
        await p();
      } catch (e) {
        names.add((e as Error).name);
      }
    }
    // node 的 WebCrypto 与浏览器**不同**：不支持的算法 ⇒ NotSupportedError，
    // 实参不对 ⇒ TypeError，密钥长度不对 ⇒ OperationError，导入格式不对 ⇒
    // DataError ⇒ **没有**单一 reason 可折 ⇒ 只能是 unknown。
    expect(names.size, "node 的拒绝 reason 集合必须不止一种").toBeGreaterThan(1);
    expect(names.has("OperationError"), "node 从不是 OperationError 唯一值").toBe(false);
  });

  it("4.2 node env 的 crypto.subtle 各成员拒绝 reason = unknown（诚实值）", () => {
    for (const member of SUBTLE_MEMBERS) {
      const fn = nodeSlotOf("crypto", "subtle", member);
      expect(fn, `node env 必须声明 crypto.subtle.${member}`).toBeTruthy();
      const reason = rejectedReason(returnTypeOf(fn));
      expect(reason, `crypto.subtle.${member} 必须有 rejected 面`).toBeTruthy();
      expect(
        reason!.shape.k,
        `crypto.subtle.${member} 的 reason 必须是 unknown（node 的拒绝 reason 不止一种）`,
      ).toBe("unknown");
    }
  });

  it("4.3 web env 的 crypto.subtle = OperationError（浏览器口径）⇒ 跨 env 不同源是宿主事实", () => {
    // web env 逐声明给 OperationError（WebCrypto Level 1/2：浏览器的**唯一**
    // 拒绝 reason）；node 的实现不同（见 4.1）⇒ 两个 env 的 reason **本就**
    // 不同源——不是缺陷，是宿主事实。
    const webCrypto = webEnv.globals.crypto!;
    const webSubtle = slotOfAbs(webCrypto, "subtle")!;
    for (const member of SUBTLE_MEMBERS) {
      const fn = slotOfAbs(webSubtle, member);
      expect(fn, `web env 必须声明 crypto.subtle.${member}`).toBeTruthy();
      const reason = rejectedReason(returnTypeOf(fn));
      expect(reason, `web crypto.subtle.${member} 必须有 rejected 面`).toBeTruthy();
      if (member === "importKey") {
        // importKey 可能以 DataError / NotSupportedError 拒绝（不止一种）⇒ unknown
        expect(reason!.shape.k).toBe("unknown");
      } else {
        expect(reason!.shape.k).toBe("brand");
        expect((reason!.shape as { name: string }).name).toBe("OperationError");
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 负控 —— 族 61 的既有声明逐字不变
// ─────────────────────────────────────────────────────────────────────────

describe("族 64 负控 —— 族 61 的既有声明逐字不变", () => {
  it("N.1 node env 的全局表仍是 130 个（成员名一个不动）", () => {
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

  it("N.2 node:crypto / node:fs / node:fs/promises 的成员名单不变", () => {
    expect(Object.keys(cryptoMod).sort()).toEqual([
      "createCipheriv", "createDecipheriv", "createHash", "createHmac", "createSign",
      "createVerify", "generateKeyPairSync", "getRandomValues", "pbkdf2Sync",
      "randomBytes", "randomInt", "randomUUID", "scryptSync", "subtle",
      "timingSafeEqual", "webcrypto",
    ]);
    const fsMod = env.modules!.fs!;
    expect(Object.keys(fsMod).sort()).toEqual([
      "access", "accessSync", "appendFile", "appendFileSync", "chmod", "chmodSync",
      "chownSync", "copyFile", "copyFileSync", "existsSync", "mkdir", "mkdirSync",
      "open", "openSync", "readFile", "readFileSync", "readdir", "readdirSync",
      "readlink", "readlinkSync", "realpath", "realpathSync", "rename", "renameSync",
      "rm", "rmSync", "rmdirSync", "stat", "statSync", "symlink", "symlinkSync",
      "unlink", "unlinkSync", "writeFile", "writeFileSync",
    ]);
    const fspMod = env.modules!["fs/promises"]!;
    expect(Object.keys(fspMod).sort()).toEqual([
      "access", "appendFile", "chmod", "copyFile", "lstat", "mkdir", "open",
      "opendir", "readFile", "readdir", "readlink", "realpath", "rename", "rm",
      "stat", "statfs", "symlink", "unlink", "writeFile",
    ]);
  });

  it("N.3 既有成员的 formatShape 快照逐字不变", () => {
    expect(formatShape(cryptoMod.createHash!)).toBe("(string) => Hash");
    expect(formatShape(cryptoMod.randomUUID!)).toBe("() => string");
    expect(formatShape(env.modules!.path!.join!)).toBe("(string, ...paths: string) => string");
  });
});
