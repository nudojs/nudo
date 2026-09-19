import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import CodeBlock from "@theme/CodeBlock";
import Translate, { translate } from "@docusaurus/Translate";

const features = [
  {
    icon: "exec",
    titleId: "homepage.feature.executeTitle",
    titleDefault: "Execute, don't declare",
    descId: "homepage.feature.executeDesc",
    descDefault:
      "Nudo runs your JavaScript with abstract values. Execution itself produces facts about parameters, returns, and every intermediate step.",
  },
  {
    icon: "observe",
    titleId: "homepage.feature.observeTitle",
    titleDefault: "Observe intermediate values",
    descId: "homepage.feature.observeDesc",
    descDefault:
      "See the algebra behind a result — terms like (x + 1), derived predicates like (x + 1) > 1, and confidence (exact / path / partial).",
  },
  {
    icon: "contract",
    titleId: "homepage.feature.contractsTitle",
    titleDefault: "Contracts stricter than types",
    descId: "homepage.feature.contractsDesc",
    descDefault:
      "Sidecar *.nudo.js and @nudo:refine / @nudo:interface gate parameters and returns. No contract? Stay honest with any / unknown — no invented fields.",
  },
  {
    icon: "tools",
    titleId: "homepage.feature.integrationsTitle",
    titleDefault: "IDE inlays, CLI checks, AI context",
    descId: "homepage.feature.integrationsDesc",
    descDefault:
      "Hover and inlay hints on intermediate values, nudo check in CI, LSP/MCP so agents see what the code actually computes.",
  },
];

const proofSource = `// calc.js — plain JavaScript
export function scale(x) {
  return x + 1;
}

export function formatName(first, last) {
  return first + " " + last;
}

formatName("Ada", "Lovelace");
scale(5);`;

const proofContract = `// calc.nudo.js — explicit contract (sidecar)
import { number, fn } from "@nudojs/core";

export const scale = fn({ x: number().gt(0) }, number());`;

const proofTest = `=== formatName ===
  call@L11  ("Ada", "Lovelace") => "Ada Lovelace"

=== scale ===
  call@L12  (5) => 6  #exact`;

const proofObserve = `scale(5)
  result : 6  #exact
  term   : (x + 1)         where x = 5
  pred   : (x + 1) > 1     #path
  conf   : exact → path after generalization

formatName("Ada", "Lovelace")
  result : "Ada Lovelace"  #exact
  term   : lit("Ada Lovelace")`;

const proofCheck = `npx nudojs check calc.js

scale(0)  →  actual: 1  #exact
            expected: x > 0
            nudo:constraint-violated   actual ⊭ expected`;

const proofIde = `// VS Code / LSP — inlay on intermediate values
export function scale(x) {
  return x + 1;
  //     ^^^^^ term (x + 1)
  //           pred (x + 1) > 1   #path
}

scale(5);  // => 6  #exact
scale(0);  // ⊭ x > 0  (sidecar: number().gt(0))`;

const beyondExamples = [
  { code: `"0x" + id`, ts: "string", nudo: "`0x${string}`" },
  { code: `"hello".slice(1, 3)`, ts: "string", nudo: '"el"' },
  { code: `"a,b,c".split(",")`, ts: "string[]", nudo: '["a", "b", "c"]' },
  { code: `for (let i = 0; i < 5; i++) sum += i`, ts: "number", nudo: "10" },
];

const nudoExample = `// Plain JS + sidecar obligation
// calc.js
export function scale(x) {
  return x + 1;
}

// calc.nudo.js
import { number, fn } from "@nudojs/core";
export const scale = fn({ x: number().gt(0) }, number());

// Call sites carry facts; check enforces the contract
scale(5);   // => 6  #exact
scale(0);   // ⊭ x > 0`;

const tsExample = `// TypeScript — annotate the language surface
interface ScaleInput { x: number }

export function scale(x: number): number {
  return x + 1;
}

// x > 0 is not expressible as a plain number type;
// you need branded types / custom guards / runtime checks.`;

const trialSteps = [
  {
    titleId: "homepage.trial.step1.title",
    titleDefault: "Keep your JS",
    descId: "homepage.trial.step1.desc",
    descDefault: "No rewrite. No TypeScript migration. Your code stays as-is.",
  },
  {
    titleId: "homepage.trial.step2.title",
    titleDefault: "Point at real usage",
    descId: "homepage.trial.step2.desc",
    descDefault: "Analyze the library together with its tests and call sites.",
  },
  {
    titleId: "homepage.trial.step3.title",
    titleDefault: "Get signatures you can trust",
    descId: "homepage.trial.step3.desc",
    descDefault:
      "Observed facts from actual calls. Add a sidecar contract only when you want a check gate.",
  },
];

const trialStats = [
  {
    value: "98.6%",
    labelId: "homepage.trial.stat1",
    labelDefault: "precise signatures on @hapi/hoek",
  },
  {
    value: "0",
    labelId: "homepage.trial.stat2",
    labelDefault: "type annotations you write",
  },
  {
    value: "291 → 0",
    labelId: "homepage.trial.stat3",
    labelDefault: "contract check failures cleared",
  },
];

const signatureCards = [
  {
    fn: "formatName",
    evidence: "from test.js call site",
    before: "no evidence → unknown params",
    after: '("Ada", "Lovelace") => "Ada Lovelace"',
  },
  {
    fn: "deepEqual",
    evidence: "from @hapi/hoek usage",
    before: "no evidence → unknown params",
    after: "({a:1,b:{c:2}}, {a:1,b:{c:2}}) => boolean",
  },
  {
    fn: "flatten",
    evidence: "from recursive + loop usage",
    before: "no evidence → unknown",
    after: "([1,[2,[3,4]]]) => [1,2,3,4]",
  },
];

function FeatureIcon({ name }: { name: string }) {
  const stroke = "currentColor";
  if (name === "exec") {
    return (
      <svg className="feature-svg" viewBox="0 0 40 40" aria-hidden="true">
        <rect x="4" y="8" width="32" height="24" rx="4" fill="none" stroke={stroke} strokeWidth="1.5" />
        <path d="M12 20h8M20 16l6 4-6 4" fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === "observe") {
    return (
      <svg className="feature-svg" viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="12" fill="none" stroke={stroke} strokeWidth="1.5" />
        <circle cx="20" cy="20" r="3" fill={stroke} />
        <path d="M20 8v4M20 28v4M8 20h4M28 20h4" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "contract") {
    return (
      <svg className="feature-svg" viewBox="0 0 40 40" aria-hidden="true">
        <path d="M12 8h16v24H12z" fill="none" stroke={stroke} strokeWidth="1.5" />
        <path d="M16 16h8M16 21h8M16 26h5" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M25 26l2 2 4-4" fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg className="feature-svg" viewBox="0 0 40 40" aria-hidden="true">
      <rect x="6" y="10" width="12" height="20" rx="2" fill="none" stroke={stroke} strokeWidth="1.5" />
      <rect x="22" y="10" width="12" height="12" rx="2" fill="none" stroke={stroke} strokeWidth="1.5" />
      <path d="M22 28h12M25 24v8" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function HeroSection() {
  return (
    <header className="hero-section">
      <div className="hero-grid" aria-hidden="true" />
      <div className="container hero-inner">
        <p className="hero-kicker">Nudo · observable execution for JavaScript</p>
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
        </div>

        <div className="hero-story" role="img" aria-label="JavaScript function, sidecar contract, and Nudo observations">
          <div className="hero-story-col">
            <div className="hero-story-label">
              <span>JS</span>
              <Translate id="homepage.hero.storyJs">function</Translate>
            </div>
            <pre className="hero-story-code">
              <code>{`export function scale(x) {\n  return x + 1;\n}`}</code>
            </pre>
          </div>
          <div className="hero-story-col">
            <div className="hero-story-label">
              <span>sidecar</span>
              <Translate id="homepage.hero.storyContract">contract</Translate>
            </div>
            <pre className="hero-story-code">
              <code>{`// scale.nudo.js\nfn({ x: number().gt(0) },\n   number())`}</code>
            </pre>
          </div>
          <div className="hero-story-col hero-story-observe">
            <div className="hero-story-label">
              <span>nudo</span>
              <Translate id="homepage.hero.storyObserve">observe + check</Translate>
            </div>
            <pre className="hero-story-code">
              <code>
                {`scale(5) => 6  #exact\nterm (x + 1)  pred (x + 1) > 1\nscale(0) ⊭ x > 0`}
              </code>
            </pre>
          </div>
        </div>
      </div>
    </header>
  );
}

function ProofSection() {
  return (
    <section className="proof-section">
      <div className="container">
        <p className="section-eyebrow">
          <Translate id="homepage.proof.eyebrow">From source to gate</Translate>
        </p>
        <h2 className="section-title">
          <Translate id="homepage.proof.title">Watch a value move through the engine</Translate>
        </h2>
        <p className="section-lead">
          <Translate id="homepage.proof.lead">
            One module, four surfaces: the JS, the sidecar contract, `nudo test` call-site
            cases, and what `nudo check` / the IDE show.
          </Translate>
        </p>

        <div className="proof-grid proof-grid-2">
          <div className="proof-panel">
            <div className="proof-panel-head">
              <span>calc.js</span>
              <span className="proof-tag">JS</span>
            </div>
            <CodeBlock language="javascript">{proofSource}</CodeBlock>
          </div>
          <div className="proof-panel">
            <div className="proof-panel-head">
              <span>calc.nudo.js</span>
              <span className="proof-tag proof-tag-contract">contract</span>
            </div>
            <CodeBlock language="javascript">{proofContract}</CodeBlock>
          </div>
        </div>

        <div className="proof-grid proof-grid-2">
          <div className="proof-panel">
            <div className="proof-panel-head">
              <span>npx nudojs test</span>
              <span className="proof-tag proof-tag-out">call sites</span>
            </div>
            <CodeBlock language="text">{proofTest}</CodeBlock>
          </div>
          <div className="proof-panel">
            <div className="proof-panel-head">
              <span>npx nudojs check --abs</span>
              <span className="proof-tag proof-tag-out">Abs</span>
            </div>
            <CodeBlock language="text">{proofObserve}</CodeBlock>
          </div>
        </div>

        <div className="proof-grid proof-grid-2">
          <div className="proof-panel">
            <div className="proof-panel-head">
              <span>npx nudojs check</span>
              <span className="proof-tag proof-tag-check">gate</span>
            </div>
            <CodeBlock language="text">{proofCheck}</CodeBlock>
          </div>
          <div className="proof-panel proof-panel-ide">
            <div className="proof-panel-head">
              <span>IDE inlay</span>
              <span className="proof-tag">LSP</span>
            </div>
            <CodeBlock language="javascript">{proofIde}</CodeBlock>
          </div>
        </div>

        <div className="proof-actions">
          <code className="proof-cli">npx nudojs check calc.js</code>
          <Link className="proof-link" to="/docs/getting-started/quick-start">
            <Translate id="homepage.proof.quickStart">Full quick start →</Translate>
          </Link>
          <Link className="proof-link" to="/playground">
            <Translate id="homepage.proof.playground">Try in Playground →</Translate>
          </Link>
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  return (
    <section className="features-section">
      <div className="container">
        <p className="section-eyebrow">
          <Translate id="homepage.features.eyebrow">Why Nudo</Translate>
        </p>
        <h2 className="section-title">
          <Translate id="homepage.features.title">
            No rewrite of your JS. Faithful observations, and contracts sharper than types.
          </Translate>
        </h2>
        <div className="features-grid">
          {features.map((feature) => (
            <div key={feature.titleId} className="feature-card">
              <div className="feature-icon">
                <FeatureIcon name={feature.icon} />
              </div>
              <h3>
                <Translate id={feature.titleId}>{feature.titleDefault}</Translate>
              </h3>
              <p>
                <Translate id={feature.descId}>{feature.descDefault}</Translate>
              </p>
            </div>
          ))}
        </div>
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
            Because Nudo evaluates on Abs, results track actual computation — literal strings,
            splits, loop sums — not a declared upper bound.
          </Translate>
        </p>
        <div className="beyond-table" role="table" aria-label="Nudo versus TypeScript expression results">
          <div className="beyond-row beyond-head" role="row">
            <span role="columnheader">Expression</span>
            <span role="columnheader">TypeScript</span>
            <span role="columnheader">Nudo observes</span>
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
      </div>
    </section>
  );
}

function ComparisonSection() {
  return (
    <section className="comparison-section">
      <div className="container">
        <p className="section-eyebrow">
          <Translate id="homepage.comparison.eyebrow">Side by side</Translate>
        </p>
        <h2 className="section-title">
          <Translate id="homepage.comparison.title">JS stays JS. Obligations stay explicit.</Translate>
        </h2>
        <div className="comparison-grid">
          <div className="comparison-panel comparison-panel-nudo">
            <h3>
              <Translate id="homepage.comparison.nudo">Nudo — JS + sidecar contract</Translate>
            </h3>
            <CodeBlock language="javascript">{nudoExample}</CodeBlock>
          </div>
          <div className="comparison-panel comparison-panel-ts">
            <h3>
              <Translate id="homepage.comparison.typescript">TypeScript — language surface only</Translate>
            </h3>
            <CodeBlock language="typescript">{tsExample}</CodeBlock>
          </div>
        </div>
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
          <Translate id="homepage.trial.title">Precise signatures without annotating anything</Translate>
        </h2>
        <p className="rw-lead">
          <Translate id="homepage.trial.lead">
            Point Nudo at real JavaScript and how it is used. It observes what the code actually
            computes — no type annotations, no rewriting the library.
          </Translate>
        </p>

        <div className="rw-steps">
          {trialSteps.map((step, index) => (
            <div className="rw-step" key={step.titleId}>
              <span className="rw-step-num" aria-hidden="true">
                {index + 1}
              </span>
              <div className="rw-step-body">
                <h3 className="rw-step-title">
                  <Translate id={step.titleId}>{step.titleDefault}</Translate>
                </h3>
                <p className="rw-step-desc">
                  <Translate id={step.descId}>{step.descDefault}</Translate>
                </p>
                {index === 1 && (
                  <code className="rw-step-cli">npx nudojs test lib/ --from test/</code>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="rw-stats">
          {trialStats.map((stat) => (
            <div className="rw-stat" key={stat.labelId}>
              <span className="rw-stat-value">{stat.value}</span>
              <span className="rw-stat-label">
                <Translate id={stat.labelId}>{stat.labelDefault}</Translate>
              </span>
            </div>
          ))}
        </div>

        <h3 className="rw-cards-title">
          <Translate id="homepage.trial.cardsTitle">What you get back</Translate>
        </h3>
        <div className="rw-cards">
          {signatureCards.map((card) => (
            <div className="rw-card" key={card.fn}>
              <div className="rw-card-head">
                <code className="rw-card-fn">{card.fn}</code>
                <span className="rw-card-chip">{card.evidence}</span>
              </div>
              <div className="rw-sig rw-sig-before">
                <span className="rw-sig-label">before</span>
                <code>{card.before}</code>
              </div>
              <div className="rw-sig rw-sig-after">
                <span className="rw-sig-label">nudo</span>
                <code>{card.after}</code>
              </div>
            </div>
          ))}
        </div>
        <div className="rw-footer">
          <p className="rw-source">
            <Translate id="homepage.trial.source">
              Measured on @hapi/hoek v9.3.0 and @discoveryjs/json-ext v0.5.7 — every signature
              produced by Nudo&apos;s abstract interpreter, zero type annotations in the libraries.
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

function CtaSection() {
  return (
    <section className="cta-section">
      <div className="container cta-inner">
        <h2 className="cta-title">
          <Translate id="homepage.cta.title">Ready to come back to JS?</Translate>
        </h2>
        <p className="cta-sub">
          <Translate id="homepage.cta.sub">
            Your JS stays JS — observe intermediates in the browser, or enforce sharper contracts
            on your own files with the CLI.
          </Translate>
        </p>
        <div className="cta-cli">
          <code>npx nudojs check ./src/app.js</code>
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
        <ProofSection />
        <FeaturesSection />
        <BeyondSection />
        <ComparisonSection />
        <TrialSection />
        <CtaSection />
      </main>
    </Layout>
  );
}
