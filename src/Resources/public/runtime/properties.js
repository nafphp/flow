// Property paths and actions are names, never executable expressions.
export const forbiddenProperties = new Set(['__proto__', 'prototype', 'constructor']);
const lifecycleHooks = new Set(['init', 'mount', 'update', 'unmount']);

export function parsePath(path) {
    if (!/^[A-Za-z_$][\w$]*(?:\.(?:[A-Za-z_$][\w$]*|\d+))*$/.test(path)) {
        throw new TypeError(`Flow expects a property path, received "${path}".`);
    }
    const parts = path.split('.');
    if (parts.some((part) => forbiddenProperties.has(part))) {
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

export function readPath(object, parts) {
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

export function writePath(object, parts, value) {
    const parent = parts.length === 1 ? object : readPath(object, parts.slice(0, -1));
    const key = parts.at(-1);
    const property = parent && findProperty(parent, key);
    if (!property || (!property.writable && !property.set)) {
        throw new TypeError(`Flow model "${parts.join('.')}" is not writable.`);
    }
    parent[key] = value;
}

export function resolveAction(instance, name) {
    if (
        !/^[A-Za-z_$][\w$]*$/.test(name) ||
        forbiddenProperties.has(name) ||
        lifecycleHooks.has(name)
    ) {
        throw new TypeError(`Invalid Flow action "${name}".`);
    }
    const property = findProperty(instance, name);
    if (!property || typeof property.value !== 'function') {
        throw new TypeError(`Unknown Flow action "${name}".`);
    }
    return property.value;
}

export function propsFrom(root) {
    const props = JSON.parse(root.getAttribute('flow-props') || '{}');
    if (!props || Array.isArray(props) || typeof props !== 'object') {
        throw new TypeError('flow-props must be a JSON object.');
    }
    function freeze(value) {
        if (value && typeof value === 'object') {
            for (const key of Object.keys(value)) {
                if (forbiddenProperties.has(key)) {
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
