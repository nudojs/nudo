/**
 * 内联 `import("spec").T` 形参注解的 check 面（进程内，PR 车道）。
 *
 * `nudo check` 的入口域来自 CLI 侧 `annotationEnvForFile` 的内联导入类型表。
 * 表缺失时整条注解解析失败 ⇒ 形参退 any、返回 any，并连带假
 * `nudo:entry-may-throw` + `nudo:annotation-unresolved`（exit 1）。
 *
 * 这里直接驱动 `runCheck` 的 `--json` 收集通道（`jsonCollect`），不起子进程；
 * 夹具是磁盘上的临时工程（内联导入按文件路径解析被导入模块）。
 * 两条一变量对照：同接口走语句级 `import type`；以及**真**解析不了的内联导入
 * （模块不存在）——后者证明这两条诊断没有被整体关掉。
 * 缺陷编号只出现在 it 标题的 provenance。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { type CheckJson } from "@nudojs/core";
import { runCheck } from "../commands/check.ts";
import { tmpProject } from "./helpers/tmp-project.ts";

const USER_TYPES = `export interface User {
  name: string;
  age: number;
}
`;

/** `nudo check --json <entry>` 的单文件报告（进程内，不打印 / 不设 exit）。 */
async function checkJson(files: Record<string, string>, entry: string): Promise<CheckJson> {
  const dir = tmpProject("nudo-inline-import-type-", files);
  const collected: CheckJson[] = [];
  await runCheck(join(dir, entry), { json: true, jsonCollect: collected });
  return collected[0];
}

/** 签名行：`name(p: T, …) => display`（display 已含 `throws X`；与 check --json 的 signatures[] 同源）。 */
function sigOf(json: CheckJson, name: string): string {
  const s = json.signatures.find((x) => x.name === name);
  if (!s) return `<no signature ${name}>`;
  const params = s.params.map((p, i) => `${p}: ${s.paramTypes?.[i] ?? "?"}`).join(", ");
  return `${s.name}(${params}) => ${s.display}`;
}

const codesOf = (json: CheckJson): string[] => json.issues.map((i) => i.code);

describe("内联导入类型的形参注解", () => {
  it("BUG-442 `u: import(\"./sub/types\").User`：入口签名 `take(u: { name: string, age: number }) => string`，零 error 级诊断（不再有假 `nudo:entry-may-throw` / `nudo:annotation-unresolved`）", async () => {
    const json = await checkJson(
      {
        "lib.ts": `export function take(u: import("./sub/types").User): string {
  return u.name;
}
`,
        "sub/types.ts": USER_TYPES,
      },
      "lib.ts",
    );
    expect(json.ok).toBe(true);
    expect(codesOf(json)).not.toContain("nudo:annotation-unresolved");
    expect(codesOf(json)).not.toContain("nudo:entry-may-throw");
    expect(sigOf(json, "take")).toBe("take(u: { name: string, age: number }) => string");
  });

  it("BUG-442 一变量对照：同一接口走语句级 `import type { User }` 的入口签名逐字相同", async () => {
    const json = await checkJson(
      {
        "lib.ts": `import type { User } from "./sub/types";
export function take(u: User): string {
  return u.name;
}
`,
        "sub/types.ts": USER_TYPES,
      },
      "lib.ts",
    );
    expect(json.ok).toBe(true);
    expect(sigOf(json, "take")).toBe("take(u: { name: string, age: number }) => string");
  });

  it("BUG-442 一变量对照：内联导入指向不存在的模块（`import(\"./sub/missing\").User`）仍然解析失败——形参退 any，并上屏 `nudo:annotation-unresolved` 与 `nudo:entry-may-throw`", async () => {
    const json = await checkJson(
      {
        "lib.ts": `export function take(u: import("./sub/missing").User): string {
  return u.name;
}
`,
      },
      "lib.ts",
    );
    expect(json.ok).toBe(false);
    expect(codesOf(json)).toEqual(
      expect.arrayContaining(["nudo:entry-may-throw", "nudo:annotation-unresolved"]),
    );
    expect(sigOf(json, "take")).toBe("take(u: any) => any throws TypeError");
  });
});
