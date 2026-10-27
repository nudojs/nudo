/**
 * BUG-074 — `nudo export --format all` 的 stdout 平铺面在模块有 `default`
 * 导出时**不是合法 TS 模块**（TS2391 / TS2390）。
 *
 * dts 生成器写的是 `.d.ts` 上下文：具名导出带 `declare`，但 `default` 导出
 * 写成 `export default function f(…): T;`（无实现、无 `declare`）⇒ 平铺进
 * stdout 这个**普通 `.ts` 模块**就不可编译。`--out` 落盘时各段进 `.d.ts`
 * 文件 ⇒ 合法，缺陷只在 stdout 平铺面。
 *
 * 修复：平铺前改写成 ambient 形态
 * `declare function f(…): T;` + `export { f as default };`（类同理）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const DEFAULT_FN = `export default function main(x) {
  return x + 1;
}
main(1);
`;

const DEFAULT_CLASS = `export default class Box {
  constructor(v) {
    this.v = v;
  }
  get() {
    return this.v;
  }
}
`;

const NAMED = `export function add(a, b) {
  return a + b;
}
`;

function withProject(files: Record<string, string>, fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug74-"));
  try {
    for (const [name, src] of Object.entries(files)) writeFileSync(join(dir, name), src);
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("BUG-074 — stdout 平铺面的 default 导出必须是 ambient 合法形态", () => {
  it("default 函数：declare function + `export { main as default }`", () => {
    withProject({ "defexp.js": DEFAULT_FN }, (dir) => {
      const out = runCliTsx(["export", join(dir, "defexp.js"), "--format", "all"]).stdout;
      expect(out).toContain("declare function main(");
      expect(out).toContain("export { main as default };");
      // `export default function` 在普通模块里没有实现 ⇒ TS2391
      expect(out).not.toMatch(/^export default function /m);
    });
  });

  it("default 类：declare class + `export { Box as default }`", () => {
    withProject({ "defcls.js": DEFAULT_CLASS }, (dir) => {
      const out = runCliTsx(["export", join(dir, "defcls.js"), "--format", "all"]).stdout;
      expect(out).toContain("declare class Box {");
      expect(out).toContain("export { Box as default };");
      expect(out).not.toMatch(/^export default class /m);
    });
  });

  it("单独 --format dts 同样合法（存成 .ts 也可编译）", () => {
    withProject({ "defexp.js": DEFAULT_FN }, (dir) => {
      const out = runCliTsx(["export", join(dir, "defexp.js"), "--format", "dts"]).stdout;
      expect(out).toContain("declare function main(");
      expect(out).toContain("export { main as default };");
    });
  });

  it("具名导出保持既有 `export declare function` 形态", () => {
    withProject({ "named.js": NAMED }, (dir) => {
      const out = runCliTsx(["export", join(dir, "named.js"), "--format", "all"]).stdout;
      expect(out).toContain("export declare function add(");
      expect(out).not.toContain("as default");
    });
  });
});
