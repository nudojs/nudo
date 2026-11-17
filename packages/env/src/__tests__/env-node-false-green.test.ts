/**
 * node env 的类语义 / 抛出面 / 成员面 / 拒绝 reason 与宿主一致性。
 * 原生 oracle = 同一进程内的真 node；引擎探针 = checkSource + node env 表。
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { $new, formatShape, runWithLoopExits, strLit, takeThrowExits, type Abs } from "@nudojs/core";
import { prim } from "../abs-helpers.ts";
import { defineEnv } from "../node.ts";
import { defineEnv as defineWebEnv } from "../web.ts";
import { checkNode, memberNames, nodeSlotOf, returnTypeOf, slotOfAbs } from "./env-member-tables-helpers.ts";
import { brandName, callSite } from "./env-helpers-call-site.ts";

const env = defineEnv();
const webEnv = defineWebEnv();
const urlMod = env.modules!.url!;
const utilMod = env.modules!.util!;
const qsMod = env.modules!.querystring!;
const cryptoMod = env.modules!.crypto!;

function nativeErrorName(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return (e as Error).name;
  }
}

function rejectedReason(a: Abs | undefined): Abs | undefined {
  if (!a || a.shape.k !== "eff") return undefined;
  return (a.shape as { rejected?: Abs }).rejected;
}

describe("TextEncoder 类语义", () => {
  it("裸调必抛；new 实例面保留；类值声明 ctor/rest/实例成员", () => {
    expect(nativeErrorName(() => (TextEncoder as unknown as () => unknown)())).toBe("TypeError");
    const envPath = checkNode(`export function f(){ return TextEncoder(); }`, true);
    const hostPath = checkNode(`export function f(){ return TextEncoder(); }`, false);
    expect(envPath.signatures[0]!.display).toBe("never throws TypeError");
    expect(hostPath.signatures[0]!.display).toBe("never throws TypeError");
    expect(envPath.errorCodes).toContain("nudo:entry-may-throw");
    expect(hostPath.errorCodes).toContain("nudo:entry-may-throw");

    const out = checkNode(`export function f(){ return new TextEncoder().encoding; }`, true);
    expect(out.signatures[0]!.display).toBe("string");
    expect(out.issues).toEqual([]);
    expect(checkNode(`export function f(){ return new TextEncoder().encoding; }`, false).signatures[0]!.display).toBe('"utf-8"');

    const te = env.globals.TextEncoder!;
    expect(te.shape.k).toBe("fn");
    const shape = te.shape as { ctor?: boolean; params?: string[]; returnType?: Abs };
    expect(shape.ctor).toBe(true);
    expect(shape.params).toEqual(["_rest"]);
    expect(memberNames(shape.returnType!).sort()).toEqual(["encode", "encodeInto", "encoding"]);
  });
});

describe("node:url 的 URL 抛出面", () => {
  it("非法/抽象实参记 TypeError；合法 URL 零抛且 href 精确；$new 也记 may-throw", () => {
    expect(nativeErrorName(() => new URL("not a url"))).toBe("TypeError");

    for (const arg of [strLit("not a url"), prim.str()]) {
      const site = callSite(urlMod.URL!, [arg]);
      expect(site.threw).toBeUndefined();
      expect(site.exits).toHaveLength(1);
      expect(brandName(site.exits[0]!)).toBe("TypeError");
    }

    const ok = callSite(urlMod.URL!, [strLit("https://x.dev/a")]);
    expect(ok.threw).toBeUndefined();
    expect(ok.exits).toHaveLength(0);
    const slots = (ok.value!.shape as { slots: Record<string, { value: Abs }> }).slots;
    const term = slots.href!.value.term as { op?: string; value?: unknown };
    expect(term.op).toBe("lit");
    expect(term.value).toBe("https://x.dev/a");

    const r = runWithLoopExits(() => {
      try {
        const value = $new(urlMod.URL!, [strLit("not a url")]);
        return { value, exits: takeThrowExits() };
      } catch (e) {
        return { exits: takeThrowExits(), threw: e };
      }
    });
    expect(r.threw).toBeUndefined();
    expect(r.value).toBeTruthy();
    expect(r.exits).toHaveLength(1);
    expect(brandName(r.exits[0]!)).toBe("TypeError");
  });
});

describe("util / querystring 的 escape 成员面", () => {
  it("宿主 util 无 escape/unescape、querystring 有；env 声明与宿主一致", () => {
    const req = createRequire(import.meta.url);
    const util = req("node:util") as Record<string, unknown>;
    const qs = req("node:querystring") as Record<string, unknown>;
    expect(util.escape).toBeUndefined();
    expect(util.unescape).toBeUndefined();
    expect(typeof qs.escape).toBe("function");
    expect(typeof qs.unescape).toBe("function");

    expect(Object.keys(utilMod)).not.toContain("escape");
    expect(Object.keys(utilMod)).not.toContain("unescape");
    expect(Object.keys(utilMod).sort()).toEqual([
      "TextDecoder", "TextEncoder", "callbackify", "deprecate", "format",
      "inherits", "inspect", "isDeepStrictEqual", "promisify", "types",
    ]);
    expect(Object.keys(qsMod).sort()).toEqual(["escape", "parse", "stringify", "unescape"]);
    expect(formatShape(qsMod.escape!)).toBe("(string) => string");
    expect(formatShape(qsMod.unescape!)).toBe("(string) => string");
  });
});

describe("crypto.subtle 拒绝 reason", () => {
  const SUBTLE_MEMBERS = ["digest", "encrypt", "decrypt", "sign", "verify", "generateKey", "deriveKey", "deriveBits", "wrapKey", "unwrapKey", "exportKey", "importKey"];

  it("node 宿主拒绝 reason 不止一种 ⇒ node env 全 unknown；web env 除 importKey 外 OperationError", async () => {
    const { webcrypto } = await import("node:crypto");
    const names = new Set<string>();
    const probes: Array<() => Promise<unknown>> = [
      () => webcrypto.subtle.digest("bogus-algo", new Uint8Array([1])),
      () => (webcrypto.subtle.digest as unknown as () => Promise<unknown>)(),
      () => (webcrypto.subtle.encrypt as unknown as (a: unknown, b: unknown) => Promise<unknown>)({ name: "bogus" }, new Uint8Array([1])),
      () => webcrypto.subtle.generateKey({ name: "bogus" }, false, ["sign"]),
      () => (webcrypto.subtle.importKey as unknown as (a: unknown, b: unknown, c: unknown, d: unknown, e: unknown) => Promise<unknown>)("raw", new Uint8Array([1]), { name: "bogus" }, false, ["sign"]),
    ];
    for (const p of probes) {
      try { await p(); } catch (e) { names.add((e as Error).name); }
    }
    expect(names.size).toBeGreaterThan(1);
    expect(names.has("OperationError")).toBe(false);

    for (const member of SUBTLE_MEMBERS) {
      const fn = nodeSlotOf("crypto", "subtle", member);
      expect(fn, member).toBeTruthy();
      const reason = rejectedReason(returnTypeOf(fn));
      expect(reason, member).toBeTruthy();
      expect(reason!.shape.k, member).toBe("unknown");
    }

    const webSubtle = slotOfAbs(webEnv.globals.crypto!, "subtle")!;
    for (const member of SUBTLE_MEMBERS) {
      const reason = rejectedReason(returnTypeOf(slotOfAbs(webSubtle, member)!));
      expect(reason, member).toBeTruthy();
      if (member === "importKey") expect(reason!.shape.k).toBe("unknown");
      else {
        expect(reason!.shape.k).toBe("brand");
        expect((reason!.shape as { name: string }).name).toBe("OperationError");
      }
    }
  });
});

describe("既有声明负控", () => {
  it("全局 130、crypto/fs/fs.promises 成员名单与 formatShape 快照不变", () => {
    const declared = Object.keys(env.globals).sort();
    expect(declared.length).toBe(130);
    for (const name of ["process", "Buffer", "console", "crypto", "performance", "navigator", "TextEncoder", "TextEncoderStream", "TextDecoderStream", "fetch", "URLPattern", "localStorage", "sessionStorage", "__dirname", "__filename"]) {
      expect(declared).toContain(name);
    }

    expect(Object.keys(cryptoMod).sort()).toEqual([
      "createCipheriv", "createDecipheriv", "createHash", "createHmac", "createSign", "createVerify", "generateKeyPairSync",
      "getRandomValues", "pbkdf2Sync", "randomBytes", "randomInt", "randomUUID", "scryptSync", "subtle", "timingSafeEqual", "webcrypto",
    ]);
    expect(Object.keys(env.modules!.fs!).sort()).toEqual([
      "access", "accessSync", "appendFile", "appendFileSync", "chmod", "chmodSync", "chownSync", "copyFile", "copyFileSync",
      "existsSync", "mkdir", "mkdirSync", "open", "openSync", "readFile", "readFileSync", "readdir", "readdirSync", "readlink",
      "readlinkSync", "realpath", "realpathSync", "rename", "renameSync", "rm", "rmSync", "rmdirSync", "stat", "statSync",
      "symlink", "symlinkSync", "unlink", "unlinkSync", "writeFile", "writeFileSync",
    ]);
    expect(Object.keys(env.modules!["fs/promises"]!).sort()).toEqual([
      "access", "appendFile", "chmod", "copyFile", "lstat", "mkdir", "open", "opendir", "readFile", "readdir",
      "readlink", "realpath", "rename", "rm", "stat", "statfs", "symlink", "unlink", "writeFile",
    ]);
    expect(formatShape(cryptoMod.createHash!)).toBe("(string) => Hash");
    expect(formatShape(cryptoMod.randomUUID!)).toBe("() => string");
    expect(formatShape(env.modules!.path!.join!)).toBe("(string, ...paths: string) => string");
  });
});
