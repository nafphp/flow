# NAF Flow

Native JavaScript components for server-rendered NAF views. Bind an ordinary class or
object to a container, change its public fields and update the page. Load HTML fragments
or JSON through the host's normal routes. The plugin registers and starts its runtime
automatically through `naf/view`.

**Development version:** the first implementation lives on `v0.1.0-rc`. No stable release
has been published. The API can change during review. In an existing NAF application:

```bash
composer config repositories.naf-flow vcs https://github.com/nafphp/flow
composer require naf/flow:dev-v0.1.0-rc
```

Requires PHP 8.3+, `naf/framework` 0.2.7+ and `naf/view` 0.2+. Composer installs these
dependencies and NAF discovers the plugin. No Node installation or frontend build is
needed in the consuming application. Only the host's `public/` directory is a web root.

## A counter

Create `public/js/components/Counter.js`:

```javascript
export default class Counter {
    count = 0;

    constructor(props) {
        this.count = props.initial ?? 0;
    }

    get doubled() {
        return this.count * 2;
    }

    increment() {
        this.count++;
    }
}
```

Create `public/js/app.js`:

```javascript
import { Flow } from '/_flow/flow.js';
import Counter from './components/Counter.js';

Flow.register('counter', props => new Counter(props));
```

Register the application module in the host's PHP layout, before rendering its scripts:

```php
use function Naf\View\asset;

asset()->add('/js/app.js', 'module');
```

The layout renders its collected scripts once, through the existing View hook:

```php
<?= asset()->render('js') ?>
```

Put the component in a PHP template:

```html
<section flow="counter" flow-props='{"initial":2}'>
    <button type="button" flow-on:click="increment">More</button>
    <output flow-text="count">2</output>
    <output flow-text="doubled">4</output>
</section>
```

There is no manual start call. Flow waits for the document, mounts registered types and
also picks up later registrations and added containers. Repeated `Flow.start()` calls
are harmless when an integration needs an explicit scan.

For server-generated props, escape the complete JSON string as a quoted HTML attribute:

```php
use function Naf\View\s;
?>
<section flow="counter" flow-props="<?= s(json_encode(['initial' => 2], JSON_THROW_ON_ERROR)) ?>">
    <output flow-text="count"></output>
</section>
```

## Objects and direct mounting

The registry always accepts a synchronous factory, returning one new object per container.
Classes need no base class. An anonymous factory exported from an ES module works too:

```javascript
export default props => ({
    count: props.initial ?? 0,
    increment() { this.count++; },
});
```

Use normal methods when referring to the instance through `this`. Arrow functions keep
JavaScript's native lexical `this` behavior. For explicit ownership of an existing object:

```javascript
const counter = new Counter({ initial: 0 });
const dispose = Flow.mount(document.querySelector('#manual-counter'), counter);
counter.count++;
// Dispose before removing a container yourself. Repeated disposal is harmless.
dispose();
```

One instance belongs to one container. Use a store for intentionally shared state.
For direct mounting, give the container an ID and omit its `flow` registration attribute.
Mounting the same instance on the same container returns the existing disposer. Dispose
an existing binding before mounting a different instance there.

## Reactivity

Declare public state fields before mounting. Flow observes writable data fields in place,
preserving the original receiver of class methods, including access to private `#fields`.
Nested plain objects and arrays are observed through proxies. Mutate them through the
component or store field, rather than an earlier reference to their raw input object.

Synchronous writes are batched into a microtask. Flow updates that container's bindings,
reevaluates its getters and then invokes `update()`. Getters should be free of side effects.
Private fields, `Date`, `Map`, `Set`, custom nested class instances and newly added top-level
fields do not become reactive automatically. Assign a new public value when appropriate;
register a nested class as a store when it needs its own observable fields.

The initial implementation evaluates all bindings in an affected container; it does not
cache getters or maintain a dependency graph per DOM binding. There is no virtual DOM or JSX.

## Markup bindings

Values are property paths, action names or JSON data. HTML contains no executable expressions.

| Attribute | Meaning |
| --- | --- |
| `flow="counter"` | Component registered under this name |
| `flow-props='{"initial":2}'` | Deeply frozen, public JSON props |
| `flow-text="cart.total"` | Text from a field or getter, using text content |
| `flow-model="query"` | Two-way input binding |
| `flow-show="open"` | Visibility through native `hidden` |
| `flow-on:click="save"` | Declared action, receiving `(event, context)` |
| `flow-class:active="selected"` | Toggle one class |
| `flow-bind:disabled="pending"` | Bind an allowed DOM property |
| `flow-bind:aria-expanded="open"` | Bind an ARIA attribute |
| `flow-ref="results"` | Local named element for a client or widget |
| `flow-key="product-42"` | Stable sibling identity during fragment updates |

`flow-model` supports text inputs, textareas, selects, checkbox booleans, radio values,
numeric/range inputs and arrays for multiple selects. An empty numeric input becomes `null`.
File inputs use native `FormData`. Event actions call `event.preventDefault()` themselves
when needed. Bindings and refs inside a nested component belong to that component.

Allowed bound properties are `disabled`, `checked`, `selected`, `readonly`, `required`,
`multiple`, `hidden`, `open` and `value`. Allowed attributes are `aria-*`, `title`, `role`
and `tabindex`. Arbitrary HTML, event-handler attributes and expression strings are rejected.

## Lifecycle

All hooks are optional. `context` contains `root`, local `refs`, readonly `props`, a scoped
`client`, `store(name)` and `onCleanup(callback)`.

| Hook | Timing |
| --- | --- |
| `init(context)` | After reactivity is prepared; refs are available, before initial rendering |
| `mount(context)` | After the first DOM update |
| `update(changes, context)` | After a batched state change, changed props or a fragment update |
| `unmount(context)` | Once during disposal |

`init` and `mount` may return promises; initialization waits for them. Writes during `init`
are part of the initial state. Writes during `mount` cause a subsequent update.
Async `update` hooks may overlap: later state changes render immediately and invoke their
own update rather than waiting for an old request. Scoped HTML loads cancel superseded
requests and reject late responses. Handle the ordering of other asynchronous work in the
component. Do not let an unguarded update write the property it observes indefinitely;
Flow diagnoses continuous update loops.

`changes.paths` lists changed public paths. `changes.has('filters.query')` matches that
path, a replacement of an ancestor or a change below it. `changes.reason` is `state`,
`props` or `fragment`. New props do not overwrite local fields; read them explicitly in
`update` if needed.

The synchronous part of `unmount` runs before Flow removes DOM. External removals are
detected afterwards by a MutationObserver. Use the direct disposer for widgets that need
cleanup while their nodes are connected. Async teardown is not awaited before removal.
Flow removes listeners and subscriptions, aborts scoped requests and runs cleanup callbacks
even when a hook fails. Register widget disposal through `onCleanup()`.

Unhandled action/hook errors dispatch a bubbling, cancelable `flow:error` event with
`detail: { error, root, phase }`. Calling `preventDefault()` suppresses the default console
report. Expected request cancellations use `AbortError` and are not reported as failures.

## Backend requests

Both `context.client` and `Flow.client` provide:

| Method | Result |
| --- | --- |
| `get(url, options)` | JSON, or `null` for 204 |
| `post(url, data, options)` | JSON, or `null` for 204 |
| `load(url, options)` | Update an HTML target; return the HTTP `Response` |

Options include `query`, `headers` and `signal`. `load` additionally takes `target`,
`debounce` in milliseconds, and optionally `method` and `data`. A scoped `target` is a
local ref name or an element belonging to that component. The standalone client takes
an element. Query arrays produce repeated parameters. Requests use the same origin and
same-origin credentials; writes are never retried automatically.

```javascript
export default class ProductSearch {
    query = '';
    error = '';

    async update(changes, { client, props }) {
        if (!changes.has('query')) return;

        try {
            await client.load(props.searchUrl, {
                query: { q: this.query }, target: 'results', debounce: 200,
            });
        } catch (error) {
            if (error.name !== 'AbortError') this.error = 'The search could not be loaded.';
        }
    }
}
```

Use a normal GET form as the initial HTML so the search also has a non-JavaScript path.
Generate its action and `searchUrl` with `Naf\route()` and escape quoted attributes with
`Naf\View\s()`.

### Full page or fragment

`load` sends `Accept: text/html` and `X-Flow: fragment`. The response must identify itself
with `Content-Type: text/html` and `X-Flow: fragment`. The PHP helper selects an explicitly
named template and sets the response headers, including `Vary: X-Flow`:

```php
use function Naf\abort;
use function Naf\Flow\page;
use function Naf\param;

// In an existing routed controller; both templates are provided by the host.
$query = param()->get('q', '');
if (!is_string($query)) {
    abort(400, 'Query must be text.');
}

return page('products.index', ['query' => $query], fragment: 'products.results');
```

Only the target's children are updated. Stable `id` or `flow-key` values preserve nodes
and component instances; keys must be unique among siblings. Unkeyed nodes match by
position and compatible type. Edited native input values and focus are preserved when
their nodes survive. Bound inputs reflect their component's state.

Successful 204 responses leave contents alone. HTML validation fragments with status 422
are rendered, then reject with `FlowHttpError`. Other failed responses retain the old DOM.
`FlowHttpError` exposes `status`, `data` and `response`; errors with JSON bodies retain
their structured data. Redirects, complete HTML documents and unexpected content types
are rejected. Handle authentication/navigation explicitly. The target's `aria-busy` is
restored after completion, including cancellation and errors.

### CSRF and forms

`naf/form` is optional at runtime. Keep its protections and validation in the host.
Generate a CSRF token once per page and include it in the form. Native `FormData` preserves
that token and file uploads:

```javascript
async save(event, { client }) {
    event.preventDefault();
    const result = await client.post('/save', new FormData(event.currentTarget));
    // Apply the JSON result to the component's fields.
}
```

Use `flow-on:submit="save"` on the form. For JSON writes, send `X-CSRF-Token` when using
`naf/form` 0.2.3+. Server validation, authorization and response generation stay in PHP.
Cancelling a browser request does not roll back an operation already running on the server.

## Stores

```javascript
class Filters {
    query = '';
    reset() { this.query = ''; }
}

Flow.store('filters', new Filters());
Flow.register('filter-form', () => ({
    filters: null,
    init({ store }) { this.filters = store('filters'); },
    reset() { this.filters.reset(); },
}));
```

Bind `flow-model="filters.query"` in each consumer. `Flow.store('filters')` retrieves the
same observed object. Stores live in the browser's page and have no automatic persistence,
server synchronization or lifecycle hooks.

## Assets and CSP

The plugin boots after View and registers `/_flow/flow.js` as a module. Its named route
`flow.runtime` serves only that known file through PSR-7, with a JavaScript MIME type,
`nosniff`, an ETag and `public, max-age=0, must-revalidate`. Matching `If-None-Match`
requests return 304. There is no generic vendor-file endpoint or publishing command to run.
Use the exact same import URL as the asset tag so application imports share one registry.

`asset()` collects tags; the layout still needs to render them. JSON and fragment responses
do not get scripts appended. A static deployment can copy the runtime to the same URL;
keep its import URL and cache invalidation consistent.

The runtime works with `script-src 'self'` without `unsafe-eval` or `unsafe-inline`.
All component logic resides in allowed external modules. Flow discards fragment scripts,
inline event handlers, embedded browsing contexts and executable URL attributes before
insertion. Serve fragments from trusted application templates; this is not a general
sanitizer for arbitrary user-authored HTML. Keep user content separate from Flow directives.
Hosts using nonce-only or Trusted Types policies need their corresponding asset/HTML
integration; the default View hook does not add nonces or a Trusted Types policy.

## Development and checks

```bash
composer install
composer test
composer style:check
composer validate --strict
npm ci
npx playwright install chromium
npm run check
npm test
```

The browser suite runs an actual NAF host with strict CSP. PHP checks cover Composer
discovery, boot order, the automatic asset and cache validation. Browser checks cover
classes/private fields, factories, lifecycle, stores, nested bindings, async cancellation,
preserved inputs, CSRF, validation fragments and HTTP failure handling. CI checks PHP
8.3–8.5 and Chromium. Additional browser coverage and performance tuning remain release
follow-up work. See [AGENTS.md](AGENTS.md) for contributor instructions.
