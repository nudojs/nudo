/**
 * BUG-250 —— guard 产物因 brand 的 `instanceof` **类型收窄**过不了
 * `tsc --noEmit --strict`（TS7053：`data["0"]` 在
 * `Uint8Array | Record<string, any>` 上不可索引）⇒ `nudo export` **exit 0、
 * 零警告**地发布不可编译的产物。
 *
 * 根因：`denote.ts` 的 brand 身份子句把 `data` 放进 `instanceof` 左操作数
 * ⇒ TS 收窄 `data`；`guard-generator.ts` 把它声明为 `Record<string, any>`。
 *
 * 本钉：内建 brand 返回形态的守卫产物必须过 `tsc --strict`，运行时语义不变。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abs, numLit, obj, type Abs } from "@nudojs/core";
import { denoteGuard } from "@nudojs/core/internal";
import { generateGuardFunctionFromAbs } from "../emit/guard-generator.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** `new Uint8Array([1, 2])` 的观测形态：brand + 数字下标槽 + length */
function uint8Abs(): Abs {
  return abs(
    {
      k: "brand",
      name: "Uint8Array",
      shape: obj({
        "0": { value: numLit(1) },
        "1": { value: numLit(2) },
        length: { value: numLit(2) },
      }),
    },
    undefined,
    undefined,
    "exact",
  );
}

describe("BUG-250 — 内建 brand 的 guard 产物必须过 tsc --strict", () => {
  it("产物真跑 tsc --noEmit --strict（改前 TS7053 ×2）", () => {
    const source = generateGuardFunctionFromAbs("isbytesOutput", uint8Abs());
    // 身份子句会收窄 `data` ⇒ 声明必须是 `: any`（否则索引读报 TS7053）
    expect(source).toContain("const data: any = value as Record<string, any>;");
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug250-"));
    dirs.push(dir);
    const p = join(dir, "lib.nudo.guard.ts");
    writeFileSync(p, source + "\n", "utf-8");
    let failure = "";
    try {
      execFileSync(
        "pnpm",
        ["exec", "tsc", "--noEmit", "--strict", "--skipLibCheck", "--ignoreConfig", p],
        { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (e) {
      const err = e as { stderr?: string; stdout?: string; message?: string };
      failure = `${err.stderr ?? ""}${err.stdout ?? err.message ?? ""}`;
    }
    expect(failure).toBe("");
  });

  it("运行时语义不变：接受合法 Uint8Array，拒绝普通对象", () => {
    const check = new Function("data", `return ${denoteGuard(uint8Abs(), "data")};`) as (
      v: unknown,
    ) => boolean;
    expect(check(new Uint8Array([1, 2]))).toBe(true);
    expect(check({ 0: 1, 1: 2, length: 2 })).toBe(false);
  });
});
