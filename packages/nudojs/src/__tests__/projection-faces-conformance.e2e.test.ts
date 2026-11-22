/**
 * export 四个产物面的模式传播：`unifiedReturnFace` 算出的 widen 模式必须
 * 真正传到 zod / guard / standard，而不只停在 service 的单测里。
 *
 * 注意：export 的 case 档是 `"none"`（文档明确 `@nudo:case` 是调试见证，不是
 * 发布契约，BUG-044）⇒ 这里的返回面都是纯观测，必须与 dts 一样递归拓宽。
 * `scalar` / `none` 两个模式由 service 的 `projection-conformance` 单测覆盖。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx, writeSrcTsconfig } from "./helpers/run-cli.ts";

const SOURCE = `export function two() { return [1, 2]; }

export function objs() { return [{ a: 1 }, { a: 2 }]; }
`;

describe("export 产物面的返回 widen 模式传播", () => {
  it("纯观测元组在 dts / zod / guard 三面都发布成数组", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-projection-faces-"));
    try {
      writeSrcTsconfig(dir);
      writeFileSync(join(dir, "lib.ts"), SOURCE, "utf-8");
      const r = runCliTsx(["export", "lib.ts", "--format", "all"], { cwd: dir });
      expect(r.status, r.stderr).toBe(0);

      // dts
      expect(r.stdout).toContain("export declare function two(): number[];");
      expect(r.stdout).toContain("export declare function objs(): { a: number }[];");

      // zod
      expect(r.stdout).toContain("export const twoOutput = z.array(");
      expect(r.stdout).toContain("export const objsOutput = z.array(");

      // guard
      expect(r.stdout).toContain("export function istwoOutput");
      expect(r.stdout).toContain("export function isobjsOutput");
      expect(r.stdout).toContain("Array.from(data).every");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
