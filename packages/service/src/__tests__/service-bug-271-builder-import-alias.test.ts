/**
 * BUG-271 —— `.nudo.ts` 侧车里**已有**的 `import { lit } from "@nudojs/core";`
 * 被当成「builder 已就位」⇒ 抑制掉 `declare const lit: …litC;` 声明头 ⇒
 * 产物里的 `lit(1)` 绑定到 core 的 **Term 构造器**（约束构建器叫 `litC`）
 * ⇒ `tsc --strict` 报 TS2322 / TS2345，而 `nudo check` 对该侧车判 OK
 * （缺陷对 nudo 完全隐形）。
 *
 * 修法：「已 import」判据比对 **core 导出名**（`coreExportNameOf`），只承认
 * 绑定的就是那个约束构建器；`import { lit }` 不豁免 ⇒ 走别名 + 声明头。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitInterface } from "../emit/interface-emitter.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-271-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// 带断言的 @nudo:case 是**域声明** ⇒ 字面量保留 ⇒ 生成段真的用到 `lit(`
const SRC = `/**
 * @nudo:case "c" (1) => 2
 */
export function f(x) {
  return x + 1;
}
`;

describe("BUG-271 —— core import 不得豁免 builder 声明头", () => {
  it("侧车已有 `import { lit }` ⇒ 仍补 litC 声明（别名，不撞名）", async () => {
    const file = join(dir, "lit.ts");
    writeFileSync(file, SRC);
    writeFileSync(join(dir, "lit.nudo.ts"), `import { fn, lit } from "@nudojs/core";\n`);

    const r = await emitInterface(file, { mode: "update", all: true });
    expect(r.written).toContain("f");

    const after = readFileSync(join(dir, "lit.nudo.ts"), "utf-8");
    // 已有的 `import { lit }` 绑定的是 Term 构造器 ⇒ 声明头不得被它抑制
    expect(after).toContain(`typeof import("@nudojs/core").litC;`);
    // 撞名 ⇒ 起别名，且 DSL 的 lit( 调用改写到别名上
    const alias = /declare const (_nudo_lit\w*): typeof import\("@nudojs\/core"\)\.litC;/.exec(
      after,
    )?.[1];
    expect(alias).toBeDefined();
    expect(after).toContain(`${alias}(1)`);
    expect(after).not.toMatch(/(?<![A-Za-z0-9_$])lit\(1\)/);
  });

  it("对照组：侧车不含 `import { lit }` ⇒ 直接声明 `lit`（无需别名）", async () => {
    const file = join(dir, "lit2.ts");
    writeFileSync(file, SRC);
    writeFileSync(join(dir, "lit2.nudo.ts"), `// empty sidecar\n`);

    await emitInterface(file, { mode: "update", all: true });
    const after = readFileSync(join(dir, "lit2.nudo.ts"), "utf-8");
    expect(after).toContain(`declare const lit: typeof import("@nudojs/core").litC;`);
    expect(after).toContain("lit(1)");
  });
});
