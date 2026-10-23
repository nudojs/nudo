/**
 * 族 35 · Bug 1044 / 1047 / 1048 / 1049 —— env 成员表对齐（node / web 两 env）。
 *
 * 共同根因：env 的成员表是**手写**的 ⇒（a）**缺**成员 ⇒ 闭 obj 缺槽 ⇒ 成员读出
 * **exact `undefined`**（确定的错值）⇒ 调用即「确定抛 TypeError」⇒ **L2 门禁假红**
 * （1047 / 1048 / 1049）；（b）**写错返回域** ⇒ 宿主必抛的调用被判安全 ⇒ **L2 门禁
 * 假绿**（1044）。
 *
 * 四条各自的病灶（族 35 之前从未被任何批次处理过）：
 * - 1044：`packages/env/src/node.ts` 的 `Response` **静态面** `json` 返回域写成
 *   `promise<unknown>`（WHATWG Fetch / undici：静态 `Response.json` **同步**返回
 *   `Response`）；同表 `error` / `redirect` 都返回 `Response` ⇒ 表内不自洽。
 * - 1047：node env 的 `performance` 表只有 9 个槽，缺宿主真实存在的 6 个
 *   （`toJSON` / `clearResourceTimings` / `eventLoopUtilization` / `timerify` /
 *   `setResourceTimingBufferSize` / `nodeTiming`）；web env 同一对象早已补过前两个
 *   （Bug 862）⇒ 两 env 不对称。
 * - 1048：node env 的 `navigator` 表缺 `locks`（Web Locks API，W3C 标准）⇒
 *   `navigator.locks` 读出 exact `undefined`，`navigator.locks.request(...)` 判
 *   「确定抛 TypeError」。
 * - 1049：web env 的 `crypto.subtle` 表只有 8 个键，缺 4 个标准 WebCrypto API
 *   （`deriveKey` / `deriveBits` / `wrapKey` / `unwrapKey`）；node env 同一对象
 *   早已声明前两个 ⇒ 两 env 自相矛盾。
 *
 * 修法：补齐缺失成员（**只补宿主实测存在的**）+ 宿主实测护栏（真 node 跑
 * `Object.getOwnPropertyNames` 对照 env 表）+ 同名对象两 env 同源。
 *
 * 负控：宿主**没有**的成员仍被判「确定缺失」⇒ 证明没有把整张表改成全放行。
 */
import { describe, it, expect } from "vitest";
import type { Abs } from "@nudojs/core";
import { checkWeb, displayOf, slotOf } from "./env-bug-s1-helpers.ts";
import {
  checkNode,
  hostOwnMembers,
  hostProtoMembers,
  instanceFaceOf,
  memberNames,
  nodeSlotOf,
  returnTypeOf,
  staticSlotOf,
} from "./env-bug-1044-1049-helpers.ts";

// ── 宿主实测排除项（每条都有理由；护栏 = 宿主成员 − 排除项 ⊆ env 表）──────

/**
 * `performance` 原型面上**不建模**的宿主成员：
 * - `markResourceTiming`：宿主上以非法 cache 名调用**必抛**
 *   （`cache must be an empty string or 'local'`）⇒ 不是「普通可调用成员」。
 * - `onresourcetimingbufferfull`：事件回调**属性**（宿主上是 null），不是方法。
 */
const PERFORMANCE_EXCLUDED = ["markResourceTiming", "onresourcetimingbufferfull"];

/**
 * `crypto.subtle` 原型面上**不建模**的宿主成员：node 后期量子（PQ）扩展
 * （`getPublicKey` / `encapsulate*` / `decapsulate*`）——**非 WebCrypto 标准**
 * ⇒ 浏览器没有；node env 本次也不建模（超出 Bug 1049 的标准 API 范围）
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

describe("Bug 1044 — node env 的静态 `Response.json` 返回域是 `Response`（不是 promise）", () => {
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

describe("Bug 1047 — node env 的 `performance` 补齐 6 个宿主真实成员", () => {
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

describe("Bug 1048 — node env 的 `navigator` 补 `locks`（Web Locks API）", () => {
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

describe("Bug 1049 — web env 的 `crypto.subtle` 补 4 个标准 WebCrypto API", () => {
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
