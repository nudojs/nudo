import React, { lazy, Suspense } from 'react';
import type { JSX } from 'react';
import Layout from '@theme/Layout';
import BrowserOnly from '@docusaurus/BrowserOnly';
import Translate, { translate } from '@docusaurus/Translate';

/**
 * Route shell only. The engine + UI body is an async chunk so the docs bundle
 * never pulls Babel / @nudojs/* into first paint; Monaco stays lazy inside.
 */
const PlaygroundApp = lazy(() => import('../playground/PlaygroundApp'));

/**
 * Client-only shell: Monaco + analyzer must not SSR-hydrate (React #426).
 */
export default function Playground(): JSX.Element {
  return (
    <Layout
      title="Playground"
      description={translate({
        id: "playground.metaDescription",
        message: "Nudo Playground — execute JavaScript and observe intermediates",
      })}
    >
      <BrowserOnly
        fallback={
          <div className="playground-container">
            <div className="playground-header">
              <h1>Nudo Playground</h1>
              <p><Translate id="playground.loading">Loading playground…</Translate></p>
            </div>
          </div>
        }
      >
        {() => (
          <Suspense
            fallback={
              <div className="playground-container">
                <div className="playground-header">
                  <h1>Nudo Playground</h1>
                  <p><Translate id="playground.loading">Loading playground…</Translate></p>
                </div>
              </div>
            }
          >
            <PlaygroundApp />
          </Suspense>
        )}
      </BrowserOnly>
    </Layout>
  );
}
