/**
 * Bug 489 —— `export default function f() { … }` 的**入口求值按「局部名」查
 * 导出表** ⇒ ESM 语义下默认导出只挂在 `default` 槽 ⇒ 查表落空 ⇒ 签名退成
 * `unknown` + 一条**指向错误**的 `nudo:opaque-result`。
 *
 * 修法（core 侧）：`algebra/export-slot.ts` 给出「本地名 → 导出槽」的兜底
 * 解析（局部名找不到 ⇒ 回退 `default` 槽），`algebra/generalize.ts` 消费它。
 *
 * 本文件钉住：
 * - 正控制：具名 default 导出的签名是**实值**（不是 unknown），且不再产生
 *   那条指向错误的 nudo:opaque-result；
 * - 负控制：普通具名导出的行为**不变**；default 导出**不得劫持**别的函数；
 * - 原生 oracle 对拍（node 另起进程，ESM 严格模式）：默认槽挂的就是那个
 *   函数，调用返回同样的值。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSource, resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { pTrue } from "../pred.ts";

beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
});

/** 具名 default 导出（ESM）：本地名 f，导出槽只有 default */
const DEFAULT_EXPORT_SRC = `export default function f() {
  return 41 + 1;
}
`;

describe("Bug 489：具名 default 导出的 check 面查表兜底", () => {
  it("签名是实值（41+1），不是 unknown", () => {
    const r = checkSource("/t/d.js", DEFAULT_EXPORT_SRC, pTrue);
    const sig = r.signatures.find((s) => s.name === "f");
    expect(sig, "default 导出的本地名 f 必须出现在签名面").toBeDefined();
    expect(sig!.display).toContain("42");
    expect(sig!.conf).not.toBe("opaque");
  });

  it("不再产生指向错误的 nudo:opaque-result", () => {
    const r = checkSource("/t/d.js", DEFAULT_EXPORT_SRC, pTrue);
    const opaque = r.issues.filter((i) => i.code === "nudo:opaque-result");
    expect(opaque).toEqual([]);
  });

  it("负控制：普通具名导出行为不变（default 导出不得劫持别的函数）", () => {
    const src = `export default function f() {
  return 1;
}
export function g() {
  return 2;
}
function local() {
  return 3;
}
`;
    const r = checkSource("/t/d2.js", src, pTrue);
    const byName = new Map(r.signatures.map((s) => [s.name, s]));
    expect(byName.get("f")!.display).toContain("1");
    expect(byName.get("g")!.display).toContain("2");
    expect(byName.get("local")!.display).toContain("3");
  });

  it("同源：`export default class C { m() }` 的方法也走 default 槽（不再 unknown）", () => {
    const src = `export default class C {
  m() {
    return 7;
  }
}
`;
    const r = checkSource("/t/d3.js", src, pTrue);
    const sig = r.signatures.find((s) => s.name === "C.m");
    expect(sig, "默认导出的类方法必须出现在签名面").toBeDefined();
    expect(sig!.display).toContain("7");
    expect(sig!.conf).not.toBe("opaque");
  });

  it("原生 oracle：ESM 默认槽挂的就是那个函数（node 另起进程对拍）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug489-"));
    const mod = join(dir, "mod.mjs");
    writeFileSync(
      mod,
      `export default function f() {
  return 41 + 1;
}
`,
      "utf8",
    );
    const runner = join(dir, "run.mjs");
    writeFileSync(
      runner,
      `import def from "./mod.mjs";
console.log(JSON.stringify({ type: typeof def, value: def() }));
`,
      "utf8",
    );
    const res = spawnSync(process.execPath, [runner], { encoding: "utf8", timeout: 60_000 });
    expect(res.status, `subprocess stderr: ${res.stderr}`).toBe(0);
    const native = JSON.parse(res.stdout.trim()) as { type: string; value: number };
    expect(native.type).toBe("function");
    expect(native.value).toBe(42);

    // 引擎侧：同一个函数的返回值必须与原生一致
    const r = checkSource("/t/d.js", DEFAULT_EXPORT_SRC, pTrue);
    const sig = r.signatures.find((s) => s.name === "f")!;
    expect(sig.display).toContain(String(native.value));
  });
});
