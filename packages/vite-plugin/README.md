# vite-plugin-nudo

Vite plugin for build-time JavaScript type inference with [Nudo](https://github.com/nudojs/nudo).

## What is Nudo?

Nudo is a type inference engine for JavaScript. Instead of a separate type system, it runs your code with symbolic type values via abstract interpretation — no TypeScript, no build step.

## This package

`vite-plugin-nudo` runs Nudo analysis during your Vite build, reporting type diagnostics as build warnings or errors.

## Install

```bash
npm install -D vite-plugin-nudo
```

## Usage

```js
// vite.config.js
import nudo from 'vite-plugin-nudo'

export default {
  plugins: [
    nudo({
      include: '**/*.js',       // default
      exclude: '**/node_modules/**', // default
      failOnError: false,       // default
    }),
  ],
}
```

## License

[MIT](https://github.com/nudojs/nudo/blob/main/LICENSE)
