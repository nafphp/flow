import { belongsToComponent } from './dom.js';
import { FlowHttpError, abortError } from './errors.js';
import { urlFor, decode, requestInit, ownRequest, wait } from './http.js';

// All clients share a target registry so the latest HTML load wins across owners.
const loads = new WeakMap();

/** The caller owns fragment application; the client owns HTTP and cancellation. */
export function createClient(owner, applyFragment) {
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

    async function load(url, options = {}) {
        // A disposed client must not cancel another owner's current target request.
        if (owner && !owner.alive) {
            throw abortError();
        }
        const target = resolveTarget(owner, options.target);
        const previous = loads.get(target);
        previous?.controller.abort();

        const request = {
            controller: new AbortController(),
            busy: previous ? previous.busy : target.getAttribute('aria-busy'),
        };
        const release = ownRequest(owner, request.controller, options.signal);
        loads.set(target, request);
        target.setAttribute('aria-busy', 'true');

        try {
            if (options.debounce) {
                await wait(options.debounce, request.controller.signal);
            }
            const response = await fetchFragment(url, options, request.controller.signal);
            const html = await decodeFragment(response);

            // A superseded request may finish even when its transport ignores abort.
            if (
                loads.get(target) !== request ||
                request.controller.signal.aborted ||
                (owner && !owner.alive)
            ) {
                throw abortError();
            }
            if (html !== null) {
                applyFragment(target, html);
            }
            if (response.status === 422) {
                throw new FlowHttpError(response, html);
            }
            return response;
        } finally {
            release();
            restoreBusyState(target, request);
        }
    }

    return Object.freeze({
        get(url, options) {
            return jsonRequest('GET', url, null, options);
        },
        post(url, data, options) {
            return jsonRequest('POST', url, data, options);
        },
        load,
    });
}

function resolveTarget(owner, target) {
    const element = typeof target === 'string' ? owner?.context.refs[target] : target;
    if (!(element instanceof Element) || (owner && !belongsToComponent(element, owner.root))) {
        throw new TypeError('Flow load requires a local flow-ref or target Element.');
    }
    return element;
}

function fetchFragment(url, options, signal) {
    const method = (options.method || 'GET').toUpperCase();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        throw new TypeError('Unsupported Flow HTTP method.');
    }
    return fetch(
        urlFor(url, options.query),
        requestInit(method, options.data, options, 'html', signal),
    );
}

function decodeFragment(response) {
    // Validation fragments are rendered before their HTTP error reaches the caller.
    const isValidationFragment =
        response.status === 422 &&
        /^text\/html(?:;|$)/i.test(response.headers.get('Content-Type') || '') &&
        response.headers.get('X-Flow') === 'fragment' &&
        !response.redirected;

    return isValidationFragment ? response.text() : decode(response, 'html');
}

function restoreBusyState(target, request) {
    if (loads.get(target) !== request) {
        return;
    }
    loads.delete(target);
    if (request.busy === null) {
        target.removeAttribute('aria-busy');
    } else {
        target.setAttribute('aria-busy', request.busy);
    }
}
