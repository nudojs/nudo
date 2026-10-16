/**
 * 宿主全局函数面漂移探针（前向兼容规则的 CI 信号）：
 * exec/calls.ts 的 isHostGlobalFn 收集 globalThis 全部函数值属性，真调用
 * 兜底按**值身份**吸收——Node 未来新增的副作用全局（调度/网络/IO 族）默认
 * 会落进兜底真执行。规则：兜底面出现**新名字必须审计**（进
 * NEVER_EXEC_HOST_FN_NAMES 拦截，或确认纯函数后并入基线 fixture）。本测试
 * 枚举当下 globalThis 与基线（并集语义）∪ 已审计拦截面比对，把该规则钉进
 * CI。设计文档：docs/design/evaluation.md「分析期真实执行面」。
 *
 * 枚举必须跑子进程（裸 node，不经 tsx/vitest）：
 * vitest 进程的 globalThis 有注入物（worker 全局/断言扩展等），tsx loader
 * 亦在进程内注册钩子——进程内枚举会把这些名字误报成「新名字」；基线也生成
 * 于裸 node，环境必须同源可比（子进程卫生测试先例：exec-host-global-fn-hygiene.test.ts）。
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import {
  NEVER_EXEC_HOST_FN_NAMES,
  collectHostGlobalFnEntryNames,
} from "../exec/calls.ts";

const here = dirname(fileURLToPath(import.meta.url));
/** packages/core/src/algebra/exec/calls.ts 绝对路径（子进程 import 用） */
const callsTs = join(here, "..", "exec", "calls.ts");
/** 仓库根（tsx 在根 devDependencies） */
const repoRoot = join(here, "..", "..", "..", "..", "..");
const baseline: { nodeVersion: string; names: string[] } = JSON.parse(
  readFileSync(join(here, "host-global-fn-names.baseline.json"), "utf8"),
);

/**
 * 枚举谓词——**镜像** exec/calls.ts collectHostGlobalFnEntries（:350-375）：
 * Object.getOwnPropertyNames(globalThis)，descriptor 有 get/set 且不在
 * HOST_FN_ACCESSOR_ALLOWLIST（:342，{Buffer,assert,events,stream,node:test}）
 * → 跳过（accessor GET 执行宿主 lazy getter 溅警告）；值 typeof function
 * → 收集名字。calls.ts 判定改动须同步本镜像（同进程比对见第二用例）。
 * 镜像而非 import：本脚本须在裸 node 子进程跑（见文件头），import 会拖入
 * tsx；且独立镜像可证伪 calls.ts 判定自身的意外漂移。
 */
const MIRROR = `
const ALLOW = new Set(["Buffer", "assert", "events", "stream", "node:test"]);
const out = [];
for (const k of Object.getOwnPropertyNames(globalThis)) {
  const d = Object.getOwnPropertyDescriptor(globalThis, k);
  if (d && (d.get !== undefined || d.set !== undefined) && !ALLOW.has(k)) continue;
  if (typeof globalThis[k] === "function") out.push(k);
}
console.log(JSON.stringify(out.sort()));
`;

/** 裸 node 枚举（无 tsx/vitest 注入）：返回排序名字数组 */
function enumerateInCleanSubprocess(): string[] {
  const res = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", MIRROR],
    { encoding: "utf8", cwd: repoRoot, timeout: 60_000 },
  );
  expect(res.status, `subprocess stderr: ${res.stderr}`).toBe(0);
  return JSON.parse(res.stdout.trim().split("\n").at(-1)!) as string[];
}

describe("host global fn surface drift", () => {
  it("no unaudited new host-global function names (union baseline + NEVER_EXEC)", () => {
    const enumerated = enumerateInCleanSubprocess();
    const enumSet = new Set(enumerated);
    // 已审计面 = 基线并集 ∪ NEVER_EXEC 拦截名单（后者兜住不在本 Node 版本
    // globalThis 上的拦截名，如浏览器宿主专属的 XMLHttpRequest/EventSource）
    const audited = new Set<string>([
      ...baseline.names,
      ...NEVER_EXEC_HOST_FN_NAMES,
    ]);
    const newNames = enumerated.filter((n) => !audited.has(n));
    expect(
      newNames,
      "宿主全局函数面出现未审计新名字（isHostGlobalFn 真调用兜底会按值身份吸收它们，" +
        "副作用全局被真执行=unsound）。处置：审计每个新名字——副作用/网络/定时器/" +
        "调度/IO 族 → exec/calls.ts NEVER_EXEC_HOST_FN_NAMES（映射 nudo:host-effect-blocked）；" +
        "确认纯函数 → 并入 host-global-fn-names.baseline.json（并集语义，只增不减）",
    ).toEqual([]);
    // 缺失方向仅告警：基线是跨 Node 版本并集，CI Node 22 矩阵必然少于本机
    // Node 26 生成面——这不是回归，是版本差；新名字方向才是安全信号。
    const missing = baseline.names.filter((n) => !enumSet.has(n));
    if (missing.length > 0) {
      console.warn(
        `[host-global-drift] ${missing.length} baseline names absent on this Node ` +
          `(${process.version}; baseline union from ${baseline.nodeVersion}) — tolerated: ` +
          missing.join(", "),
      );
    }
  });

  it("collectHostGlobalFnEntryNames matches the mirrored predicate in-process", () => {
    // tsx 子进程内同进程比对：导出 helper 与镜像谓词必须逐元素一致
    // （calls.ts 声称「共用同套判定」，此处证伪判定分叉；helper 亦是
    // 漂移审计的程序化入口）。tsx 可能注入进程内全局——两谓词同进程跑，
    // 注入物对称出现，不影响一致性结论。
    const script = `
const m = await import(${JSON.stringify(pathToFileURL(callsTs).href)});
const ALLOW = new Set(["Buffer", "assert", "events", "stream", "node:test"]);
const out = [];
for (const k of Object.getOwnPropertyNames(globalThis)) {
  const d = Object.getOwnPropertyDescriptor(globalThis, k);
  if (d && (d.get !== undefined || d.set !== undefined) && !ALLOW.has(k)) continue;
  if (typeof globalThis[k] === "function") out.push(k);
}
const fromHelper = m.collectHostGlobalFnEntryNames();
const fromMirror = out.sort();
if (JSON.stringify(fromHelper) !== JSON.stringify(fromMirror)) {
  console.error("DIVERGE\\nhelper: " + JSON.stringify(fromHelper) + "\\nmirror: " + JSON.stringify(fromMirror));
  process.exit(2);
}
`;
    const res = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", script],
      { encoding: "utf8", cwd: repoRoot, timeout: 60_000 },
    );
    expect(
      `${res.status}\n${res.stderr}`,
      "collectHostGlobalFnEntryNames 与镜像谓词分叉（同进程比对）",
    ).not.toMatch(/^2\n/);
    expect(res.status, `subprocess stderr: ${res.stderr}`).toBe(0);
    // 主进程直接消费导出面（防「导出即死码」）：helper 可调用且非空
    expect(collectHostGlobalFnEntryNames().length).toBeGreaterThan(0);
  });
});
