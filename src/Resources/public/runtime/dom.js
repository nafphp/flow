/** A nested Flow root owns its directives, even while it waits for registration. */
export function belongsToComponent(element, root) {
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

export function componentElements(root) {
    return [root, ...root.querySelectorAll('*')].filter((element) =>
        belongsToComponent(element, root),
    );
}

/** Reconcile children in place. The runtime owns component refresh and disposal. */
export function patchChildren(parent, desired, lifecycle) {
    const keyedNodes = new Map(
        [...parent.childNodes].filter((node) => nodeKey(node)).map((node) => [nodeKey(node), node]),
    );
    const usedNodes = new Set();
    let cursor = parent.firstChild;

    for (const next of [...desired.childNodes]) {
        const key = nodeKey(next);
        const candidate = key ? keyedNodes.get(key) : cursor;
        let node;

        if (candidate && !usedNodes.has(candidate) && canReuse(candidate, next)) {
            node = candidate;
            if (node !== cursor) {
                parent.insertBefore(node, cursor);
            }
            morph(node, next, lifecycle);
        } else {
            node = next;
            parent.insertBefore(node, cursor);
        }

        usedNodes.add(node);
        cursor = node.nextSibling;
    }

    while (cursor) {
        const next = cursor.nextSibling;
        lifecycle.removeNode(cursor);
        cursor = next;
    }
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

function morph(node, desired, lifecycle) {
    if (!(node instanceof Element)) {
        if (node.nodeValue !== desired.nodeValue) {
            node.nodeValue = desired.nodeValue;
        }
        return;
    }

    // Attribute changes must not overwrite drafts or the focused input's value.
    const inputState = captureInputState(node);
    updateAttributes(node, desired);
    patchChildren(node, desired, lifecycle);
    restoreInputState(node, inputState);
    lifecycle.refreshNode(node);
}

function updateAttributes(node, desired) {
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
}

function captureInputState(node) {
    const isInput = node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement;
    const value =
        isInput && (node === document.activeElement || node.value !== node.defaultValue)
            ? node.value
            : null;
    const checked =
        node instanceof HTMLInputElement && node.checked !== node.defaultChecked
            ? node.checked
            : null;
    const selection =
        node instanceof HTMLSelectElement &&
        [...node.options].some((option) => option.selected !== option.defaultSelected)
            ? [...node.selectedOptions].map((option) => option.value)
            : null;

    return { value, checked, selection };
}

function restoreInputState(node, { value, checked, selection }) {
    if (value !== null && node.type !== 'file') {
        node.value = value;
    }
    if (checked !== null) {
        node.checked = checked;
    }
    if (selection) {
        for (const option of node.options) {
            option.selected = selection.includes(option.value);
        }
    }
}
