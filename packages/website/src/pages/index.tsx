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
      "First-class VS Code extension with hover types, completions, and CodeLens. Vite plugin for build-time type checking. CLI for scripting and CI.",
  },
  {
    icon: "🧩",
    titleId: "homepage.feature.jsTitle",
    titleDefault: "Pure JavaScript",
    descId: "homepage.feature.jsDesc",
    descDefault:
      "Works with plain .js files. No TypeScript compilation step required. Infer types for any JavaScript code, including third-party libraries without type definitions.",
  },
  {
    icon: "🔬",
    titleId: "homepage.feature.soundTitle",
    titleDefault: "Theoretically Sound",
    descId: "homepage.feature.soundDesc",
    descDefault:
      "Built on abstract interpretation — a well-established technique from programming language theory — presented in a developer-friendly \"just run the code\" mental model.",
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
      </main>
    </Layout>
  );
}
