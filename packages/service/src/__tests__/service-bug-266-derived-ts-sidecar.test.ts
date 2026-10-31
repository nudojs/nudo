/**
 * BUG-266 —— `nudo contract --emit` 的**派生分支**写 `.nudo.ts` 侧车时
 * **不补 builder 类型声明** ⇒ 产物里 `fn` 是未声明标识符 ⇒ `tsc` **TS2304**；
 * 而主分支（`interface-emitter.ts`）的 `.nudo.ts` 有 `declare const fn: …`
 * ⇒ 同一命令、同一个侧车扩展名，两个分支两个结论。
 *
 * 修法：派生分支写盘前按主分支**同款算法**（`CONSTRAINT_BUILDER_NAMES` +
 * `coreExportNameOf`）补声明头；`.js` 侧车不加（裸注入已够）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitDerivedFromRoot } from "../emit/interface-derivation-emit.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-266-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("BUG-266 —— 派生分支的 .nudo.ts 必须带 builder 声明头", () => {
  it("下游是 .ts ⇒ 派生产物补 `declare const fn: …`", () => {
    writeFileSync(
      join(dir, "add.ts"),
      `export function add2(x) {\n  return x + 2;\n}\n`,
      "utf-8",
    );
    writeFileSync(
      join(dir, "lib.js"),
      `import { add2 } from "./add.ts";\n\nexport function add4(x) {\n  return add2(x + 1) + 1;\n}\n`,
      "utf-8",
    );
    writeFileSync(
      join(dir, "std.nudo.js"),
      `import { number } from "@nudojs/core";\nexport const positive = number().ge(0);\nexport const positive4 = number().ge(4);\n`,
      "utf-8",
    );
    writeFileSync(
      join(dir, "lib.nudo.js"),
      `import { fn } from "@nudojs/core";\nimport { positive, positive4 } from "./std.nudo.js";\n\nexport const add4 = fn({ x: positive }, positive4);\n`,
      "utf-8",
    );

    const r = emitDerivedFromRoot(join(dir, "lib.js"), {
      mode: "update",
      fnNames: ["add2"],
    });
    expect(r.hasRoot).toBe(true);

    const sidecar = join(dir, "add.nudo.ts");
    const after = readFileSync(sidecar, "utf-8");
    // 产物会被 tsc 编译 ⇒ builder 标识符必须已声明（否则 TS2304）
    expect(after).toContain(`declare const fn: typeof import("@nudojs/core").fn;`);
    expect(after).toContain("export const add2 = fn(");
  });

  it("对照组：.js 侧车不加 declare（裸注入已够）", () => {
    writeFileSync(join(dir, "add2.js"), `export function add2b(x) {\n  return x + 2;\n}\n`, "utf-8");
    writeFileSync(
      join(dir, "lib2.js"),
      `import { add2b } from "./add2.js";\n\nexport function add4b(x) {\n  return add2b(x + 1) + 1;\n}\n`,
      "utf-8",
    );
    writeFileSync(
      join(dir, "std2.nudo.js"),
      `import { number } from "@nudojs/core";\nexport const positive = number().ge(0);\nexport const positive4 = number().ge(4);\n`,
      "utf-8",
    );
    writeFileSync(
      join(dir, "lib2.nudo.js"),
      `import { fn } from "@nudojs/core";\nimport { positive, positive4 } from "./std2.nudo.js";\n\nexport const add4b = fn({ x: positive }, positive4);\n`,
      "utf-8",
    );

    const r = emitDerivedFromRoot(join(dir, "lib2.js"), { mode: "update", fnNames: ["add2b"] });
    expect(r.hasRoot).toBe(true);
    const after = readFileSync(join(dir, "add2.nudo.js"), "utf-8");
    expect(after).not.toContain("declare const");
    expect(after).toContain("export const add2b = fn(");
  });
});
