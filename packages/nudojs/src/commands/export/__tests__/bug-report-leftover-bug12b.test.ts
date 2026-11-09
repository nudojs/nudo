/**
 * Bug 12B —— 匿名 `export default function (): T;` 的 **stdout 平铺**产物
 * 在普通 `.ts` 模块里报 TS2391（函数声明缺实现）。
 *
 * 根因：`ambientizeDtsSegment` 的 `DEFAULT_EXPORT_DECL` 正则要求绑定名，
 * 匿名形态匹配不上 ⇒ 原样落到 stdout ⇒ TS2391。`--out` 落 `.d.ts` 时该形态
 * 合法（且 core-bug-435 / emit-bug-514 要求保留匿名发射形态）⇒ 缺陷只在
 * stdout 平铺面。
 *
 * 修法：`ambientizeDtsSegment` 对匿名形态分配合成名 `_default`，拆成
 * `declare function _default(): T;` + `export { _default as default };`。
 *
 * 用 `stdoutChunks`（stdout 平铺的唯一组装入口）直接钉改写结果，避免起
 * CLI 子进程；真 `tsc --noEmit --strict` 消费端校验由 CLI 手工复现覆盖。
 */
import { describe, it, expect } from "vitest";
import { stdoutChunks } from "../stdout.ts";

/** 只投 dts 段（其余方言段为空 ⇒ 跨段改名不介入）。 */
function dtsStdout(dts: string): string {
  return stdoutChunks({
    standardChunks: [],
    guardChunks: [],
    dtsChunks: [dts],
    droppedNotes: [],
  }).join("\n");
}

describe("Bug 12B — 匿名 default 声明的 stdout 平铺是合法 ambient 形态", () => {
  it("匿名 function：`declare function _default` + `export { _default as default }`", () => {
    const out = dtsStdout(
      "/**\n * @returns number\n */\nexport default function (): number;",
    );
    expect(out).toContain("declare function _default(): number;");
    expect(out).toContain("export { _default as default };");
    // 普通 .ts 模块里不允许 `export default function (…)`（TS2391）
    expect(out).not.toMatch(/^export default function\s*\(/m);
  });

  it("匿名 class：`declare class _default` + `export { _default as default }`", () => {
    const out = dtsStdout("export default class { m(): number; }");
    expect(out).toContain("declare class _default");
    expect(out).toContain("export { _default as default };");
    expect(out).not.toMatch(/^export default class\s*\{/m);
  });

  it.each([
    ["泛型", "export default function<T>(x: T): T;", "declare function _default<T>(x: T): T;"],
    ["generator", "export default function* (): Generator;", "declare function* _default(): Generator;"],
    ["class extends", "export default class extends B { m(): number; }", "declare class _default extends B"],
  ] as const)("匿名 %s 形态也正确分配合成名", (_name, dts, expected) => {
    expect(dtsStdout(dts)).toContain(expected);
  });
});

describe("Bug 12B 对照组 — 既有形态不回归", () => {
  it("具名 default 函数仍走 BUG-074 形态（`declare function main`）", () => {
    const out = dtsStdout("export default function main(): number;");
    expect(out).toContain("declare function main(): number;");
    expect(out).toContain("export { main as default };");
    expect(out).not.toContain("_default");
  });

  it("具名 default 类仍走 BUG-074 形态（`declare class Box`）", () => {
    const out = dtsStdout("export default class Box { get(): number; }");
    expect(out).toContain("declare class Box { get(): number; }");
    expect(out).toContain("export { Box as default };");
  });

  it("具名导出不受影响（`export declare function` 原样）", () => {
    const out = dtsStdout("export declare function add(a: number): number;");
    expect(out).toContain("export declare function add(a: number): number;");
    expect(out).not.toContain("as default");
  });
});
