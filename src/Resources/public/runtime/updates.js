import { render } from './bindings.js';
import { report } from './errors.js';
import { parsePath } from './properties.js';

// Batch synchronous writes while allowing later updates during async lifecycle hooks.

export function queueUpdate(component, path = null, reason = 'state') {
    if (!component.alive) {
        return;
    }
    if (path) {
        component.pending.add(path);
    }
    if (reason !== 'state') {
        component.reason = reason;
    }
    if (!component.ready || component.queued || component.updating) {
        return;
    }
    component.queued = true;
    queueMicrotask(() => flushUpdates(component));
}

function flushUpdates(component) {
    component.queued = false;
    if (!component.alive || component.updating) {
        return;
    }
    component.updating = true;
    const paths = [...component.pending];
    const reason = component.reason;
    component.pending.clear();
    component.reason = 'state';
    const changes = describeChanges(paths, reason);
    resetCycleCountAfterTick(component);
    try {
        if (++component.cycles > 100) {
            throw new Error('Flow update loop: more than 100 consecutive updates.');
        }
        render(component);
        if (typeof component.instance.update === 'function') {
            Promise.resolve(component.instance.update(changes, component.context)).catch((error) =>
                report(error, component, 'update'),
            );
        }
    } catch (error) {
        report(error, component, 'update');
        if (component.cycles > 100) {
            component.dispose();
        }
    } finally {
        component.updating = false;
        if (component.pending.size || component.reason !== 'state') {
            queueUpdate(component);
        }
    }
}

function describeChanges(paths, reason) {
    return Object.freeze({
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
}

function resetCycleCountAfterTick(component) {
    if (!component.resetTimer) {
        component.resetTimer = setTimeout(() => {
            component.cycles = 0;
            component.resetTimer = null;
        }, 0);
    }
}
