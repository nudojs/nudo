#!/usr/bin/env node
/**
 * nudo CLI — 命令面按 design-cli-semantics.md §1。
 *
 * 正门：check / test / contract / export / health / migrate
 * 观察是 check signatures + test case 报告 + IDE，不是一级动词。
 * harvest 不是产品动词：@types 补洞走分析自动路径，env 包生成用 @nudojs/harvester。
 * migrate 是替代 TS 的单向门（status/strip/verify/retire）；双跑仅 verify。
 *
 * 本文件只做 program 注册与全局错误处理；命令实现在 commands/*.ts。
 */
import { Command } from "commander";
import { formatVersionOutput } from "./version.ts";
import { registerCheckCommand } from "./commands/check.ts";
import { registerTestCommand } from "./commands/test.ts";
import { registerContractCommand } from "./commands/contract.ts";
import { registerExportCommand } from "./commands/export.ts";
import { registerHealthCommand } from "./commands/health.ts";
import { registerMigrateCommand } from "./commands/migrate.ts";

const program = new Command();

// pnpm run nudo -- <args> 会把 `--` 传进 argv；commander 会把其后旗标当位置参数
const argv = process.argv.filter((a, i) => !(i >= 2 && a === "--"));

program
  .name("nudo")
  .description("JavaScript types, computed — check / test / contract / export / health / migrate")
  .version(formatVersionOutput())
  .addHelpText(
    "after",
    `
Day 0   nudo check <path>   (signatures + L1/L2 gate)
        nudo test <path>    (every inferred case)
Day 1   nudo contract + check
Ecosystem  nudo export (dts / guard / schema / standard)
Ops     nudo health [paths]
Migrate nudo migrate status|strip|verify|retire  (exit is retire tsc)

No observation verb: signatures come from check, cases from test, hover from IDE.
`,
  );

registerCheckCommand(program);
registerTestCommand(program);
registerContractCommand(program);
registerExportCommand(program);
registerHealthCommand(program);
registerMigrateCommand(program);

program.parseAsync(argv).catch((err: unknown) => {
  console.error(err instanceof Error ? (process.env.NUDO_DEBUG ? err.stack : err.message) : err);
  process.exitCode = 1;
});
