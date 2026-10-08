import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#counter .count')).toHaveText('2');
});

test('auto-start, native class receivers, getters and batched lifecycle under strict CSP', async ({ page }) => {
    await page.locator('#counter button').click();
    await expect(page.locator('#counter .count')).toHaveText('3');
    await expect(page.locator('#counter .doubled')).toHaveText('6');
    await expect(page.locator('#counter .private')).toHaveText('2');
    await page.evaluate(() => {
        window.fixture.instances.counter.count = 5;
        window.fixture.instances.counter.count = 6;
    });
    await expect(page.locator('#counter .doubled')).toHaveText('12');
    const result = await page.evaluate(() => ({ events: window.fixture.events, errors: window.fixture.errors, csp: window.fixture.csp }));
    expect(result.events.filter(value => value === 'counter:init')).toHaveLength(1);
    expect(result.events.filter(value => value === 'counter:mount')).toHaveLength(1);
    expect(result.events.filter(value => value.startsWith('counter:update'))).toHaveLength(2);
    expect(result.errors).toEqual([]);
    expect(result.csp).toEqual([]);
    expect(await page.locator('script[src="/_flow/flow.js"]').count()).toBe(1);
});

test('object factories and declarative visibility, class and attribute bindings', async ({ page }) => {
    await page.locator('#factory button').click();
    await expect(page.locator('#factory output')).toHaveText('1');
    await page.evaluate(() => { window.fixture.instances.counter.count = 0; });
    await expect(page.locator('#counter .visible')).toBeHidden();
    await expect(page.locator('#counter .visible')).not.toHaveClass(/active/);
    await expect(page.locator('#counter .visible')).toHaveAttribute('aria-expanded', '0');
});

test('late registration and added roots mount once without an explicit start', async ({ page }) => {
    await page.evaluate(() => {
        const { Flow, Counter } = window.fixture;
        Flow.register('late', () => ({ value: 'late module' }));
        const root = document.createElement('section');
        root.id = 'added'; root.setAttribute('flow', 'counter');
        root.innerHTML = '<output flow-text="count"></output>';
        document.body.append(root);
        Flow.start(); Flow.start();
    });
    await expect(page.locator('#late output')).toHaveText('late module');
    await expect(page.locator('#added output')).toHaveText('0');
    expect(await page.evaluate(() => window.fixture.events.filter(event => event === 'added:mount'))).toHaveLength(1);
});

test('nested state, arrays and shared stores propagate to the right containers', async ({ page }) => {
    await page.evaluate(() => {
        window.fixture.instances.search.filters.term = 'nested';
        window.fixture.instances.search.rows.push('a', 'b');
    });
    await expect(page.locator('#nested-value')).toHaveText('nested');
    await expect(page.locator('#array-count')).toHaveText('2');
    await page.locator('#store-a button').click();
    await expect(page.locator('#store-a output')).toHaveText('1');
    await expect(page.locator('#store-b output')).toHaveText('1');
    await page.evaluate(() => { window.fixture.Flow.store('filters').count++; });
    await expect(page.locator('#store-b output')).toHaveText('2');
    expect(await page.evaluate(() => window.fixture.errors)).toEqual([]);
});

test('replaced nested objects detach the old subscription', async ({ page }) => {
    await page.evaluate(() => {
        const search = window.fixture.instances.search;
        window.fixture.oldFilters = search.filters;
        search.filters = { term: 'replacement' };
        window.fixture.oldFilters.term = 'obsolete';
    });
    await expect(page.locator('#nested-value')).toHaveText('replacement');
    await page.evaluate(() => { window.fixture.instances.search.filters.term = 'current'; });
    await expect(page.locator('#nested-value')).toHaveText('current');
});

test('model changes load backend fragments and mount nested components independently', async ({ page }) => {
    await page.locator('#search input[name=q]').fill('first');
    await expect(page.locator('#query')).toHaveText('first');
    await expect(page.locator('#result')).toHaveText('first');
    await expect(page.locator('#child .count')).toHaveText('4');
    await page.locator('#child button').click();
    await expect(page.locator('#child .count')).toHaveText('5');
    expect(await page.evaluate(() => window.fixture.errors)).toEqual([]);
});

test('fragment updates preserve keyed component instances, draft values and focus', async ({ page }) => {
    await page.locator('#search input[name=q]').fill('first');
    await expect(page.locator('#child .count')).toHaveText('4');
    await page.locator('#child button').click();
    await page.locator('#draft').fill('my draft');
    await page.evaluate(() => {
        window.fixture.childBefore = window.fixture.instances.child;
        window.fixture.instances.search.query = 'second';
    });
    await expect(page.locator('#result')).toHaveText('second');
    await expect(page.locator('#child .count')).toHaveText('5');
    await expect(page.locator('#draft')).toHaveValue('my draft');
    await expect(page.locator('#draft')).toBeFocused();
    expect(await page.evaluate(() => window.fixture.childBefore === window.fixture.instances.child)).toBe(true);
    expect(await page.evaluate(() => window.fixture.events.filter(event => event === 'child:mount'))).toHaveLength(1);
});

test('Flow-controlled removal runs unmount before removal and external removal cleans up', async ({ page }) => {
    await page.locator('#search input[name=q]').fill('first');
    await expect(page.locator('#child .count')).toHaveText('4');
    await page.locator('#search input[name=q]').fill('remove');
    await expect(page.locator('#child')).toHaveCount(0);
    expect(await page.evaluate(() => window.fixture.events.filter(event => event === 'child:unmount:true'))).toHaveLength(1);
    await page.evaluate(() => document.querySelector('#counter').remove());
    await expect.poll(() => page.evaluate(() => window.fixture.events.filter(event => event === 'counter:unmount:false').length)).toBe(1);
});

test('fragment scripts and inline event handlers are never executed', async ({ page }) => {
    await page.locator('#search input[name=q]').fill('unsafe');
    await expect.poll(async () => page.evaluate(() => ({
        result: document.querySelector('#result').textContent,
        error: window.fixture.instances.search.error,
    }))).toEqual({ result: 'unsafe', error: '' });
    await expect(page.locator('#results script')).toHaveCount(0);
    await expect(page.locator('#unsafe')).not.toHaveAttribute('onclick');
    await page.locator('#unsafe').click();
    expect(await page.evaluate(() => window.fragmentScript)).toBeUndefined();
    // Chromium may report a rejected handler during inert parsing. It is never copied into the live DOM.
    expect(await page.evaluate(() => window.fixture.errors)).toEqual([]);
});

test('JSON and FormData writes reuse the installed form plugin CSRF checks', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { client } = window.fixture.Flow;
        const form = await client.post('/echo', new FormData(document.querySelector('#csrf-form')));
        const { token } = await client.get('/token');
        const json = await client.post('/echo', { name: 'Grace' }, { headers: { 'X-CSRF-Token': token } });
        let rejected;
        try { await client.post('/echo', { name: 'No token' }); } catch (error) { rejected = error.status; }
        return { form, json, rejected };
    });
    expect(result.form.name).toBe('Ada');
    expect(result.json.name).toBe('Grace');
    expect(result.rejected).toBe(400);
});

test('HTTP failures retain contents, 204 retains contents and busy state is restored', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { client } = window.fixture.Flow;
        const target = document.querySelector('#results');
        const statuses = [];
        for (const status of [400, 401, 403, 409, 500]) {
            try { await client.load(`/status/${status}`, { target }); }
            catch (error) { statuses.push({ status: error.status, data: error.data }); }
        }
        await client.load('/empty', { target });
        return { statuses, text: target.textContent, busy: target.getAttribute('aria-busy') };
    });
    expect(result.statuses.map(error => error.status)).toEqual([400, 401, 403, 409, 500]);
    expect(result.statuses.every(error => error.data.error === 'test')).toBe(true);
    expect(result.text).toBe('Initial results');
    expect(result.busy).toBeNull();
});

test('422 renders an explicit validation fragment and remains an inspectable HTTP error', async ({ page }) => {
    const status = await page.evaluate(async () => {
        try {
            await window.fixture.Flow.client.load('/validation', {
                method: 'POST', data: new FormData(document.querySelector('#csrf-form')),
                target: document.querySelector('#results'),
            });
        } catch (error) { return error.status; }
    });
    expect(status).toBe(422);
    await expect(page.locator('#validation-error')).toHaveText('Invalid input');
});

test('redirects, full documents and cross-origin URLs are rejected without replacing contents', async ({ page }) => {
    const errors = await page.evaluate(async () => {
        const errors = [];
        for (const url of ['/redirect', '/document', 'https://example.org/']) {
            try { await window.fixture.Flow.client.load(url, { target: document.querySelector('#results') }); }
            catch (error) { errors.push(error.message); }
        }
        return errors;
    });
    expect(errors[0]).toContain('redirect');
    expect(errors[1]).toContain('fragment');
    expect(errors[2]).toContain('same origin');
    await expect(page.locator('#results')).toHaveText('Initial results');
});

test('latest load wins even when the transport ignores AbortSignal', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const originalFetch = window.fetch;
        const responses = new Map();
        window.fetch = url => new Promise(resolve => responses.set(String(url), resolve));
        const target = document.querySelector('#results');
        const response = text => new Response(`<p>${text}</p>`, { headers: { 'Content-Type': 'text/html', 'X-Flow': 'fragment' } });
        try {
            const old = window.fixture.Flow.client.load('/race-old', { target }).catch(error => error.name);
            const latest = window.fixture.Flow.client.load('/race-new', { target });
            responses.get(`${location.origin}/race-new`)(response('latest'));
            await latest;
            const busyAfterLatest = target.getAttribute('aria-busy');
            responses.get(`${location.origin}/race-old`)(response('obsolete'));
            return { old: await old, text: target.textContent, busyAfterLatest, busy: target.getAttribute('aria-busy') };
        } finally { window.fetch = originalFetch; }
    });
    expect(result).toEqual({ old: 'AbortError', text: 'latest', busyAfterLatest: null, busy: null });
});

test('disposal is idempotent and prevents late async init from mounting', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { Flow } = window.fixture;
        let resolveInit, cleanup = 0, mounts = 0, unmounts = 0;
        const root = document.querySelector('#manual');
        const instance = {
            count: 0, increment() { this.count++; },
            async init({ onCleanup }) {
                onCleanup(() => cleanup++);
                await new Promise(resolve => { resolveInit = resolve; });
            },
            mount() { mounts++; }, unmount() { unmounts++; },
        };
        const dispose = Flow.mount(root, instance);
        dispose(); dispose(); resolveInit();
        await Promise.resolve(); await Promise.resolve();
        return { cleanup, mounts, unmounts };
    });
    expect(result).toEqual({ cleanup: 1, mounts: 0, unmounts: 1 });
});

test('async update hooks do not freeze reactivity and newer searches cancel old loads', async ({ page }) => {
    await page.evaluate(() => {
        window.fixture.savedFetch = window.fetch;
        window.fixture.responses = new Map();
        window.fetch = (url, options) => new Promise(resolve => {
            window.fixture.responses.set(new URL(url).searchParams.get('q'), { resolve, signal: options.signal });
        });
        window.fixture.instances.search.query = 'old';
    });
    await expect.poll(() => page.evaluate(() => window.fixture.responses.has('old'))).toBe(true);
    await page.evaluate(() => { window.fixture.instances.search.query = 'new'; });
    await expect(page.locator('#query')).toHaveText('new');
    await expect.poll(() => page.evaluate(() => window.fixture.responses.has('new'))).toBe(true);
    expect(await page.evaluate(() => window.fixture.responses.get('old').signal.aborted)).toBe(true);
    await page.evaluate(() => {
        window.fixture.responses.get('new').resolve(new Response('<p id="result">new</p>', {
            headers: { 'Content-Type': 'text/html', 'X-Flow': 'fragment' },
        }));
    });
    await expect(page.locator('#result')).toHaveText('new');
    await page.evaluate(() => {
        window.fixture.responses.get('old').resolve(new Response('<p id="result">old</p>', {
            headers: { 'Content-Type': 'text/html', 'X-Flow': 'fragment' },
        }));
        window.fetch = window.fixture.savedFetch;
    });
    await expect(page.locator('#result')).toHaveText('new');
    expect(await page.evaluate(() => window.fixture.errors)).toEqual([]);
});

test('scoped requests are aborted on unmount, including transports with late responses', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const originalFetch = window.fetch;
        let resolveResponse, signal, pending;
        window.fetch = (url, options) => new Promise(resolve => { resolveResponse = resolve; signal = options.signal; });
        const root = document.querySelector('#manual');
        const dispose = window.fixture.Flow.mount(root, {
            count: 0, increment() {},
            init({ client }) { pending = client.get('/late-request').catch(error => error.name); },
        });
        try {
            dispose();
            resolveResponse(new Response('{"value":"late"}', { headers: { 'Content-Type': 'application/json' } }));
            return { aborted: signal.aborted, result: await pending };
        } finally { window.fetch = originalFetch; }
    });
    expect(result).toEqual({ aborted: true, result: 'AbortError' });
});

test('feedback loops produce a diagnosis and release the component', async ({ page }) => {
    await page.evaluate(() => {
        const instance = {
            count: 0, increment() {}, update() { this.count++; },
            unmount() { window.fixture.loopDisposed = true; },
        };
        window.fixture.Flow.mount(document.querySelector('#manual'), instance);
        window.fixture.loopInstance = instance;
    });
    await expect(page.locator('#manual output')).toHaveText('0');
    await page.evaluate(() => { window.fixture.loopInstance.count++; });
    await expect.poll(() => page.evaluate(() => window.fixture.loopDisposed)).toBe(true);
    expect(await page.evaluate(() => window.fixture.errors.some(error => error.includes('update loop')))).toBe(true);
    const before = await page.locator('#manual output').textContent();
    await page.evaluate(() => { window.fixture.loopInstance.count = 500; });
    await expect(page.locator('#manual output')).toHaveText(before);
});

test('a class instance cannot be shared between containers and failure keeps its original owner', async ({ page }) => {
    const error = await page.evaluate(() => {
        try { window.fixture.Flow.mount(document.querySelector('#manual'), window.fixture.instances.counter); }
        catch (error) { return error.message; }
    });
    expect(error).toContain('one container');
    await page.locator('#counter button').click();
    await expect(page.locator('#counter .count')).toHaveText('3');
    expect(await page.evaluate(() => window.fixture.events.filter(event => event.startsWith('counter:unmount')))).toEqual([]);
});

test('direct mounting is idempotent for the same instance and rejects conflicting ownership', async ({ page }) => {
    const result = await page.evaluate(() => {
        const root = document.querySelector('#manual');
        const instance = { count: 0, increment() { this.count++; } };
        const dispose = window.fixture.Flow.mount(root, instance);
        const same = window.fixture.Flow.mount(root, instance) === dispose;
        let error;
        try { window.fixture.Flow.mount(root, { count: 100, increment() {} }); }
        catch (failure) { error = failure.message; }
        instance.count++;
        return { same, error };
    });
    expect(result.same).toBe(true);
    expect(result.error).toContain('already mounted');
    await expect(page.locator('#manual output')).toHaveText('1');
});

test('markup accepts paths and declared actions and rejects expressions or lifecycle actions', async ({ page }) => {
    await page.evaluate(() => {
        for (const binding of ['flow-text="count + 1"', 'flow-text="constructor.name"', 'flow-on:click="update"']) {
            const root = document.createElement('section');
            root.setAttribute('flow', 'factory'); root.innerHTML = `<button ${binding}>Invalid</button>`;
            document.body.append(root);
        }
    });
    await expect.poll(() => page.evaluate(() => window.fixture.errors.length)).toBe(3);
    const errors = await page.evaluate(() => window.fixture.errors);
    expect(errors.some(error => error.includes('property path'))).toBe(true);
    expect(errors.some(error => error.includes('cannot access'))).toBe(true);
    expect(errors.some(error => error.includes('Invalid Flow action'))).toBe(true);
});

test('props update without remounting or overwriting locally edited state', async ({ page }) => {
    await page.locator('#counter button').click();
    await page.evaluate(() => document.querySelector('#counter').setAttribute('flow-props', '{"initial":100}'));
    await expect.poll(() => page.evaluate(() => window.fixture.events.some(event => event === 'counter:update:props:'))).toBe(true);
    await expect(page.locator('#counter .count')).toHaveText('3');
    expect(await page.evaluate(() => window.fixture.events.filter(event => event === 'counter:mount'))).toHaveLength(1);
});

test('the minified module preserves named exports and shares the automatic runtime', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const module = await import('/_flow/flow.js');
        const { Flow, FlowHttpError } = module;
        const error = new FlowHttpError(new Response('', { status: 409 }), { conflict: true });

        return {
            exports: Object.keys(module).sort(),
            shared: Flow === window.fixture.Flow,
            className: FlowHttpError.name,
            errorName: error.name,
            status: error.status,
            data: error.data,
        };
    });

    expect(result).toEqual({
        exports: ['Flow', 'FlowHttpError'],
        shared: true,
        className: 'FlowHttpError',
        errorName: 'FlowHttpError',
        status: 409,
        data: { conflict: true },
    });
});

test('the bundled runtime works with one public module and no internal module requests', async ({ page }) => {
    const runtimeRequests = [];
    page.on('request', request => {
        const pathname = new URL(request.url()).pathname;
        if (request.resourceType() === 'script' && pathname.startsWith('/_flow/')) {
            runtimeRequests.push(pathname);
        }
    });

    await page.reload();
    await page.locator('#counter button').click();
    await expect(page.locator('#counter .doubled')).toHaveText('6');
    await page.locator('#search input[name=q]').fill('bundled');
    await expect(page.locator('#result')).toHaveText('bundled');
    expect(runtimeRequests).toEqual(['/_flow/flow.js']);
    expect(await page.evaluate(() => window.fixture.errors)).toEqual([]);
    expect((await page.request.get('/_flow/runtime/components.js')).status()).toBe(404);
});

test('a disposed client cannot cancel a current load into its former container', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { Flow } = window.fixture;
        const root = document.createElement('section');
        root.innerHTML = '<div flow-ref="results">before</div>';
        document.body.append(root);
        let context;
        const dispose = Flow.mount(root, { init(value) { context = value; } });
        await Promise.resolve();
        dispose();

        const target = root.querySelector('div');
        const originalFetch = window.fetch;
        let finish;
        let aborted = false;
        window.fetch = async (url, options) => {
            options.signal.addEventListener('abort', () => { aborted = true; });
            await new Promise(resolve => { finish = resolve; });
            return new Response('<p>current</p>', {
                headers: { 'Content-Type': 'text/html', 'X-Flow': 'fragment' },
            });
        };
        try {
            const current = Flow.client.load('/current', { target });
            let staleError;
            try { await context.client.load('/stale', { target }); }
            catch (error) { staleError = error.name; }
            finish();
            let currentError = null;
            try { await current; } catch (error) { currentError = error.name; }
            return { aborted, staleError, currentError, text: target.textContent };
        } finally {
            window.fetch = originalFetch;
            root.remove();
        }
    });
    expect(result).toEqual({ aborted: false, staleError: 'AbortError', currentError: null, text: 'current' });
});

for (const mode of ['native', 'fallback']) {
    test(`keyed reordering preserves input identity, focus and selection (${mode})`, async ({ page }) => {
        const result = await page.evaluate(async mode => {
            const root = document.createElement('section');
            root.innerHTML = '<div flow-key="first">First</div><div flow-key="draft"><input value="server"></div>';
            document.body.append(root);
            if (mode === 'fallback') Object.defineProperty(root, 'moveBefore', { value: undefined });
            const input = root.querySelector('input');
            input.value = 'my draft';
            input.focus();
            input.setSelectionRange(1, 4, 'backward');
            const originalFetch = window.fetch;
            window.fetch = async () => new Response(
                '<div flow-key="draft"><input value="new server"></div><div flow-key="first">First</div>',
                { headers: { 'Content-Type': 'text/html', 'X-Flow': 'fragment' } },
            );
            try {
                await window.fixture.Flow.client.load('/reorder', { target: root });
                return {
                    sameInput: input === root.querySelector('input'),
                    focused: document.activeElement === input,
                    value: input.value,
                    selection: [input.selectionStart, input.selectionEnd, input.selectionDirection],
                    order: [...root.children].map(node => node.getAttribute('flow-key')),
                };
            } finally {
                window.fetch = originalFetch;
                root.remove();
            }
        }, mode);
        expect(result).toEqual({
            sameInput: true, focused: true, value: 'my draft', selection: [1, 4, 'backward'], order: ['draft', 'first'],
        });
    });
}

test('PHP page helper distinguishes full pages and fragments, runtime route is bounded and cacheable', async ({ request }) => {
    const page = await request.get('/fragment?q=full');
    expect(await page.text()).toContain('<!doctype html>');
    expect(page.headers().vary).toBe('X-Flow');
    const fragment = await request.get('/fragment?q=partial', { headers: { 'X-Flow': 'fragment' } });
    expect(fragment.headers()['x-flow']).toBe('fragment');
    expect(await fragment.text()).toContain('partial');
    expect(await fragment.text()).not.toContain('/_flow/flow.js');
    const runtime = await request.get('/_flow/flow.js');
    expect(runtime.headers()['content-type']).toContain('text/javascript');
    const cached = await request.get('/_flow/flow.js', { headers: { 'If-None-Match': runtime.headers().etag } });
    expect(cached.status()).toBe(304);
    expect(await cached.text()).toBe('');
    expect((await request.get('/_flow/composer.json')).status()).toBe(404);
});
