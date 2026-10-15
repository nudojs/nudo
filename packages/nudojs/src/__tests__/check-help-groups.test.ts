/**
 * `nudo check --help` 旗标分组（#11）：分组标题按
 * Common → Observation → Fix → CI → What-if 排列，全部旗标仍列出，
 * 且分组操作不改旗标语义（flags/description/defaultValue 原样）。
 * 进程内 commander（与 check-gitlab 同型）。
 */
import { describe, it, expect } from "vitest";
import { Command, type Option } from "commander";
import { registerCheckCommand } from "../commands/check.ts";
import { applyCheckHelpGroups } from "../check-help-groups.ts";

function buildProgram(): Command {
  const program = new Command();
  program.name("nudo");
  registerCheckCommand(program);
  applyCheckHelpGroups(program);
  return program;
}

/** help 文本中每个旗标（按 term token 匹配，兼容 "-h, --help" 与描述换行）所属的分节标题 */
function sectionOf(help: string, longFlag: string): string | undefined {
  let heading: string | undefined;
  for (const line of help.split("\n")) {
    if (/^\S.*:$/.test(line)) heading = line;
    const term = line.trim().split(/\s{2,}/)[0] ?? "";
    if (term.split(/[,\s]+/).includes(longFlag)) return heading;
  }
  return undefined;
}

const ALL_FLAGS = [
  "--watch",
  "--json",
  "--quiet",
  "--profile",
  "--entry-throws",
  "--ignore-throws",
  "--abs",
  "--fn",
  "--assume",
  "--generalize",
  "--verbose",
  "--from",
  "--fix",
  "--only",
  "--write",
  "--dry-run",
  "--gha",
  "--gitlab",
  "--what-if",
  "--target",
  "--help",
] as const;

const EXPECTED_SECTION: Record<string, string> = {
  "--watch": "Common options:",
  "--json": "Common options:",
  "--quiet": "Common options:",
  "--profile": "Common options:",
  "--entry-throws": "Common options:",
  "--ignore-throws": "Common options:",
  "--help": "Common options:",
  "--abs": "Observation options:",
  "--fn": "Observation options:",
  "--assume": "Observation options:",
  "--generalize": "Observation options:",
  "--verbose": "Observation options:",
  "--from": "Observation options:",
  "--fix": "Fix options:",
  "--only": "Fix options:",
  "--write": "Fix options:",
  "--dry-run": "Fix options:",
  "--gha": "CI options:",
  "--gitlab": "CI options:",
  "--what-if": "What-if options:",
  "--target": "What-if options:",
};

describe("check --help flag groups (#11)", () => {
  it("group headings appear in order Common → Observation → Fix → CI → What-if", () => {
    const help = buildProgram().commands.find((c) => c.name() === "check")!.helpInformation();
    const order = [
      "Common options:",
      "Observation options:",
      "Fix options:",
      "CI options:",
      "What-if options:",
    ].map((h) => help.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("every flag is still listed, under its expected group", () => {
    const help = buildProgram().commands.find((c) => c.name() === "check")!.helpInformation();
    for (const flag of ALL_FLAGS) {
      expect(help, `${flag} missing from help`).toContain(flag);
      expect(sectionOf(help, flag), `${flag} in wrong section`).toBe(EXPECTED_SECTION[flag]);
    }
  });

  it("no leftover ungrouped Options: section; usage/description lines unchanged", () => {
    const help = buildProgram().commands.find((c) => c.name() === "check")!.helpInformation();
    expect(help).not.toMatch(/^Options:$/m);
    expect(help).toMatch(/^Usage: nudo check \[options\] \[paths...\]$/m);
    expect(help).toContain("Gate contracts + entry throws");
  });

  it("grouping does not alter option semantics (flags/description/defaultValue/identity)", () => {
    const program = new Command();
    program.name("nudo");
    registerCheckCommand(program);
    const check = program.commands.find((c) => c.name() === "check")!;
    const face = (o: Option) =>
      JSON.stringify([o.flags, o.description, o.defaultValue ?? null, o.presetArg ?? null]);
    const beforeOptions = [...check.options];

    applyCheckHelpGroups(program);
    // 同一批 Option 实例（只加 heading + 展示排序，无重建、无语义面变化）
    expect(check.options).toHaveLength(beforeOptions.length);
    expect(check.options.every((o) => beforeOptions.includes(o))).toBe(true);
    expect(check.options.map(face).sort()).toEqual(beforeOptions.map(face).sort());
  });

  it("grouping is idempotent", () => {
    const program = buildProgram();
    applyCheckHelpGroups(program); // 第二次调用不应破坏任何面
    const help = program.commands.find((c) => c.name() === "check")!.helpInformation();
    for (const flag of ALL_FLAGS) {
      expect(sectionOf(help, flag)).toBe(EXPECTED_SECTION[flag]);
    }
  });
});
