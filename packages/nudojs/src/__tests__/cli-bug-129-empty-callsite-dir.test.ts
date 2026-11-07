/**
 * BUG-129 回归：`--from <空目录>` 必须报路径错误（`nudo:path-empty-dir`），
 * 不能静默通过。
 *
 * 改前空目录展开成 `[]` ⇒ 循环体一次都不执行 ⇒ 既不产生 PathError 也不产生
 * 调用记录 ⇒ 上层回落 `entry@` + exit 0（假绿）。「0 条记录」的三种情形
 * （文件缺失 / 读失败 / 无调用点）此前只区分了前两种。
 */
import { describe, it, expect } from "vitest";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { collectExternalRecords } from "../commands/shared.ts";
import type { PathError } from "@nudojs/service";
import { tmpProject } from "./helpers/tmp-project.ts";

describe("BUG-129 — 空目录现场", () => {
  it("空目录 ⇒ path-empty-dir 进 sink，且不返回记录", () => {
    const dir = tmpProject("nudo-129-", { "lib.js": "export function f() { return 1; }\n" });
    const empty = join(dir, "empty");
    mkdirSync(empty);
    const sink: PathError[] = [];
    const records = collectExternalRecords([empty], sink);
    expect(records).toBeUndefined();
    expect(sink.map((e) => e.code)).toContain("nudo:path-empty-dir");
  });

  it("对照组：非空目录现场照常采集（无路径错误）", () => {
    const dir = tmpProject("nudo-129-ok-", {
      "site.js": 'import { f } from "./lib.js";\nexport const v = f(1);\n',
      "lib.js": "export function f(a) { return a + 1; }\n",
    });
    const sink: PathError[] = [];
    const records = collectExternalRecords([dir], sink);
    expect(sink).toEqual([]);
    expect(records?.length ?? 0).toBeGreaterThan(0);
  });
});
