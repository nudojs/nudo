/**
 * Bug 814 回归（harvester 收割面）：`export default` **不在模块导出表里** ⇒
 * 默认导入落 `unknown`（假警告）；同时**默认导出的局部名被当成具名导出**（假绿）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h4/）：
 * - `export default function makeThing(): number;` ⇒ 默认导入 `() => number`，
 *   而 `import { makeThing } from "fx"` 是 **TS2614**（该模块没有具名导出 `makeThing`）。
 * - `export default class Widget { render(): string; }` ⇒ 默认导入拿到类（构造签名），
 *   `import { Widget } from "fx"` 同样是 **TS2614**。
 *
 * 契约：
 *   1. 导出表里有 `default`（键名就是 `default`）；
 *   2. 默认导出的**局部名不进导出表**（否则 `import { makeThing }` 假绿）；
 *   3. 桥接层不把局部名抬成具名导出（包名键的 `named` 里没有 `makeThing`）。
 *
 * 桥接层的另一半（包名键的 `default` 槽 + 扫描面登记 `default`）由 H7 并发修好
 * （`harvest-package.ts` 的 `scanDtsFile` 现在对 `export default function/class`
 * 登记 `default` 而不是局部名）—— 本文件把收割面与桥接面一起钉住。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatShape, getFnImpl } from "@nudojs/core";
import { harvestDts } from "../harvest-dts.ts";
import { packageHarvestToAbsModules } from "../harvest-to-abs.ts";
import type { PackageHarvest } from "../harvest-package.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug814-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** 用收割面造一个 PackageHarvest（不必真的装一个包） */
function pkgOf(pkg: string, file: string): PackageHarvest {
  return { pkg, root: join(file, ".."), dtsFiles: [file], env: harvestDts([file]) };
}

describe("Bug 814 —— `export default` 进导出表，局部名不进", () => {
  it("`export default function makeThing()` ⇒ 导出表有 default，没有 makeThing", () => {
    const p = writeTemp("fx.d.ts", `export default function makeThing(): number;\n`);
    const env = harvestDts([p]);
    expect(env.globals["default"]).toBeDefined();
    expect(formatShape(env.globals["default"]!)).toBe("() => number");
    // 局部名不得顺带变成具名导出（TS 侧是 TS2614）
    expect(env.globals["makeThing"]).toBeUndefined();
    expect(env.stats.skipped).toBe(0);
  });

  it("`export default class Widget {}` ⇒ 导出表有 default，没有 Widget", () => {
    const p = writeTemp("fx.d.ts", `export default class Widget { render(): string; }\n`);
    const env = harvestDts([p]);
    expect(env.globals["default"]).toBeDefined();
    expect(env.globals["Widget"]).toBeUndefined();
    expect(env.stats.skipped).toBe(0);
  });

  it("`export default <局部名>` ⇒ default 取局部绑定的值", () => {
    const p = writeTemp(
      "fx.d.ts",
      `declare function helper(): string;\nexport default helper;\n`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["default"]!)).toBe("() => string");
  });

  it("桥接层把 globals 的 default 提升成模块的 default 导出（默认导入不再是 unknown）", () => {
    const p = writeTemp("fx.d.ts", `export default function makeThing(): number;\n`);
    const mods = packageHarvestToAbsModules("fx", pkgOf("fx", p));
    expect(mods["fx"]?.default).toBeDefined();
    // 默认导入拿到的是这个函数（mock 化的可调用值），调用结果 = 声明的返回类型
    const mock = mods["fx"]!.default!;
    expect(formatShape(mock)).toContain("()");
    const impl = getFnImpl(mock);
    const out = impl?.apply?.([{ shape: { k: "prim", type: "number" }, conf: "exact" }]);
    expect(formatShape(out!)).toBe("number");
    // 局部名不得出现在具名导出面里（TS 侧 TS2614）
    expect(mods["fx"]!.named["makeThing"]).toBeUndefined();
  });
});
