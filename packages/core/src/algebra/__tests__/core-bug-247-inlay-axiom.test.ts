/**
 * Bug 247（inlay 面）—— 用户公理（`@nudo:invariant` / `@nudo:assume`）**只由
 * check 的动态域播种** ⇒ inlayHint 自算 generalize 时若不播种，IDE 角标印的是
 * 「**没有那条公理**的程序」的类型 ⇒ `nudo check`（CLI）与 IDE 角标跨面矛盾。
 *
 * 夹具（`tmp/repro/bug-247/inv|ctrl/m1.js` 逐字）：同一函数体，只差
 * `@nudo:invariant dp[*] >= 0` 那一行。
 *
 * | 面 | 有公理 | 无公理（对照） |
 * |---|---|---|
 * | CLI `nudo check` 签名行 | `0 \| number` | `number` |
 * | IDE inlayHint | `: 0 \| number` | `: number` ← **改前逐字相同** |
 *
 * 修复后钉（本文件 = **inlay 面**；hover 面见 lsp 包的
 * `lsp-bug-247-*`）：
 * 1. inlay 返回角标随公理那一行变化（`0 | number` ↔ `number`）；
 * 2. inlay 与 check 面**同源**：角标文本 == 签名行返回位文本（逐字）；
 * 3. 任何内部计数器 id（`inv#N` / `len#N`）不得上屏（Bug 412 同款口径）——
 *    公理折出的循环值参与算术时（`inv#2 + 1`）也必须退形状。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSource } from "../check.ts";
import { collectAbsInlays } from "../inlay.ts";
import { pTrue } from "../pred.ts";

/** 有公理：`tmp/repro/bug-247/inv/m1.js` 逐字内容 */
const INV_SRC = `/**
 * @nudo:invariant dp[*] >= 0
 */
export function f(n) {
  const dp = [0];
  for (let i = 1; i < n; i++) {
    dp.push(dp[i - 1] + 1);
  }
  const out = dp[n - 1];
  if (out === undefined) return 0;
  return out;
}
`;

/** 对照组：同一函数体，只删掉 `@nudo:invariant` 那一行 */
const CTRL_SRC = `export function f(n) {
  const dp = [0];
  for (let i = 1; i < n; i++) {
    dp.push(dp[i - 1] + 1);
  }
  const out = dp[n - 1];
  if (out === undefined) return 0;
  return out;
}
`;

/** 公理折出的循环值**参与算术**（`inv#N + 1`）：内部 id 旧口径从这里漏上屏 */
const INV_TERM_SRC = `/**
 * @nudo:invariant dp[*] >= 0
 */
export function h(n) {
  const dp = [0];
  for (let i = 1; i < n; i++) {
    dp.push(dp[i - 1] + 1);
  }
  return dp[n - 1] + 1;
}
`;

type Faces = { inlay: string; check: string; issues: string[] };

/**
 * 同一份源码的**两个面**：
 * - `inlay` = `collectAbsInlays` 的返回角标（`: … · derived` → 返回位文本）
 * - `check` = `checkSource` 的 `NudoSig.display`（CLI 签名行返回位；去掉
 *   ` throws …` 尾缀——那是 L2 域，不在本条的比较面）
 */
function facesOf(name: string, src: string): Faces {
  const dir = mkdtempSync(join(tmpdir(), `nudo-bug247-core-${name}-`));
  try {
    const file = join(dir, `${name}.js`);
    writeFileSync(file, src, "utf-8");
    const report = checkSource(file, src, pTrue, { fromFile: file });
    const sig = report.signatures.find((s) => s.name === (name.startsWith("h") ? "h" : "f"));
    expect(sig, `${name}: check 面没有签名`).toBeDefined();
    const inlays = collectAbsInlays(src, { fromFile: file });
    const ret = inlays.find((i) => i.kind === "type");
    expect(ret, `${name}: inlay 面没有返回角标`).toBeDefined();
    return {
      inlay: ret!.label
        .replace(/^:\s*/, "")
        .replace(/\s*·\s*derived\s*$/, "")
        .trim(),
      check: sig!.display.replace(/\s+throws\s+.*$/, "").trim(),
      issues: report.issues.map((i) => `${i.code}: ${i.message}`),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Bug 247 · inlay 返回位必须消费用户公理（与 check 面同源）", () => {
  it("有公理 ⇒ inlay `0 | number`；无公理 ⇒ `number`；两者不同", () => {
    const inv = facesOf("inv", INV_SRC);
    const ctrl = facesOf("ctrl", CTRL_SRC);

    // 改前：inlay 自算 generalize（未播种）⇒ 两版都是 `number`
    expect(inv.inlay).toBe("0 | number");
    expect(ctrl.inlay).toBe("number");
    // 差异**精确地由公理那一行引起**（不是面固有精度差）
    expect(inv.inlay).not.toBe(ctrl.inlay);
  });

  it("inlay 与 check 面逐字同源（同一 Abs 的两个渲染面）", () => {
    const inv = facesOf("inv", INV_SRC);
    const ctrl = facesOf("ctrl", CTRL_SRC);
    expect(inv.check).toBe("0 | number");
    expect(ctrl.check).toBe("number");
    // 跨面一致：IDE 角标 == CLI 签名行返回位
    expect(inv.inlay).toBe(inv.check);
    expect(ctrl.inlay).toBe(ctrl.check);
  });

  it("公理折出的循环值参与算术（inv#N + 1）⇒ 内部 id 不上屏、退 check 同款形状", () => {
    const f = facesOf("h", INV_TERM_SRC);
    // 改前：`: inv#2 + 1 | NaN · derived`（内部计数器 id 泄漏 + 与 check 面矛盾）
    expect(f.inlay).not.toMatch(/[a-z]+#\d+/);
    expect(f.inlay).toBe(f.check);
    expect(f.inlay).toContain("number");
  });
});
