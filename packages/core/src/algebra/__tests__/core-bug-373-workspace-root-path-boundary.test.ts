/**
 * Bug 373 —— GHA / GitLab 注解读取用**裸 `startsWith` 前缀**裁工作区路径 ⇒
 * **兄弟目录**（`…/app` vs `…/app2`）被裁成 `2/src/x.js`（指向**不存在**的
 * 文件）⇒ 注解的 `file=` / Code Quality 的 `location.path` / `fingerprint`
 * **全错**。
 *
 * 修法（core/algebra/check-report.ts）：前缀命中后，余下部分必须是**空**或
 * 以**路径分隔符**开头 ⇒ 才是「同一棵树下的子路径」；否则（`app2` vs `app`）
 * 原样保留完整路径。
 */
import { describe, it, expect } from "vitest";
import {
  formatGithubAnnotations,
  formatGitlabCodeQuality,
  type CheckReport,
} from "../check-report.ts";

const report = (file: string): CheckReport => ({
  file,
  ok: true,
  signatures: [],
  summary: { errors: 0, warnings: 0, infos: 1, functions: 0 },
  issues: [
    {
      severity: "info",
      code: "nudo:interface-entry-only",
      message: "export 'b' has no contract root and no call-site domain (entry-only)",
      line: 1,
      column: 7,
    },
  ],
});

const WS = "/ws/app";

describe("Bug 373：工作区根裁剪要过路径边界（兄弟目录不得被裁）", () => {
  it("GHA 注解：兄弟目录 app2 不得被裁成 2/src/x.js", () => {
    const out = formatGithubAnnotations(report("/ws/app2/src/x.js"), {
      workspaceRoot: WS,
    });
    expect(out).toContain("file=/ws/app2/src/x.js");
    expect(out).not.toContain("file=2/src/x.js");
  });

  it("GHA 注解：真子路径仍按工作区相对路径裁（app/src/x.js → src/x.js）", () => {
    const out = formatGithubAnnotations(report("/ws/app/src/x.js"), {
      workspaceRoot: WS,
    });
    expect(out).toContain("file=src/x.js");
  });

  it("GitLab Code Quality：location.path 不得被裁成 2/src/x.js", () => {
    const out = formatGitlabCodeQuality(report("/ws/app2/src/x.js"), {
      workspaceRoot: WS,
    });
    expect(out[0]?.location.path).toBe("/ws/app2/src/x.js");
    expect(out[0]?.fingerprint.startsWith("/ws/app2/src/x.js:")).toBe(true);
  });

  it("GitLab Code Quality：真子路径仍按工作区相对路径裁", () => {
    const out = formatGitlabCodeQuality(report("/ws/app/src/x.js"), {
      workspaceRoot: WS,
    });
    expect(out[0]?.location.path).toBe("src/x.js");
    expect(out[0]?.fingerprint.startsWith("src/x.js:")).toBe(true);
  });

  it("无工作区根 ⇒ 原样保留完整路径", () => {
    const out = formatGitlabCodeQuality(report("/ws/app2/src/x.js"));
    expect(out[0]?.location.path).toBe("/ws/app2/src/x.js");
  });
});
