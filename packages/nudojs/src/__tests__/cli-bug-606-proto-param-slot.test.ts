/**
 * Bug 606 — 形参名 `__proto__` 在 **zod Input 装配**时被普通对象吞掉 ⇒ zod 面丢形参。
 *
 * 症状（改前）：`export function f(__proto__, normal)` ⇒ zod 产物
 * `fInput = z.object({ normal: z.literal(3) })`（`__proto__` 形参**消失**），
 * 而 dts 面是对的（`f(__proto__: number, normal: number)`）⇒ 跨产物面自相矛盾。
 *
 * 根因（nudojs 层，本片修）：`export/zod-face.ts` 的 `zodInputSlots` 用**普通
 * 对象**存槽表 ⇒ 形参名 `__proto__` 的赋值命中 `Object.prototype.__proto__`
 * 的 **setter**（原型 setter）⇒ 该键**永不成自有属性** ⇒ `Object.entries()`
 * 看不到它 ⇒ `obj(slots)` 拿不到该槽。
 *
 * 修法（族 17 · S2）：槽表改用**无原型对象**（`Object.create(null)`）⇒ 没有原型
 * setter ⇒ `__proto__` 落为普通自有键（`constructor` / `toString` 等继承键同理）。
 *
 * ✅ **core 层缺口已闭合**（族 17 主 agent 接线）：core 的 `absToConstraint`
 * （`algebra/projection.ts` 的 `projectObj`）把槽位抄进**无原型对象** `fields`
 * （`Object.create(null)`），且 `algebra/codegen-escape.ts` 的 `formatObjectKey`
 * 把 `__proto__` 写成**计算键** `["__proto__"]`（裸 `__proto__: v` 在 JS 对象
 * 字面量里是原型 setter ⇒ 运行时该键不是自有属性）⇒ 产品面 zod 模块不再丢
 * 该形参（本钉第三段断言已从 `it.fails` 旗标**转正**为真断言）。
 *
 * runner 注：spawn 型 CLI 子进程对 @nudojs/* 的解析不经 vitest 别名 ⇒ 子进程
 * cwd 下的 tsconfig.json paths（绝对路径指向 src）保证测试面与本仓 src 一致。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abs } from "@nudojs/core";
import { zodInputSlots } from "../commands/export/zod-face.ts";
import { runCliTsx, repoRoot } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 子进程 tsx 用 tsconfig：@nudojs/* → 仓内 src（vitest 别名的子进程面） */
const SRC_TSCONFIG = `${JSON.stringify(
  {
    compilerOptions: {
      paths: {
        "@nudojs/core": [`${repoRoot}packages/core/src`],
        "@nudojs/core/exec": [`${repoRoot}packages/core/src/algebra/exec/index.ts`],
        "@nudojs/core/internal": [`${repoRoot}packages/core/src/internal.ts`],
        "@nudojs/parser": [`${repoRoot}packages/parser/src`],
        "@nudojs/service": [`${repoRoot}packages/service/src`],
        "@nudojs/service/emit": [`${repoRoot}packages/service/src/emit/index.ts`],
        "@nudojs/service/evaluator": [`${repoRoot}packages/service/src/evaluator/evaluator-api.ts`],
        "@nudojs/env/es": [`${repoRoot}packages/env/src/es.ts`],
        "@nudojs/env/web": [`${repoRoot}packages/env/src/web.ts`],
        "@nudojs/env/node": [`${repoRoot}packages/env/src/node.ts`],
        "@nudojs/harvester": [`${repoRoot}packages/harvester/src`],
      },
    },
  },
  null,
  2,
)}\n`;

/** 建夹具目录（tsconfig.json + 源文件），返回目录路径 */
function fixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-606-"));
  dirs.push(dir);
  writeFileSync(join(dir, "tsconfig.json"), SRC_TSCONFIG, "utf-8");
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

const numAbs = abs({ k: "prim", type: "number" }, undefined, undefined, "exact");

describe("Bug 606 — zod 槽表保留 `__proto__` 形参（无原型对象 ⇒ 不触发原型 setter）", () => {
  it("槽表把 `__proto__` 落为自有键（改前：普通对象 ⇒ 被原型 setter 吞掉）", () => {
    const slots = zodInputSlots([
      { name: "__proto__", abs: numAbs },
      { name: "normal", abs: numAbs },
    ]);
    expect(Object.keys(slots)).toEqual(["__proto__", "normal"]);
    expect(Object.getPrototypeOf(slots)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(slots, "__proto__")).toBe(true);
    expect(slots["__proto__"]?.value).toBe(numAbs);
    expect(slots["normal"]?.value).toBe(numAbs);
  });

  it("继承键（constructor / toString）同样不被原型吞掉", () => {
    const slots = zodInputSlots([
      { name: "constructor", abs: numAbs },
      { name: "toString", abs: numAbs },
    ]);
    expect(Object.keys(slots)).toEqual(["constructor", "toString"]);
    // 无原型 ⇒ 槽表不挂 Object.prototype（改前：挂原型 ⇒ 继承键可被误读）
    expect(Object.getPrototypeOf(slots)).toBeNull();
    expect(slots["constructor"]?.value).toBe(numAbs);
    expect(slots["toString"]?.value).toBe(numAbs);
  });

  it(
    "产品面 zod Input 含 `__proto__` 形参（core 两处补丁后：projection 字段表无原型 + 键走计算键）",
    () => {
      const dir = fixtureDir({
        "lib.js": [
          `/**`,
          ` * @nudo:case "c" (2, 3) => 3`,
          ` */`,
          `export function f(__proto__, normal) {`,
          `  return normal;`,
          `}`,
          ``,
        ].join("\n"),
      });
      const r = runCliTsx(["export", "lib.js", "--format", "schema"], { cwd: dir });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("__proto__");
    },
    30000,
  );
});
