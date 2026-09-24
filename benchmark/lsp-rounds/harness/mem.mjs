/**
 * macOS RSS 采样：LSP / gate / 候选进程树峰值（KB）。
 * 只读 `ps`，不依赖 web / 额外依赖。
 */
import { spawnSync } from "node:child_process";

const LSP_RE = /nudo-lsp|typescript-language-server|tsserver|tsserverlibrary|server\.js|tsserver\.js/i;
const GATE_RE = /\bnudo\b|\btsc\b|typescript/i;

function psSnapshot() {
  const r = spawnSync("ps", ["-axo", "pid=,rss=,command="], {
    encoding: "utf-8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const rows = [];
  for (const line of (r.stdout ?? "").split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    rows.push({ pid: Number(m[1]), rssKb: Number(m[2]), cmd: m[3] });
  }
  return rows;
}

/**
 * 启动周期采样。返回 stop() → peak 快照。
 * @param {{ matchLsp?: RegExp, matchGate?: RegExp, sampleMs?: number }} opts
 */
export function startMemSampler(opts = {}) {
  const sampleMs = opts.sampleMs ?? 2000;
  const matchLsp = opts.matchLsp ?? LSP_RE;
  const peak = {
    treeRssKb: 0,
    lspRssKb: 0,
    gateRssKb: 0,
    nodeRssKb: 0,
    samples: 0,
    lspCmd: "",
    treeCmd: "",
  };

  const timer = setInterval(() => {
    const rows = psSnapshot();
    peak.samples += 1;
    let tree = 0;
    let lsp = 0;
    let gate = 0;
    let node = 0;
    let lspCmd = peak.lspCmd;
    let treeCmd = peak.treeCmd;
    for (const row of rows) {
      tree += row.rssKb;
      if (matchLsp.test(row.cmd)) {
        if (row.rssKb > lsp) {
          lsp = row.rssKb;
          lspCmd = row.cmd.slice(0, 160);
        }
      }
      if (/(^|\/)node(\s|$)/.test(row.cmd) || row.cmd.includes("node ")) {
        node = Math.max(node, row.rssKb);
      }
      if (opts.matchGate && opts.matchGate.test(row.cmd)) {
        gate = Math.max(gate, row.rssKb);
      }
    }
    // 全局 node 总和不稳；记录全系统 RSS 和 + LSP 单进程峰值 + node 单进程峰值
    peak.treeRssKb = Math.max(peak.treeRssKb, tree);
    if (lsp > peak.lspRssKb) {
      peak.lspRssKb = lsp;
      peak.lspCmd = lspCmd;
    }
    peak.gateRssKb = Math.max(peak.gateRssKb, gate);
    peak.nodeRssKb = Math.max(peak.nodeRssKb, node);
    if (tree > 0) peak.treeCmd = `${rows.length} procs`;
  }, sampleMs);

  return {
    stop() {
      clearInterval(timer);
      return { ...peak };
    },
  };
}

/**
 * 跑一条命令并测 max RSS（KB）。macOS `/usr/bin/time -l`。
 * @returns {{ code: number, out: string, maxRssKb: number }}
 */
export function runWithMaxRss(cmd, args, cwd, env) {
  const r = spawnSync("/usr/bin/time", ["-l", cmd, ...args], {
    cwd,
    encoding: "utf-8",
    maxBuffer: 32 * 1024 * 1024,
    env,
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  // macOS: "maximum resident set size" in bytes
  let maxRssKb = 0;
  const m = out.match(/maximum resident set size[^\d]*(\d+)/i);
  if (m) maxRssKb = Math.round(Number(m[1]) / 1024);
  return { code: r.status ?? 1, out, maxRssKb };
}

export function formatMb(kb) {
  if (!kb) return "—";
  return `${(kb / 1024).toFixed(0)}MB`;
}
