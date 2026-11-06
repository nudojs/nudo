/**
 * BUG-272 —— 草稿的 builder import 列表用**词边界**（`\bname\b`）扫 DSL ⇒
 * 仅仅因为观测对象的**字段名叫 `lit`** 就把 core 的 `lit`（**Term 构造器**，
 * 约束构建器叫 `litC`）拖进草稿 import ⇒ 与「只 import 草稿里实际用到的
 * builder」的自述直接相悖，且写出的绑定类型面是坏的。
 *
 * 修法：判据改为**调用位**（`name(`），名单取 core 的
 * `CONSTRAINT_BUILDER_NAMES`（单一真源）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { draftInterface } from "../emit/interface-draft.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-272-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function importLine(src: string): string {
  return /^import \{[^}]*\} from "@nudojs\/core";$/m.exec(src)?.[0] ?? "";
}

describe("BUG-272 —— 草稿 builder import ⊆ 真正被调用的 builder", () => {
  it("字段名叫 `lit` 不得把 `lit` 拖进 import（DSL 从未调用 lit(）", async () => {
    const file = join(dir, "lit.ts");
    writeFileSync(
      file,
      `export function f(o) {\n  return o.lit;\n}\nf({ lit: 1 });\n`,
    );
    const r = await draftInterface(file);
    const line = importLine(r.draftSource);
    expect(line).toContain("fn");
    expect(line).toContain("shape");
    expect(line).toContain("number");
    expect(line).not.toMatch(/(?<![\w$])lit(?![A-Za-z0-9_$])/);
    // 草稿的 DSL 行里确实没有 lit( 调用（注释里的 /* observed: … */ 是见证，不算）
    const dsl = r.draftSource
      .split("\n")
      .filter((l) => /^export const f = /.test(l))
      .join("\n");
    expect(dsl).not.toMatch(/(?<![\w$])lit\s*\(/);
  });

  it("对照组：字段名改成 `lam` ⇒ 同一个 import 列表（唯一变量是字段名）", async () => {
    const file = join(dir, "lam.ts");
    writeFileSync(
      file,
      `export function f(o) {\n  return o.lam;\n}\nf({ lam: 1 });\n`,
    );
    const r = await draftInterface(file);
    expect(importLine(r.draftSource)).not.toMatch(/(?<![\w$])lit(?![A-Za-z0-9_$])/);
  });
});
