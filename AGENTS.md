# Working on naf/flow

NAF Flow binds native JavaScript class instances or object factories to server-rendered
HTML. It is an optional Composer `naf-plugin`, not a standalone application. Use NAF's
existing routing, PSR-7 responses and `Naf\View\asset()`; keep domain rules in the host.

Read the [shared workflow](https://github.com/nafphp/docs/blob/main/AGENT_WORKFLOW.md),
[release procedure](https://github.com/nafphp/docs/blob/main/RELEASING.md) and
[code style](https://github.com/nafphp/docs/blob/main/CODE_STYLE.md). In the workspace,
these are available in sibling `docs/`. Package code uses an RC branch and is merged by
the maintainer.

## Boundaries

- `naf/view` is required; `extra.naf.boot.after` ensures its Asset service is ready.
- `bootstrap.php` registers one self-starting ES module through `asset()`.
- `src/routes.php` serves the committed `flow.min.js` at the fixed `/_flow/flow.js` URL.
  Asset tags and application imports use this same URL to share one module instance.
  Never expose arbitrary vendor paths.
- `src/functions.php` selects an explicitly named full-page or fragment template.
- `src/Resources/public/flow.js` is the public API and autostart entry point. Implementation
  lives in `src/Resources/public/runtime/`: components/lifecycle, bindings, reactivity,
  updates, stores, client/HTTP, DOM reconciliation, fragment parsing, properties and errors.
  No `eval`, `new Function`, inline expression parser or execution of scripts from fragments.
- Keep modules focused and imports acyclic. `components.js` owns component registration
  and disposal; the client and DOM code receive small callbacks for fragment application
  and lifecycle work. Do not create a shared bag of mutable runtime state.
- Keep this source readable with explicit control blocks and the package's Prettier rules.
  Generate `flow.min.js` with `npm run build` after source changes and commit it alongside
  the source modules. Do not edit the generated file. The single esbuild command bundles
  all internal imports into one ESM file, preserving the public exports, function/class
  names and license. Applications need no frontend build or access to internal source files.
- Keep native class receivers intact, including methods accessing private `#fields`.
  Public fields are declared before mounting. Lifecycle hooks and prototype traversal
  are not markup actions. Nested components own their own bindings and references.
- HTTP writes keep NAF's existing authentication, validation and CSRF. The browser
  client never retries writes. Superseded loads and disposed instances cannot update DOM.

## Documentation is part of every change

Always review and update the affected user documentation alongside code, configuration,
API or behavior changes and every release. The authoritative Flow guide is
[`docs/pages/flow.md`](https://github.com/nafphp/docs/blob/main/pages/flow.md); also update
affected plugin/view guides, examples, navigation and generated references. Keep the
documented installation, component factories, lifecycle, bindings, stores, client,
fragments, assets and CSP behavior aligned with the implementation.

Follow the [shared documentation workflow](https://github.com/nafphp/docs/blob/main/AGENT_WORKFLOW.md#documentation-is-part-of-every-change)
for checks, publication and deployment verification. A README or draft does not replace
the regular documentation for released behavior. If no documentation change is needed,
explain why in the handover.

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
