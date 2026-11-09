/**
 * 分册 12 回归：磁盘缓存签名 / 路径身份。
 *
 * - Bug 1：HMAC 签名绑定缓存键 ⇒ 跨键复制合法签发的条目必须判 miss；旧格式
 *   （签名不含键）条目只当 miss、不崩（向后兼容）。
 * - Bug 2：入口文件相对化失败时保留路径身份（ext:），同内容不同路径必不同键；
 *   依赖路径的 cnt: 内容指纹跨机复用保持不变（disk-cache.test.ts:472 口径）。
 */
import { describe, it, expect } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withTmpProject } from "./tmp-project.ts";
import { ANALYSIS_ABI, DiskCache, checkCacheKey } from "../disk-cache.ts";

/** namespace 目录下所有 .json 条目路径 */
function entries(nsDir: string): string[] {
  return readdirSync(nsDir, { recursive: true })
    .map((f) => join(nsDir, String(f)))
    .filter((p) => p.endsWith(".json"));
}

/** 找出 value.file 以 name 结尾的条目路径 */
function entryWithFile(nsDir: string, name: string): string | undefined {
  return entries(nsDir).find((p) => {
    try {
      const parsed = JSON.parse(readFileSync(p, "utf8")) as { value?: { file?: string } };
      return parsed.value?.file?.endsWith(name) === true;
    } catch {
      return false;
    }
  });
}

describe("Bug 1 — 磁盘缓存签名绑定缓存键（跨键重放伪造绿）", () => {
  it("合法签发的绿条目被复制到另一键路径 => get(另一键) 判 miss，绝不返回绿", () =>
    withTmpProject("nudo-bug1-replay-", (root) => {
      const c = new DiskCache({ root, namespace: "check", signKey: "s3cret" });
      const goodKey = checkCacheKey("/p/good.js", "good src", { autoBind: true });
      const badKey = checkCacheKey("/p/bad.js", "bad src", { autoBind: true });
      expect(goodKey).not.toBe(badKey);

      c.set(goodKey, { ok: true, file: "/p/good.js" }); // 绿
      c.set(badKey, { ok: false, file: "/p/bad.js" }); // 红

      const nsDir = join(root, "check");
      const goodPath = entryWithFile(nsDir, "good.js");
      const badPath = entryWithFile(nsDir, "bad.js");
      expect(goodPath).toBeDefined();
      expect(badPath).toBeDefined();

      // 攻击：把 good 的签名条目原样覆盖到 bad 的落盘路径（路径由键推导、公开可算）
      copyFileSync(goodPath!, badPath!);

      // 签名绑定的是 goodKey：good 自己的键仍命中
      expect(c.get(goodKey)).toEqual({ ok: true, file: "/p/good.js" });
      // bad 键下用 badKey 重算签名 ≠ 条目里 goodKey 的签名 ⇒ miss（不返回绿）
      expect(c.get(badKey)).toBeUndefined();
    }));

  it("旧格式（签名不含键）条目只当 miss，不崩（向后兼容）", () =>
    withTmpProject("nudo-bug1-legacy-", (root) => {
      const c = new DiskCache({ root, namespace: "check", signKey: "s3cret" });
      const key = checkCacheKey("/p/a.js", "src", { autoBind: true });
      const value = { ok: true };
      c.set(key, value);
      const nsDir = join(root, "check");
      const entryPath = entries(nsDir)[0]!;

      // 复刻修复前的签名公式（不含 key）：HMAC(SIGN_DOMAIN\0abi\0valueJson)
      const SIGN_DOMAIN = "nudo-disk-cache-sign-v1";
      const keyMat = createHash("sha256").update(`${SIGN_DOMAIN}\0s3cret`).digest();
      const legacySig = createHmac("sha256", keyMat)
        .update(`${SIGN_DOMAIN}\0${ANALYSIS_ABI}\0${JSON.stringify(value)}`)
        .digest("hex");
      const entry = JSON.parse(readFileSync(entryPath, "utf8")) as Record<string, unknown>;
      entry.sig = legacySig;
      writeFileSync(entryPath, JSON.stringify(entry));

      // 旧条目签名与新公式（含 key）不符 ⇒ miss；不得抛异常
      expect(() => c.get(key)).not.toThrow();
      expect(c.get(key)).toBeUndefined();
      // 重新写入的新格式条目正常命中
      c.set(key, value);
      expect(c.get(key)).toEqual(value);
    }));
});

describe("Bug 2 — 入口路径相对化失败保留路径身份", () => {
  it("同内容、不同路径的入口文件 => 不同缓存键（修复前同为 cnt: 内容指纹 ⇒ 同键、file 指错）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug2-entry-"));
    const content = "export const x = 1;\n";
    const a = checkCacheKey(join(dir, "a.js"), content, { autoBind: true });
    const b = checkCacheKey(join(dir, "b.js"), content, { autoBind: true });
    expect(a).not.toBe(b);
    // 同一路径 + 同内容 ⇒ 稳定同键
    expect(checkCacheKey(join(dir, "a.js"), content, { autoBind: true })).toBe(a);
  });

  it("依赖路径的 cnt: 内容指纹跨机复用保持不变（disk-cache.test.ts:472 口径）", () => {
    const base = { autoBind: true, projectDir: "/p" };
    const a = checkCacheKey("/p/a.js", "entry", {
      ...base,
      depContents: [{ path: "/Users/alice/store/orphan.js", content: "dep\n" }],
    });
    const b = checkCacheKey("/p/a.js", "entry", {
      ...base,
      depContents: [{ path: "/home/ci/store/orphan.js", content: "dep\n" }],
    });
    // 依赖不进 file 字段，同内容不同机器路径仍同键
    expect(a).toBe(b);
  });
});
