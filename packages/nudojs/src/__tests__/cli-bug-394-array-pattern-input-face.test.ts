/**
 * Bug 394（**nudojs 侧**，zod / standard 产物面）：**数组解构**形参的字段级
 * 侧车契约被摊成**对象槽** ⇒ 产物的输入面与真实形参形态**完全颠倒**。
 *
 * 症状（改前）：`export function f7([a, b])` + 侧车契约 `fn({ a: number() })`
 * ⇒ zod 给出 `f7Input = z.object({ a: z.number()… })`
 * —— 校验器要求一个**键名叫 `a`** 的属性，而真实调用传的是**数组**
 * ⇒ 合法的数组调用被判红、非法的对象调用被放行（与真实形参形态完全颠倒）。
 *
 * 根因：统一参数面（`export/contract-face.ts`）按**绑定名**收侧车契约，
 * 而数组解构的绑定名是**元素下标**（`[a, b]` 的 `a` 是下标 0 的元素）⇒
 * 必须**按下标**合成**元组槽**，不能摊成对象槽。
 *
 * 修法（产物面兜底，`packages/nudojs/src/commands/export.ts`）：把该形参的
 * 字段级槽合成**一个元组槽**（元素位按下标寻址，未契约的位置留 `any`）。
 *
 * 钉：
 * - zod 入参面是**元组**（改前是对象槽）；
 * - standard 面的槽节点是**元组**；
 * - 负控制：**对象解构**的字段级契约仍摊成对象槽（既有口径不变）；
 * - 负控制：无契约的数组解构仍是观测元组（既有口径不变）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b394-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

const ARRAY_SRC = `export function f7([a, b]) { return a; }
f7([1, 2]);
`;

const ARRAY_SIDECAR = `import { fn, number } from "@nudojs/core";
export const f7 = fn({ a: number() }, number());
`;

const OBJECT_SRC = `export function f7({ a, b }) { return a; }
f7({ a: 1, b: 2 });
`;

const OBJECT_SIDECAR = `import { fn, number } from "@nudojs/core";
export const f7 = fn({ a: number() }, number());
`;

describe("export — 数组解构形参的输入面（族 08 · S5 · Bug 394）", () => {
  it("zod 入参面：数组解构 + 字段级契约 ⇒ 元组槽（改前是对象槽 `a`）", () => {
    const dir = fixture({ "m394.js": ARRAY_SRC, "m394.nudo.js": ARRAY_SIDECAR });
    const r = runCliTsx(["export", join(dir, "m394.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("z.tuple(");
    // 改前的形态：对象槽按绑定名摊开
    expect(r.stdout).not.toContain("z.object({ a:");
  }, 30000);

  it("standard 面：数组解构形参的槽节点是元组", () => {
    const dir = fixture({ "m394s.js": ARRAY_SRC, "m394s.nudo.js": ARRAY_SIDECAR });
    const r = runCliTsx(["export", join(dir, "m394s.js"), "--format", "standard"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('"k":"tuple"');
    expect(r.stdout).not.toContain('"key":"a"');
  }, 30000);

  it("负控制：对象解构 + 字段级契约仍摊成对象槽（既有口径不变）", () => {
    const dir = fixture({ "m394o.js": OBJECT_SRC, "m394o.nudo.js": OBJECT_SIDECAR });
    const r = runCliTsx(["export", join(dir, "m394o.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("z.object({ a:");
  }, 30000);

  it("负控制：无契约的数组解构仍是观测元组（既有口径不变）", () => {
    const dir = fixture({ "m394n.js": ARRAY_SRC });
    const r = runCliTsx(["export", join(dir, "m394n.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("z.tuple(");
    expect(r.stdout).not.toContain("z.object({ a:");
  }, 30000);
});
