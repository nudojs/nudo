import clsx from "clsx";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import CodeBlock from "@theme/CodeBlock";
import Translate, { translate } from "@docusaurus/Translate";

const features = [
  {
    icon: "⚡",
    titleId: "homepage.feature.executeTitle",
    titleDefault: "Execute, Don't Analyze",
    descId: "homepage.feature.executeDesc",
    descDefault:
      "Nudo runs your JavaScript code with symbolic type values instead of concrete values. The execution itself produces types — no separate type language needed.",
  },
  {
    icon: "🎯",
    titleId: "homepage.feature.preciseTitle",
    titleDefault: "Precise Inference",
    descId: "homepage.feature.preciseDesc",
    descDefault:
      "Through abstract interpretation, Nudo tracks literal types, narrowing, and control flow with precision that matches how your code actually behaves at runtime.",
  },
  {
    icon: "📝",
    titleId: "homepage.feature.directivesTitle",
    titleDefault: "Directive-Driven",
    descId: "homepage.feature.directivesDesc",
    descDefault:
      "Use simple comment directives like @nudo:case and @nudo:mock to guide type inference. No new syntax to learn — just annotated JavaScript.",
  },
  {
    icon: "🔌",
    titleId: "homepage.feature.integrationsTitle",
    titleDefault: "IDE & Build Integration",
    descId: "homepage.feature.integrationsDesc",
    descDefault:
      "Full-featured VS Code extension with hover types, go-to-definition, find references, rename, signature help, and CodeLens. Vite plugin for build-time type checking. CLI for scripting and CI.",
  },
  {
    icon: "🤖",
    titleId: "homepage.feature.aiTitle",
    titleDefault: "AI Agent Integration",
    descId: "homepage.feature.aiDesc",
    descDefault:
      "The Nudo language server gives AI coding agents direct access to type inference — what-if analysis, type tracing, and diagnostics over LSP or any LSP→MCP bridge, giving AI the type context it needs to write correct JavaScript.",
  },
  {
    icon: "🔧",
    titleId: "homepage.feature.runtimeTitle",
    titleDefault: "Runtime Type Generation",
    descId: "homepage.feature.runtimeDesc",
    descDefault:
      "Bridge static inference and runtime validation. Generate Zod schemas, native type guards, and TypeScript declarations from inferred types — one command, zero hand-written validators.",
  },
];

const nudoExample = `// @nudo:case "strings" (T.string)
// @nudo:case "numbers" (T.number)
function transform(x) {
  if (typeof x === "string") return x.toUpperCase();
  if (typeof x === "number") return x + 1;
  return null;
}`;

const tsExample = `function transform(x: string): string;
function transform(x: number): number;
function transform(x: unknown): null;
function transform(x: unknown) {
  if (typeof x === "string") return x.toUpperCase();
  if (typeof x === "number") return x + 1;
  return null;
}`;

const trialWaves = [
  { name: "Baseline", pct: 54.8, fix: "Directive-only" },
  { name: "Wave 1", pct: 71.7, fix: "Call-site discovery" },
  { name: "Wave 2", pct: 80, fix: "Export match chain" },
  { name: "Wave 3", pct: 85.8, fix: "Builtin prototypes" },
  { name: "Wave 4", pct: 89.4, fix: "Dynamic key access" },
  { name: "Wave 5", pct: 90.8, fix: "Promise & iterable" },
  { name: "Wave 6", pct: 98.6, fix: "Closure & collector" },
];

const trialStats = [
  { value: "54.8% → 98.6%", label: "precise signatures" },
  { value: "291 → 0", label: "type errors" },
  { value: "6", label: "engine hardening waves" },
];

const signatureCards = [
  {
    fn: "formatName",
    capability: "Call-site discovery",
    origin: "call collected from test.js:12",
    before: "(unknown, unknown) => unknown",
    after: '("Ada", "Lovelace") => "Ada Lovelace"',
  },
  {
    fn: "deepEqual",
    capability: "Literal object arguments",
    origin: "@hapi/hoek — nested equality walk",
    before: "(unknown, unknown) => unknown",
    after: "({a: 1, b: {c: 2}}, {a: 1, b: {c: 2}}) => boolean",
  },
  {
    fn: "flatten",
    capability: "Recursion & iteration",
    origin: "recursive call + for-of tracking",
    before: "(unknown) => unknown",
    after: "([1, [2, [3, 4]]]) => [1, 2, 3, 4]",
  },
];

function HeroSection() {
  return (
    <header className="hero-section">
      <div className="container">
        <h1 className="hero-title">Nudo</h1>
        <p className="hero-subtitle">
          <Translate id="homepage.hero.subtitle">
            A type inference engine for JavaScript that executes your code with
            symbolic type values to derive precise types — no type gymnastics
            required.
          </Translate>
        </p>
        <div className="hero-buttons">
          <Link className="button button--primary button--lg" to="/docs/intro">
            <Translate id="homepage.hero.getStarted">Get Started</Translate>
          </Link>
          <Link
            className="button button--outline button--lg"
            to="/docs/concepts/type-values"
          >
            <Translate id="homepage.hero.learnMore">Learn More</Translate>
          </Link>
        </div>
      </div>
    </header>
  );
}

function FeaturesSection() {
  return (
    <section className="features-section">
      <div className="features-grid">
        {features.map((feature, idx) => (
          <div key={idx} className="feature-card">
            <div className="feature-icon">{feature.icon}</div>
            <h3>
              <Translate id={feature.titleId}>{feature.titleDefault}</Translate>
            </h3>
            <p>
              <Translate id={feature.descId}>{feature.descDefault}</Translate>
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ComparisonSection() {
  return (
    <section className="comparison-section">
      <div className="container">
        <h2>
          <Translate id="homepage.comparison.title">
            Write JavaScript. Get Types.
          </Translate>
        </h2>
        <div className="comparison-grid">
          <div className="comparison-panel">
            <h3>
              <Translate id="homepage.comparison.nudo">
                With Nudo — plain JavaScript
              </Translate>
            </h3>
            <CodeBlock language="javascript">{nudoExample}</CodeBlock>
          </div>
          <div className="comparison-panel">
            <h3>
              <Translate id="homepage.comparison.typescript">
                With TypeScript — overloads needed
              </Translate>
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
        <h2>
          <Translate id="homepage.trial.title">Real-World Trial</Translate>
        </h2>
        <p className="rw-lead">
          <Translate id="homepage.trial.lead">
            We ran Nudo against real, unannotated libraries and hardened the
            engine wave by wave until inferred signatures matched runtime
            behavior.
          </Translate>
        </p>
        <div className="rw-stats">
          {trialStats.map((stat) => (
            <div className="rw-stat" key={stat.label}>
              <span className="rw-stat-value">{stat.value}</span>
              <span className="rw-stat-label">{stat.label}</span>
            </div>
          ))}
        </div>
        <div
          className="rw-ladder"
          role="img"
          aria-label="Precise signature coverage on @hapi/hoek climbing from 54.8 percent to 98.6 percent across six waves of engine fixes"
        >
          {trialWaves.map((wave) => {
            const isFinal = wave.name === "Wave 6";
            return (
              <div className="rw-bar" key={wave.name}>
                <div className="rw-bar-track">
                  <div
                    className={
                      isFinal
                        ? "rw-bar-fill rw-bar-fill-final"
                        : wave.name === "Baseline"
                          ? "rw-bar-fill rw-bar-fill-baseline"
                          : "rw-bar-fill"
                    }
                    style={{ height: `${wave.pct}%` }}
                  />
                  <span
                    className={isFinal ? "rw-bar-value rw-bar-value-final" : "rw-bar-value"}
                    style={{ bottom: `calc(${wave.pct}% + 0.4rem)` }}
                  >
                    {wave.pct}%
                  </span>
                </div>
                <span className="rw-bar-name">{wave.name}</span>
                <span className="rw-bar-fix">{wave.fix}</span>
              </div>
            );
          })}
        </div>
        <p className="rw-caption">
          <Translate id="homepage.trial.ladderCaption">
            Precise-signature coverage on @hapi/hoek — each wave ships one
            engine capability, no library annotations added.
          </Translate>
        </p>
        <h3 className="rw-cards-title">
          <Translate id="homepage.trial.cardsTitle">
            From unknown to exact
          </Translate>
        </h3>
        <div className="rw-cards">
          {signatureCards.map((card) => (
            <div className="rw-card" key={card.fn}>
              <div className="rw-card-head">
                <code className="rw-card-fn">{card.fn}</code>
                <span className="rw-card-chip">{card.capability}</span>
              </div>
              <div className="rw-sig rw-sig-before">
                <span className="rw-sig-label">before</span>
                <code>{card.before}</code>
              </div>
              <div className="rw-sig rw-sig-after">
                <span className="rw-sig-label">after</span>
                <code>{card.after}</code>
              </div>
              <div className="rw-card-origin">{card.origin}</div>
            </div>
          ))}
        </div>
        <p className="rw-source">
          <Translate id="homepage.trial.source">
            Measured on real-library trials: @hapi/hoek v9.3.0 and
            @discoveryjs/json-ext v0.5.7 — every signature produced by
            Nudo&rsquo;s abstract interpreter, zero type annotations.
          </Translate>
        </p>
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
        <FeaturesSection />
        <ComparisonSection />
        <TrialSection />
      </main>
    </Layout>
  );
}
