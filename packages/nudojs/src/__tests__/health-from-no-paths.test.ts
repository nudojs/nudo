/**
 * G6 / BUG-024 后续：`nudo health --from usage.js`（无位置参数）——
 * --from 收尾、只吞了旗标自身的一个值，没有任何位置参数被吞。
 * 旧门把它误报成 "variadic flag(s) --from consumed ..."（文案失实）；
 * 现为定向 usage error：如实说明 --from 需显式 paths（旧形态静默扫 cwd，
 * freeze-drift 范围错误）+ 给出显式形态建议。
 * 688：`--from` 收到 ≥2 个值而**位置路径已给出**时（`health lib.js --from
 * a.js b.js`）不再报 variadic 错误——多文件 --from 与 `check` / `contract`
 * 同口径被接受（歧义只存在于「旗标之后的裸 token」；paths 为空时仍报
 * BUG-024 面）。
 */
import { describe, it, expect } from "vitest";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

describe("G6: health --from 无位置参数（--from 收尾）", () => {
  it("health --from usage.js → 定向 usage error，文案如实、不声称 consumed", () => {
    const r = runCli(["health", "--from", "usage.js"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("--from requires explicit paths");
    expect(r.stderr).toContain(". --from"); // 建议形态 nudo health . --from usage.js
    // 本次调用 --from 只吞了 usage.js，没有任何参数被误吞——不得声称 consumed
    expect(r.stderr).not.toContain("consumed");
  });

  it("health lib.js --from usage.js extra.js（多值 --from）→ 被接受（688：与 check/contract 同口径），不再报 variadic 错误", () => {
    const r = runCli(["health", "lib.js", "--from", "usage.js", "extra.js"]);
    // 688：多文件 --from **不是**「variadic 吞噬位置参数」——paths 明明收到了
    // lib.js（文案失实）；且 `check` / `contract` 接受同样的多值形态 ⇒
    // health 不得再拒绝（否则跨命令行为分叉）。
    expect(r.stderr).not.toContain("variadic flag(s) --from consumed");
    expect(r.stderr).not.toContain("received no paths");
    // 分析目标仍是 lib.js（usage.js / extra.js 只作使用点）
    expect(r.stdout).toContain("File not found: lib.js");
  });

  it("health lib.js --from usage.js（paths 在旗标前）→ 正常执行，不进 variadic 门", () => {
    const r = runCli(["health", "lib.js", "--from", "usage.js"]);
    // lib.js / usage.js 不存在 → 正常的路径错误面（exit 1），而非 usage gate
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Callsite file not found");
    expect(r.stdout).toContain("File not found: lib.js");
    expect(r.stderr).not.toContain("variadic flag");
    expect(r.stderr).not.toContain("requires explicit paths");
  });
});
