import { observe } from './reactivity.js';

// Stores and components share the same observation registry.
const stores = new Map();

export function store(name, value) {
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
