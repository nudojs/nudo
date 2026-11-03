import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withTmpProject } from "./tmp-project.ts";
import {
  DiskCache,
  DiskCacheSignError,
  checkCacheKey,
  openDiskCache,
} from "../disk-cache.ts";
import { diskCacheSignState, type NudoCacheConfig } from "../evaluator/config.ts";

/**
 * B3 签名磁盘缓存（`nudo.cache.sign: true` + `NUDO_CACHE_KEY`）：
 *  - 逐条 HMAC-SHA256（篡改 ⇒ miss 回算，不 throw——fail-open 只对**内容**，
 *    配置错误仍然 fail-closed）；
 *  - 密钥空间分离（signed/unsigned 不同 storage key ⇒ 轮换/模式切换不脏命中）；
 *  - sign 开而 key 缺席 / sign 形状非法 ⇒ DiskCacheSignError（不静默降级）。
 */
describe("B3 signed disk cache", () => {
  it("sign state: on/off/error 三态（env 可注入）", () => {
    expect(diskCacheSignState(undefined).kind).toBe("off");
    expect(diskCacheSignState({ cache: true }).kind).toBe("off");
    expect(diskCacheSignState({ cache: { sign: true } }, { NUDO_CACHE_KEY: "k" }).kind).toBe("on");
    // sign 开但密钥缺席 ⇒ error（安全旋钮不静默降级）
    const noKey = diskCacheSignState({ cache: { sign: true } }, {});
    expect(noKey.kind).toBe("error");
    expect((noKey as { message: string }).message).toContain("NUDO_CACHE_KEY");
    // 空串密钥 = 缺席同判
    expect(diskCacheSignState({ cache: { sign: true } }, { NUDO_CACHE_KEY: "" }).kind).toBe("error");
    // sign 形状非法（typo 防护）⇒ error——不得按「没写」处理
    expect(
      diskCacheSignState(
        { cache: { sign: "true" as unknown as boolean } },
        { NUDO_CACHE_KEY: "k" },
      ).kind,
    ).toBe("error");
  });

  it("signed entries round-trip and carry a sig field", () =>
    withTmpProject("nudo-cache-sign-", (root) => {
      const c = openDiskCache({
        config: { cache: { sign: true } },
        projectDir: root,
        namespace: "check",
        env: { NUDO_CACHE_KEY: "s3cret" },
      });
      const key = checkCacheKey("/p/a.js", "export const x = 1;\n", { autoBind: true });
      expect(c.get(key)).toBeUndefined();
      c.set(key, { ok: true, n: 1 });
      expect(c.get(key)).toEqual({ ok: true, n: 1 });
      // 落盘条目含 sig（HMAC-SHA256 hex = 64 字符）
      const nsDir = join(root, ".nudo", "cache", "check");
      const entry = readdirSync(nsDir, { recursive: true })
        .map((f) => join(nsDir, String(f)))
        .filter((p) => p.endsWith(".json"))[0]!;
      const raw = JSON.parse(readFileSync(entry, "utf8")) as { sig?: string };
      expect(typeof raw.sig).toBe("string");
      expect((raw.sig as string).length).toBe(64);
    }));

  it("tampered value = miss (no throw), forged verdict never served", () =>
    withTmpProject("nudo-cache-sign-", (root) => {
      const c = openDiskCache({
        config: { cache: { sign: true } },
        projectDir: root,
        namespace: "check",
        env: { NUDO_CACHE_KEY: "s3cret" },
      });
      const key = checkCacheKey("/p/a.js", "src", { autoBind: true });
      c.set(key, { ok: false });
      // 篡改 value（结构合法的「绿」）但不重算 sig
      const nsDir = join(root, ".nudo", "cache", "check");
      const entry = readdirSync(nsDir, { recursive: true })
        .map((f) => join(nsDir, String(f)))
        .filter((p) => p.endsWith(".json"))[0]!;
      const raw = JSON.parse(readFileSync(entry, "utf8")) as {
        value: unknown;
        sig: string;
      };
      (raw.value as { ok: boolean }).ok = true;
      writeFileSync(entry, JSON.stringify(raw));
      // 校验失败 ⇒ miss（undefined），绝不返回被伪造的内容，也不 throw
      expect(c.get(key)).toBeUndefined();
      // 回写后恢复为（新）真值 ⇒ 命中
      c.set(key, { ok: false });
      expect(c.get(key)).toEqual({ ok: false });
    }));

  it("stripped/missing sig = miss (unsigned entries cannot leak into signed reads)", () =>
    withTmpProject("nudo-cache-sign-", (root) => {
      const c = openDiskCache({
        config: { cache: { sign: true } },
        projectDir: root,
        namespace: "check",
        env: { NUDO_CACHE_KEY: "s3cret" },
      });
      const key = checkCacheKey("/p/a.js", "src", { autoBind: true });
      c.set(key, { v: 1 });
      const nsDir = join(root, ".nudo", "cache", "check");
      const entry = readdirSync(nsDir, { recursive: true })
        .map((f) => join(nsDir, String(f)))
        .filter((p) => p.endsWith(".json"))[0]!;
      const raw = JSON.parse(readFileSync(entry, "utf8")) as { sig?: string };
      delete raw.sig;
      writeFileSync(entry, JSON.stringify(raw));
      expect(c.get(key)).toBeUndefined();
    }));

  it("key rotation and mode switch miss cleanly (separate key spaces, no orphans needed)", () =>
    withTmpProject("nudo-cache-sign-", (root) => {
      const key = checkCacheKey("/p/a.js", "src", { autoBind: true });
      const cfg: NudoCacheConfig = { sign: true };
      const c1 = openDiskCache({ config: { cache: cfg }, projectDir: root, namespace: "check", env: { NUDO_CACHE_KEY: "k1" } });
      c1.set(key, { v: 1 });
      expect(c1.get(key)).toEqual({ v: 1 });
      // 轮换密钥：同一路径 ⇒ 验签失败 ⇒ miss（原条目留在原地无害）
      const c2 = openDiskCache({ config: { cache: cfg }, projectDir: root, namespace: "check", env: { NUDO_CACHE_KEY: "k2" } });
      expect(c2.get(key)).toBeUndefined();
      // 关闭签名：unsigned 键空间与 signed 不同 ⇒ 同一逻辑键不脏命中
      const c3 = openDiskCache({ config: { cache: { sign: false } }, projectDir: root, namespace: "check", env: {} });
      expect(c3.get(key)).toBeUndefined();
      c3.set(key, { v: 3 });
      expect(c3.get(key)).toEqual({ v: 3 });
      // 再开签名：signed 条目还在（c1 写入的），且不受 unsigned 条目影响
      const c4 = openDiskCache({ config: { cache: cfg }, projectDir: root, namespace: "check", env: { NUDO_CACHE_KEY: "k1" } });
      expect(c4.get(key)).toEqual({ v: 1 });
    }));

  it("openDiskCache throws DiskCacheSignError on sign-without-key (library backstop)", () => {
    expect(() =>
      openDiskCache({ config: { cache: { sign: true } }, projectDir: "/tmp", namespace: "check", env: {} }),
    ).toThrow(DiskCacheSignError);
    expect(() =>
      openDiskCache({ config: { cache: { sign: 1 as unknown as boolean } }, projectDir: "/tmp", namespace: "check", env: { NUDO_CACHE_KEY: "k" } }),
    ).toThrow(DiskCacheSignError);
  });

  it("unsigned DiskCache (signKey absent) keeps the legacy byte shape {abi,value}", () =>
    withTmpProject("nudo-cache-sign-", (root) => {
      const c = new DiskCache({ root: join(root, ".nudo", "cache"), namespace: "check" });
      const key = checkCacheKey("/p/a.js", "src", { autoBind: true });
      c.set(key, { v: 1 });
      const nsDir = join(root, ".nudo", "cache", "check");
      const entry = readdirSync(nsDir, { recursive: true })
        .map((f) => join(nsDir, String(f)))
        .filter((p) => p.endsWith(".json"))[0]!;
      const raw = JSON.parse(readFileSync(entry, "utf8")) as Record<string, unknown>;
      expect(Object.keys(raw).sort()).toEqual(["abi", "value"]);
    }));
});
