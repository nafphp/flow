import { bind, collectInitialRefs } from './bindings.js';
import { createClient } from './client.js';
import { patchChildren } from './dom.js';
import { report } from './errors.js';
import { parseFragment } from './fragments.js';
import { propsFrom } from './properties.js';
import { observe } from './reactivity.js';
import { store } from './stores.js';
import { queueUpdate } from './updates.js';

/** Own registrations, mounted instances and the document's component lifecycle. */
export class ComponentRuntime {
    #factories = new Map();
    #mounted = new WeakMap();
    #owners = new WeakMap();
    #active = new Set();
    #started = false;

    // DOM code receives lifecycle callbacks without depending on the registry.
    #domLifecycle = {
        removeNode: (node) => this.#removeTree(node),
        refreshNode: (node) => {
            const component = this.#mounted.get(node);
            if (component) {
                this.#refresh(component, 'fragment');
            }
        },
    };

    register(name, factory) {
        if (!/^[a-z][a-z0-9-]*$/.test(name) || typeof factory !== 'function') {
            throw new TypeError('Flow.register requires a name and factory.');
        }
        if (this.#factories.has(name)) {
            throw new TypeError(`Flow component "${name}" is already registered.`);
        }
        this.#factories.set(name, factory);
        if (this.#started) {
            this.#scan(document);
        }
    }

    start(scope = document) {
        if (!this.#started) {
            this.#started = true;
            const observer = new MutationObserver((mutations) => this.#handleMutations(mutations));
            observer.observe(document.documentElement, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['flow', 'flow-props'],
            });
        }
        this.#scan(scope);
    }

    mount(root, instanceOrFactory, isFactory = false) {
        if (!(root instanceof Element)) {
            throw new TypeError('Flow.mount requires an Element.');
        }
        const existing = this.#mounted.get(root);
        if (existing) {
            if (!isFactory && existing.instance !== instanceOrFactory) {
                throw new TypeError(
                    'This Flow container is already mounted; dispose its binding first.',
                );
            }
            return existing.dispose;
        }

        const component = createBinding(root);
        this.#prepareContext(component);
        component.dispose = () => this.#dispose(component);
        this.#mounted.set(root, component);
        this.#active.add(component);

        try {
            const { props } = component.context;
            const instance = isFactory
                ? instanceOrFactory(props, component.context)
                : instanceOrFactory;
            component.instance = instance;
            this.#claimInstance(component);

            const observation = observe(instance, true);
            component.cleanup.push(observation.listen((path) => queueUpdate(component, path)));
            this.#initialize(component);
        } catch (error) {
            this.#dispose(component);
            throw error;
        }

        return component.dispose;
    }

    createClient(owner = null) {
        return createClient(owner, (target, html) => this.#applyFragment(target, html, owner));
    }

    #prepareContext(component) {
        let props = propsFrom(component.root);
        component.setProps = () => {
            props = propsFrom(component.root);
        };
        component.context = Object.freeze({
            root: component.root,
            refs: Object.create(null),
            get props() {
                return props;
            },
            client: this.createClient(component),
            store,
            onCleanup(callback) {
                if (typeof callback !== 'function') {
                    throw new TypeError('onCleanup requires a function.');
                }
                if (component.alive) {
                    component.cleanup.push(callback);
                } else {
                    callback();
                }
            },
        });
    }

    #claimInstance(component) {
        const { instance, root } = component;
        if (!instance || typeof instance !== 'object' || typeof instance.then === 'function') {
            throw new TypeError('A Flow factory must synchronously return an object.');
        }
        if (this.#owners.has(instance)) {
            throw new TypeError(
                'A Flow instance belongs to one container; use a store for shared state.',
            );
        }
        this.#owners.set(instance, root);
    }

    async #initialize(component) {
        try {
            collectInitialRefs(component);
            if (typeof component.instance.init === 'function') {
                await component.instance.init(component.context);
            }
            if (!component.alive) {
                return;
            }

            // Writes during init belong to the first render, rather than an update hook.
            component.pending.clear();
            component.reason = 'state';
            bind(component, this.#domLifecycle.removeNode);

            if (typeof component.instance.mount === 'function') {
                await component.instance.mount(component.context);
            }
            if (!component.alive) {
                return;
            }

            component.ready = true;
            if (component.pending.size || component.reason !== 'state') {
                queueUpdate(component);
            }
        } catch (error) {
            report(error, component, 'mount');
            this.#dispose(component);
        }
    }

    #dispose(component) {
        if (!component.alive) {
            return;
        }
        component.alive = false;
        this.#active.delete(component);
        this.#mounted.delete(component.root);

        const ownsInstance =
            component.instance && this.#owners.get(component.instance) === component.root;
        if (ownsInstance) {
            this.#owners.delete(component.instance);
        }
        const cleanups = [...component.bindCleanup.splice(0), ...component.cleanup.splice(0)];
        for (const controller of component.controllers) {
            controller.abort();
        }
        if (component.resetTimer) {
            clearTimeout(component.resetTimer);
        }

        // Flow-controlled removal invokes unmount while the DOM is still connected.
        try {
            if (ownsInstance && typeof component.instance.unmount === 'function') {
                Promise.resolve(component.instance.unmount(component.context)).catch((error) =>
                    report(error, component, 'unmount'),
                );
            }
        } catch (error) {
            report(error, component, 'unmount');
        }

        for (const cleanup of cleanups) {
            try {
                cleanup();
            } catch (error) {
                report(error, component, 'cleanup');
            }
        }
    }

    #scan(scope) {
        const roots = [
            ...(scope instanceof Element && scope.hasAttribute('flow') ? [scope] : []),
            ...scope.querySelectorAll('[flow]'),
        ];
        for (const root of roots) {
            if (!root.isConnected || this.#mounted.has(root)) {
                continue;
            }
            const factory = this.#factories.get(root.getAttribute('flow'));
            if (factory) {
                try {
                    this.mount(root, factory, true);
                } catch (error) {
                    report(error, { root }, 'mount');
                }
            }
        }
    }

    #refresh(component, reason = null) {
        if (!component.alive || !component.ready) {
            return;
        }
        try {
            component.setProps();
            bind(component, this.#domLifecycle.removeNode);
            if (reason) {
                queueUpdate(component, null, reason);
            }
        } catch (error) {
            report(error, component, 'binding');
            this.#dispose(component);
        }
    }

    #handleMutations(mutations) {
        this.#refreshChangedComponents(mutations);
        for (const mutation of mutations) {
            if (mutation.type === 'attributes') {
                this.#scan(mutation.target);
            }
            for (const node of mutation.addedNodes) {
                if (node instanceof Element) {
                    this.#scan(node);
                }
            }
        }
    }

    #refreshChangedComponents(mutations) {
        for (const component of [...this.#active]) {
            if (!component.root.isConnected) {
                this.#dispose(component);
                continue;
            }
            if (!mutations.some((mutation) => component.root.contains(mutation.target))) {
                continue;
            }
            const propsChanged = hasAttributeChange(mutations, component.root, 'flow-props');
            const nameChanged = hasAttributeChange(mutations, component.root, 'flow');
            if (nameChanged) {
                this.#dispose(component);
            } else {
                this.#refresh(component, propsChanged ? 'props' : null);
            }
        }
    }

    #applyFragment(target, html, owner) {
        patchChildren(target, parseFragment(html), this.#domLifecycle);
        if (owner) {
            this.#refresh(owner, 'fragment');
        }
        this.#scan(target);
    }

    #removeTree(node) {
        for (const component of [...this.#active].reverse()) {
            if (node === component.root || node.contains(component.root)) {
                this.#dispose(component);
            }
        }
        node.remove();
    }
}

function hasAttributeChange(mutations, root, attribute) {
    return mutations.some(
        (mutation) => mutation.target === root && mutation.attributeName === attribute,
    );
}

function createBinding(root) {
    return {
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
}
