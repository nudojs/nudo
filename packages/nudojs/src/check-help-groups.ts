/**
 * `nudo check --help` 旗标分组（#11）。
 *
 * check 注册 20 个旗标平铺一节，阅读性差。commander 15 的原生机制是
 * `Option.helpGroup(heading)` + `Help.groupItems`（按 heading 分节），
 * 但分组节序 = 旗标在 cmd.options 中的首现顺序——注册顺序
 * （watch, json, gha, gitlab, verbose, …）会让 CI 节插在 Observation
 * 前面。因此本模块在注册后做三件事，全部只影响帮助展示：
 *   1) 按长旗标赋 heading；
 *   2) 对 cmd.options 稳定排序成目标组序（解析/取值按旗标名查找，
 *      与顺序无关；稳定排序保持组内注册序）；
 *   3) optionsGroup(兜底标题) + helpOption 显式重建：`-h, --help` 是
 *      惰性创建的（注册期不在 cmd.options 里），显式给 flags 触发
 *      `_initOptionGroup`，让它落进「Common options:」而不是孤悬一节。
 *
 * 不改 commands/check.ts（旗标语义/名/默认值全部不动）；check.ts 未来
 * 新增的未分组旗标自然落在末尾默认「Options:」节，仍然全部列出。
 */
import type { Command, Option } from "commander";

/** 分组标题（数组顺序 = 显示顺序） */
const COMMON_HEADING = "Common options:";
const GROUPS: ReadonlyArray<{ heading: string; flags: readonly string[] }> = [
  {
    heading: COMMON_HEADING,
    flags: ["--watch", "--json", "--quiet", "--profile", "--entry-throws", "--ignore-throws"],
  },
  {
    heading: "Observation options:",
    flags: ["--abs", "--fn", "--assume", "--generalize", "--verbose", "--from"],
  },
  { heading: "Fix options:", flags: ["--fix", "--only", "--write", "--dry-run"] },
  { heading: "CI options:", flags: ["--gha", "--gitlab"] },
  { heading: "What-if options:", flags: ["--what-if", "--target"] },
];

/** 未分组旗标（未来新增）的排序位：所有分组之后 */
const UNGROUPED_RANK = GROUPS.length;

function groupRank(option: Option): number {
  for (let i = 0; i < GROUPS.length; i++) {
    if (option.long && GROUPS[i].flags.includes(option.long)) return i;
  }
  return UNGROUPED_RANK;
}

/** 给 check 命令的 --help 应用旗标分组（幂等：重复调用只重赋同样的 heading） */
export function applyCheckHelpGroups(program: Command): void {
  const check = program.commands.find((c) => c.name() === "check");
  if (!check) return;
  for (const option of check.options) {
    const rank = groupRank(option);
    if (rank !== UNGROUPED_RANK) option.helpGroup(GROUPS[rank].heading);
  }
  // 展示序 = 组序（稳定排序保组内注册序）；解析按名查找，与顺序无关
  ;(check.options as Option[]).sort((a, b) => groupRank(a) - groupRank(b));
  // `-h, --help`（惰性创建）落进 Common；后续新增选项的默认组也收 Common
  check.optionsGroup(COMMON_HEADING);
  check.helpOption("-h, --help", "display help for command");
}
