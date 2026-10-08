# Working on naf/flow

NAF Flow binds native JavaScript class instances or object factories to server-rendered
HTML. It is an optional Composer `naf-plugin`, not a standalone application. Use NAF's
existing routing, PSR-7 responses and `Naf\View\asset()`; keep domain rules in the host.

Read the [shared workflow](https://github.com/nafphp/docs/blob/main/AGENT_WORKFLOW.md),
[release procedure](https://github.com/nafphp/docs/blob/main/RELEASING.md) and
[code style](https://github.com/nafphp/docs/blob/main/CODE_STYLE.md). In the workspace,
these are available in sibling `docs/`. Package code uses an RC branch and is merged by
the maintainer. Review documentation with every behavior change.

## Boundaries

- `naf/view` is required; `extra.naf.boot.after` ensures its Asset service is ready.
- `bootstrap.php` registers one self-starting ES module through `asset()`.
- `src/routes.php` serves the committed `flow.min.js` at the fixed `/_flow/flow.js` URL.
  Asset tags and application imports use this same URL to share one module instance.
  Never expose arbitrary vendor paths.
- `src/functions.php` selects an explicitly named full-page or fragment template.
- `src/Resources/public/flow.js` contains the browser runtime. No `eval`, `new Function`,
  inline expression parser or execution of scripts from fragments.
- Keep this source readable with explicit control blocks and the package's Prettier rules.
  Generate `flow.min.js` with `npm run build` after source changes and commit it alongside
  the source. Do not edit the generated file. The single esbuild command preserves ESM
  exports, function/class names and the license; applications need no frontend build.
- Keep native class receivers intact, including methods accessing private `#fields`.
  Public fields are declared before mounting. Lifecycle hooks and prototype traversal
  are not markup actions. Nested components own their own bindings and references.
- HTTP writes keep NAF's existing authentication, validation and CSRF. The browser
  client never retries writes. Superseded loads and disposed instances cannot update DOM.

## Verify

```sh
composer install
composer test
composer style:check
composer validate --strict
npm ci
npm run style:check
npm run build
npx playwright install chromium
npm run check
npm test
```

PHPUnit checks the PHP integration. Playwright tests use an actual NAF host under a strict
CSP and cover component lifecycle, reactivity, stores, fragments and HTTP errors. Node is
development tooling only; applications consume the shipped minified ES module without a build
step. CI rebuilds it and rejects a diff from the committed artifact. Use `npm run style:fix`
to apply the JavaScript formatting rules.
Follow the supported runtimes in `composer.json`, `package.json` and CI.
