/**
 * omp 事件流 / session.jsonl → token / rounds / ctx（**只算 token，不算 price**）
 *
 * omp `--mode json` 为 NDJSON：
 *   message_end.message.usage = { input, output, cacheRead, cacheWrite, totalTokens }
 *   agent_end.messages[] 同构
 * message_start / message_end / turn_end 可能指向同一轮 —— 按 messageId 去重。
 */

export function emptyMetrics() {
  return {
    tokenIn: 0,
    tokenOut: 0,
    tokenTotal: 0,
    rounds: 0,
    toolCalls: 0,
    ctxAvg: 0,
    ctxPeak: 0,
    offscriptToolCalls: 0,
    offscriptSamples: [],
    wallMs: 0,
  };
}

// isometry deviation: learn≈∞ probes / off-manifest tools — NOT PRD implementation cost
// note: do NOT match `nudojs/` — `@nudojs/core` imports in *.nudo.js are legal sidecars
const LEARN_PROBES =
  /(--help\b|(?<!@)nudojs\/|packages\/|monorepo|langspec|surface\.ts|require\.resolve|\/tmp\/nudo)/;
const KNOWN_TOOLS =
  /^(bash|edit|write|read|glob|grep|task|todo|todoread|todowrite|todo_write|search|webfetch|websearch|code_execution|playwright|think|report_findings|exit_plan_mode|invalid|eval|session|patch|apply_patch|multi_edit|str_replace)$/i;

function scanOffscript(records) {
  const samples = [];
  let count = 0;
  const push = (label) => {
    count += 1;
    if (samples.length < 5) samples.push(String(label).slice(0, 120));
  };
  for (const r of records ?? []) {
    const msg = r?.type === "message" || r?.type === "message_end" ? r.message ?? r : r;
    const content = msg?.content;
    const items = Array.isArray(content)
      ? content
      : msg?.tool || msg?.tool_name || msg?.name
        ? [msg]
        : [];
    for (const it of items) {
      const name = it?.name ?? it?.tool ?? it?.tool_name ?? "";
      const isTool =
        it?.type === "toolCall" ||
        it?.type === "tool_use" ||
        (name && KNOWN_TOOLS.test(String(name))) ||
        (name && it?.input !== undefined) ||
        (name && it?.arguments !== undefined);
      if (!isTool && !(name && it?.type === "toolCall")) {
        // still allow bare tool records
        if (!name) continue;
      }
      const argStr = JSON.stringify(it?.input ?? it?.arguments ?? it?.tool_input ?? {});
      if (name && !KNOWN_TOOLS.test(String(name))) push(`tool:${name}`);
      if (LEARN_PROBES.test(argStr)) push(`probe:${name}:${argStr}`);
    }
  }
  return { offscriptToolCalls: count, offscriptSamples: samples };
}

function readUsage(u) {
  if (!u || typeof u !== "object") return null;
  const input =
    u.input ?? u.prompt_tokens ?? u.input_tokens ?? u.promptTokens ?? 0;
  const output =
    u.output ?? u.completion_tokens ?? u.output_tokens ?? u.completionTokens ?? 0;
  return { input: Number(input) || 0, output: Number(output) || 0 };
}

/**
 * @param records  omp NDJSON 条目（或 session.jsonl 条目）
 */
export function summarizeOmpSession(records, wallMs = 0) {
  /** @type {Map<string, {input:number,output:number,ctx:number,tools:number}>} */
  const rounds = new Map();

  const ingest = (id, msg) => {
    if (!msg || msg.role !== "assistant") return;
    const u = readUsage(msg.usage);
    const snap = msg.contextSnapshot;
    const ctx = snap?.promptTokens ?? u?.input ?? 0;
    const tools = Array.isArray(msg.content)
      ? msg.content.filter((c) => c && c.type === "toolCall").length
      : 0;
    const prev = rounds.get(id);
    if (prev) {
      // 同一轮多事件：取 usage 非零的一次
      if (u && (u.input || u.output)) {
        prev.input = u.input;
        prev.output = u.output;
      }
      prev.ctx = Math.max(prev.ctx, ctx);
      prev.tools = Math.max(prev.tools, tools);
      return;
    }
    rounds.set(id, {
      input: u?.input ?? 0,
      output: u?.output ?? 0,
      ctx,
      tools,
    });
  };

  for (const r of records ?? []) {
    // session.jsonl: { type:"message", message:{ role, usage, content, contextSnapshot } }
    if (r.type === "message" && r.message) {
      ingest(String(r.id ?? rounds.size), r.message);
      continue;
    }
    if (r.type === "message_end") {
      ingest(String(r.id ?? r.message?.id ?? rounds.size), r.message ?? r);
    } else if (r.type === "agent_end" && Array.isArray(r.messages)) {
      if (rounds.size === 0) {
        r.messages.forEach((m, i) => ingest(`agent_end:${i}`, m));
      }
    } else if (r.role === "assistant" && !r.type) {
      ingest(String(r.id ?? rounds.size), r);
    }
  }

  let tokenIn = 0;
  let tokenOut = 0;
  let toolCalls = 0;
  const ctxs = [];
  for (const r of rounds.values()) {
    tokenIn += r.input;
    tokenOut += r.output;
    toolCalls += r.tools;
    if (r.ctx > 0) ctxs.push(r.ctx);
  }

  const ctxPeak = ctxs.length ? Math.max(...ctxs) : 0;
  const ctxAvg = ctxs.length
    ? Math.round(ctxs.reduce((a, b) => a + b, 0) / ctxs.length)
    : 0;
  const iso = scanOffscript(records);

  return {
    tokenIn,
    tokenOut,
    tokenTotal: tokenIn + tokenOut,
    rounds: rounds.size,
    toolCalls,
    ctxAvg,
    ctxPeak,
    ...iso,
    wallMs,
  };
}

export function countRework(testEvents) {
  let rework = 0;
  const last = new Map();
  for (const e of testEvents ?? []) {
    const prev = last.get(e.name);
    if (prev === "pass" && e.status === "fail") rework += 1;
    last.set(e.name, e.status);
  }
  return rework;
}
