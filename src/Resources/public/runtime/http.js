import { FlowHttpError, abortError } from './errors.js';

// Same-origin requests, response decoding and cancellation ownership.

export function urlFor(url, query = {}) {
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

export async function decode(response, kind) {
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

export function requestInit(method, data, options, kind, signal) {
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

export function ownRequest(owner, controller, signal) {
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

export function wait(milliseconds, signal) {
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
