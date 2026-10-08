/*! NAF Flow — MIT License. Native ES module; no application build step. */
const factories = new Map();
const stores = new Map();
const observations = new WeakMap();
const mounted = new WeakMap();
const owners = new WeakMap();
const active = new Set();
const loads = new WeakMap();
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const hooks = new Set(['init', 'mount', 'update', 'unmount']);
let started = false;

function parsePath(path) {
    if (!/^[A-Za-z_$][\w$]*(?:\.(?:[A-Za-z_$][\w$]*|\d+))*$/.test(path)) {
        throw new TypeError(`Flow expects a property path, received "${path}".`);
    }
    const parts = path.split('.');
    if (parts.some((part) => forbidden.has(part))) {
        throw new TypeError(`Flow cannot access "${path}".`);
    }
    return parts;
}

function findProperty(object, key) {
    for (
        let cursor = object;
        cursor && cursor !== Object.prototype;
        cursor = Object.getPrototypeOf(cursor)
    ) {
        const property = Object.getOwnPropertyDescriptor(cursor, key);
        if (property) {
            return property;
        }
    }
}

function readPath(object, parts) {
    let value = object;
    for (const part of parts) {
        if (value == null) {
            return undefined;
        }
        if (!findProperty(Object(value), part)) {
            throw new TypeError(`Unknown Flow property "${part}".`);
        }
        value = value[part];
        if (typeof value === 'function') {
            throw new TypeError('Flow bindings read fields and getters, not methods.');
        }
    }
    return value;
}

function writePath(object, parts, value) {
    const parent = parts.length === 1 ? object : readPath(object, parts.slice(0, -1));
    const key = parts.at(-1);
    const property = parent && findProperty(parent, key);
    if (!property || (!property.writable && !property.set)) {
        throw new TypeError(`Flow model "${parts.join('.')}" is not writable.`);
    }
    parent[key] = value;
}

/* Observe public fields in place so native class receivers and private fields work.
 * Nested plain objects/arrays are proxied. Parent links propagate store changes,
 * detach when a field is replaced and guard cyclic object graphs. */
function observe(object, isRoot = false) {
    if (!object || typeof object !== 'object') {
        return null;
    }
    if (observations.has(object)) {
        return observations.get(object);
    }
    const plain =
        Array.isArray(object) ||
        Object.getPrototypeOf(object) === Object.prototype ||
        Object.getPrototypeOf(object) === null;
    if (!isRoot && !plain) {
        return null;
    }

    const listeners = new Set();
    const children = new Map();
    const record = {
        value: object,
        ancestors: new Set(),
        listen(callback, ancestors = new Set()) {
            const first = listeners.size === 0;
            listeners.add(callback);
            if (first) {
                record.ancestors = new Set([...ancestors, record]);
                for (const [key, child] of children) {
                    attach(key, child);
                }
            }
            return () => {
                listeners.delete(callback);
                if (listeners.size === 0) {
                    for (const child of children.values()) {
                        child.disconnect?.();
                        child.disconnect = null;
                    }
                    record.ancestors.clear();
                }
            };
        },
        emit(path, visited = new Set()) {
            if (visited.has(record)) {
                return;
            }
            visited.add(record);
            for (const listener of [...listeners]) {
                listener(path, new Set(visited));
            }
        },
    };
    observations.set(object, record);

    function attach(key, child) {
        if (!child.disconnect && !record.ancestors.has(child.record)) {
            child.disconnect = child.record.listen(
                (path, visited) => record.emit(`${key}.${path}`, visited),
                record.ancestors,
            );
        }
    }

    function connect(key, value) {
        children.get(key)?.disconnect?.();
        children.delete(key);
        const child = observe(value);
        if (child) {
            const link = { record: child, disconnect: null };
            children.set(key, link);
            if (listeners.size) {
                attach(key, link);
            }
            return child.value;
        }
        return value;
    }

    if (isRoot) {
        for (const key of Object.keys(object)) {
            const property = Object.getOwnPropertyDescriptor(object, key);
            if (
                forbidden.has(key) ||
                !property.configurable ||
                !property.writable ||
                !('value' in property) ||
                typeof property.value === 'function'
            ) {
                continue;
            }
            let value = connect(key, property.value);
            Object.defineProperty(object, key, {
                configurable: true,
                enumerable: property.enumerable,
                get() {
                    return value;
                },
                set(next) {
                    const child = observe(next);
                    if (Object.is(value, child?.value ?? next)) {
                        return;
                    }
                    value = connect(key, next);
                    record.emit(key);
                },
            });
        }
    } else {
        record.value = new Proxy(object, {
            set(target, key, value) {
                if (typeof key === 'symbol') {
                    return Reflect.set(target, key, value);
                }
                if (forbidden.has(key)) {
                    throw new TypeError(`Invalid Flow field "${key}".`);
                }
                const next = observe(value)?.value ?? value;
                if (Object.is(target[key], next)) {
                    return true;
                }
                const result = Reflect.set(target, key, next);
                if (result) {
                    connect(key, next);
                    if (Array.isArray(target) && key === 'length') {
                        for (const [child, link] of children) {
                            if (/^\d+$/.test(child) && Number(child) >= target.length) {
                                link.disconnect?.();
                                children.delete(child);
                            }
                        }
                    }
                    record.emit(String(key));
                }
                return result;
            },
            deleteProperty(target, key) {
                const exists = Object.hasOwn(target, key);
                const result = Reflect.deleteProperty(target, key);
                if (result && exists) {
                    children.get(key)?.disconnect?.();
                    children.delete(key);
                    record.emit(String(key));
                }
                return result;
            },
        });
        observations.set(record.value, record);
        for (const key of Object.keys(object)) {
            const property = Object.getOwnPropertyDescriptor(object, key);
            if (!forbidden.has(key) && property?.writable && 'value' in property) {
                object[key] = connect(key, object[key]);
            }
        }
    }
    return record;
}

function propsFrom(root) {
    const props = JSON.parse(root.getAttribute('flow-props') || '{}');
    if (!props || Array.isArray(props) || typeof props !== 'object') {
        throw new TypeError('flow-props must be a JSON object.');
    }
    function freeze(value) {
        if (value && typeof value === 'object') {
            for (const key of Object.keys(value)) {
                if (forbidden.has(key)) {
                    throw new TypeError(`Invalid Flow prop "${key}".`);
                }
                freeze(value[key]);
            }
            Object.freeze(value);
        }
        return value;
    }
    return freeze(props);
}

function belongs(element, root) {
    for (let cursor = element; cursor; cursor = cursor.parentElement) {
        if (cursor === root) {
            return true;
        }
        if (cursor.hasAttribute('flow')) {
            return false;
        }
    }
    return false;
}

function elements(record) {
    return [record.root, ...record.root.querySelectorAll('*')].filter((element) =>
        belongs(element, record.root),
    );
}

function report(error, record, phase) {
    if (error?.name === 'AbortError') {
        return;
    }
    const target = record?.root ?? document;
    const handled = !target.dispatchEvent(
        new CustomEvent('flow:error', {
            bubbles: true,
            cancelable: true,
            detail: { error, root: record?.root ?? null, phase },
        }),
    );
    if (!handled) {
        console.error(`[NAF Flow: ${phase}]`, error);
    }
}

function resolveAction(instance, name) {
    if (!/^[A-Za-z_$][\w$]*$/.test(name) || forbidden.has(name) || hooks.has(name)) {
        throw new TypeError(`Invalid Flow action "${name}".`);
    }
    const property = findProperty(instance, name);
    if (!property || typeof property.value !== 'function') {
        throw new TypeError(`Unknown Flow action "${name}".`);
    }
    return property.value;
}

function renderText(element, value) {
    const next = value == null ? '' : String(value);
    if (element.textContent === next) {
        return;
    }
    if (element.childNodes.length === 1 && element.firstChild.nodeType === Node.TEXT_NODE) {
        element.firstChild.data = next;
    } else {
        for (const child of [...element.childNodes]) {
            removeTree(child);
        }
        element.textContent = next;
    }
}

function modelValue(element) {
    if (element.type === 'checkbox') {
        return element.checked;
    }
    if (element.type === 'number' || element.type === 'range') {
        return element.value === '' ? null : element.valueAsNumber;
    }
    if (element.multiple && element.tagName === 'SELECT') {
        return [...element.selectedOptions].map((option) => option.value);
    }
    return element.value;
}

function renderModel(element, value) {
    if (element.type === 'checkbox') {
        element.checked = Boolean(value);
    } else if (element.type === 'radio') {
        element.checked = element.value === String(value);
    } else if (element.multiple && element.tagName === 'SELECT') {
        for (const option of element.options) {
            option.selected = Array.isArray(value) && value.includes(option.value);
        }
    } else if (element.value !== String(value ?? '')) {
        element.value = value ?? '';
    }
}

function bind(record) {
    for (const cleanup of record.bindCleanup.splice(0)) {
        cleanup();
    }
    record.bindings = [];
    for (const key of Object.keys(record.context.refs)) {
        delete record.context.refs[key];
    }
    for (const element of elements(record)) {
        for (const { name, value } of [...element.attributes]) {
            if (name === 'flow-ref') {
                if (!/^[A-Za-z_$][\w$]*$/.test(value) || forbidden.has(value)) {
                    throw new TypeError('Invalid flow-ref.');
                }
                if (record.context.refs[value]) {
                    throw new TypeError(`Duplicate flow-ref "${value}".`);
                }
                record.context.refs[value] = element;
            } else if (name.startsWith('flow-on:')) {
                const event = name.slice(8);
                if (!/^[a-z][\w:-]*$/.test(event)) {
                    throw new TypeError(`Invalid Flow event "${event}".`);
                }
                const method = resolveAction(record.instance, value);
                const listener = (domEvent) => {
                    try {
                        Promise.resolve(
                            method.call(record.instance, domEvent, record.context),
                        ).catch((error) => report(error, record, 'action'));
                    } catch (error) {
                        report(error, record, 'action');
                    }
                };
                element.addEventListener(event, listener);
                record.bindCleanup.push(() => element.removeEventListener(event, listener));
            } else if (
                name === 'flow-text' ||
                name === 'flow-show' ||
                name === 'flow-model' ||
                name.startsWith('flow-class:') ||
                name.startsWith('flow-bind:')
            ) {
                const parts = parsePath(value);
                let apply;
                if (name === 'flow-text') {
                    apply = (next) => renderText(element, next);
                }
                if (name === 'flow-show') {
                    apply = (next) => {
                        element.hidden = !next;
                    };
                }
                if (name === 'flow-model') {
                    if (
                        !['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) ||
                        element.type === 'file'
                    ) {
                        throw new TypeError(
                            'flow-model requires an input, textarea or select, excluding file inputs.',
                        );
                    }
                    apply = (next) => renderModel(element, next);
                    const listener = () => {
                        if (element.type === 'radio' && !element.checked) {
                            return;
                        }
                        try {
                            writePath(record.instance, parts, modelValue(element));
                        } catch (error) {
                            report(error, record, 'model');
                        }
                    };
                    const event =
                        element.tagName === 'SELECT' || ['checkbox', 'radio'].includes(element.type)
                            ? 'change'
                            : 'input';
                    element.addEventListener(event, listener);
                    record.bindCleanup.push(() => element.removeEventListener(event, listener));
                }
                if (name.startsWith('flow-class:')) {
                    const className = name.slice(11);
                    if (!className || /\s/.test(className)) {
                        throw new TypeError('Invalid Flow class name.');
                    }
                    apply = (next) => element.classList.toggle(className, Boolean(next));
                }
                if (name.startsWith('flow-bind:')) {
                    const attribute = name.slice(10);
                    const properties = {
                        disabled: 'disabled',
                        checked: 'checked',
                        selected: 'selected',
                        readonly: 'readOnly',
                        required: 'required',
                        multiple: 'multiple',
                        hidden: 'hidden',
                        open: 'open',
                        value: 'value',
                    };
                    if (Object.hasOwn(properties, attribute)) {
                        apply = (next) => {
                            element[properties[attribute]] =
                                attribute === 'value' ? (next ?? '') : Boolean(next);
                        };
                    } else if (
                        /^aria-[a-z-]+$/.test(attribute) ||
                        ['title', 'role', 'tabindex'].includes(attribute)
                    ) {
                        apply = (next) => {
                            if (next == null) {
                                element.removeAttribute(attribute);
                            } else {
                                element.setAttribute(attribute, String(next));
                            }
                        };
                    } else {
                        throw new TypeError(`Unsupported Flow attribute "${attribute}".`);
                    }
                }
                record.bindings.push(() => apply(readPath(record.instance, parts)));
            }
        }
    }
    render(record);
}

function render(record) {
    for (const binding of record.bindings) {
        binding();
    }
}

function queue(record, path = null, reason = 'state') {
    if (!record.alive) {
        return;
    }
    if (path) {
        record.pending.add(path);
    }
    if (reason !== 'state') {
        record.reason = reason;
    }
    if (!record.ready || record.queued || record.updating) {
        return;
    }
    record.queued = true;
    queueMicrotask(() => flush(record));
}

function flush(record) {
    record.queued = false;
    if (!record.alive || record.updating) {
        return;
    }
    record.updating = true;
    const paths = [...record.pending];
    const reason = record.reason;
    record.pending.clear();
    record.reason = 'state';
    const changes = Object.freeze({
        paths: Object.freeze(paths),
        reason,
        has(path) {
            parsePath(path);
            return paths.some(
                (changed) =>
                    changed === path ||
                    changed.startsWith(`${path}.`) ||
                    path.startsWith(`${changed}.`),
            );
        },
    });
    if (!record.resetTimer) {
        record.resetTimer = setTimeout(() => {
            record.cycles = 0;
            record.resetTimer = null;
        }, 0);
    }
    try {
        if (++record.cycles > 100) {
            throw new Error('Flow update loop: more than 100 consecutive updates.');
        }
        render(record);
        if (typeof record.instance.update === 'function') {
            Promise.resolve(record.instance.update(changes, record.context)).catch((error) =>
                report(error, record, 'update'),
            );
        }
    } catch (error) {
        report(error, record, 'update');
        if (record.cycles > 100) {
            dispose(record);
        }
    } finally {
        record.updating = false;
        if (record.pending.size || record.reason !== 'state') {
            queue(record);
        }
    }
}

function dispose(record) {
    if (!record.alive) {
        return;
    }
    record.alive = false;
    active.delete(record);
    mounted.delete(record.root);
    const ownsInstance = record.instance && owners.get(record.instance) === record.root;
    if (ownsInstance) {
        owners.delete(record.instance);
    }
    const cleanups = [...record.bindCleanup.splice(0), ...record.cleanup.splice(0)];
    for (const controller of record.controllers) {
        controller.abort();
    }
    if (record.resetTimer) {
        clearTimeout(record.resetTimer);
    }
    try {
        if (ownsInstance && typeof record.instance?.unmount === 'function') {
            Promise.resolve(record.instance.unmount(record.context)).catch((error) =>
                report(error, record, 'unmount'),
            );
        }
    } catch (error) {
        report(error, record, 'unmount');
    }
    for (const cleanup of cleanups) {
        try {
            cleanup();
        } catch (error) {
            report(error, record, 'cleanup');
        }
    }
}

function mount(root, instanceOrFactory, factory = false) {
    if (!(root instanceof Element)) {
        throw new TypeError('Flow.mount requires an Element.');
    }
    if (mounted.has(root)) {
        const existing = mounted.get(root);
        if (!factory && existing.instance !== instanceOrFactory) {
            throw new TypeError(
                'This Flow container is already mounted; dispose its binding first.',
            );
        }
        return existing.dispose;
    }
    const record = {
        root,
        instance: null,
        alive: true,
        ready: false,
        queued: false,
        updating: false,
        pending: new Set(),
        reason: 'state',
        cycles: 0,
        resetTimer: null,
        cleanup: [],
        bindCleanup: [],
        bindings: [],
        controllers: new Set(),
        context: null,
    };
    let props = propsFrom(root);
    record.context = Object.freeze({
        root,
        refs: Object.create(null),
        get props() {
            return props;
        },
        client: createClient(record),
        store,
        onCleanup(callback) {
            if (typeof callback !== 'function') {
                throw new TypeError('onCleanup requires a function.');
            }
            if (record.alive) {
                record.cleanup.push(callback);
            } else {
                callback();
            }
        },
    });
    record.setProps = () => {
        props = propsFrom(root);
    };
    record.dispose = () => dispose(record);
    mounted.set(root, record);
    active.add(record);
    try {
        record.instance = factory ? instanceOrFactory(props, record.context) : instanceOrFactory;
        if (
            !record.instance ||
            typeof record.instance !== 'object' ||
            typeof record.instance.then === 'function'
        ) {
            throw new TypeError('A Flow factory must synchronously return an object.');
        }
        if (owners.has(record.instance)) {
            throw new TypeError(
                'A Flow instance belongs to one container; use a store for shared state.',
            );
        }
        owners.set(record.instance, root);
        const observation = observe(record.instance, true);
        record.cleanup.push(observation.listen((path) => queue(record, path)));
        initialize(record);
    } catch (error) {
        dispose(record);
        throw error;
    }
    return record.dispose;
}

async function initialize(record) {
    try {
        // Refs are available during init; the first render still happens afterwards.
        for (const element of elements(record)) {
            const name = element.getAttribute('flow-ref');
            if (name && !forbidden.has(name)) {
                record.context.refs[name] = element;
            }
        }
        if (typeof record.instance.init === 'function') {
            await record.instance.init(record.context);
        }
        if (!record.alive) {
            return;
        }
        record.pending.clear();
        record.reason = 'state';
        bind(record);
        if (typeof record.instance.mount === 'function') {
            await record.instance.mount(record.context);
        }
        if (!record.alive) {
            return;
        }
        record.ready = true;
        if (record.pending.size || record.reason !== 'state') {
            queue(record);
        }
    } catch (error) {
        report(error, record, 'mount');
        dispose(record);
    }
}

function scan(scope) {
    const roots = [
        ...(scope instanceof Element && scope.hasAttribute('flow') ? [scope] : []),
        ...scope.querySelectorAll('[flow]'),
    ];
    for (const root of roots) {
        if (!root.isConnected || mounted.has(root)) {
            continue;
        }
        const factory = factories.get(root.getAttribute('flow'));
        if (factory) {
            try {
                mount(root, factory, true);
            } catch (error) {
                report(error, { root }, 'mount');
            }
        }
    }
}

function refresh(record, reason = null) {
    if (!record.alive || !record.ready) {
        return;
    }
    try {
        record.setProps();
        bind(record);
        if (reason) {
            queue(record, null, reason);
        }
    } catch (error) {
        report(error, record, 'binding');
        dispose(record);
    }
}

function start(scope = document) {
    if (!started) {
        started = true;
        new MutationObserver((mutations) => {
            for (const record of [...active]) {
                if (!record.root.isConnected) {
                    dispose(record);
                    continue;
                }
                if (mutations.some((mutation) => record.root.contains(mutation.target))) {
                    const propsChanged = mutations.some(
                        (mutation) =>
                            mutation.target === record.root &&
                            mutation.attributeName === 'flow-props',
                    );
                    const nameChanged = mutations.some(
                        (mutation) =>
                            mutation.target === record.root && mutation.attributeName === 'flow',
                    );
                    if (nameChanged) {
                        dispose(record);
                        continue;
                    }
                    refresh(record, propsChanged ? 'props' : null);
                }
            }
            for (const mutation of mutations) {
                if (mutation.type === 'attributes') {
                    scan(mutation.target);
                }
                for (const node of mutation.addedNodes) {
                    if (node instanceof Element) {
                        scan(node);
                    }
                }
            }
        }).observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['flow', 'flow-props'],
        });
    }
    scan(scope);
}

function store(name, value) {
    if (arguments.length > 1) {
        if (stores.has(name)) {
            throw new TypeError(`Flow store "${name}" is already registered.`);
        }
        if (!value || typeof value !== 'object') {
            throw new TypeError('A Flow store must be an object.');
        }
        stores.set(name, observe(value, true).value);
    }
    if (!stores.has(name)) {
        throw new TypeError(`Unknown Flow store "${name}".`);
    }
    return stores.get(name);
}

export class FlowHttpError extends Error {
    constructor(response, data, message = `Flow request failed (${response.status}).`) {
        super(message);
        this.name = 'FlowHttpError';
        this.status = response.status;
        this.data = data;
        this.response = response;
    }
}

function abortError() {
    return new DOMException('Flow request was cancelled.', 'AbortError');
}

function urlFor(url, query = {}) {
    const resolved = new URL(url, document.baseURI);
    if (!['http:', 'https:'].includes(resolved.protocol) || resolved.origin !== location.origin) {
        throw new TypeError('Flow requests must use the same origin.');
    }
    for (const [key, value] of Object.entries(query)) {
        if (value == null) {
            continue;
        }
        resolved.searchParams.delete(key);
        for (const item of Array.isArray(value) ? value : [value]) {
            resolved.searchParams.append(key, String(item));
        }
    }
    return resolved;
}

async function decode(response, kind) {
    if (response.status === 204) {
        return null;
    }
    const type = response.headers.get('Content-Type') || '';
    const json = /^application\/(?:[\w.-]+\+)?json(?:;|$)/i.test(type);
    if (!response.ok) {
        const body = await response.text();
        let data = body;
        if (json) {
            try {
                data = JSON.parse(body);
            } catch {
                /* Keep malformed error bodies inspectable. */
            }
        }
        throw new FlowHttpError(response, data);
    }
    if (response.redirected) {
        throw new FlowHttpError(
            response,
            null,
            'Flow followed a redirect; handle navigation explicitly.',
        );
    }
    if (kind === 'json') {
        if (!json) {
            throw new FlowHttpError(response, null, 'Flow expected a JSON response.');
        }
        return response.json();
    }
    if (!/^text\/html(?:;|$)/i.test(type) || response.headers.get('X-Flow') !== 'fragment') {
        throw new FlowHttpError(
            response,
            null,
            'Flow expected an HTML fragment with X-Flow: fragment.',
        );
    }
    return response.text();
}

function requestInit(method, data, options, kind, signal) {
    const headers = new Headers(options.headers);
    headers.set('Accept', kind === 'html' ? 'text/html' : 'application/json');
    if (kind === 'html') {
        headers.set('X-Flow', 'fragment');
    }
    let body;
    if (data != null && method !== 'GET' && method !== 'HEAD') {
        if (data instanceof FormData) {
            body = data;
        } else {
            headers.set('Content-Type', 'application/json');
            body = JSON.stringify(data);
        }
    }
    return { method, headers, body, signal, credentials: 'same-origin' };
}

function ownRequest(owner, controller, signal) {
    if (owner && !owner.alive) {
        throw abortError();
    }
    owner?.controllers.add(controller);
    const abort = () => controller.abort();
    if (signal?.aborted) {
        abort();
    } else {
        signal?.addEventListener('abort', abort, { once: true });
    }
    return () => {
        owner?.controllers.delete(controller);
        signal?.removeEventListener('abort', abort);
    };
}

function wait(milliseconds, signal) {
    if (signal.aborted) {
        return Promise.reject(abortError());
    }
    return new Promise((resolve, reject) => {
        const abort = () => {
            clearTimeout(timer);
            reject(abortError());
        };
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', abort);
            resolve();
        }, milliseconds);
        signal.addEventListener('abort', abort, { once: true });
    });
}

function removeTree(node) {
    for (const record of [...active].reverse()) {
        if (node === record.root || node.contains(record.root)) {
            dispose(record);
        }
    }
    node.remove();
}

function nodeKey(node) {
    return node instanceof Element ? node.getAttribute('flow-key') || node.id || null : null;
}
function canReuse(node, desired) {
    return (
        node.nodeType === desired.nodeType &&
        (!(node instanceof Element) ||
            (node.tagName === desired.tagName &&
                node.getAttribute('flow') === desired.getAttribute('flow') &&
                nodeKey(node) === nodeKey(desired)))
    );
}

function morph(node, desired) {
    if (!(node instanceof Element)) {
        if (node.nodeValue !== desired.nodeValue) {
            node.nodeValue = desired.nodeValue;
        }
        return;
    }
    const input = node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement;
    const dirtyValue =
        input && (node === document.activeElement || node.value !== node.defaultValue)
            ? node.value
            : null;
    const dirtyChecked =
        node instanceof HTMLInputElement && node.checked !== node.defaultChecked
            ? node.checked
            : null;
    const selection =
        node instanceof HTMLSelectElement &&
        [...node.options].some((option) => option.selected !== option.defaultSelected)
            ? [...node.selectedOptions].map((option) => option.value)
            : null;
    for (const attribute of [...node.attributes]) {
        if (!desired.hasAttribute(attribute.name)) {
            node.removeAttribute(attribute.name);
        }
    }
    for (const attribute of [...desired.attributes]) {
        if (node.getAttribute(attribute.name) !== attribute.value) {
            node.setAttribute(attribute.name, attribute.value);
        }
    }
    patchChildren(node, desired);
    if (dirtyValue !== null && node.type !== 'file') {
        node.value = dirtyValue;
    }
    if (dirtyChecked !== null) {
        node.checked = dirtyChecked;
    }
    if (selection) {
        for (const option of node.options) {
            option.selected = selection.includes(option.value);
        }
    }
    const record = mounted.get(node);
    if (record) {
        refresh(record, 'fragment');
    }
}

function patchChildren(parent, desired) {
    const keyed = new Map(
        [...parent.childNodes].filter((node) => nodeKey(node)).map((node) => [nodeKey(node), node]),
    );
    const used = new Set();
    let cursor = parent.firstChild;
    for (const next of [...desired.childNodes]) {
        const candidate = nodeKey(next) ? keyed.get(nodeKey(next)) : cursor;
        let node;
        if (candidate && !used.has(candidate) && canReuse(candidate, next)) {
            node = candidate;
            if (node !== cursor) {
                parent.insertBefore(node, cursor);
            }
            morph(node, next);
        } else {
            node = next;
            parent.insertBefore(node, cursor);
        }
        used.add(node);
        cursor = node.nextSibling;
    }
    while (cursor) {
        const next = cursor.nextSibling;
        removeTree(cursor);
        cursor = next;
    }
}

function parseFragment(html) {
    if (/<(?:!doctype|html|head|body)(?:\s|>)/i.test(html)) {
        throw new TypeError('Flow cannot insert a full HTML document as a fragment.');
    }
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    function copy(node) {
        if (!(node instanceof Element)) {
            return document.importNode(node, false);
        }
        if (['SCRIPT', 'BASE', 'IFRAME', 'OBJECT', 'EMBED'].includes(node.tagName.toUpperCase())) {
            return null;
        }
        const element = document.createElementNS(node.namespaceURI, node.localName);
        for (const attribute of [...node.attributes]) {
            if (
                /^on/i.test(attribute.name) ||
                attribute.name === 'srcdoc' ||
                (['href', 'src', 'xlink:href', 'action', 'formaction'].includes(attribute.name) &&
                    /^(?:javascript|vbscript|data):/i.test(
                        attribute.value.replace(/[\u0000-\u0020]/g, ''),
                    ))
            ) {
                continue;
            }
            if (attribute.namespaceURI) {
                element.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
            } else {
                element.setAttribute(attribute.name, attribute.value);
            }
        }
        const source = node instanceof HTMLTemplateElement ? node.content : node;
        const target = element instanceof HTMLTemplateElement ? element.content : element;
        for (const child of [...source.childNodes]) {
            const copied = copy(child);
            if (copied) {
                target.append(copied);
            }
        }
        return element;
    }
    const result = document.createDocumentFragment();
    for (const child of [...parsed.body.childNodes]) {
        const copied = copy(child);
        if (copied) {
            result.append(copied);
        }
    }
    return result;
}

function createClient(owner) {
    async function jsonRequest(method, url, data, options = {}) {
        const controller = new AbortController();
        const release = ownRequest(owner, controller, options.signal);
        try {
            const response = await fetch(
                urlFor(url, options.query),
                requestInit(method, data, options, 'json', controller.signal),
            );
            const result = await decode(response, 'json');
            if (controller.signal.aborted || (owner && !owner.alive)) {
                throw abortError();
            }
            return result;
        } finally {
            release();
        }
    }
    return Object.freeze({
        get(url, options) {
            return jsonRequest('GET', url, null, options);
        },
        post(url, data, options) {
            return jsonRequest('POST', url, data, options);
        },
        async load(url, options = {}) {
            const target =
                typeof options.target === 'string'
                    ? owner?.context.refs[options.target]
                    : options.target;
            if (!(target instanceof Element) || (owner && !belongs(target, owner.root))) {
                throw new TypeError('Flow load requires a local flow-ref or target Element.');
            }
            const previous = loads.get(target);
            previous?.controller.abort();
            const slot = {
                controller: new AbortController(),
                busy: previous ? previous.busy : target.getAttribute('aria-busy'),
            };
            const release = ownRequest(owner, slot.controller, options.signal);
            loads.set(target, slot);
            target.setAttribute('aria-busy', 'true');
            try {
                if (options.debounce) {
                    await wait(options.debounce, slot.controller.signal);
                }
                const method = (options.method || 'GET').toUpperCase();
                if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
                    throw new TypeError('Unsupported Flow HTTP method.');
                }
                const response = await fetch(
                    urlFor(url, options.query),
                    requestInit(method, options.data, options, 'html', slot.controller.signal),
                );
                let html;
                if (
                    response.status === 422 &&
                    /^text\/html(?:;|$)/i.test(response.headers.get('Content-Type') || '') &&
                    response.headers.get('X-Flow') === 'fragment' &&
                    !response.redirected
                ) {
                    html = await response.text();
                } else {
                    html = await decode(response, 'html');
                }
                if (
                    loads.get(target) !== slot ||
                    slot.controller.signal.aborted ||
                    (owner && !owner.alive)
                ) {
                    throw abortError();
                }
                if (html !== null) {
                    patchChildren(target, parseFragment(html));
                    if (owner) {
                        refresh(owner, 'fragment');
                    }
                    scan(target);
                }
                if (response.status === 422) {
                    throw new FlowHttpError(response, html);
                }
                return response;
            } finally {
                release();
                if (loads.get(target) === slot) {
                    loads.delete(target);
                    if (slot.busy === null) {
                        target.removeAttribute('aria-busy');
                    } else {
                        target.setAttribute('aria-busy', slot.busy);
                    }
                }
            }
        },
    });
}

export const Flow = Object.freeze({
    register(name, factory) {
        if (!/^[a-z][a-z0-9-]*$/.test(name) || typeof factory !== 'function') {
            throw new TypeError('Flow.register requires a name and factory.');
        }
        if (factories.has(name)) {
            throw new TypeError(`Flow component "${name}" is already registered.`);
        }
        factories.set(name, factory);
        if (started) {
            scan(document);
        }
    },
    start,
    mount(root, instance) {
        return mount(root, instance);
    },
    store,
    client: createClient(null),
});

(() => {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => start(), { once: true });
    } else {
        start();
    }
})();
