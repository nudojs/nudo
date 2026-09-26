import { useState } from "react";
import type { JSX } from "react";
import type { ReactNode } from "react";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import Translate, { translate } from "@docusaurus/Translate";
import { Highlight, type PrismTheme } from "prism-react-renderer";

import {
  type LineHint,
  sourceCode,
  sourceHints,
  contractCode,
  contractHints,
  checkOutput,
  checkHints,
  dtsOutput,
  dtsHints,
  zodOutput,
  zodHints,
  beyondExamples,
  adoptSteps,
  trialStats,
  costStats,
  signatureCards,
  ecoItems,
  agentCards,
  agentPaste,
  pathCards,
  heroCmd,
} from "../content/home.ts";

/* ── Prism theme: Engineering Noir-friendly tokens ───────────────────────── */

const nudoPrism: PrismTheme = {
  plain: {
    color: "var(--nudo-code-fg, #e8e4ff)",
    backgroundColor: "transparent",
  },
  styles: [
    {
      types: ["comment", "prolog", "cdata"],
      style: { color: "var(--nudo-code-comment, #8b849e)" },
    },
    {
      types: ["punctuation", "operator"],
      style: { color: "var(--nudo-code-punct, #9b94ad)" },
    },
    {
      types: ["keyword", "builtin", "important"],
      style: { color: "var(--nudo-code-kw, #a29bfe)" },
    },
    {
      types: ["string", "char", "attr-value", "template-string"],
      style: { color: "var(--nudo-code-str, #4ade80)" },
    },
    {
      types: ["number", "boolean", "constant", "literal"],
      style: { color: "var(--nudo-code-num, #fbbf24)" },
    },
    {
      types: ["function", "title", "title function"],
      style: { color: "var(--nudo-code-fn, #c4b5fd)" },
    },
    {
      types: ["class-name", "maybe-class-name", "tag"],
      style: { color: "var(--nudo-code-type, #fde68a)" },
    },
    {
      types: ["attr-name", "property"],
      style: { color: "var(--nudo-code-attr, #93c5fd)" },
    },
    {
      types: ["deleted"],
      style: { color: "#f87171" },
    },
  ],
};

/* ── UI primitives ───────────────────────────────────────────────────────── */

/** Syntax-highlighted code with per-line Nudo inlays + hover observation panels. */
function NudoCode({
  code,
  language = "javascript",
  hints = [],
  dense = false,
}: {
  code: string;
  language?: string;
  hints?: LineHint[];
  dense?: boolean;
}) {
  const hintMap = new Map(hints.map((h) => [h.line, h]));
  return (
    <div className={`nudo-code${dense ? " nudo-code-dense" : ""}`}>
      <Highlight theme={nudoPrism} code={code.replace(/\n$/, "")} language={language}>
        {({ className, style, tokens, getTokenProps }) => (
          <pre
            className={`nudo-code-pre ${className ?? ""}`}
            style={{ ...style, background: "transparent", color: "var(--nudo-code-fg)" }}
          >
            {tokens.map((line, i) => {
              const lineNo = i + 1;
              const hint = hintMap.get(lineNo);
              return (
                <div key={i} className={`nudo-code-line${hint ? " has-hint" : ""}`}>
                  <code className="nudo-code-line-text">
                    {line.map((token, key) => (
                      <span key={key} {...getTokenProps({ token })} />
                    ))}
                    {line.length === 0 ? " " : null}
                  </code>
                  {hint ? (
                    <>
                      <span className="nudo-inlay">{hint.inlay}</span>
                      <span className="nudo-tooltip" role="tooltip">
                        {hint.detail.split("\n").map((row, ri) => (
                          <span key={ri} className="nudo-tooltip-row">
                            {row}
                          </span>
                        ))}
                      </span>
                    </>
                  ) : (
                    <span className="nudo-inlay nudo-inlay-empty" aria-hidden="true" />
                  )}
                </div>
              );
            })}
          </pre>
        )}
      </Highlight>
    </div>
  );
}

function CodePanel({
  title,
  tag,
  tagClass,
  code,
  language = "javascript",
  hints,
  dense,
}: {
  title: string;
  tag?: string;
  tagClass?: string;
  code: string;
  language?: string;
  hints?: LineHint[];
  dense?: boolean;
}) {
  return (
    <div className="term-panel">
      <div className="term-panel-head">
        <span className="term-panel-title">{title}</span>
        {tag ? <span className={`term-tag ${tagClass ?? ""}`}>{tag}</span> : null}
      </div>
      <NudoCode code={code} language={language} hints={hints} dense={dense} />
    </div>
  );
}

function TabGroup({
  tabs,
  ariaLabel,
}: {
  tabs: { id: string; label: ReactNode; content: ReactNode }[];
  ariaLabel: string;
}) {
  const [active, setActive] = useState(tabs[0]?.id);
  return (
    <div className="nudo-tabs">
      <div className="nudo-tablist" role="tablist" aria-label={ariaLabel}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={active === tab.id}
            aria-controls={`panel-${tab.id}`}
            className={`nudo-tab${active === tab.id ? " is-active" : ""}`}
            onClick={() => setActive(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`panel-${tab.id}`}
          aria-labelledby={`tab-${tab.id}`}
          hidden={active !== tab.id}
          className="nudo-tabpanel"
        >
          {active === tab.id ? tab.content : null}
        </div>
      ))}
    </div>
  );
}

function CopyCommand({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="hero-cmd"
      aria-label={translate({
        id: "homepage.hero.cmdAria",
        message: "Copy command",
      })}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        });
      }}
    >
      <span className="hero-cmd-prompt">$</span>
      <code className="hero-cmd-text">{text}</code>
      <span className="hero-cmd-copy">
        {copied
          ? translate({ id: "homepage.hero.copied", message: "Copied" })
          : translate({ id: "homepage.hero.copy", message: "Copy" })}
      </span>
    </button>
  );
}

/* ── Sections ────────────────────────────────────────────────────────────── */

function HeroSection() {
  return (
    <header className="hero-section">
      <div className="hero-grid" aria-hidden="true" />
      <div className="container hero-inner">
        <p className="hero-kicker">
          <Translate id="homepage.hero.kicker">Nudo</Translate>
        </p>
        <h1 className="hero-title">
          <Translate id="homepage.hero.slogan">Welcome back to JavaScript.</Translate>
        </h1>
        <p className="hero-subtitle">
          <Translate id="homepage.hero.subtitle">
            Your JS stays JS. Nudo does not restrict how you write JavaScript — it faithfully
            observes intermediate values and results, and enforces contracts sharper than types.
          </Translate>
        </p>
        <div className="hero-buttons">
          <Link className="button button--primary button--lg hero-btn-primary" to="/playground">
            <Translate id="homepage.hero.ctaPlayground">Open Playground</Translate>
          </Link>
          <Link className="button button--secondary button--lg hero-btn-secondary" to="/docs/intro">
            <Translate id="homepage.hero.ctaDocs">Read the Docs</Translate>
          </Link>
          <Link
            className="button button--secondary button--lg hero-btn-secondary"
            to="/docs/getting-started/mental-model"
          >
            <Translate id="homepage.hero.ctaMentalModel">10-min mental model</Translate>
          </Link>
        </div>

        <CopyCommand text={heroCmd} />

        <div
          className="hero-demo"
          aria-label={translate({
            id: "homepage.hero.demoAria",
            message: "Nudo observing pricing.js with a sidecar contract",
          })}
        >
          <div className="hero-demo-bar">
            <span className="hero-demo-dot" />
            <span className="hero-demo-dot" />
            <span className="hero-demo-dot" />
            <span className="hero-demo-bar-label">nudo · pricing.js + sidecar</span>
          </div>
          <div className="hero-demo-grid">
            <div className="hero-demo-col">
              <TabGroup
                ariaLabel={translate({
                  id: "homepage.demo.sourceTabsAria",
                  message: "Source and sidecar contract",
                })}
                tabs={[
                  {
                    id: "src",
                    label: <Translate id="homepage.demo.tab.source">pricing.js</Translate>,
                    content: (
                      <NudoCode
                        code={sourceCode}
                        language="javascript"
                        hints={sourceHints}
                        dense
                      />
                    ),
                  },
                  {
                    id: "sidecar",
                    label: <Translate id="homepage.demo.tab.sidecar">pricing.nudo.js</Translate>,
                    content: (
                      <NudoCode
                        code={contractCode}
                        language="javascript"
                        hints={contractHints}
                        dense
                      />
                    ),
                  },
                ]}
              />
            </div>
            <div className="hero-demo-col hero-demo-out">
              <TabGroup
                ariaLabel={translate({
                  id: "homepage.hero.outTabsAria",
                  message: "CLI projections",
                })}
                tabs={[
                  {
                    id: "check",
                    label: "check",
                    content: (
                      <NudoCode code={checkOutput} language="bash" hints={checkHints} dense />
                    ),
                  },
                  {
                    id: "zod",
                    label: "export · zod",
                    content: (
                      <NudoCode code={zodOutput} language="typescript" hints={zodHints} dense />
                    ),
                  },
                  {
                    id: "dts",
                    label: "export · dts",
                    content: (
                      <NudoCode code={dtsOutput} language="typescript" hints={dtsHints} dense />
                    ),
                  },
                ]}
              />
            </div>
          </div>
        </div>
        <p className="hero-hint">
          <Translate id="homepage.hero.hoverHint">
            Hover a line — body inlays are algebraic Abs from the sidecar; call sites in the same
            file are evidence and the L1 gate.
          </Translate>
        </p>
      </div>
    </header>
  );
}

function ProofStrip() {
  return (
    <section
      className="proof-strip"
      aria-label={translate({
        id: "homepage.proof.aria",
        message: "Measured results on real packages",
      })}
    >
      <div className="container proof-strip-inner">
        {trialStats.map((stat) => (
          <div className="proof-strip-item" key={stat.labelId}>
            <span className="proof-strip-value">{stat.value}</span>
            <span className="proof-strip-label">
              <Translate id={stat.labelId}>{stat.labelDefault}</Translate>
            </span>
          </div>
        ))}
        <Link className="proof-strip-link" to="/docs/guides/callsite-discovery">
          <Translate id="homepage.trial.detail">How call-site discovery works →</Translate>
        </Link>
      </div>
    </section>
  );
}

function ProductPath() {
  return (
    <div className="product-path" aria-label={translate({
      id: "homepage.path.aria",
      message: "Observation check, Contracts contract, ecosystem export, then retire tsc",
    })}>
      <ol className="product-path-list">
        {adoptSteps.map((step) => (
          <li key={step.tagId} className="product-path-item">
            <span className="path-tag">
              <Translate id={step.tagId}>{step.tagDefault}</Translate>
            </span>
            <span className="product-path-title">
              <Translate id={step.titleId}>{step.titleDefault}</Translate>
            </span>
            <code className="path-cmd">{step.cmd}</code>
          </li>
        ))}
      </ol>
    </div>
  );
}

function DemoSection() {
  return (
    <section className="demo-section" id="flow">
      <div className="container">
        <p className="section-eyebrow">
          <Translate id="homepage.demo.eyebrow">Product path</Translate>
        </p>
        <h2 className="section-title">
          <Translate id="homepage.demo.title">Observation → Contracts → leave tsc</Translate>
        </h2>
        <p className="section-lead">
          <Translate id="homepage.demo.lead">
            Observation: `nudo check` prints signatures and diagnoses entry may-throw. Contracts:
            sidecar contracts turn call-site facts into L1 obligations. Ecosystem: `export` projects
            artifacts from Abs. Exit: `migrate retire` — coexistence is not the end state.
          </Translate>
        </p>

        <ProductPath />

        <div className="demo-panels demo-panels-2 flow-cards">
          <article className="flow-card">
            <span className="path-tag">
              <Translate id="homepage.flow.modeA">Logic first</Translate>
            </span>
            <h3>
              <Translate id="homepage.flow.cardA">Write logic, then generate contracts</Translate>
            </h3>
            <p>
              <Translate id="homepage.flow.cardADesc">
                Call sites are evidence. `contract --draft` can generate a reviewable contract
                draft; accept into `*.nudo.js`. Drafts never become check obligations by
                themselves.
              </Translate>
            </p>
            <code className="path-cmd">npx nudojs contract --draft lib.js --from test/</code>
          </article>
          <article className="flow-card">
            <span className="path-tag path-tag-b">
              <Translate id="homepage.flow.modeB">Contracts first</Translate>
            </span>
            <h3>
              <Translate id="homepage.flow.cardB">
                Write contracts, then guide / constrain logic
              </Translate>
            </h3>
            <p>
              <Translate id="homepage.flow.cardBDesc">
                Write `*.nudo.js` or `@nudo:contract` first. The same contract face guides
                implementation and constrains logic in `check`.
              </Translate>
            </p>
            <code className="path-cmd">npx nudojs check src/</code>
          </article>
        </div>

        <div className="eco-block">
          <h3 className="eco-heading">
            <Translate id="homepage.eco.title">Validate vs. project</Translate>
          </h3>
          <p className="eco-lead">
            <Translate id="homepage.eco.lead">
              The flow is centered on the Abs contract face. `check` only validates. `export`
              projects `.d.ts` / Zod / Standard Schema / guards from Abs; IDE and agents read Abs
              directly.
            </Translate>
          </p>
          <div className="eco-grid">
            {ecoItems.map((item) => (
              <div className="eco-item" key={item.descId}>
                <h4>{item.title}</h4>
                <p>
                  <Translate id={item.descId}>{item.descDefault}</Translate>
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="demo-actions">
          <Link className="button button--primary" to="/docs/why-nudo">
            <Translate id="homepage.demo.why">Why Nudo</Translate>
          </Link>
          <Link className="button button--secondary" to="/docs/guides/check">
            <Translate id="homepage.demo.checkDocs">nudo check</Translate>
          </Link>
          <Link className="button button--secondary" to="/docs/guides/migrating-from-typescript">
            <Translate id="homepage.demo.fromTs">From TypeScript</Translate>
          </Link>
        </div>
      </div>
    </section>
  );
}

function CostSection() {
  return (
    <section className="cost-section" id="cost">
      <div className="container">
        <p className="section-eyebrow">
          <Translate id="homepage.cost.eyebrow">Cost, measured</Translate>
        </p>
        <h2 className="section-title">
          <Translate id="homepage.cost.title">Shorter repair loops, cheaper payloads</Translate>
        </h2>
        <p className="section-lead">
          <Translate id="homepage.cost.lead">
            Variables show up close to runtime and violations carry actual / expected / actions — so
            agents detect earlier and iterate less. Numbers are in-repo baselines (OSS slice + micro
            probes), not a closed benchmark.
          </Translate>
        </p>
        <div className="cost-stats">
          {costStats.map((stat) => (
            <article className="cost-stat" key={stat.labelId}>
              <div className="cost-stat-row">
                <span className="cost-stat-value">{stat.value}</span>
                <span className="cost-stat-compare">{stat.compare}</span>
              </div>
              <p className="cost-stat-label">
                <Translate id={stat.labelId}>{stat.labelDefault}</Translate>
              </p>
            </article>
          ))}
        </div>
        <p className="cost-foot">
          <Translate id="homepage.cost.foot">
            TS “cheap” tokens are often silent green. Nudo pays tokens to report.
          </Translate>{" "}
          <Link to="/docs/guides/vs-typescript">
            <Translate id="homepage.cost.detail">Method and bounds →</Translate>
          </Link>
        </p>
      </div>
    </section>
  );
}

function BeyondSection() {
  return (
    <section className="beyond-section">
      <div className="container">
        <p className="section-eyebrow">
          <Translate id="homepage.beyond.eyebrow">Beyond declared types</Translate>
        </p>
        <h2 className="section-title">
          <Translate id="homepage.beyond.title">Values TypeScript widens away</Translate>
        </h2>
        <p className="section-lead">
          <Translate id="homepage.beyond.lead">
            Nudo evaluates on Abs, so results track actual computation — literal strings, splits,
            loop sums — not a declared upper bound.
          </Translate>
        </p>
        <div
          className="beyond-table"
          role="table"
          aria-label={translate({
            id: "homepage.beyond.aria",
            message: "Nudo versus TypeScript expression results",
          })}
        >
          <div className="beyond-row beyond-head" role="row">
            <span role="columnheader">
              <Translate id="homepage.beyond.colExpr">Expression</Translate>
            </span>
            <span role="columnheader">
              <Translate id="homepage.beyond.colTs">TypeScript</Translate>
            </span>
            <span role="columnheader">
              <Translate id="homepage.beyond.colNudo">Nudo observes</Translate>
            </span>
          </div>
          {beyondExamples.map((row) => (
            <div className="beyond-row" role="row" key={row.code}>
              <code role="cell">{row.code}</code>
              <span className="beyond-ts" role="cell">
                {row.ts}
              </span>
              <code className="beyond-nudo" role="cell">
                {row.nudo}
              </code>
            </div>
          ))}
        </div>
        <p className="beyond-foot">
          <Translate
            id="homepage.beyond.foot"
            values={{
              tpl: <code key="tpl">`SAVE-${"{code.toUpperCase()}"}`</code>,
              lit: <code key="lit">"SAVE-VIP"</code>,
              call: <code key="call">coupon("vip")</code>,
            }}
          >
            {
              "The template {tpl} is not plain string — when the call site is {call}, Nudo observes {lit}."
            }
          </Translate>
        </p>
      </div>
    </section>
  );
}

function TrialSection() {
  return (
    <section className="rw-section">
      <div className="container">
        <p className="section-eyebrow">
          <Translate id="homepage.trial.eyebrow">Real code, real results</Translate>
        </p>
        <h2 className="section-title">
          <Translate id="homepage.trial.title">Call sites become signatures</Translate>
        </h2>
        <p className="rw-lead">
          <Translate id="homepage.trial.lead">
            Observation check prints unconstrained params as any. Point Nudo at real usage — tests,
            call sites — and the interpreter synthesizes precise signatures from evidence. No
            type annotations. No library rewrite.
          </Translate>
        </p>

        <h3 className="rw-cards-title">
          <Translate id="homepage.trial.cardsTitle">What call-site discovery returns</Translate>
        </h3>
        <div className="rw-cards">
          {signatureCards.map((card) => (
            <div className="rw-card" key={card.fn}>
              <div className="rw-card-head">
                <code className="rw-card-fn">{card.fn}</code>
                <span className="rw-card-chip">
                  <Translate id={card.evidenceId}>{card.evidenceDefault}</Translate>
                </span>
              </div>
              <div className="rw-sig rw-sig-before">
                <span className="rw-sig-label">
                  <Translate id="homepage.trial.card.beforeLabel">before</Translate>
                </span>
                <code>
                  <Translate id={card.beforeId}>{card.beforeDefault}</Translate>
                </code>
              </div>
              <div className="rw-sig rw-sig-after">
                <span className="rw-sig-label">
                  <Translate id="homepage.trial.card.afterLabel">nudo</Translate>
                </span>
                <code>{card.after}</code>
              </div>
            </div>
          ))}
        </div>
        <div className="rw-footer">
          <p className="rw-source">
            <Translate id="homepage.trial.source">
              Measured on @hapi/hoek v9.3.0 and @discoveryjs/json-ext v0.5.7 — every signature
              produced by Nudo's abstract interpreter, zero type annotations in the libraries.
            </Translate>
          </p>
          <Link className="proof-link" to="/docs/guides/callsite-discovery">
            <Translate id="homepage.trial.detail">How call-site discovery works →</Translate>
          </Link>
        </div>
      </div>
    </section>
  );
}

function AgentSection() {
  return (
    <section className="agent-section" id="agents">
      <div className="container">
        <p className="section-eyebrow">
          <Translate id="homepage.agent.eyebrow">AI agents</Translate>
        </p>
        <h2 className="section-title">
          <Translate id="homepage.agent.title">
            Agents that gate contracts — not invent types
          </Translate>
        </h2>
        <p className="section-lead">
          <Translate id="homepage.agent.lead">
            Coding agents and editors read the same Abs face via LSP / MCP. They run `nudo check`,
            respect sidecar contracts, and parse stable diagnostic IDs — not a second type
            language.
          </Translate>
        </p>

        <div className="agent-grid">
          {agentCards.map((card) => (
            <article className="agent-card" key={card.titleId}>
              <h3>
                <Translate id={card.titleId}>{card.titleDefault}</Translate>
              </h3>
              <p>
                <Translate id={card.descId}>{card.descDefault}</Translate>
              </p>
              <code className="path-cmd">{card.cmd}</code>
            </article>
          ))}
        </div>

        <div className="agent-paste">
          <div className="agent-paste-head">
            <span className="term-panel-title">
              <Translate id="homepage.agent.pasteTitle">Paste into your coding agent</Translate>
            </span>
          </div>
          <pre className="agent-paste-pre">
            <code>{agentPaste}</code>
          </pre>
        </div>

        <div className="demo-actions">
          <Link className="button button--primary" to="/docs/reference/agents">
            <Translate id="homepage.agent.ctaDocs">Agent docs</Translate>
          </Link>
          <a
            className="button button--secondary"
            href="https://nudojs.github.io/nudo/agents.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Translate id="homepage.agent.ctaAgentsMd">agents.md</Translate>
          </a>
          <Link className="button button--secondary" to="/docs/guides/agent-integration">
            <Translate id="homepage.agent.ctaMcp">Agent integration</Translate>
          </Link>
        </div>
      </div>
    </section>
  );
}

function PersonaSection() {
  return (
    <section className="paths-section" id="paths">
      <div className="container">
        <p className="section-eyebrow">
          <Translate id="homepage.paths.eyebrow">Start by role</Translate>
        </p>
        <h2 className="section-title">
          <Translate id="homepage.paths.title">Pick your entry path</Translate>
        </h2>
        <p className="section-lead">
          <Translate id="homepage.paths.lead">
            The docs are organized by audience. Choose the path that matches your situation —
            every card lands on a runnable first step.
          </Translate>
        </p>
        <div className="path-grid">
          {pathCards.map((p) => (
            <Link key={p.to} className="path-card" to={p.to}>
              <span className="path-eyebrow">
                <Translate id={p.eyebrowId}>{p.eyebrowDefault}</Translate>
              </span>
              <h3>
                <Translate id={p.titleId}>{p.titleDefault}</Translate>
              </h3>
              <p>
                <Translate id={p.descId}>{p.descDefault}</Translate>
              </p>
              <span className="path-cta">
                <Translate id={p.ctaId}>{p.ctaDefault}</Translate>
                <span aria-hidden="true"> →</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function CtaSection() {
  return (
    <section className="cta-section">
      <div className="container cta-inner">
        <h2 className="cta-title">
          <Translate id="homepage.cta.title">Ready to come back to JS?</Translate>
        </h2>
        <p className="cta-sub">
          <Translate id="homepage.cta.sub">
            Observe intermediates in the browser, gate contracts on your own files with the CLI,
            or point a coding agent at the same Abs face. Your JS stays JS.
          </Translate>
        </p>
        <div className="cta-cli">
          <code>{heroCmd}</code>
        </div>
        <div className="hero-buttons">
          <Link className="button button--primary button--lg hero-btn-primary" to="/playground">
            <Translate id="homepage.hero.ctaPlayground">Open Playground</Translate>
          </Link>
          <Link
            className="button button--secondary button--lg hero-btn-secondary"
            to="/docs/getting-started/installation"
          >
            <Translate id="homepage.cta.install">Install</Translate>
          </Link>
          <Link
            className="button button--secondary button--lg hero-btn-secondary"
            to="/docs/reference/agents"
          >
            <Translate id="homepage.cta.agents">Agents</Translate>
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function Home(): JSX.Element {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title={translate({ id: "homepage.title", message: "Home" })}
      description={siteConfig.tagline}
    >
      <HeroSection />
      <main>
        <ProofStrip />
        <CostSection />
        <BeyondSection />
        <TrialSection />
        <DemoSection />
        <PersonaSection />
        <AgentSection />
        <CtaSection />
      </main>
    </Layout>
  );
}
