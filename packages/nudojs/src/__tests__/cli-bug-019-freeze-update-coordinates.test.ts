/**
 * BUG-019 — `nudo test --freeze=update` 在**剥离后的源码坐标**上分析并写回：
 *
 * - ① 把正确的见证行号改错（`call@L8` → `call@L5`）：基源（剥离生成块后）的
 *   调用点在第 5 行，但写回的文件里它在第 8 行；
 * - ② 过期见证与新调用点撞名 ⇒ 判「已经是最新」⇒ 永不刷新；
 * - ③ `--freeze` 运行里报告的行号相对真实文件整体偏移（少掉被剥离的行数）；
 * - ④ 已冻结的指令 case 在 `--freeze` 运行里整个消失（剥离后再没被分析）。
 *
 * 契约：写盘文本里的 `call@L<n>` 必须指向**该文件**里真实的调用点行号；
 * 更新幂等（第二次不改写）；更新运行的展示面必须含已冻结的指令 case
 * （不是剥离坐标系的 entry@ 偏移视图）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const CALL = "add(1, 2);";

const BASE = `export function add(a, b) {
  return a + b;
}
${CALL}
`;

/** 直接在源文件里造一个「已冻结」块（3 行） + 可选空行把调用点推远。 */
function frozenFile(claimedLine: number, blankLinesAfterDecl = 0): string {
  const blanks = "\n".repeat(blankLinesAfterDecl);
  return `/**
 * @nudo:case "call@L${claimedLine}" (1, 2)
 */
export function add(a, b) {
  return a + b;
}
${blanks}${CALL}
`;
}

function project(text: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug19-"));
  const file = join(dir, "add.js");
  writeFileSync(file, text);
  return { dir, file };
}

/** 文件里真实调用点的行号（1-based） */
function callLine(text: string): number {
  return text.split("\n").findIndex((l) => l.trim() === CALL) + 1;
}

/** 生成块里声明的见证行号（无 ⇒ undefined） */
function claimedLine(text: string): number | undefined {
  const m = /@nudo:case "call@L(\d+)"/.exec(text);
  return m ? Number(m[1]) : undefined;
}

describe("BUG-019 — --freeze=update 的见证坐标", () => {
  it("首轮 add 之后的 update 把见证名改成真实行号，且再跑一次幂等", () => {
    const { dir, file } = project(BASE);
    try {
      expect(runCliTsx(["test", file, "--freeze"]).status).toBe(0);
      const afterAdd = readFileSync(file, "utf-8");
      // 首轮 add 的块插在声明上方 ⇒ 名字（基源坐标）必然过期
      expect(claimedLine(afterAdd)).not.toBe(callLine(afterAdd));

      const upd = runCliTsx(["test", file, "--freeze=update"]);
      expect(upd.status).toBe(0);
      const afterUpdate = readFileSync(file, "utf-8");
      expect(claimedLine(afterUpdate)).toBe(callLine(afterUpdate));

      // ② 幂等：第二次 update 不改写、不报 diff
      const again = runCliTsx(["test", file, "--freeze=update", "--dry-run"]);
      expect(again.status).toBe(0);
      expect(again.stdout).toContain("freeze: no changes.");
      expect(readFileSync(file, "utf-8")).toBe(afterUpdate);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("已正确的见证不被改错（写盘污染回归）", () => {
    const file = frozenFile(8, 1); // 调用点真的在第 8 行
    const { dir, file: path } = project(file);
    try {
      const text = readFileSync(path, "utf-8");
      expect(callLine(text)).toBe(8);
      const r = runCliTsx(["test", path, "--freeze=update", "--dry-run"]);
      expect(r.stdout).toContain("freeze: no changes.");
      expect(claimedLine(readFileSync(path, "utf-8"))).toBe(8);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("过期见证被刷新（不再「no changes」）", () => {
    const { dir, file } = project(frozenFile(4, 1)); // 名字 L4，真实调用在 L8
    try {
      expect(callLine(readFileSync(file, "utf-8"))).toBe(8);
      const r = runCliTsx(["test", file, "--freeze=update"]);
      expect(r.status).toBe(0);
      expect(r.stdout).not.toContain("freeze: no changes.");
      expect(claimedLine(readFileSync(file, "utf-8"))).toBe(8);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("update 运行的展示面含已冻结的指令 case（不退回剥离坐标系的 entry@）", () => {
    const { dir, file } = project(frozenFile(8, 1));
    try {
      const r = runCliTsx(["test", file, "--freeze=update"]);
      expect(r.stdout).toContain(`case "call@L8"`);
      expect(r.stdout).toContain("[unchecked]");
      // ④ 旧行为：剥离后看不到指令 case ⇒ 只剩 entry@（行号还偏移）
      expect(r.stdout).not.toContain("entry@");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("普通 test 对同一次调用只记一条（指令见证与合成调用点不并存）", () => {
    const { dir, file } = project(frozenFile(8, 1));
    try {
      const r = runCliTsx(["test", file]);
      // 之前会出现两条：冻结写回的指令见证 `call@L8` + 活调用点合成的 `call@L9`
      const caseLines = (r.stdout.match(/^ {2}call@L\d+/gm) ?? []).length;
      expect(caseLines).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
