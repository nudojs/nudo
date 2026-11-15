/**
 * 模块套件：宿主标准库面（Buffer/crypto/text/atob/uri/structuredClone/iterable）。
 */
import { describe, it, expect } from "vitest";
import { type Abs, checkSource, pTrue, formatShape, numLit, strLit, resetGeneralizeMemo, type AbsModuleExports } from "@nudojs/core";
import { checkWeb, displayOf, slotOf, webEnvGlobals } from "./env-helpers-s1.ts";
import { checkNode, hostOwnMembers, hostProtoMembers, instanceFaceOf, memberNames, nodeSlotOf, returnTypeOf, staticSlotOf, slotOfAbs } from "./env-member-tables-helpers.ts";
import { defineEnv, defineEnv as defineNodeEnv } from "../node.ts";
import { execFileSync } from "node:child_process";
import { envMember } from "./env-helpers-s3.ts";
import { createHash as nodeCreateHash, pbkdf2Sync as nodePbkdf2Sync, randomBytes as nodeRandomBytes, randomInt as nodeRandomInt, timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";
import { prim } from "../abs-helpers.ts";
import { brandName, callSite } from "./env-helpers-s4.ts";
import { defineEnv as defineWebEnv } from "../web.ts";
import { defineEnv as defineEnv_____es_ts } from "../es.ts";

// ---------------------------------------------------------------------------
// node env 的静态 `Response.json` 返回域是 `Response`（不是 promise）
// ---------------------------------------------------------------------------
describe("node env 的静态 `Response.json` 返回域是 `Response`（不是 promise）", () => {
/**
 * 族 35 · —— env 成员表对齐（node / web 两 env）。
 *
 * 共同根因：env 的成员表是**手写**的 ⇒（a）**缺**成员 ⇒ 闭 obj 缺槽 ⇒ 成员读出
 * **exact `undefined`**（确定的错值）⇒ 调用即「确定抛 TypeError」⇒ **L2 门禁假红**
 * （1047 / 1048 / 1049）；（b）**写错返回域** ⇒ 宿主必抛的调用被判安全 ⇒ **L2 门禁
 * 假绿**（1044）。
 *
 * 四条各自的病灶（族 35 之前从未被任何批次处理过）：
 * - 1044：`packages/env/src/node.ts` 的 `Response` **静态面** `json` 返回域写成
 * `promise<unknown>`（WHATWG Fetch / undici：静态 `Response.json` **同步**返回
 * `Response`）；同表 `error` / `redirect` 都返回 `Response` ⇒ 表内不自洽。
 * - 1047：node env 的 `performance` 表只有 9 个槽，缺宿主真实存在的 6 个
 * （`toJSON` / `clearResourceTimings` / `eventLoopUtilization` / `timerify` /
 * `setResourceTimingBufferSize` / `nodeTiming`）；web env 同一对象早已补过前两个
 * （）⇒ 两 env 不对称。
 * - 1048：node env 的 `navigator` 表缺 `locks`（Web Locks API，W3C 标准）⇒
 * `navigator.locks` 读出 exact `undefined`，`navigator.locks.request(...)` 判
 * 「确定抛 TypeError」。
 * - 1049：web env 的 `crypto.subtle` 表只有 8 个键，缺 4 个标准 WebCrypto API
 * （`deriveKey` / `deriveBits` / `wrapKey` / `unwrapKey`）；node env 同一对象
 * 早已声明前两个 ⇒ 两 env 自相矛盾。
 *
 * 修法：补齐缺失成员（**只补宿主实测存在的**）+ 宿主实测护栏（真 node 跑
 * `Object.getOwnPropertyNames` 对照 env 表）+ 同名对象两 env 同源。
 *
 * 负控：宿主**没有**的成员仍被判「确定缺失」⇒ 证明没有把整张表改成全放行。
 */





// ── 宿主实测排除项（每条都有理由；护栏 = 宿主成员 − 排除项 ⊆ env 表）──────

/**
 * `performance` 原型面上**不建模**的宿主成员：
 * - `markResourceTiming`：宿主上以非法 cache 名调用**必抛**
 * （`cache must be an empty string or 'local'`）⇒ 不是「普通可调用成员」。
 * - `onresourcetimingbufferfull`：事件回调**属性**（宿主上是 null），不是方法。
 */
const PERFORMANCE_EXCLUDED = ["markResourceTiming", "onresourcetimingbufferfull"];

/**
 * `crypto.subtle` 原型面上**不建模**的宿主成员：node 后期量子（PQ）扩展
 * （`getPublicKey` / `encapsulate*` / `decapsulate*`）——**非 WebCrypto 标准**
 * ⇒ 浏览器没有；node env 本次也不建模（超出 的标准 API 范围）
 * ⇒ 记为已知偏差（见报告）。
 */
const SUBTLE_EXCLUDED = [
  "getPublicKey",
  "encapsulateBits",
  "encapsulateKey",
  "decapsulateBits",
  "decapsulateKey",
];

/** 构造器函数元属性（全宿主均匀未建模，不追踪）。 */
const CTOR_META = ["length", "name", "prototype"];

/** 宿主护栏：宿主实测成员名（减去显式排除项）必须 ⊆ env 表成员名。 */
function expectHostCovered(host: string[], env: string[], excluded: string[], label: string) {
  const missing = host.filter((m) => !env.includes(m) && !excluded.includes(m));
  expect(missing, `${label}：宿主实测成员必须在 env 表里声明`).toEqual([]);
}

/** fn 形的静态面槽名（ctor 的 `shape.slots`）。 */
function staticSlotNames(fn: Abs | undefined): string[] {
  if (!fn || fn.shape.k !== "fn") return [];
  return Object.keys((fn.shape as { slots?: Record<string, unknown> }).slots ?? {});
}

describe("node env 的静态 `Response.json` 返回域是 `Response`（不是 promise）", () => {
  it("静态 `Response.json` 的返回域是 brand `Response`，且不是 promise", () => {
    const rt = returnTypeOf(staticSlotOf("Response", "json"));
    expect(rt, "Response.json 必须声明返回域").toBeTruthy();
    expect(rt!.shape.k).toBe("brand");
    expect((rt!.shape as { name: string }).name).toBe("Response");
    // 不是 promise（旧的错声明就是 promise<unknown>）
    expect(rt!.shape.k === "eff" && (rt!.shape as { eff?: string }).eff === "promise").toBe(false);
  });

  it("静态 `Response.json(x)` 的引擎签名是 `Response`（不是 promise）", () => {
    const out = checkNode(`export function f(x){ return Response.json(x); }`);
    expect(out.errorCodes).toEqual([]);
    expect(displayOf(out)).toMatch(/^Response\b/);
    expect(displayOf(out)).not.toMatch(/promise/);
  });

  it("实例 `response.json()` 仍是 promise（不得被改成同步）", () => {
    const face = instanceFaceOf("Response");
    expect(face, "Response 实例面").toBeTruthy();
    const inner = (face!.shape as { shape?: Abs }).shape;
    const jsonSlot = (inner?.shape as { slots?: Record<string, { value: Abs }> }).slots?.json?.value;
    expect(jsonSlot, "实例面必须保留 json 槽").toBeTruthy();
    const jsonRt = returnTypeOf(jsonSlot);
    expect(jsonRt!.shape.k).toBe("eff");
    expect((jsonRt!.shape as { eff?: string }).eff).toBe("promise");
  });

  it("静态面三个工厂（error / json / redirect）都仍在，且都返回 `Response` 品牌", () => {
    for (const name of ["error", "json", "redirect"] as const) {
      const slot = staticSlotOf("Response", name);
      expect(slot, `Response.${name}`).toBeTruthy();
      const rt = returnTypeOf(slot);
      expect(rt!.shape.k, `Response.${name} 返回域`).toBe("brand");
      expect((rt!.shape as { name: string }).name).toBe("Response");
    }
  });
});

describe("node env 的 `performance` 补齐 6 个宿主真实成员", () => {
  const SIX = [
    "toJSON",
    "clearResourceTimings",
    "eventLoopUtilization",
    "timerify",
    "setResourceTimingBufferSize",
    "nodeTiming",
  ] as const;

  it("6 个宿主真实成员都被声明（不再缺槽）", () => {
    for (const name of SIX) {
      expect(nodeSlotOf("performance", name), `performance.${name}`).toBeTruthy();
    }
  });

  it("6 个成员都可调用（不落进「确定缺失」）", () => {
    const out = checkNode(`export function f(){
  performance.toJSON();
  performance.clearResourceTimings();
  performance.eventLoopUtilization();
  performance.timerify(() => 1);
  performance.setResourceTimingBufferSize(100);
  return performance.nodeTiming;
}`);
    expect(out.errorCodes).toEqual([]);
    expect(out.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
    expect(displayOf(out)).not.toMatch(/never\s+throws/);
  });

  it("`performance.nodeTiming` 是对象（宿主上不是函数）", () => {
    const slot = nodeSlotOf("performance", "nodeTiming");
    expect(slot!.shape.k).toBe("obj");
  });

  it("`performance.timerify(fn)` 的返回域是可调用的（宿主返回包装函数，不是 undefined）", () => {
    const rt = returnTypeOf(nodeSlotOf("performance", "timerify"));
    expect(rt).toBeTruthy();
    expect(rt!.shape.k).toBe("fn");
  });

  it("已声明的成员行为不变：`now` / `mark` / `measure` / `getEntries*` 仍可调用", () => {
    const out = checkNode(`export function f(){
  performance.now();
  performance.mark("m");
  performance.measure("m");
  performance.getEntries();
  performance.getEntriesByName("m");
  performance.getEntriesByType("m");
  return 1;
}`);
    expect(out.errorCodes).toEqual([]);
  });
});

describe("node env 的 `navigator` 补 `locks`（Web Locks API）", () => {
  it("`navigator.locks` 被声明（不再是 exact undefined）", () => {
    const slot = nodeSlotOf("navigator", "locks");
    expect(slot, "navigator.locks").toBeTruthy();
    const out = checkNode(`export function f(){ return navigator.locks; }`);
    expect(out.errorCodes).toEqual([]);
    expect(displayOf(out)).not.toMatch(/^undefined/);
  });

  it("`navigator.locks.request(...)` 不被判「确定缺失」", () => {
    const out = checkNode(`export function f(){ return navigator.locks.request("k", () => 1); }`);
    expect(out.errorCodes).toEqual([]);
    expect(out.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
    expect(displayOf(out)).toMatch(/^promise/);
  });

  it("`navigator.locks.query()` 也被声明", () => {
    expect(nodeSlotOf("navigator", "locks", "query"), "navigator.locks.query").toBeTruthy();
  });

  it("`Navigator` 实例面与 `navigator` 全局面同源（同一份槽表）", () => {
    const face = instanceFaceOf("Navigator");
    expect(face, "Navigator 实例面").toBeTruthy();
    expect(memberNames(face)).toContain("locks");
    expect(memberNames(face).sort()).toEqual(
      memberNames(nodeSlotOf("navigator")).sort(),
    );
  });

  it("已声明的成员行为不变：hardwareConcurrency / language / languages / userAgent / platform", () => {
    for (const name of [
      "hardwareConcurrency",
      "language",
      "languages",
      "userAgent",
      "platform",
    ] as const) {
      expect(nodeSlotOf("navigator", name), `navigator.${name}`).toBeTruthy();
    }
    const out = checkNode(`export function f(){ return navigator.hardwareConcurrency; }`);
    expect(out.errorCodes).toEqual([]);
    expect(displayOf(out)).toMatch(/^number/);
  });
});

describe("web env 的 `crypto.subtle` 补 4 个标准 WebCrypto API", () => {
  const FOUR = ["deriveKey", "deriveBits", "wrapKey", "unwrapKey"] as const;

  it("deriveKey / deriveBits / wrapKey / unwrapKey 被声明", () => {
    for (const name of FOUR) {
      expect(slotOf("crypto", "subtle", name), `crypto.subtle.${name}`).toBeTruthy();
    }
  });

  it("调用不再被判「确定缺失」（合法浏览器代码不再被 L2 门禁挡住）", () => {
    const out = checkWeb(`export function f(){
  crypto.subtle.deriveKey("bits", "raw", "raw", {}, "HKDF", false, ["deriveKey"]);
  crypto.subtle.deriveBits("bits", "raw", 256);
  crypto.subtle.wrapKey("raw", "raw", {}, {}, {});
  crypto.subtle.unwrapKey("raw", "raw", {}, {}, {});
  return 1;
}`);
    expect(out.errorCodes).toEqual([]);
    expect(out.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
  });

  it("已声明的成员行为不变：digest / encrypt / decrypt / sign / verify / generateKey / importKey / exportKey", () => {
    for (const name of [
      "digest",
      "encrypt",
      "decrypt",
      "sign",
      "verify",
      "generateKey",
      "importKey",
      "exportKey",
    ] as const) {
      expect(slotOf("crypto", "subtle", name), `crypto.subtle.${name}`).toBeTruthy();
    }
    const out = checkWeb(`export function f(){ return crypto.subtle.digest("SHA-256", new Uint8Array()); }`);
    expect(out.errorCodes).toEqual([]);
    expect(displayOf(out)).toMatch(/^promise/);
  });

  it("node env 与 web env 的 `crypto.subtle` 成员集合同源（两 env 不再自相矛盾）", () => {
    const nodeMembers = memberNames(nodeSlotOf("crypto", "subtle")).sort();
    const webMembers = memberNames(slotOf("crypto", "subtle")).sort();
    expect(nodeMembers).toEqual(webMembers);
  });
});

describe("负控 —— 宿主没有的成员仍被判「确定缺失」（表没被改成全放行）", () => {
  it("`performance.notARealMember()` 仍判「确定抛 TypeError」", () => {
    const out = checkNode(`export function f(){ return performance.notARealMember(); }`);
    expect(displayOf(out)).toMatch(/never\s+throws\s+TypeError/);
    expect(out.errorCodes).toContain("nudo:entry-may-throw");
  });

  it("`navigator.notARealMember` 仍读出 undefined（不是全放行）", () => {
    const out = checkNode(`export function f(){ return navigator.notARealMember; }`);
    expect(displayOf(out)).toMatch(/^undefined/);
  });

  it("web env `crypto.subtle.notAMember()` 仍判「确定抛 TypeError」", () => {
    const out = checkWeb(`export function f(){ return crypto.subtle.notAMember(); }`);
    expect(displayOf(out)).toMatch(/never\s+throws\s+TypeError/);
    expect(out.errorCodes).toContain("nudo:entry-may-throw");
  });

  it("node env `crypto.subtle.notAMember()` 仍读出 undefined（不是全放行）", () => {
    const out = checkNode(`export function f(){ return crypto.subtle.notAMember; }`);
    expect(displayOf(out)).toMatch(/^undefined/);
  });
});

describe("宿主护栏 —— 宿主实测成员名 ⊆ env 表成员名", () => {
  it("performance（node env）", () => {
    const host = hostProtoMembers("performance");
    const env = memberNames(nodeSlotOf("performance"));
    expectHostCovered(host, env, PERFORMANCE_EXCLUDED, "performance");
  });

  it("navigator（node env）", () => {
    const host = hostProtoMembers("navigator");
    const env = memberNames(nodeSlotOf("navigator"));
    expectHostCovered(host, env, [], "navigator");
  });

  it("crypto.subtle（node env 与 web env）", () => {
    const host = hostProtoMembers("crypto.subtle");
    expectHostCovered(
      host,
      memberNames(nodeSlotOf("crypto", "subtle")),
      SUBTLE_EXCLUDED,
      "crypto.subtle (node)",
    );
    expectHostCovered(
      host,
      memberNames(slotOf("crypto", "subtle")),
      SUBTLE_EXCLUDED,
      "crypto.subtle (web)",
    );
  });

  it("Response 静态面（node env 与 web env）", () => {
    const host = hostOwnMembers("Response").filter((m) => !CTOR_META.includes(m));
    expectHostCovered(host, staticSlotNames(nodeSlotOf("Response")), [], "Response static (node)");
    expectHostCovered(host, staticSlotNames(slotOf("Response")), [], "Response static (web)");
  });
});
});

// ---------------------------------------------------------------------------
// atob / btoa keep the host's InvalidCharacterError throws面
// ---------------------------------------------------------------------------
describe("atob / btoa keep the host's InvalidCharacterError throws面", () => {
/**
 * 族 29 `@nudo:env web` 的 `atob` / `btoa` 吞掉宿主的
 * `DOMException(InvalidCharacterError)` ⇒ 恒不抛 ⇒ **L2 门禁假绿**。
 *
 * 根因：web env 把宿主实现包在 `try/catch` 里（catch 分支 `return undefined`）
 * ⇒ 「抛」与「不抛」塌成同一个返回值；再叠加 `envFn` 的 apply 包装的
 * `catch { return returnType }` ⇒ 第二层吞异常 ⇒ 无论宿主抛不抛都记「不抛」。
 *
 * 修法（已实测）：**删掉 env 的 atob / btoa 声明** ⇒ 回落宿主路径 ⇒ core 的
 * `GLOBAL_FNS` 分派给出**精确**语义（字面量真折叠 + 非法 base64 记
 * `InvalidCharacterError`）。
 *
 * 原生 oracle（node v26.10.0）：
 * atob("!!!") → THROW DOMException name=InvalidCharacterError
 * btoa("✓") → THROW DOMException name=InvalidCharacterError
 * atob("YWJj") → "abc"
 *
 * 反向钉：把 atob / btoa 加回 env 全局表 ⇒ 本文件必挂。
 */
describe("atob / btoa keep the host's InvalidCharacterError throws面", () => {
  it("atob / btoa are NOT declared in the web env (host fallback)", () => {
    expect(webEnvGlobals()["atob"]).toBeUndefined();
    expect(webEnvGlobals()["btoa"]).toBeUndefined();
  });

  it("atob('!!!') records InvalidCharacterError", () => {
    const out = checkWeb(`export function f(){ return atob("!!!"); }`);
    expect(out.throwBrands).toContain("InvalidCharacterError");
  });

  it("btoa('✓') records InvalidCharacterError", () => {
    const out = checkWeb(`export function f(){ return btoa("✓"); }`);
    expect(out.throwBrands).toContain("InvalidCharacterError");
  });

  it("valid base64 still folds to the exact string (no precision loss)", () => {
    const out = checkWeb(`export function f(){ return atob("YWJj"); }`);
    expect(out.errorCodes).toEqual([]);
    expect(displayOf(out)).toMatch(/^"abc"/);
  });

  it("the host-fallback path and the env path agree (same source, same verdict)", () => {
    const withEnv = checkWeb(`export function f(){ return atob("!!!"); }`, true);
    const hostOnly = checkWeb(`export function f(){ return atob("!!!"); }`, false);
    expect(withEnv.throwBrands).toEqual(hostOnly.throwBrands);
    expect(withEnv.throwBrands).toContain("InvalidCharacterError");
  });
});
});

// ---------------------------------------------------------------------------
// Buffer 是构造器（new Buffer(...) 不再定抛 TypeError）
// ---------------------------------------------------------------------------
describe("Buffer 是构造器（new Buffer(...) 不再定抛 TypeError）", () => {
/**
 * node env 把 `Buffer` 声明成**普通对象**（不是构造器）⇒
 * `new Buffer(...)` 被判**确定 TypeError** ⇒ L2 门禁对合法 Node 代码报 error
 * （假红，`nudo check` exit 1）。
 *
 * 修法：`Buffer` 建成 **envFn + `{ ctor: true }`**（packages/env/src/node.ts）；
 * 静态面（from / alloc / of / …）挂 fn 的 slots，实例面在 returnType 上——
 * 两者指向**同一个** Buffer 形状（bufferBrand），不另造第二份 Buffer 形状。
 *
 * 证据口径：原生 oracle（同进程真实 new Buffer）+ 引擎探针。
 */




const env = defineEnv();

function check(src: string) {
  return checkSource("/t/env-bug-878.js", src, pTrue, {
    inject: { envGlobals: env.globals },
  });
}

describe("Buffer 是构造器（new Buffer(...) 不再定抛 TypeError）", () => {
  it("原生 oracle：new Buffer(1) / new Buffer(\"ab\") 正常返回（仅弃用警告，不抛）", () => {
    expect(new Buffer(1).length).toBe(1);
    expect(new Buffer("ab").length).toBe(2);
  });

  it("env：Buffer 是 fn 形全局且带 ctor:true，实例面是 Buffer 形状", () => {
    const g = env.globals.Buffer!;
    expect(g, "global Buffer missing").toBeTruthy();
    expect(g.shape.k, "Buffer 形状").toBe("fn");
    expect((g.shape as { ctor?: boolean }).ctor, "Buffer ctor").toBe(true);
    const inst = (g.shape as { returnType: { shape: { k: string; name?: string } } }).returnType;
    expect(inst.shape.k).toBe("brand");
    expect(inst.shape.name).toBe("Buffer");
  });

  it("引擎探针：new Buffer(1) 不再是「never throws TypeError」", () => {
    const r = check(`
      export function f() { return new Buffer(1); }
      export function g() { return new Buffer("ab"); }
    `);
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
    for (const s of r.signatures) {
      expect(s.throws, `${s.name} 不应有 throws 面`).toBeUndefined();
      expect(s.display).toMatch(/^Buffer\b/);
    }
  });
});
});

// ---------------------------------------------------------------------------
// Buffer 实例面补 byteLength / buffer / byteOffset
// ---------------------------------------------------------------------------
describe("Buffer 实例面补 byteLength / buffer / byteOffset", () => {
/**
 * env node：`Buffer` 实例面**缺 `byteLength` / `buffer` / `byteOffset`**
 * ⇒ 成员读出 **exact `undefined`**（真值分别是 `4` / `ArrayBuffer` / `0`）。
 *
 * 修法：Buffer 实例形状（packages/env/src/node.ts 的 `BufferInstance`）补三个
 * 槽。`buffer` 用 ArrayBuffer 品牌（**不用 unknown**——unknown 会把签名污染
 * 成 unknown 并误报 nudo:unknown-inference）。
 *
 * 证据口径：原生 oracle（同进程真实 Buffer）+ 引擎探针（checkSource）。
 */





const env = defineEnv();

function shapeOf(a: Abs | undefined, label: string): string {
  expect(a, `expected Abs at ${label}`).toBeTruthy();
  return formatShape(a!);
}

function walk(a: Abs | undefined, ...keys: string[]): Abs | undefined {
  let cur: Abs | undefined = a;
  for (const k of keys) {
    if (!cur) return undefined;
    if (cur.shape.k === "brand") cur = cur.shape.shape as Abs | undefined;
    if (!cur || cur.shape.k !== "obj") return undefined;
    cur = cur.shape.slots[k]?.value;
  }
  return cur;
}

/** Buffer 的实例面：envFn 的 returnType（静态面在 fn 的 slots 上） */
function bufferInstance(): Abs {
  const g = env.globals.Buffer!;
  expect(g, "global Buffer missing").toBeTruthy();
  expect(g.shape.k, "Buffer 形状").toBe("fn");
  return (g.shape as { returnType: Abs }).returnType;
}

function check(src: string) {
  return checkSource("/t/env-bug-868.js", src, pTrue, {
    inject: { envGlobals: env.globals },
  });
}

describe("Buffer 实例面补 byteLength / buffer / byteOffset", () => {
  it("原生 oracle：Buffer.alloc(4) 的三个成员是真值（不是 undefined）", () => {
    const b = Buffer.alloc(4);
    expect(b.byteLength).toBe(4);
    expect(b.byteOffset).toBe(0);
    expect(b.buffer).toBeInstanceOf(ArrayBuffer);
  });

  it("env：Buffer 实例形状带三个槽，且类型正确", () => {
    const inst = bufferInstance();
    expect(shapeOf(walk(inst, "byteLength"), "byteLength")).toContain("number");
    expect(shapeOf(walk(inst, "byteOffset"), "byteOffset")).toContain("number");
    expect(shapeOf(walk(inst, "buffer"), "buffer")).toContain("ArrayBuffer");
  });

  it("引擎探针：三个成员读出 number / ArrayBuffer / number（不再是 exact undefined）", () => {
    const src = `
      export function b1() { return Buffer.alloc(4).byteLength; }
      export function b2() { return Buffer.alloc(4).buffer; }
      export function b3() { return Buffer.alloc(4).byteOffset; }
    `;
    const r = check(src);
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
    expect(r.issues.filter((i) => i.code === "nudo:unknown-inference")).toEqual([]);
    const byName = new Map(r.signatures.map((s) => [s.name, s.display]));
    expect(byName.get("b1")).toMatch(/^number\b/);
    expect(byName.get("b2")).toMatch(/^ArrayBuffer\b/);
    expect(byName.get("b3")).toMatch(/^number\b/);
  });
});
});

// ---------------------------------------------------------------------------
// Buffer has no isUtf8/transcode/constants statics
// ---------------------------------------------------------------------------
describe("Buffer has no isUtf8/transcode/constants statics", () => {
/**
 * 族 15 · node env 把**宿主上不存在**的 4 个成员声明成 `Buffer`
 * 类的**静态**成员（`compareBuffers` / `isUtf8` / `transcode` / `constants`）。
 *
 * 宿主真值：`typeof Buffer.isUtf8 === "undefined"`（它们是 `node:buffer` 的
 * **模块级导出**）⇒ 引擎判「不抛 + 自信的值」，宿主**必抛 TypeError**
 * ⇒ 假绿 + 错值（`Buffer.constants.MAX_LENGTH` 折成 `number`）。
 *
 * 修法：从 `Buffer` 静态表移除，按宿主放回 `node:buffer` 的模块面。
 *
 * 反向钉：把 `isUtf8` 加回 Buffer 静态表 ⇒ 本文件必挂。
 */
function host(script: string): string {
  return execFileSync(process.execPath, ["-e", script], { encoding: "utf-8" }).trim();
}

describe("Buffer has no isUtf8/transcode/constants statics", () => {
  it("host oracle: the four names are not Buffer statics (they are module exports)", () => {
    const out = host(`
      const b = require("node:buffer");
      console.log(JSON.stringify({
        bufferStatics: ["compareBuffers", "isUtf8", "transcode", "constants"].map((k) => typeof Buffer[k]),
        moduleExports: ["isUtf8", "transcode", "constants"].map((k) => typeof b[k]),
      }));
    `);
    expect(JSON.parse(out)).toEqual({
      bufferStatics: ["undefined", "undefined", "undefined", "undefined"],
      moduleExports: ["function", "function", "object"],
    });
  });

  it("the env Buffer static table no longer declares them", () => {
    for (const name of ["compareBuffers", "isUtf8", "transcode", "constants"]) {
      expect(staticSlotOf("Buffer", name), `Buffer.${name} must not be declared`).toBeUndefined();
    }
    // 真实静态仍在（负控：不是把整张表删空）
    expect(staticSlotOf("Buffer", "compare")).toBeTruthy();
    expect(staticSlotOf("Buffer", "isBuffer")).toBeTruthy();
  });

  it("calling Buffer.isUtf8(...) is no longer a confident value (was green)", () => {
    const out = checkNode(`export function f1(){ return Buffer.isUtf8(Buffer.from("x")); }`);
    // 修复前：`boolean`（引擎说「不抛 + 有值」），宿主必抛 TypeError。
    // 修复后：该名字**不再声明** ⇒ 读面诚实落 unknown（不再给自信错值）。
    expect(out.signatures[0]!.display).toBe("unknown");
    expect(out.throwBrands).not.toContain("TypeError");
  });

  it("Buffer.constants.MAX_LENGTH is no longer a confident number", () => {
    const out = checkNode(`export function f3(){ return Buffer.constants.MAX_LENGTH; }`);
    expect(out.signatures[0]!.display).toBe("unknown");
  });

  it("the module face node:buffer declares them at module scope", () => {
    for (const name of ["isUtf8", "transcode", "constants"]) {
      expect(envMember("node:buffer", name), `node:buffer.${name}`).toBeTruthy();
    }
    const out = checkNode(`export function f4(){ return Buffer.compare(Buffer.from("a"), Buffer.from("b")); }`);
    expect(out.throwBrands).toEqual([]);
    expect(out.signatures[0]!.display).toBe("number");
  });
});
});

// ---------------------------------------------------------------------------
// Buffer 静态面补 of（不再定抛 TypeError）
// ---------------------------------------------------------------------------
describe("Buffer 静态面补 of（不再定抛 TypeError）", () => {
/**
 * node env 的**静态 `Buffer`** 面**没有 `of`** ⇒ `Buffer.of(1, 2)`
 * 必抛 TypeError ⇒ L2 门禁假红。
 *
 * 修法：静态面挂在 `Buffer` 这个 envFn 的 slots 上（packages/env/src/node.ts），
 * `of` 用 `envFnVariadic`（原生 `Buffer.of` 是**变长**的）。静态面与实例面
 * 指向**同一个** Buffer 形状（bufferBrand），不另造第二份 Buffer 形状。
 *
 * 证据口径：原生 oracle（同进程真实 Buffer.of）+ 引擎探针。
 */





const env = defineEnv();

function shapeOf(a: Abs | undefined, label: string): string {
  expect(a, `expected Abs at ${label}`).toBeTruthy();
  return formatShape(a!);
}

/** fn 形全局的**静态槽**面（envFn 的 `opts.slots`） */
function staticSlot(a: Abs | undefined, name: string): Abs | undefined {
  if (!a || a.shape.k !== "fn") return undefined;
  const slots = (a.shape as { slots?: Record<string, { value: Abs }> }).slots;
  return slots?.[name]?.value;
}

function check(src: string) {
  return checkSource("/t/env-bug-874.js", src, pTrue, {
    inject: { envGlobals: env.globals },
  });
}

describe("Buffer 静态面补 of（不再定抛 TypeError）", () => {
  it("原生 oracle：Buffer.of 存在且返回 Buffer（长度 2）", () => {
    expect(typeof Buffer.of).toBe("function");
    const b = Buffer.of(1, 2);
    expect(Buffer.isBuffer(b)).toBe(true);
    expect(b.length).toBe(2);
  });

  it("env：Buffer 静态面带 of（变长 fn）", () => {
    const of = staticSlot(env.globals.Buffer, "of");
    expect(of, "Buffer.of 缺失").toBeTruthy();
    expect(shapeOf(of, "Buffer.of")).toContain("=>");
    // 变长：params 末位是 rest
    const params = (of!.shape as { params?: string[] }).params ?? [];
    expect(params[params.length - 1]).toMatch(/^\.\.\./);
  });

  it("引擎探针：Buffer.of(1, 2) 不再定抛 TypeError", () => {
    const r = check(`export function useBufferOf() { return Buffer.of(1, 2); }`);
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
    for (const s of r.signatures) {
      expect(s.throws, `${s.name} 不应有 throws 面`).toBeUndefined();
    }
    expect(r.signatures[0]?.display).toMatch(/^Buffer\b/);
  });
});
});

// ---------------------------------------------------------------------------
// node:crypto 族有实参域 throws 面
// ---------------------------------------------------------------------------
describe("node:crypto 族有实参域 throws 面", () => {
/**
 * `@nudo:env node` 的 `node:crypto` 族**实参域抛错全缺** ⇒ L2 门禁**假绿**
 *（一次放行五个必抛入口）。
 *
 * 原生 oracle（Node v26.10.0 **独立进程**逐个实测，**不猜**）：
 * createHash("nope") ⇒ 抛 **Error**（"Digest method not supported"）
 * createHash("sha256") ⇒ 不抛
 * randomBytes(-1) ⇒ 抛 **RangeError**（ERR_OUT_OF_RANGE；size ∈ [0, 2^31-1]）
 * randomBytes(8) ⇒ 不抛
 * randomInt(5, 1) ⇒ 抛 **RangeError**（ERR_OUT_OF_RANGE；max 必须 > min）
 * randomInt(1, 5) ⇒ 不抛
 * pbkdf2Sync("p","s",0,8,"sha256") ⇒ 抛 **RangeError**（iterations ∈ [1, 2^31-1]）
 * pbkdf2Sync("p","s",1,8,"sha256") ⇒ 不抛
 * timingSafeEqual(Buffer.alloc(1), Buffer.alloc(2))
 * ⇒ 抛 **RangeError**（ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH）
 *
 * 旧实现：五个入口全是 relation 面（**恒不抛**）⇒ 五个必抛入口一次放行（假绿）。
 *
 * 新建模（走 core 的 throws 通道）：
 * - 实参**可判定**且越界 ⇒ **必抛**（abs 面 = never + 对应错误品牌）；
 * - 实参**抽象** ⇒ **may-throw**（原生在该域上确实可能抛）；
 * - 落在合法域 ⇒ **零抛**。
 *
 * 断言双向：正向钉住「越界必抛 / 合法零抛 / 抽象 may-throw」；
 * 反向（把 apply 去掉、改回恒不抛的 relation 面）本文件必须失败。
 */







const env = defineEnv();
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

describe("node:crypto 族有实参域 throws 面", () => {
  it("1. createHash：不支持的算法名 ⇒ 必抛 Error（旧实现恒不抛）", () => {
    expect(nativeErrorName(() => nodeCreateHash("nope"))).toBe("Error");
    const bad = callSite(cryptoMod.createHash!, [strLit("nope")]);
    expect(bad.threw, "unsupported digest must be an always-throw").toBeTruthy();
    expect(brandName((bad.threw as { absValue: Abs }).absValue)).toBe("Error");

    const good = callSite(cryptoMod.createHash!, [strLit("sha256")]);
    expect(good.threw).toBeUndefined();
    expect(good.exits).toHaveLength(0);
  });

  it("2. randomBytes：size 越界 ⇒ 必抛 RangeError；合法 size 零抛", () => {
    expect(nativeErrorName(() => nodeRandomBytes(-1))).toBe("RangeError");
    const bad = callSite(cryptoMod.randomBytes!, [numLit(-1)]);
    expect(bad.threw).toBeTruthy();
    expect(brandName((bad.threw as { absValue: Abs }).absValue)).toBe("RangeError");

    const good = callSite(cryptoMod.randomBytes!, [numLit(8)]);
    expect(good.threw).toBeUndefined();
    expect(good.exits).toHaveLength(0);
  });

  it("3. randomInt：max <= min ⇒ 必抛 RangeError；合法区间零抛", () => {
    expect(nativeErrorName(() => nodeRandomInt(5, 1))).toBe("RangeError");
    const bad = callSite(cryptoMod.randomInt!, [numLit(5), numLit(1)]);
    expect(bad.threw).toBeTruthy();
    expect(brandName((bad.threw as { absValue: Abs }).absValue)).toBe("RangeError");

    const good = callSite(cryptoMod.randomInt!, [numLit(1), numLit(5)]);
    expect(good.threw).toBeUndefined();
    expect(good.exits).toHaveLength(0);
  });

  it("4. pbkdf2Sync：iterations = 0 ⇒ 必抛 RangeError；合法参数零抛", () => {
    expect(nativeErrorName(() => nodePbkdf2Sync("p", "s", 0, 8, "sha256"))).toBe("RangeError");
    const bad = callSite(cryptoMod.pbkdf2Sync!, [
      strLit("p"),
      strLit("s"),
      numLit(0),
      numLit(8),
      strLit("sha256"),
    ]);
    expect(bad.threw).toBeTruthy();
    expect(brandName((bad.threw as { absValue: Abs }).absValue)).toBe("RangeError");

    const good = callSite(cryptoMod.pbkdf2Sync!, [
      strLit("p"),
      strLit("s"),
      numLit(1),
      numLit(8),
      strLit("sha256"),
    ]);
    expect(good.threw).toBeUndefined();
    expect(good.exits).toHaveLength(0);
  });

  it("5. timingSafeEqual：长度不等 ⇒ RangeError（env 的 Buffer 面不建模长度 ⇒ may-throw）", () => {
    expect(
      nativeErrorName(() => nodeTimingSafeEqual(Buffer.alloc(1), Buffer.alloc(2))),
    ).toBe("RangeError");
    const site = callSite(cryptoMod.timingSafeEqual!, [
      env.globals.Buffer as Abs,
      env.globals.Buffer as Abs,
    ]);
    expect(site.threw, "undecidable length must not be a hard throw").toBeUndefined();
    expect(site.exits).toHaveLength(1);
    expect(brandName(site.exits[0]!)).toBe("RangeError");
  });

  it("6. 抽象实参 ⇒ may-throw（原生在该域上确实可能抛）", () => {
    const site = callSite(cryptoMod.createHash!, [prim.str()]);
    expect(site.threw).toBeUndefined();
    expect(site.exits).toHaveLength(1);
    expect(brandName(site.exits[0]!)).toBe("Error");
  });
});
});

// ---------------------------------------------------------------------------
// crypto.getRandomValues takes a TypedArray, returns it
// ---------------------------------------------------------------------------
describe("crypto.getRandomValues takes a TypedArray, returns it", () => {
/**
 * 族 15 · node env 的 `crypto.getRandomValues` 声明成
 * `(unknown[]) => unknown[]`。
 *
 * 宿主真值：**只接受整数型 TypedArray**（数组字面量 ⇒ 定抛
 * `DOMException: The data argument must be an integer-type TypedArray`），
 * 且**原样返回同一个对象**。旧声明两个方向都错：
 * - 形参是 JS Array ⇒ `crypto.getRandomValues([1,2,3])` 判绿（**假绿**）；
 * - 返回声明成「新数组」⇒ 与「同一对象」不符。
 *
 * 反向钉：把 paramTypes / apply 恢复成 `arrOf(unknown)` ⇒ 本文件必挂
 * （数组字面量重新判绿）。
 */
function host(script: string): string {
  return execFileSync(process.execPath, ["-e", script], { encoding: "utf-8" }).trim();
}

describe("crypto.getRandomValues takes a TypedArray, returns it", () => {
  it("host oracle: array argument throws, TypedArray is returned by identity", () => {
    const out = host(`
      const a = new Uint8Array(4);
      const r = crypto.getRandomValues(a);
      let threw = null;
      try { crypto.getRandomValues([1, 2, 3]); } catch (e) { threw = e.constructor.name; }
      console.log(JSON.stringify({ same: r === a, threw }));
    `);
    expect(JSON.parse(out)).toEqual({ same: true, threw: "DOMException" });
  });

  it("array literal argument is rejected (was green)", () => {
    const out = checkNode(`export function fill(){ return crypto.getRandomValues([1, 2, 3]); }`);
    // 运行时必抛 ⇒ 引擎也必须判必抛（never + TypeError）
    expect(displayOf(out, "fill")).toContain("never");
    expect(out.throwBrands).toContain("TypeError");
    expect(out.errorCodes).toContain("nudo:entry-may-throw");
  });

  it("legal integer TypedArray is not a throw and keeps its identity", () => {
    const out = checkNode(`export function ok(){ return crypto.getRandomValues(new Uint8Array(16)); }`);
    expect(out.throwBrands).toEqual([]);
    expect(displayOf(out, "ok")).toBe("Uint8Array");
  });

  it("float TypedArray is rejected by the host → rejected by the env", () => {
    const thrown = host(`
      let name = null;
      try { crypto.getRandomValues(new Float32Array(4)); } catch (e) { name = e.constructor.name; }
      console.log(String(name));
    `);
    expect(thrown).toBe("DOMException");
    const out = checkNode(`export function flt(){ return crypto.getRandomValues(new Float32Array(4)); }`);
    expect(displayOf(out, "flt")).toContain("never");
  });

  it("the declared parameter domain is integer TypedArrays, never a JS Array", () => {
    const fn = nodeSlotOf("crypto", "getRandomValues");
    expect(fn?.shape.k).toBe("fn");
    const param = (fn!.shape as { paramTypes?: Abs[] }).paramTypes?.[0];
    expect(param?.shape.k, "param must be a union of TypedArray brands").toBe("sum");
    const names = (param!.shape as { members: Abs[] }).members.map(
      (m) => (m.shape as { name?: string }).name ?? "",
    );
    expect(names).not.toContain("Array");
    expect(names).toContain("Uint8Array");
    expect(names.every((n) => n.endsWith("Array"))).toBe(true);
  });
});
});

// ---------------------------------------------------------------------------
// Headers/FormData iterators are not arrays (both envs)
// ---------------------------------------------------------------------------
describe("Headers/FormData iterators are not arrays (both envs)", () => {
/**
 * 族 15 · `Headers` / `FormData` 的 `keys` / `values` / `entries`
 * 在 WHATWG 规范里返回**迭代器**，不是数组。
 *
 * - node 面声明成 `arrOf(...)` ⇒ `Array.isArray(h.keys())` 折 **true**
 * （宿主 false）、`k.length` 折 `number`（宿主 undefined）⇒ 自信的错值；
 * - web 面声明成 `unknown` ⇒ 可迭代性分类落 "may" ⇒ `[...h.keys()]` 记
 * may-throw TypeError ⇒ **假红**（挡住合法的 `for…of` / 展开）。
 *
 * 修法：两面统一为**迭代器面**（带 `@@iterator` 槽的 obj ⇒ core 判 total）。
 *
 * 反向钉：把 keys 改回 `arrOf(...)` ⇒ `Array.isArray` 断言的 false 会挂。
 */
function host(script: string): string {
  return execFileSync(process.execPath, ["-e", script], { encoding: "utf-8" }).trim();
}

describe("Headers/FormData iterators are not arrays (both envs)", () => {
  it("host oracle: keys() is an Iterator, not an Array", () => {
    const out = host(`
      const h = new Headers({ a: "b" });
      const k = h.keys();
      console.log(JSON.stringify({
        isArray: Array.isArray(k),
        length: typeof k.length,
        ctor: k.constructor.name,
        first: [...k][0],
      }));
    `);
    expect(JSON.parse(out)).toEqual({
      isArray: false,
      length: "undefined",
      ctor: "Iterator",
      first: "a",
    });
  });

  it("node: Array.isArray(headers.keys()) folds to false (was true)", () => {
    const out = checkNode(`export function f(){
  const h = new Headers({ a: "b" });
  return Array.isArray(h.keys());
}`);
    expect(out.signatures[0]!.display).toBe("false");
  });

  it("node: keys() has no array length / index (was number / string)", () => {
    const out = checkNode(`export function f(){
  const h = new Headers({ a: "b" });
  const k = h.keys();
  return [k.length, k[0]];
}`);
    const d = out.signatures[0]!.display;
    expect(d).not.toContain("number");
    expect(d).not.toContain("string");
  });

  it("node: the declared face is an iterator object (has @@iterator), not arr", () => {
    const keys = slotOfAbs(instanceFaceOf("Headers"), "keys");
    const ret = (keys!.shape as { returnType?: { shape: { k: string; slots?: Record<string, unknown> } } }).returnType;
    expect(ret?.shape.k).toBe("obj");
    expect(Object.keys(ret!.shape.slots ?? {})).toContain("@@iterator");
  });

  it("web: spreading headers.keys() is legal (was may-throw TypeError)", () => {
    const out = checkWeb(`export function f(){
  const h = new Headers({ a: "b" });
  return [...h.keys()].length;
}`);
    expect(out.signatures[0]!.display).toBe("number");
    expect(out.throwBrands).toEqual([]);
  });

  it("FormData entries are iterators too (both envs)", () => {
    const node = checkNode(`export function f(){
  const d = new FormData();
  return Array.isArray(d.entries());
}`);
    expect(node.signatures[0]!.display).toBe("false");
    const web = checkWeb(`export function f(){
  const d = new FormData();
  d.append("a", "b");
  return [...d.entries()].length;
}`);
    expect(web.throwBrands).toEqual([]);
    expect(slotOfAbs(instanceFaceOf("FormData"), "entries")).toBeTruthy();
  });
});
});

// ---------------------------------------------------------------------------
// env promise 必须带 rejected 通道（catch 臂是活代码）
// ---------------------------------------------------------------------------
describe("env promise 必须带 rejected 通道（catch 臂是活代码）", () => {
/**
 * （族 29 · S6）—— **env promise 的 rejected 通道**回归钉。
 *
 * 现象：env 造的 promise **没有 rejected 通道** ⇒ core 读成「**确定
 * fulfilled**」⇒ `catch` 臂被当成**死代码** ⇒ 引擎给出**确定的错值**
 * （原生：fs/promises.readFile / fetch / crypto.subtle.digest 都可能拒绝，
 * catch 臂是活代码）。
 *
 * 根因：core 的 promise 形状有两个**可选**通道（`packages/core/src/algebra/abs.ts`）：
 * `rejected?: Abs` 与 `unsettled?: boolean`；「无该标记且无 rejected 通道
 * = 确定 fulfilled」。判定点 `packages/core/src/algebra/builtins/promise.ts`
 * 的 `settledFulfilledOf`。env 的 `promiseOf()`（`packages/env/src/abs-helpers.ts`）
 * 造出的 promise 既无 `rejected` 也无 `unsettled` ⇒ core 读成「确定 fulfilled」。
 *
 * **core 侧核对结论（本分片已核）：core 零改动。**
 * `settledFulfilledOf` / `then` / `catch` / `$await` 对**带 `rejected` 通道**
 * 的 promise 处理已经正确：
 * - `settledFulfilledOf`：`rejected !== undefined` ⇒ 不判「确定 fulfilled」；
 * - `catch`：走「拒绝通道在场但 settle 未定」分支 ⇒ 两臂 join（catch 臂活）；
 * - `then`：两臂 join；
 * - `$await`：拒绝臂进 throw 通道 ⇒ `try/catch` 可吸收 ⇒ catch 臂可达。
 * （见本文件「core 对照组」三钉——它们现在就绿。）
 *
 * **env 侧修法（`packages/env/src/abs-helpers.ts` 的 `promiseOf()`）**：给
 * promise 形状补上 `rejected` 通道 ⇒ 两臂均可能 ⇒ catch 臂保持活：
 *
 * ```ts
 * export function promiseOf(inner: Abs): Abs {
 * return makeAbs(
 * { k: "eff", eff: "promise", inner, rejected: unknown },
 * undefined,
 * undefined,
 * "exact",
 * );
 * }
 * ```
 *
 * （`unknown` = env 侧已有的 unknown Abs——拒绝 reason 不可知 ⇒ 两臂均可能。
 * `rejected` 是**态信息**，不进 leq / 指纹 / check 等价。）
 *
 * 📌 **状态**：本文件写完后 env 侧 `promiseOf` 已按上述改法接线 ⇒
 * 「env 侧」三条钉**已转绿**。接线前它们是红的（catch 臂是死代码 ⇒
 * 签名里没有 `"boom"`）——即本钉就是那次接线的验收门。
 */






const nodeEnv = defineNodeEnv();
const webEnv = defineWebEnv();

/** env 模块表 → core 的模块导出表（与 service 的 `collectEnvModules` 同口径） */
function modulesOf(def: {
  modules?: Record<string, Record<string, Abs>>;
}): Record<string, AbsModuleExports> {
  const out: Record<string, AbsModuleExports> = {};
  for (const [spec, named] of Object.entries(def.modules ?? {})) {
    out[spec] = { named: { ...named } };
  }
  return out;
}

const NODE_MODULES = modulesOf(nodeEnv);
const WEB_MODULES = modulesOf(webEnv);

function check(
  src: string,
  def: { modules?: Record<string, Record<string, Abs>>; globals: Record<string, Abs> },
) {
  resetGeneralizeMemo();
  const modules = modulesOf(def);
  return checkSource("/t/x.js", src, pTrue, {
    modules,
    inject: { envGlobals: def.globals, modules },
  });
}

function sigOf(
  src: string,
  name: string,
  def: { modules?: Record<string, Record<string, Abs>>; globals: Record<string, Abs> },
): string {
  const sig = check(src, def).signatures.find((s) => s.name === name);
  expect(sig, `signature "${name}" missing`).toBeTruthy();
  return sig!.display;
}

/** try/catch 模板：catch 臂的返回值 "boom" 是「catch 臂活」的探针 */
const TRY_CATCH_BODY = (expr: string) => `try { ${expr} return "ok"; } catch (e) { return "boom"; }`;

describe("env promise 必须带 rejected 通道（catch 臂是活代码）", () => {
  describe("core 对照组（现在就绿——证明 core 侧无需改动）", () => {
    it("带 rejected 通道的 promise（executor fork）⇒ catch 臂活", () => {
      const src = `export async function use(c) {
        ${TRY_CATCH_BODY(`await new Promise((res, rej) => { if (c) { res(1); } else { rej(2); } });`)}
      }`;
      const display = sigOf(src, "use", nodeEnv);
      expect(display, "catch 臂必须是活代码（值域含 catch 分支的 \"boom\"）").toContain(
        '"boom"',
      );
    });

    it("确定 fulfilled 的 promise（Promise.resolve）⇒ catch 臂死（原生同款）", () => {
      const src = `export async function use(c) {
        ${TRY_CATCH_BODY("await Promise.resolve(1);")}
      }`;
      const display = sigOf(src, "use", nodeEnv);
      expect(display, "确定 fulfilled ⇒ catch 臂是死代码").not.toContain('"boom"');
    });

    it("反向对照：把「带 rejected 通道」换成「确定 fulfilled」⇒ 断言必须失败", () => {
      // 同一断言（display 含 "boom"）作用在确定 fulfilled 的 promise 上必须不成立
      const src = `export async function use(c) {
        ${TRY_CATCH_BODY("await Promise.resolve(1);")}
      }`;
      const display = sigOf(src, "use", nodeEnv);
      expect(display).not.toContain('"boom"');
    });
  });

  describe("env 侧（promiseOf 补 rejected 通道 ⇒ catch 臂活）", () => {
    it("fs/promises.readFile ⇒ catch 臂是活代码", () => {
      const src = `/// @nudo:env node
import { readFile } from "node:fs/promises";
export async function use() {
  ${TRY_CATCH_BODY(`const b = await readFile("x.txt", "utf8");`)}
}
`;
      const display = sigOf(src, "use", nodeEnv);
      expect(
        display,
        'catch 臂是死代码 ⇒ env promise 缺 rejected 通道（promiseOf 接线后应含 "boom"）',
      ).toContain('"boom"');
    });

    it("fetch（web）⇒ catch 臂是活代码", () => {
      const src = `/// @nudo:env web
export async function use() {
  ${TRY_CATCH_BODY(`const r = await fetch("https://example.com");`)}
}
`;
      const display = sigOf(src, "use", webEnv);
      expect(
        display,
        'catch 臂是死代码 ⇒ env promise 缺 rejected 通道（promiseOf 接线后应含 "boom"）',
      ).toContain('"boom"');
    });

    it("crypto.subtle.digest（node 全局 crypto）⇒ catch 臂是活代码", () => {
      // 用**全局** `crypto`（node env 的 `crypto` 全局带完整的
      // `subtle.digest` 声明 ⇒ 返回 env 造的 promise）。
      // ⚠️ 不要用 `import { webcrypto } from "node:crypto"`——node env 的
      // `node:crypto` 模块**未声明** `webcrypto`（越界发现）⇒ 那是缺失绑定，
      // 根本不是 env promise，接线 `promiseOf` 也不会转绿。
      const src = `/// @nudo:env node
export async function use() {
  ${TRY_CATCH_BODY(`const d = await crypto.subtle.digest("SHA-256", new Uint8Array([1]));`)}
}
`;
      const display = sigOf(src, "use", nodeEnv);
      expect(
        display,
        'catch 臂是死代码 ⇒ env promise 缺 rejected 通道（promiseOf 接线后应含 "boom"）',
      ).toContain('"boom"');
    });
  });
});
});

// ---------------------------------------------------------------------------
// node env 不再声明 structuredClone（宿主 throws 面不再被遮蔽）
// ---------------------------------------------------------------------------
describe("node env 不再声明 structuredClone（宿主 throws 面不再被遮蔽）", () => {
/**
 * `@nudo:env node` 的**全局 `structuredClone`** **遮蔽**宿主内建 ⇒
 * 引擎改走 env 声明路径 ⇒ **throws 面整个消失** ⇒ 假绿（原生对不可克隆值抛
 * DataCloneError，引擎却说「不抛」）。
 *
 * 修法：**删掉 node env 里的 `structuredClone` 声明**（packages/env/src/node.ts）⇒
 * 回落宿主路径 ⇒ 宿主那侧的 throws 面回来。
 *
 * 说明（勘误）：宿主路径曾把 structuredClone 的错误记成 **TypeError**（宿主
 * 实际抛 DOMException/DataCloneError）——那是 core 侧「宿主全局字面量守卫」
 * 的保守口径（ 家族），**不在本条范围**；本条只保证
 * 「throws 面不再消失」（假绿修掉）。
 *
 * 落地后的探针口径（2026-10）：宿主路径已按**实参可克隆性**分档
 * ——可克隆实参（{ a: 1 } / 数组 / Date / Map…）**不记抛**（native 也不抛），
 * 不可克隆实参（函数 / Symbol / WeakMap / Promise）记 **DataCloneError**。
 * ⇒ 本文件的「throws 面还在不在」探针**必须用不可克隆实参**，否则会把
 * 「假绿」修成「假红」（原生 oracle：structuredClone({ a: 1 }) 不抛）。
 *
 * 证据口径：原生 oracle（同进程真实 structuredClone）+ 引擎探针。
 */




const env = defineEnv();

function check(src: string) {
  return checkSource("/t/env-bug-884.js", src, pTrue, {
    inject: { envGlobals: env.globals },
  });
}

describe("node env 不再声明 structuredClone（宿主 throws 面不再被遮蔽）", () => {
  it("原生 oracle：structuredClone 对不可克隆值抛错（不是恒不抛）", () => {
    expect(structuredClone({ a: 1 })).toEqual({ a: 1 });
    expect(() => structuredClone(Symbol("x"))).toThrow();
  });

  it("env：node env 不声明 structuredClone（回落宿主路径）", () => {
    expect(env.globals.structuredClone, "structuredClone 不应被 node env 声明").toBeUndefined();
  });

  it("引擎探针：带 node env 时 structuredClone 仍有 throws 面（假绿修掉）", () => {
    // 探针实参取**不可克隆**值（函数）：宿主对不可克隆值抛 DataCloneError ⇒
    // throws 面必须存在（口径：可克隆实参不记抛，见下一例）。
    const r = check(`export function s1() { return structuredClone(() => 1); }`);
    const sig = r.signatures[0];
    expect(sig, "无签名").toBeTruthy();
    // throws 面回来了（宿主全局字面量守卫的 may-throw 口径）
    expect(sig!.throws, "structuredClone 应带 throws 面").toBeTruthy();
    expect(r.issues.some((i) => i.code === "nudo:entry-may-throw")).toBe(true);
  });

  it("引擎探针：不开 env 时结论一致（env 不再改变门禁结论）", () => {
    const withEnv = check(`export function s1() { return structuredClone(() => 1); }`);
    const withoutEnv = checkSource("/t/env-bug-884.js", `export function s1() { return structuredClone(() => 1); }`, pTrue, {});
    expect(withoutEnv.signatures[0]?.throws).toBeTruthy();
    expect(withEnv.signatures[0]?.throws).toBeTruthy();
  });

  it("Bug 288 口径：可克隆实参（{ a: 1 }）native 不抛 ⇒ 引擎不得记 throws 面", () => {
    const r = check(`export function s1() { return structuredClone({ a: 1 }); }`);
    expect(r.signatures[0]?.throws, "可克隆实参不应带 throws 面").toBeUndefined();
    expect(r.issues.some((i) => i.code === "nudo:entry-may-throw")).toBe(false);
  });
});
});

// ---------------------------------------------------------------------------
// TextDecoder keeps core's precise RangeError
// ---------------------------------------------------------------------------
describe("TextDecoder keeps core's precise RangeError", () => {
/**
 * 族 29 web env 的 `TextDecoder` 声明**遮蔽** core 精确的 `RangeError`。
 *
 * 根因：env 的 `TextDecoder` 只是一条**无 impl 的类型声明** ⇒ 引擎走 env 声明
 * 路径 ⇒ core 的 `makeTextDecoderAbs`（非法 encoding label ⇒ **RangeError**）
 * 从未被调用 ⇒ 落到 env 通用构造兜底（`new` 一个「可调用性未知的函数值」）
 * ⇒ 记 **TypeError** ⇒ `@nudo:throws` 门禁**双向翻转**
 * （RangeError 假红 / TypeError 假绿）。
 *
 * 修法（已实测）：**删掉 web env 的 `TextDecoder` 声明** ⇒ 回落宿主 ⇒ core 的
 * `makeTextDecoderAbs` 生效 ⇒ 记 **RangeError**。
 *
 * 原生 oracle（node v26.10.0）：`new TextDecoder("bad-$$")` →
 * `RangeError: The "bad-$$" encoding is not supported`。
 *
 * 反向钉：把 `TextDecoder` 加回 env 全局表 ⇒ 本文件必挂。
 */
describe("TextDecoder keeps core's precise RangeError", () => {
  it("TextDecoder is NOT declared in the web env (it shadowed core's exact model)", () => {
    expect(webEnvGlobals()["TextDecoder"]).toBeUndefined();
  });

  it("new TextDecoder('bad-$$') records RangeError (not TypeError)", () => {
    const out = checkWeb(`export function f(){ return new TextDecoder("bad-$$"); }`);
    expect(out.throwBrands).toContain("RangeError");
    expect(out.throwBrands).not.toContain("TypeError");
  });

  it("new TextDecoder() is clean", () => {
    const out = checkWeb(`export function f(){ return new TextDecoder(); }`);
    expect(out.errorCodes).toEqual([]);
    expect(out.throwBrands).toEqual([]);
  });

  it("the env path and the host path agree on the error brand", () => {
    const withEnv = checkWeb(`export function f(){ return new TextDecoder("bad-$$"); }`, true);
    const hostOnly = checkWeb(`export function f(){ return new TextDecoder("bad-$$"); }`, false);
    expect(withEnv.throwBrands).toEqual(hostOnly.throwBrands);
    expect(withEnv.throwBrands).toContain("RangeError");
  });

  it("core's exact model still folds a known label (encoding slot)", () => {
    const out = checkWeb(`export function f(){ const d = new TextDecoder("utf-8"); return d.encoding; }`);
    expect(out.errorCodes).toEqual([]);
    expect(displayOf(out)).toMatch(/^"utf-8"/);
  });
});
});

// ---------------------------------------------------------------------------
// TextEncoder / TextDecoder are classes, not plain functions
// ---------------------------------------------------------------------------
describe("TextEncoder / TextDecoder are classes, not plain functions", () => {
/**
 * 族 29 env 把 JS **类**（`TextEncoder` / `TextDecoder`）建模成普通
 * 可调用函数 ⇒ 不带 `new` 的调用被判「成功返回、恒不抛」⇒ **L2 门禁假绿**。
 *
 * 根因：`envFn` 的 facet 面只能表达「可 `new`」（`ctor: true`），**不能**表达
 * 「不可裸调」⇒ 声明侧把类与函数混为一谈：
 * - `new TextDecoder(...)` 走「fn 无 ctor ⇒ 记 may-throw」分支 ⇒ 假红（）；
 * - `TextDecoder(...)`（不写 `new`）走「普通 fn 可调」分支 ⇒ 恒不抛 ⇒ 假绿（本条）。
 *
 * 修法（已实测）：**删掉 web env 的 `TextEncoder` / `TextDecoder` 声明** ⇒
 * 回落宿主 ⇒ 裸调用记 TypeError、`new` 调用干净。
 *
 * 原生 oracle（node v26.10.0）：
 * TextEncoder() → TypeError: Class constructor TextEncoder cannot be
 * invoked without 'new'
 * TextDecoder("utf-8") → TypeError: Class constructor TextDecoder cannot be
 * invoked without 'new'
 * new TextEncoder() → OK
 *
 * 反向钉：把 TextEncoder / TextDecoder 加回 env 全局表 ⇒ 本文件必挂。
 */
describe("TextEncoder / TextDecoder are classes, not plain functions", () => {
  it("TextEncoder / TextDecoder are NOT declared in the web env", () => {
    expect(webEnvGlobals()["TextEncoder"]).toBeUndefined();
    expect(webEnvGlobals()["TextDecoder"]).toBeUndefined();
  });

  it("bare TextEncoder() records TypeError (native: class without new)", () => {
    const out = checkWeb(`export function f(){ return TextEncoder(); }`);
    expect(out.throwBrands).toContain("TypeError");
  });

  it("bare TextDecoder('utf-8') records TypeError (native: class without new)", () => {
    const out = checkWeb(`export function f(){ return TextDecoder("utf-8"); }`);
    expect(out.throwBrands).toContain("TypeError");
  });

  it("new TextEncoder() / new TextDecoder() are clean", () => {
    const out = checkWeb(`export function f(){
  const e = new TextEncoder();
  const d = new TextDecoder();
  return [e, d];
}`);
    expect(out.errorCodes).toEqual([]);
    expect(out.throwBrands).toEqual([]);
  });

  it("the env path and the host path agree on the bare-call verdict", () => {
    const withEnv = checkWeb(`export function f(){ return TextEncoder(); }`, true);
    const hostOnly = checkWeb(`export function f(){ return TextEncoder(); }`, false);
    expect(withEnv.throwBrands).toEqual(hostOnly.throwBrands);
    expect(withEnv.throwBrands).toContain("TypeError");
  });
});
});

// ---------------------------------------------------------------------------
// URI 族不再吞掉 URIError（es env）
// ---------------------------------------------------------------------------
describe("URI 族不再吞掉 URIError（es env）", () => {
/**
 * 族 29 · es env 的 URI 族（`decodeURI` / `decodeURIComponent` /
 * `encodeURI` / `encodeURIComponent`）**吞掉 URIError** ⇒ 引擎判「不抛」
 * ⇒ L2 `nudo:entry-may-throw` 门禁失效（**假绿**）。
 *
 * 根因：env 声明走 `strToStrImplAbs(encodeURI)`，宿主 `URIError` 被 envFn 的
 * apply 包装吞掉（旧实现 `catch { return returnType }`）。修法：URI 族声明
 * **委托 core 的 `evalGlobalFn`**（= 宿主回落路径的同一建模），
 * - 字面量实参：畸形 % 序列 / 孤立代理项 ⇒ **always-throw URIError**；
 * - 抽象实参：回落**声明域** `string`（**不**折原生产不出的自信精确字面量），
 * decode* 记 **may-throw URIError**（与无 env 的宿主路径同口径）。
 *
 * 断言双向：
 * - 正向：畸形入参 ⇒ 记 URIError（门禁红）；合法入参 ⇒ **不**抛（不误红）；
 * 抽象入参 ⇒ 值面是 `string` 声明域（不是自信精确字面量）。
 * - 反向：把 URI 族改回旧的「吞异常」实现 ⇒ 本文件必须失败。
 */




/** es env 的全局表（≡ service 侧 `collectEnvGlobals(["es"])`）。 */
function esEnvGlobals(): Record<string, Abs> {
  return { ...defineEnv_____es_ts().globals };
}

type CheckResult = ReturnType<typeof checkSource>;

function checkWithEs(src: string): CheckResult {
  resetGeneralizeMemo();
  return checkSource("/t/env-bug-864.js", src, pTrue, {
    inject: { envGlobals: esEnvGlobals() },
  });
}

/** 入口 may-throw 诊断（品牌从 message 里取）。 */
function mayThrowMessages(r: CheckResult): string[] {
  return r.issues.filter((i) => i.code === "nudo:entry-may-throw").map((i) => i.message);
}

describe("URI 族不再吞掉 URIError（es env）", () => {
  it("1. 畸形 % 序列 ⇒ 记 URIError（原生恒抛，门禁必须红）", () => {
    const cases: Array<[string, string]> = [
      ["decodeURI", 'decodeURI("%")'],
      ["decodeURIComponent", 'decodeURIComponent("%")'],
      ["decodeURI", 'decodeURI("%E0%A4%A")'],
      ["decodeURIComponent", 'decodeURIComponent("%E0%A4%A")'],
      ["encodeURI", 'encodeURI("\\uD800")'],
      ["encodeURIComponent", 'encodeURIComponent("\\uD800")'],
    ];
    for (const [id, expr] of cases) {
      const r = checkWithEs(`export function f() { return ${expr}; }`);
      const msgs = mayThrowMessages(r);
      expect(msgs.length, `${id}: ${expr} must report may-throw`).toBeGreaterThan(0);
      expect(msgs.join(" | "), `${id}: ${expr}`).toContain("URIError");
      // 原生恒抛 ⇒ 值面是 never（旧行为：回落 string ⇒ 假绿）
      const sig = r.signatures.find((s) => s.name === "f");
      expect(sig, `${id}: f must have a signature`).toBeTruthy();
      expect(formatShape(sig!.abs), `${id}: ${expr}`).toMatch(/\bnever\b/);
    }
  });

  it("2. 合法入参 ⇒ **不**抛（不误红）且值精确", () => {
    const cases: Array<[string, string, string]> = [
      ["decodeURI", 'decodeURI("a b")', '"a b"'],
      ["encodeURI", 'encodeURI("a b")', '"a%20b"'],
      ["encodeURIComponent", 'encodeURIComponent("a b")', '"a%20b"'],
      ["decodeURIComponent", 'decodeURIComponent("a%20b")', '"a b"'],
    ];
    for (const [id, expr, expected] of cases) {
      const r = checkWithEs(`export function f() { return ${expr}; }`);
      expect(mayThrowMessages(r), `${id}: ${expr} must not report may-throw`).toEqual([]);
      const sig = r.signatures.find((s) => s.name === "f");
      expect(formatShape(sig!.abs), `${id}: ${expr}`).toContain(expected);
    }
  });

  it("3. 抽象实参 ⇒ 回落声明域 string（不折自信精确字面量）+ may-throw URIError", () => {
    const r = checkWithEs("export function f(x) { return decodeURI(x); }");
    const sig = r.signatures.find((s) => s.name === "f");
    const display = formatShape(sig!.abs);
    // 值面 = 声明域 string（不是某个具体字面量）
    expect(display).toContain("string");
    expect(display).not.toMatch(/"[^"]*"/);
    // 抽象串可能畸形 ⇒ may-throw URIError（与无 env 的宿主路径同口径）
    const msgs = mayThrowMessages(r);
    expect(msgs.join(" | ")).toContain("URIError");
  });

  it("4. 四个 URI 全局都声明了 throws 面（errBrand('URIError')）", () => {
    const env = defineEnv_____es_ts();
    for (const name of ["encodeURI", "decodeURI", "encodeURIComponent", "decodeURIComponent"]) {
      const fn = env.globals[name];
      expect(fn, `${name} must be declared`).toBeTruthy();
      expect(fn!.shape.k, `${name} must be a function`).toBe("fn");
      const shape = fn!.shape as { paramTypes?: Abs[]; returnType?: Abs };
      expect(shape.paramTypes?.[0]?.shape.k, `${name} param`).toBe("prim");
      expect(shape.returnType?.shape.k, `${name} return`).toBe("prim");
    }
  });
});
});
