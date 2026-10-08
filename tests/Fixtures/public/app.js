import { Flow } from '/_flow/flow.js';

window.fixture = { Flow, instances: {}, events: [], errors: [], csp: [] };
document.addEventListener('flow:error', event => {
    window.fixture.errors.push(event.detail.error.message);
    event.preventDefault();
});
document.addEventListener('securitypolicyviolation', event => {
    window.fixture.csp.push(event.violatedDirective);
    window.fixture.lastCsp = { directive: event.violatedDirective, source: event.sourceFile,
        line: event.lineNumber, sample: event.sample, blocked: event.blockedURI };
});

class Counter {
    count = 0;
    #secret = 1;
    constructor(props) { this.count = props.initial ?? 0; }
    get doubled() { return this.count * 2; }
    get secret() { return this.#secret; }
    increment() { this.#secret++; this.count++; }
    init({ root }) { window.fixture.instances[root.id] = this; window.fixture.events.push(`${root.id}:init`); }
    mount({ root }) { window.fixture.events.push(`${root.id}:mount`); }
    update(changes, { root }) { window.fixture.events.push(`${root.id}:update:${changes.reason}:${changes.paths.join(',')}`); }
    unmount({ root }) { window.fixture.events.push(`${root.id}:unmount:${root.isConnected}`); }
}

class Search {
    query = '';
    error = '';
    filters = { term: '' };
    rows = [];
    get rowCount() { return this.rows.length; }
    init({ root }) { window.fixture.instances[root.id] = this; }
    async update(changes, { client }) {
        if (!changes.has('query')) return;
        try { await client.load('/fragment', { query: { q: this.query }, target: 'results', debounce: 15 }); }
        catch (error) { if (error.name !== 'AbortError') this.error = error.message; }
    }
}

Flow.store('filters', { count: 0 });
Flow.register('counter', props => new Counter(props));
Flow.register('search', () => new Search());
Flow.register('factory', () => ({ count: 0, increment() { this.count++; } }));
Flow.register('store-view', () => ({
    filters: null,
    init({ store }) { this.filters = store('filters'); },
    increment() { this.filters.count++; },
}));
window.fixture.Counter = Counter;
