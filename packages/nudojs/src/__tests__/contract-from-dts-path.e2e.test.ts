/**
 * `nudo contract --from-dts` 拼错路径不得回落成 npm 包名。
 * 旧实现 `paths.filter(existsSync)` 把不存在的 ./typo-dir 全部当 barePkgs，
 * harvestPackage 报误导性错误（no .d.ts files found / package not found）。
 * 修复：路径形态（./x、/x、含分隔符）miss（ENOENT）→ 明确 path not found；
 * 裸名（无分隔符）仍按包名 harvest（保留原行为）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx as runCli } from "./helpers/run-cli.ts";

describe("contract --from-dts 路径 miss 分类", () => {
  it("拼错的相对路径 → path not found（不当包名、不报 no .d.ts files found）", () => {
    const r = runCli(["contract", "--from-dts", "./definitely-missing-dir"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("path not found for --from-dts");
    expect(r.stderr).toContain("./definitely-missing-dir");
    expect(r.stderr).not.toContain("no .d.ts files found");
  });

  it("拼错的绝对路径 → 同样 path not found", () => {
    const r = runCli(["contract", "--from-dts", "/definitely/missing/pkg"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("path not found for --from-dts");
    expect(r.stderr).not.toContain("no .d.ts files found");
  });

  it("裸名（无分隔符）仍按 npm 包名处理（非 path not found）", () => {
    const r = runCli(["contract", "--from-dts", "definitely-not-a-real-pkg-xyz"]);
    expect(r.status).toBe(1);
    expect(r.stderr).not.toContain("path not found for --from-dts");
  });

  it("存在的 .d.ts 文件照常产出草稿（回归对照）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-fromdts-ok-"));
    try {
      const dts = join(dir, "math.d.ts");
      writeFileSync(dts, "export declare function add(a: number, b: number): number;\n", "utf-8");
      const r = runCli(["contract", "--from-dts", dts]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("add");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
