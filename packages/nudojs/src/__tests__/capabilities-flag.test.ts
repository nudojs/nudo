/**
 * 模块套件：CLI `--capabilities strict|trusted` 开关。
 *
 * strict（默认）：denied 宿主面报 `nudo:capability-denied`；
 * trusted：退回旧面 `nudo:builtin-unknown`；
 * 非法取值：usage error（exit 1，直指旗标）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode } from "./helpers/run-cli.ts";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-capabilities-flag-"));
  file = join(dir, "fetch.js");
  writeFileSync(
    file,
    '/** @nudo:case "f" () */\nexport function f() {\n  return fetch("https://example.com/");\n}\n',
    "utf-8",
  );
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const out = (r: { stdout: string; stderr: string }): string => `${r.stdout}\n${r.stderr}`;

type Case = {
  name: string;
  argv: string[];
  exit: number;
  contains?: string[];
  absent?: string[];
};

const CASES: Case[] = [
  { name: "test 默认 strict ⇒ capability-denied", argv: ["test"], exit: 0, contains: ["nudo:capability-denied"] },
  { name: "check 默认 strict ⇒ 接受旗标但不产 capability 诊断", argv: ["check"], exit: 0, absent: ["nudo:capability-denied", "nudo:builtin-unknown"] },
  { name: "test trusted ⇒ builtin-unknown 且无 capability-denied", argv: ["test", "--capabilities", "trusted"], exit: 0, contains: ["nudo:builtin-unknown"], absent: ["nudo:capability-denied"] },
  { name: "check trusted ⇒ 同样不产 capability 诊断", argv: ["check", "--capabilities", "trusted"], exit: 0, absent: ["nudo:capability-denied", "nudo:builtin-unknown"] },
  { name: "test --capabilities=trusted（等号形态）⇒ 无 capability-denied", argv: ["test", "--capabilities=trusted"], exit: 0, absent: ["nudo:capability-denied"] },
  { name: "test 非法取值 ⇒ exit 1 + 点名旗标", argv: ["test", "--capabilities", "nope"], exit: 1, contains: ['--capabilities expects "strict" or "trusted"'] },
  { name: "check 非法取值 ⇒ 同一 usage error", argv: ["check", "--capabilities", "nope"], exit: 1, contains: ['--capabilities expects "strict" or "trusted"'] },
];

describe("[matrix] CLI --capabilities：命令面 × 取值 × 退出码", () => {
  it.each(CASES)("$name", ({ argv, exit, contains = [], absent = [] }) => {
    const r = runCliNode([...argv, file]);
    const text = out(r);
    expect(r.status).toBe(exit);
    for (const s of contains) expect(text).toContain(s);
    for (const s of absent) expect(text).not.toContain(s);
  });
});
