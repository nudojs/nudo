/**
 * BUG-123 回归：`declare module "pkg" { interface Opts { x; y } const o: Opts; }`
 * —— 接口成员 `x` / `y` 是**接口成员提升**出来的，不是模块导出
 * （TS：`import { x }` ⇒ TS2305）⇒ 模块记录 / 包导出表都不得登记它们。
 *
 * 改前：`import { x } from "mpkg"` 在 nudo 下拿到**自信的 `number`**（假绿）；
 * `tsc` 对同一行报 TS2305。改后：x / y 不导出 ⇒ 诚实降级 `unknown`。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harvestDts, promotedNamesOf } from "../harvest-dts.ts";
import { packageHarvestToAbsModules } from "../harvest-to-abs.ts";
import { materializeHarvestJson, serializeHarvestJson } from "../harvest-json.ts";
import type { PackageHarvest } from "../harvest-package.ts";

const DTS = `declare module "ghostpkg" {
  interface Opts { x: number; y: string; }
  const o: Opts;
  function real(): void;
}
`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(): PackageHarvest {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug123-"));
  dirs.push(dir);
  const file = join(dir, "index.d.ts");
  writeFileSync(file, DTS, "utf-8");
  return { pkg: "ghostpkg", root: dir, dtsFiles: [file], env: harvestDts([file]) };
}

describe("BUG-123 —— 接口成员不得注册成模块导出", () => {
  it("declare module 记录的导出表只含真实声明（o / real）", () => {
    const h = fixture();
    // 白盒：x / y 仍在记录里（brand 面要用），但被标记成「提升」
    expect([...promotedNamesOf(h.env.modules["ghostpkg"]!)]).toEqual(["x", "y"]);
    const named = packageHarvestToAbsModules("ghostpkg", h)["ghostpkg"]!.named;
    expect(Object.keys(named)).toContain("o");
    expect(Object.keys(named)).toContain("real");
    // 幽灵导出必须缺席
    expect(Object.keys(named)).not.toContain("x");
    expect(Object.keys(named)).not.toContain("y");
  });

  it("磁盘缓存往返保留提升 provenance（冷 / 热两面同结论）", () => {
    const h = fixture();
    const json = JSON.parse(
      JSON.stringify(serializeHarvestJson("ghostpkg", h.env, { dtsHash: "h", maxFiles: 1 })),
    );
    const back = materializeHarvestJson(json)!;
    expect([...promotedNamesOf(back.modules["ghostpkg"]!)]).toEqual(["x", "y"]);
    const named = packageHarvestToAbsModules("ghostpkg", { ...h, env: back })["ghostpkg"]!.named;
    expect(Object.keys(named)).toContain("o");
    expect(Object.keys(named)).not.toContain("x");
  });
});
