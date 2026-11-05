import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { checkWeb, slotOf } from "./env-bug-s1-helpers.ts";

/**
 * 族 15 · BUG-150 — web env 把 `crypto.subtle` 的拒绝 reason **一刀切收窄成
 * `OperationError`**，而参数类型非法时宿主拒绝的是 **`TypeError`**
 * （node 实测 `crypto.subtle.encrypt("AES-GCM", 1, 2)` ⇒ `e.name ===
 * "TypeError"`）⇒ `catch (e) { if (e.name === "TypeError") … }` 的**真分支
 * 被判不可达** ⇒ 分支体从签名面消失 ⇒ **假绿**（比假红更隐蔽）。
 *
 * 修法：**静态**声明保持规范面 `OperationError`（既有声明面测试不变），
 * **调用面** reason 放宽为 `OperationError ∪ TypeError` ⇒ 两臂都活。
 *
 * 反向钉：去掉 apply 的联合 reason（只留静态 OperationError）⇒ 本文件必挂。
 */
function host(script: string): string {
  return execFileSync(process.execPath, ["-e", script], { encoding: "utf-8" }).trim();
}

const TRY_CATCH = (call: string) => `export async function enc() {
  try { await ${call}; return "ok"; }
  catch (e) {
    if (e.name === "TypeError") return "caught-typeerror";
    return "other";
  }
}`;

describe("Bug 150 — WebCrypto rejections include TypeError at the call site", () => {
  it("host oracle: invalid arguments reject with a TypeError", async () => {
    const name = host(`
      crypto.subtle.encrypt("AES-GCM", 1, 2).catch((e) => console.log(e.name));
    `);
    expect(name).toBe("TypeError");
  });

  it("the TypeError branch is reachable (was dead code)", () => {
    const out = checkWeb(TRY_CATCH(`crypto.subtle.encrypt("AES-GCM", 1, 2)`));
    expect(out.signatures[0]!.display).toContain("caught-typeerror");
    expect(out.signatures[0]!.display).toContain("other");
  });

  it("the OperationError branch stays reachable too", () => {
    const out = checkWeb(TRY_CATCH(`crypto.subtle.digest("SHA-256", new Uint8Array([1]))`));
    expect(out.signatures[0]!.display).toContain("other");
    expect(out.errorCodes).toEqual([]);
  });

  it("the static declaration keeps OperationError (spec face, not widened)", () => {
    const digest = slotOf("crypto", "subtle", "digest");
    const ret = (digest!.shape as { returnType?: { shape: { k: string; rejected?: { shape: { k: string; name?: string } } } } }).returnType;
    expect(ret?.shape.k).toBe("eff");
    expect(ret?.shape.rejected?.shape.k).toBe("brand");
    expect(ret?.shape.rejected?.shape.name).toBe("OperationError");
  });

  it("importKey keeps an honest unknown reason (several reject paths)", () => {
    const out = checkWeb(TRY_CATCH(`crypto.subtle.importKey("raw", new Uint8Array([1]), "AES-GCM", false, ["encrypt"])`));
    // unknown ⇒ 仍是全路径（含 TypeError）⇒ 分支可达
    expect(out.signatures[0]!.display).toContain("caught-typeerror");
  });
});
