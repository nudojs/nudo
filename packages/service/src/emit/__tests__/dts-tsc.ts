/**
 * dts 产物面的 **tsc 实测** harness（族 15 专用）。
 *
 * 产物面条目（dts / zod / standard / guard）必须真的能被
 * `tsc --noEmit --strict` 编译——只比字符串抓不到 TS2314（缺类型实参）/
 * TS1359（保留字）/ TS2571（unknown 上的方法调用）/ TS2339（空对象属性读）/
 * TS2488（不可迭代）这些症状。
 *
 * 独立文件（不塞进共享 `fixtures.ts`）：避免与并发分片在共享夹具里撞同名
 * 导出（重复导出会让所有引用它的文件一起编译失败）。
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpProject } from "../../__tests__/tmp-project.ts";

export type TscResult = { ok: boolean; stderr: string };

/** 把给定文件写进临时工程并跑 `tsc --noEmit --strict`（真编译） */
export function tscNoEmit(files: Record<string, string>): TscResult {
  const dir = tmpProject("nudo-dts-tsc-");
  const paths: string[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    writeFileSync(p, content.endsWith("\n") ? content : content + "\n", "utf-8");
    paths.push(p);
  }
  try {
    execFileSync(
      "pnpm",
      ["exec", "tsc", "--noEmit", "--strict", "--ignoreConfig", ...paths],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { ok: true, stderr: "" };
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    return { ok: false, stderr: `${err.stderr ?? ""}${err.stdout ?? err.message ?? ""}` };
  }
}
