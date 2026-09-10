#!/usr/bin/env node
/**
 * nudo-types — 从 JS 源码打印「类型即计算」结果
 *
 * 用法：
 *   nudo-types <file.js> [fnName]
 *   nudo-types --source 'const add=(a,b)=>a+b;' add
 *
 * 无 fnName 时分析文件中全部函数声明。
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import {
  evalSource,
  analyzeFn,
  emptyEnv,
  numLit,
  numVar,
  strLit,
  unknown,
  formatAbsMultiline,
  formatShape,
  gtNum,
  v,
  pTrue,
  generalizeFromAst,
  checkCall,
  formatDiagnostics,
  type Abs,
  type Phi,
} from "./index.ts";
import { parse } from "@nudojs/parser";

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  let source: string | undefined;
  let file: string | undefined;
  let fn: string | undefined;
  let assume: string[] = [];
  let generalize = false;
  let check = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--source") {
      source = args[++i];
    } else if (a === "--assume") {
      assume.push(args[++i]!);
    } else if (a === "--generalize" || a === "-g") {
      generalize = true;
    } else if (a === "--check") {
      check = true;
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else if (!file && !source) {
      file = a;
    } else {
      fn = a;
    }
  }
  return { source, file, fn, assume, generalize, check };
}

function printHelp(): void {
  console.log(`nudo-types — 类型即计算

用法:
  nudo-types <file.js> [fnName]
  nudo-types --source '<js>' [fnName]
  nudo-types <file.js> --assume 'x>0'
  nudo-types <file.js> --generalize

选项:
  --source <js>     直接分析源码字符串
  --assume <pred>   前置约束，目前支持 x>N
  --generalize, -g  符号 α 上执行，打印多态签名
  --check           约束诊断
  -h, --help        显示帮助
`);
}

function parseAssume(s: string): Phi | undefined {
  // x>0 / x>=1
  const m = /^([A-Za-z_$][\w$]*)\s*(>=|>)\s*(-?\d+(?:\.\d+)?)$/.exec(s.trim());
  if (!m) return undefined;
  const id = m[1]!;
  const op = m[2]!;
  const n = Number(m[3]);
  return op === ">" ? gtNum(v(id), n) : gtNum(v(id), n); // geNum 简化：都用 gt
}

function listFunctions(source: string): string[] {
  const file = parse(source);
  const names: string[] = [];
  for (const stmt of file.program.body) {
    if (stmt.type === "FunctionDeclaration" && stmt.id) {
      names.push(stmt.id.name);
    }
    if (stmt.type === "VariableDeclaration") {
      for (const d of stmt.declarations) {
        if (
          d.id.type === "Identifier" &&
          d.init &&
          (d.init.type === "ArrowFunctionExpression" ||
            d.init.type === "FunctionExpression")
        ) {
          names.push(d.id.name);
        }
      }
    }
  }
  return names;
}

function buildArgs(
  fnName: string,
  source: string,
  phi: Phi,
  assumeIds: Set<string>,
): Abs[] {
  // 从函数声明读取参数名；带 assume 的参数用符号，否则 unknown
  const file = parse(source);
  let params: string[] = [];
  for (const stmt of file.program.body) {
    if (stmt.type === "FunctionDeclaration" && stmt.id?.name === fnName) {
      params = stmt.params.map((p) => (p.type === "Identifier" ? p.name : "_"));
    }
    if (stmt.type === "VariableDeclaration") {
      for (const d of stmt.declarations) {
        if (
          d.id.type === "Identifier" &&
          d.id.name === fnName &&
          d.init &&
          (d.init.type === "ArrowFunctionExpression" ||
            d.init.type === "FunctionExpression")
        ) {
          const init = d.init as { params: Array<{ type: string; name?: string }> };
          params = init.params.map((p) => (p.type === "Identifier" ? (p.name ?? "_") : "_"));
        }
      }
    }
  }
  return params.map((p) => {
    if (assumeIds.has(p)) {
      return numVar(p, gtNum(v(p), 0));
    }
    // 无 assume：给 unknown 参数
    return {
      shape: { k: "unknown" as const },
      conf: "partial" as const,
    };
  });
}

function main(): void {
  const { source: srcOpt, file, fn, assume, generalize, check } = parseArgs(process.argv);
  let source = srcOpt;
  if (file) {
    source = readFileSync(file, "utf8");
  }
  if (!source) {
    printHelp();
    process.exit(1);
  }

  let phi: Phi = pTrue;
  const assumeIds = new Set<string>();
  for (const a of assume) {
    const p = parseAssume(a);
    if (p) {
      phi = p;
      if (p.op === "gt" && p.a.op === "var") assumeIds.add(p.a.id);
    } else {
      console.error(`无法解析 --assume: ${a}（支持 x>0 形式）`);
    }
  }

  const fns = fn ? [fn] : listFunctions(source);
  if (fns.length === 0) {
    console.error("未找到函数声明");
    process.exit(1);
  }

  const title = file ? basename(file) : "<source>";
  console.log(`nudo-types  ${title}`);
  if (assumeIds.size > 0) {
    console.log(`assume: ${[...assumeIds].map((id) => `${id} > 0`).join(", ")}`);
  }
  if (generalize) console.log("mode: generalize");
  if (check) console.log("mode: check");
  console.log("");

  if (check) {
    const allDiags = [];
    for (const name of fns) {
      const args = buildArgs(name, source, phi, assumeIds);
      const diags = checkCall(source, name, args, phi);
      allDiags.push(...diags);
    }
    console.log(formatDiagnostics(allDiags));
    if (allDiags.some((d) => d.severity === "error")) process.exitCode = 1;
    return;
  }

  if (generalize) {
    for (const name of fns) {
      const g = generalizeFromAst(name, source);
      if (!g) {
        console.log(`${name}:  (not found)`);
        continue;
      }
      console.log(g.display);
      console.log("");
    }
    return;
  }

  for (const name of fns) {
    const args = buildArgs(name, source, phi, assumeIds);
    let result: Abs;
    try {
      result = analyzeFn(source, name, args, phi);
    } catch (e) {
      console.log(`${name}:  (error: ${(e as Error).message})`);
      continue;
    }
    console.log(formatAbsMultiline(result, `${name}(${args.map(formatShape).join(", ")})`));
    console.log("");
  }
}

main();
