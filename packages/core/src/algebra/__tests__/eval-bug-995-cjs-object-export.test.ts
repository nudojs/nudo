/**
 * Bug 995 —— `module.exports = { f: fn }`（CJS 对象字面量导出）的函数在
 * **core 的 check 面**不可见：导出表里只有 `module.exports` 本身（default
 * 槽），成员 `f` 查不到 ⇒ 签名退成 `unknown` + 指向错误的 nudo:opaque-result。
 *
 * 修法（core 侧）：`algebra/export-slot.ts` 的 CJS 对象字面量成员桥接
 * （`module.exports = { … }` 的成员登记成可按名查找的导出槽），
 * `algebra/generalize.ts` 消费它（成员调用走 $invoke 桥）。
 *
 * 本文件钉住：
 * - 正控制：CJS 对象字面量导出的成员在 check 面**可按名查到**，签名是实值，
 *   且不再产生 nudo:opaque-result；
 * - 负控制：普通 CJS 具名导出（`exports.f = fn`）行为不变；CJS 成员桥
 *   不得劫持无关的本地函数；
 * - 原生 oracle 对拍（node 另起进程，CJS）：成员挂在 exports 对象上，
 *   调用返回同样的值。
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

/** CJS 对象字面量导出：成员 greet 挂在 module.exports 上 */
const CJS_OBJECT_SRC = `module.exports = {
  greet: function (name) {
    return "hi " + name;
  },
};
`;

describe("Bug 995：CJS 对象字面量导出的 check 面成员桥接", () => {
  it("成员在签名面可按名查到，返回类型是实值（string）", () => {
    const r = checkSource("/t/cjs.js", CJS_OBJECT_SRC, pTrue);
    const sig = r.signatures.find((s) => s.name === "greet");
    expect(sig, "CJS 对象字面量成员 greet 必须出现在签名面").toBeDefined();
    expect(sig!.display).toContain("string");
    expect(sig!.conf).not.toBe("opaque");
  });

  it("不再产生指向错误的 nudo:opaque-result", () => {
    const r = checkSource("/t/cjs.js", CJS_OBJECT_SRC, pTrue);
    const opaque = r.issues.filter((i) => i.code === "nudo:opaque-result");
    expect(opaque).toEqual([]);
  });

  it("负控制：普通 CJS 具名导出行为不变（exports.f = fn）", () => {
    const src = `exports.greet = function (name) {
  return "hi " + name;
};
`;
    const r = checkSource("/t/cjs2.js", src, pTrue);
    const sig = r.signatures.find((s) => s.name === "greet");
    expect(sig).toBeDefined();
    expect(sig!.display).toContain("string");
  });

  it("负控制：成员桥不得劫持无关的本地函数", () => {
    const src = `function other() {
  return 7;
}
module.exports = {
  greet: function () {
    return 1;
  },
};
`;
    const r = checkSource("/t/cjs3.js", src, pTrue);
    const other = r.signatures.find((s) => s.name === "other");
    expect(other).toBeDefined();
    expect(other!.display).toContain("7");
  });

  it("原生 oracle：CJS 成员挂在 exports 对象上（node 另起进程对拍）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug995-"));
    const mod = join(dir, "mod.cjs");
    writeFileSync(
      mod,
      `module.exports = {
  greet: function (name) {
    return "hi " + name;
  },
};
`,
      "utf8",
    );
    const runner = join(dir, "run.cjs");
    writeFileSync(
      runner,
      `const m = require("./mod.cjs");
console.log(JSON.stringify({ keys: Object.keys(m), value: m.greet("x") }));
`,
      "utf8",
    );
    const res = spawnSync(process.execPath, [runner], { encoding: "utf8", timeout: 60_000 });
    expect(res.status, `subprocess stderr: ${res.stderr}`).toBe(0);
    const native = JSON.parse(res.stdout.trim()) as { keys: string[]; value: string };
    expect(native.keys).toContain("greet");
    expect(native.value).toBe("hi x");

    // 引擎侧：成员名可按名查到，返回类型与原生值域一致（string）
    const r = checkSource("/t/cjs.js", CJS_OBJECT_SRC, pTrue);
    const sig = r.signatures.find((s) => s.name === "greet")!;
    expect(sig.display).toContain(typeof native.value);
  });
});
