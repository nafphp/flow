/*! NAF Flow — MIT License. Native ES module; no application build step. */
import { ComponentRuntime } from './runtime/components.js';
import { store } from './runtime/stores.js';

export { FlowHttpError } from './runtime/errors.js';

const components = new ComponentRuntime();

export const Flow = Object.freeze({
    register(name, factory) {
        components.register(name, factory);
    },
    start(scope = document) {
        components.start(scope);
    },
    mount(root, instance) {
        return components.mount(root, instance);
    },
    store,
    client: components.createClient(),
});

function startWhenReady() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => Flow.start(), { once: true });
    } else {
        Flow.start();
    }
}

startWhenReady();
