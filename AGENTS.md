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
- `src/routes.php` serves only the fixed runtime file. Never expose arbitrary vendor paths.
- `src/functions.php` selects an explicitly named full-page or fragment template.
- `src/Resources/public/flow.js` contains the browser runtime. No `eval`, `new Function`,
  inline expression parser or execution of scripts from fragments.
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
npx playwright install chromium
npm test
```

PHPUnit checks the PHP integration. Playwright tests use an actual NAF host under a strict
CSP and cover component lifecycle, reactivity, stores, fragments and HTTP errors. Node is
development tooling only; applications consume the shipped ES module without a build step.
Follow the supported runtimes in `composer.json`, `package.json` and CI.
