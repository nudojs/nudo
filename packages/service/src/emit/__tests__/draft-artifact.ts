/**
 * 草稿产物检查共享助手：真跑 `node --check`（草稿必须是**合法 JS**——
 * 解析期 SyntaxError 会让整份侧车失联，见 Bug 527 / 545）。
 */
import { execFileSync } from "node:child_process";

export function nodeCheck(file: string): { ok: boolean; stderr: string } {
  try {
    execFileSync(process.execPath, ["--check", file], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stderr: "" };
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    return { ok: false, stderr: `${err.stderr ?? ""}${err.stdout ?? err.message ?? ""}` };
  }
}
