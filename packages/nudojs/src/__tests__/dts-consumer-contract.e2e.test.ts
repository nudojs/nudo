/**
 * 模块套件：dts 产物面的**消费方差分**（1 文件 = 1 worker）。
 *
 * 只比字符串抓不到「产物比实现更宽」这类缺陷：dts 里写 `unknown` /
 * `number | string` / `number[][]` 时，字符串断言可能仍然通过，而真实消费者
 * 要么把错误实参放过去（假绿），要么被合法调用拦住（假红）。
 *
 * 裁判口径（每个夹具都成对）：
 * - 生成 `.d.ts`（CLI `export --format dts`）；
 * - **正确用法**的消费者 `tsc --noEmit --strict` ⇒ exit 0；
 * - **错误用法**的消费者（错实参 / 错覆写 / 错返回赋值）⇒ 非零，且诊断里
 *   带预期的 TS 码（2322 / 2345 / 2416）。
 *
 * 覆盖通道：abstract / 无体方法的源码面形参、构造器 rest、对象字面量成员
 * 函数、类方法返回位（注解证据），外加一条**反向对照**（普通方法的形参不得
 * 被放宽成 `unknown`）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { repoRoot, runCliTsx as runCli } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 仓库自带 tsc（与 `pnpm exec tsc` 同一入口；测试不编译整个 monorepo）。 */
const tscBin = join(repoRoot, "node_modules/.bin/tsc");

/**
 * 消费方编译参数：`--ignoreConfig` 不读本仓 tsconfig（夹具是独立小工程），
 * nodenext 让 `import "./out/x.js"` 解析到 `out/x.d.ts`。
 */
const TSC_ARGS = [
  "--noEmit",
  "--strict",
  "--skipLibCheck",
  "--ignoreConfig",
  "--target",
  "es2022",
  "--module",
  "nodenext",
  "--moduleResolution",
  "nodenext",
];

function runTsc(files: string[]): { status: number; output: string } {
  const r = spawnSync(tscBin, [...TSC_ARGS, ...files], {
    cwd: repoRoot,
    encoding: "utf-8",
  });
  return { status: r.status ?? 1, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

type Consumer = {
  /** 期望的诊断码（诊断行里必须出现） */
  code: string;
  source: string;
};

type Fixture = {
  /** 夹具名（也是源文件 / 产物名；不含缺陷编号） */
  name: string;
  source: string;
  /** 产物里必须出现的声明片段（形状钉） */
  expectDts: string[];
  /** 产物里不得出现的放宽形态（反向钉） */
  rejectDts?: string[];
  /** 正确用法的消费者 */
  correct: string;
  /** 错误用法的消费者 */
  wrong: Consumer[];
};

const FIXTURES: Fixture[] = [
  {
    name: "abstract-method",
    source: `export abstract class Base {
  abstract m(a: number, ...rest: string[]): void;
  concrete(b: number): number { return b + 1; }
}
`,
    expectDts: ["abstract m(a: number, ...rest: string[]): void;", "concrete(b: number): number;"],
    rejectDts: ["a: unknown"],
    correct: `import { Base } from "./out/abstract-method.js";

export class Sub extends Base {
  m(a: number, ...rest: string[]): void {
    void a;
    void rest;
  }
}

export function call(b: Base): void {
  b.m(1, "x", "y");
  b.concrete(2);
}
`,
    wrong: [
      {
        code: "TS2345",
        source: `import { Base } from "./out/abstract-method.js";

export function call(b: Base): void {
  b.m("x", 1, 2);
}
`,
      },
      {
        code: "TS2416",
        source: `import { Base } from "./out/abstract-method.js";

export class BadSub extends Base {
  m(a: string): void {
    void a;
  }
}
`,
      },
    ],
  },
  {
    name: "ctor-rest",
    source: `export class Ctor {
  constructor(...rest: number[]) { void rest; }
  method(...rest: number[]): number { return rest.length; }
}
`,
    expectDts: ["constructor(...rest: number[]);", "method(...rest: number[]): number;"],
    rejectDts: ["number[][]"],
    correct: `import { Ctor } from "./out/ctor-rest.js";

export function make(): number {
  const c = new Ctor(1, 2, 3);
  return c.method(4, 5);
}
`,
    wrong: [
      {
        code: "TS2345",
        source: `import { Ctor } from "./out/ctor-rest.js";

export const c = new Ctor([1], [2]);
`,
      },
      {
        code: "TS2345",
        source: `import { Ctor } from "./out/ctor-rest.js";

export function call(c: Ctor): number {
  return c.method(1, "x");
}
`,
      },
    ],
  },
  {
    name: "object-member",
    source: `export const cfg = {
  g(a: number): number { return a + 1; },
  h: (a: number): number => a + 1,
};
`,
    expectDts: ["g: (a: number) => number", "h: (a: number) => number"],
    correct: `import { cfg } from "./out/object-member.js";

export const a: number = cfg.g(1);
export const b: number = cfg.h(2);
`,
    wrong: [
      {
        code: "TS2345",
        source: `import { cfg } from "./out/object-member.js";

export const a = cfg.g("str");
`,
      },
    ],
  },
  {
    name: "class-method-return",
    source: `export class K {
  n: number;
  constructor(n: number) { this.n = n; }
  m() { return this.n + 1; }
}
`,
    expectDts: ["m(): number;", "constructor(n: number);"],
    rejectDts: ["number | string"],
    correct: `import { K } from "./out/class-method-return.js";

export const v: number = new K(1).m();
`,
    wrong: [
      {
        code: "TS2322",
        source: `import { K } from "./out/class-method-return.js";

export const s: string = new K(1).m();
`,
      },
    ],
  },
  {
    // 注解档：源码写了 `: number`，注解就是 `check` 签名面发布的那条类型。
    // 求值面把 `this.<字段>` 播种成 any ⇒ 观测串是 `number | string`；产物若
    // 照抄观测串，消费者按 `number` 用会被 TS2322 拦住（假红），而 `check` /
    // tsc dts 都是 `number`。
    name: "class-method-return-annotated",
    source: `export class K2 {
  n: number;
  constructor(n: number) { this.n = n; }
  m(): number { return this.n + 1; }
}
`,
    expectDts: ["m(): number;", "constructor(n: number);"],
    rejectDts: ["number | string"],
    correct: `import { K2 } from "./out/class-method-return-annotated.js";

export const v: number = new K2(1).m();
`,
    wrong: [
      {
        code: "TS2322",
        source: `import { K2 } from "./out/class-method-return-annotated.js";

export const s: string = new K2(1).m();
`,
      },
    ],
  },
  {
    // 反向对照：普通（有体、有注解）方法不得被放宽 —— 形参仍是 `number`。
    name: "plain-method",
    source: `export class Plain {
  m(a: number): number { return a + 1; }
}
`,
    expectDts: ["m(a: number): number;"],
    rejectDts: ["a: unknown"],
    correct: `import { Plain } from "./out/plain-method.js";

export const v: number = new Plain().m(1);
`,
    wrong: [
      {
        code: "TS2345",
        source: `import { Plain } from "./out/plain-method.js";

export const v = new Plain().m("str");
`,
      },
    ],
  },
  {
    // 全局增强面：模块级 `declare global { … }` 是**裸 `TSModuleDeclaration`**
    // （没有 `export` 外壳）⇒ 旧实现五趟顶层扫描全不命中、整块静默消失：
    // 消费方读被增强的全局成员报 TS2339（`var nudoGlobalProbe` 不存在）。
    // 镜像进产物后，正确用法 exit 0；把增强成员当别的类型用必须被 TS2322 拦住
    // （证明确实是**类型化**的增强，而不是被放宽成 any）。
    name: "global-augmentation",
    source: `declare global {
  var nudoGlobalProbe: string;
  interface NudoGlobalShape {
    probe: string;
  }
}

export interface Local {
  z: number;
}

export const marker = 1;
`,
    expectDts: [
      "declare global {",
      "var nudoGlobalProbe: string;",
      "interface NudoGlobalShape {",
      "export interface Local {",
    ],
    correct: `import { marker } from "./out/global-augmentation.js";
import type { Local } from "./out/global-augmentation.js";

export const v: string = nudoGlobalProbe;
export const l: Local = { z: marker };
export const s: NudoGlobalShape = { probe: v };
`,
    wrong: [
      {
        code: "TS2322",
        source: `import "./out/global-augmentation.js";

export const n: number = nudoGlobalProbe;
`,
      },
      {
        code: "TS2322",
        source: `import "./out/global-augmentation.js";
import type { Local } from "./out/global-augmentation.js";

export const l: Local = { z: "not a number" };
`,
      },
    ],
  },
];

describe("dts 产物面的消费方差分", () => {
  it("正确用法编译通过、错误用法被拦（错实参 / 错覆写 / 错返回赋值）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-dts-consumer-"));
    dirs.push(dir);
    const out = join(dir, "out");
    mkdirSync(out, { recursive: true });

    for (const fixture of FIXTURES) {
      const srcPath = join(dir, `${fixture.name}.ts`);
      writeFileSync(srcPath, fixture.source, "utf-8");
      const run = runCli(["export", srcPath, "--format", "dts", "--out", out]);
      expect(run.status, `export failed for ${fixture.name}:\n${run.stderr}`).toBe(0);
      const dts = readFileSync(join(out, `${fixture.name}.d.ts`), "utf-8");
      for (const want of fixture.expectDts) {
        expect(dts, `${fixture.name}.d.ts must contain ${want}`).toContain(want);
      }
      for (const bad of fixture.rejectDts ?? []) {
        expect(dts, `${fixture.name}.d.ts must not contain ${bad}`).not.toContain(bad);
      }
    }

    // 单夹具一次 tsc：所有**正确**消费者进同一个 program，必须 exit 0。
    const correctFiles = FIXTURES.map((f) => {
      const p = join(dir, `use-${f.name}.ts`);
      writeFileSync(p, f.correct, "utf-8");
      return p;
    });
    const ok = runTsc(correctFiles);
    expect(ok.status, `correct consumers must compile:\n${ok.output}`).toBe(0);

    // 所有**错误**消费者进另一个 program：必须非零，且每条诊断的 TS 码对得上。
    const wrongFiles: Array<{ path: string; code: string }> = [];
    for (const f of FIXTURES) {
      f.wrong.forEach((w, i) => {
        const p = join(dir, `bad-${f.name}-${i}.ts`);
        writeFileSync(p, w.source, "utf-8");
        wrongFiles.push({ path: p, code: w.code });
      });
    }
    const bad = runTsc(wrongFiles.map((w) => w.path));
    expect(bad.status, `wrong consumers must fail:\n${bad.output}`).not.toBe(0);
    for (const w of wrongFiles) {
      const base = w.path.slice(w.path.lastIndexOf("/") + 1);
      // 诊断行形如 `…/bad-x-0.ts(3,9): error TS2345: …`
      expect(bad.output, `${base} must report ${w.code}`).toMatch(
        new RegExp(`${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\([^)]*\\): error ${w.code}`),
      );
    }
  });
});
