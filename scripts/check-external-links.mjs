#!/usr/bin/env node
// 外链体检（每周定时任务；不进 PR 门禁——外站抖动不该阻塞合并）。
//
// 扫描站点文档树（en + zh 镜像 + 博客 + static/*.md + 仓库 README）里的 http(s)
// 链接，做并发受限的 HEAD 探测（部分站点拒绝 HEAD 时退回 GET Range 探测）。
// 判定：
//   - 2xx/3xx            → OK
//   - 403/405/429/503    → 软失败（反爬/限流），计数但不算红
//   - 404/410 及其他     → 硬失败（退出码 1）
//   - 网络错误           → 重试一次后仍失败 = 硬失败
// 运行：node scripts/check-external-links.mjs [--report] [--concurrency=6]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const args = process.argv.slice(2);
const REPORT = args.includes("--report");
// 网络层失败（DNS/连接超时/代理缺失）默认算软失败：定时任务不该因为出网抖动变红。
// 需要严格模式（例如在受控 CI 里）时加 --strict-network。
const STRICT_NETWORK = args.includes("--strict-network");
const concurrencyArg = args.find((a) => a.startsWith("--concurrency="));
const CONCURRENCY = concurrencyArg ? Number(concurrencyArg.split("=")[1]) : 6;
const TIMEOUT_MS = 12_000;

const SOURCES = [
  "packages/website/docs",
  "packages/website/i18n/zh-Hans/docusaurus-plugin-content-docs/current",
  "packages/website/blog",
  "packages/website/i18n/zh-Hans/docusaurus-plugin-content-blog",
  "packages/website/static",
  "README.md",
  "docs/examples/README.md",
];

// 站内锚点/示例占位/登录墙：不是「坏外链」。
const IGNORE = [
  /^https?:\/\/nudojs\.github\.io\//,
  /^https?:\/\/localhost/,
  /^https?:\/\/127\.0\.0\.1/,
  /^https?:\/\/api\.example\.com/,
  /^https?:\/\/example\.(com|org|net)/,
  /^https?:\/\/(www\.)?my-app\.com/,
  /\{.*\}/, // 模板占位（…{version}…）
];

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function sourceFiles() {
  const files = [];
  for (const rel of SOURCES) {
    const p = join(root, rel);
    const st = statSync(p);
    if (st.isDirectory()) files.push(...walk(p));
    else files.push(p);
  }
  return files.filter((f) => [".md", ".mdx"].includes(extname(f)));
}

const stripFences = (src) => {
  const lines = [];
  let inFence = false;
  for (const line of src.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) lines.push(line);
  }
  return lines.join("\n");
};

function collect() {
  /** @type {Map<string, string[]>} url → sources */
  const map = new Map();
  for (const file of sourceFiles()) {
    const rel = relative(root, file);
    const src = stripFences(readFileSync(file, "utf8"));
    for (const m of src.matchAll(/https?:\/\/[^\s)\]"'<＞》」』]+/g)) {
      const url = m[0].replace(/[.,;:!?，。；：！？]+$/, "");
      if (IGNORE.some((re) => re.test(url))) continue;
      const list = map.get(url) ?? [];
      if (!list.includes(rel)) list.push(rel);
      map.set(url, list);
    }
  }
  return map;
}

async function probe(url) {
  // 用 curl 而不是 Node fetch：curl 天然遵循 HTTP(S)_PROXY 等代理环境变量，
  // 在需要出网代理的机器上不会静默失败（Node 的 undici 不读这些变量）。
  const run = (extraArgs) =>
    new Promise((resolve) => {
      execFile(
        "curl",
        [
          "-sS",
          "-o",
          "/dev/null",
          "-w",
          "%{http_code}",
          "-L",
          "--max-time",
          String(Math.round(TIMEOUT_MS / 1000)),
          "-A",
          "nudo-docs-link-check/1.0 (+https://github.com/nudojs/nudo)",
          ...extraArgs,
          url,
        ],
        { timeout: TIMEOUT_MS + 5_000 },
        (err, stdout) => {
          const code = Number(String(stdout).trim());
          if (Number.isFinite(code) && code > 0) resolve({ status: code, error: null });
          else resolve({ status: 0, error: err ? String(err.message).split("\n")[0] : "no response" });
        },
      );
    });

  let res = await run(["--head"]);
  if (res.status === 0 || [403, 405, 501].includes(res.status)) {
    const ranged = await run(["-H", "Range: bytes=0-2048"]);
    if (ranged.status !== 0) res = ranged;
  }
  return res;
}

async function main() {
  const urls = collect();
  const entries = [...urls.keys()];
  const hard = [];
  const soft = [];
  let ok = 0;

  let cursor = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < entries.length) {
      const url = entries[cursor++];
      let { status, error } = await probe(url);
      if (status === 0 || status >= 500) {
        // 重试一次：3xx/4xx 是确定回答，5xx 与网络错误可能是抖动
        await new Promise((r) => setTimeout(r, 1500));
        ({ status, error } = await probe(url));
      }
      const srcs = urls.get(url).join(", ");
      if (status >= 200 && status < 400) {
        ok++;
        if (REPORT) console.log(`ok   ${status} ${url}`);
      } else if (status === 0) {
        const bucket = STRICT_NETWORK ? hard : soft;
        bucket.push({ url, status, error, srcs });
        console.log(
          `net  (no answer: ${error}) ${url}  ← ${srcs}${STRICT_NETWORK ? "" : " [soft without --strict-network]"}`,
        );
      } else if ([403, 405, 429, 503].includes(status)) {
        soft.push({ url, status, srcs });
        console.log(`soft ${status} (rate limit / bot guard) ${url}`);
      } else {
        hard.push({ url, status, error, srcs });
        console.log(`FAIL ${status} ${url}  ← ${srcs}`);
      }
    }
  });
  await Promise.all(workers);

  console.log("--------------------------------------------------------------");
  const netCount = soft.filter((s) => s.status === 0).length;
  console.log(
    `external links: ${ok} ok · ${soft.length - netCount} soft (rate limited) · ${netCount} no-answer · ${hard.length} broken of ${entries.length}`,
  );
  if (soft.some((s) => s.status === 0)) {
    console.log("no-answer hosts (network/proxy; rerun or use --strict-network to gate):");
    for (const s of soft.filter((x) => x.status === 0)) console.log(`  ${s.url}  ← ${s.srcs}`);
  }
  if (hard.length > 0) {
    console.log("broken links (update the URL or drop the reference):");
    for (const h of hard) console.log(`  ${h.status || "network"} ${h.url}  ← ${h.srcs}`);
    process.exit(1);
  }
}

await main();
