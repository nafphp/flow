import { forbiddenProperties } from './properties.js';

const observations = new WeakMap();

/** Observe native root fields in place and nested plain objects through proxies. */
export function observe(object, isRoot = false) {
    if (!object || typeof object !== 'object') {
        return null;
    }
    if (observations.has(object)) {
        return observations.get(object);
    }
    if (!isRoot && !isPlainObject(object)) {
        return null;
    }

    const { observation, children, connectChild } = createObservation(object);
    // Register before visiting children, since object graphs may contain cycles.
    observations.set(object, observation);

    if (isRoot) {
        observeFields(object, observation, connectChild);
    } else {
        observeNestedObject(object, observation, children, connectChild);
    }
    return observation;
}

function isPlainObject(object) {
    return (
        Array.isArray(object) ||
        Object.getPrototypeOf(object) === Object.prototype ||
        Object.getPrototypeOf(object) === null
    );
}

function createObservation(object) {
    const listeners = new Set();
    const children = new Map();
    const observation = {
        value: object,
        ancestors: new Set(),
        listen(callback, ancestors = new Set()) {
            const isFirstListener = listeners.size === 0;
            listeners.add(callback);
            if (isFirstListener) {
                observation.ancestors = new Set([...ancestors, observation]);
                for (const [name, child] of children) {
                    attachChild(name, child);
                }
            }
            return () => {
                listeners.delete(callback);
                if (listeners.size === 0) {
                    for (const child of children.values()) {
                        child.disconnect?.();
                        child.disconnect = null;
                    }
                    observation.ancestors.clear();
                }
            };
        },
        emit(path, visited = new Set()) {
            if (visited.has(observation)) {
                return;
            }
            visited.add(observation);
            for (const listener of [...listeners]) {
                listener(path, new Set(visited));
            }
        },
    };

    function attachChild(name, child) {
        if (!child.disconnect && !observation.ancestors.has(child.observation)) {
            child.disconnect = child.observation.listen(
                (path, visited) => observation.emit(`${name}.${path}`, visited),
                observation.ancestors,
            );
        }
    }

    function connectChild(name, value) {
        // Replacing a field disconnects its previous child from this parent.
        children.get(name)?.disconnect?.();
        children.delete(name);
        const child = observe(value);
        if (!child) {
            return value;
        }
        const link = { observation: child, disconnect: null };
        children.set(name, link);
        if (listeners.size) {
            attachChild(name, link);
        }
        return child.value;
    }

    return { observation, children, connectChild };
}

function observeFields(object, observation, connectChild) {
    for (const name of Object.keys(object)) {
        const property = Object.getOwnPropertyDescriptor(object, name);
        if (
            forbiddenProperties.has(name) ||
            !property.configurable ||
            !property.writable ||
            !('value' in property) ||
            typeof property.value === 'function'
        ) {
            continue;
        }
        let value = connectChild(name, property.value);
        // Accessors preserve the actual class receiver, including private #fields.
        Object.defineProperty(object, name, {
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
                value = connectChild(name, next);
                observation.emit(name);
            },
        });
    }
}

function observeNestedObject(object, observation, children, connectChild) {
    observation.value = new Proxy(object, {
        set(target, name, value) {
            if (typeof name === 'symbol') {
                return Reflect.set(target, name, value);
            }
            if (forbiddenProperties.has(name)) {
                throw new TypeError(`Invalid Flow field "${name}".`);
            }
            const next = observe(value)?.value ?? value;
            if (Object.is(target[name], next)) {
                return true;
            }
            const changed = Reflect.set(target, name, next);
            if (changed) {
                connectChild(name, next);
                if (Array.isArray(target) && name === 'length') {
                    detachRemovedItems(children, target.length);
                }
                observation.emit(String(name));
            }
            return changed;
        },
        deleteProperty(target, name) {
            const exists = Object.hasOwn(target, name);
            const removed = Reflect.deleteProperty(target, name);
            if (removed && exists) {
                children.get(name)?.disconnect?.();
                children.delete(name);
                observation.emit(String(name));
            }
            return removed;
        },
    });
    observations.set(observation.value, observation);

    for (const name of Object.keys(object)) {
        const property = Object.getOwnPropertyDescriptor(object, name);
        if (!forbiddenProperties.has(name) && property?.writable && 'value' in property) {
            object[name] = connectChild(name, object[name]);
        }
    }
}

function detachRemovedItems(children, length) {
    for (const [name, child] of children) {
        if (/^\d+$/.test(name) && Number(name) >= length) {
            child.disconnect?.();
            children.delete(name);
        }
    }
}
