import { componentElements } from './dom.js';
import { report } from './errors.js';
import {
    forbiddenProperties,
    parsePath,
    readPath,
    writePath,
    resolveAction,
} from './properties.js';

const boundProperties = {
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

/** Discover refs before init; the regular binding pass validates them afterwards. */
export function collectInitialRefs(component) {
    for (const element of componentElements(component.root)) {
        const name = element.getAttribute('flow-ref');
        if (name && !forbiddenProperties.has(name)) {
            component.context.refs[name] = element;
        }
    }
}

/** Rebuild only this container's bindings, leaving nested components to their owners. */
export function bind(component, removeNode) {
    clearBindings(component);

    for (const element of componentElements(component.root)) {
        for (const { name, value } of [...element.attributes]) {
            if (name === 'flow-ref') {
                registerRef(component, element, value);
            } else if (name.startsWith('flow-on:')) {
                bindAction(component, element, name.slice(8), value);
            } else if (isValueBinding(name)) {
                const path = parsePath(value);
                const apply = createRenderer(component, element, name, path, removeNode);
                component.bindings.push(() => apply(readPath(component.instance, path)));
            }
        }
    }

    render(component);
}

export function render(component) {
    for (const binding of component.bindings) {
        binding();
    }
}

function clearBindings(component) {
    for (const cleanup of component.bindCleanup.splice(0)) {
        cleanup();
    }
    component.bindings = [];

    for (const name of Object.keys(component.context.refs)) {
        delete component.context.refs[name];
    }
}

function registerRef(component, element, name) {
    if (!/^[A-Za-z_$][\w$]*$/.test(name) || forbiddenProperties.has(name)) {
        throw new TypeError('Invalid flow-ref.');
    }
    if (component.context.refs[name]) {
        throw new TypeError(`Duplicate flow-ref "${name}".`);
    }
    component.context.refs[name] = element;
}

function listen(component, element, event, callback) {
    element.addEventListener(event, callback);
    component.bindCleanup.push(() => element.removeEventListener(event, callback));
}

function bindAction(component, element, event, name) {
    if (!/^[a-z][\w:-]*$/.test(event)) {
        throw new TypeError(`Invalid Flow event "${event}".`);
    }
    const action = resolveAction(component.instance, name);

    listen(component, element, event, (domEvent) => {
        try {
            const result = action.call(component.instance, domEvent, component.context);
            Promise.resolve(result).catch((error) => report(error, component, 'action'));
        } catch (error) {
            report(error, component, 'action');
        }
    });
}

function isValueBinding(name) {
    return (
        ['flow-text', 'flow-show', 'flow-model'].includes(name) ||
        name.startsWith('flow-class:') ||
        name.startsWith('flow-bind:')
    );
}

function createRenderer(component, element, name, path, removeNode) {
    switch (name) {
        case 'flow-text':
            return (value) => renderText(element, value, removeNode);
        case 'flow-show':
            return (value) => {
                element.hidden = !value;
            };
        case 'flow-model':
            bindModel(component, element, path);
            return (value) => renderModel(element, value);
    }

    if (name.startsWith('flow-class:')) {
        const className = name.slice(11);
        if (!className || /\s/.test(className)) {
            throw new TypeError('Invalid Flow class name.');
        }
        return (value) => element.classList.toggle(className, Boolean(value));
    }

    return attributeRenderer(element, name.slice(10));
}

function attributeRenderer(element, attribute) {
    if (Object.hasOwn(boundProperties, attribute)) {
        return (value) => {
            element[boundProperties[attribute]] =
                attribute === 'value' ? (value ?? '') : Boolean(value);
        };
    }
    if (/^aria-[a-z-]+$/.test(attribute) || ['title', 'role', 'tabindex'].includes(attribute)) {
        return (value) => {
            if (value == null) {
                element.removeAttribute(attribute);
            } else {
                element.setAttribute(attribute, String(value));
            }
        };
    }
    throw new TypeError(`Unsupported Flow attribute "${attribute}".`);
}

function bindModel(component, element, path) {
    if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || element.type === 'file') {
        throw new TypeError(
            'flow-model requires an input, textarea or select, excluding file inputs.',
        );
    }
    const event =
        element.tagName === 'SELECT' || ['checkbox', 'radio'].includes(element.type)
            ? 'change'
            : 'input';

    listen(component, element, event, () => {
        if (element.type === 'radio' && !element.checked) {
            return;
        }
        try {
            writePath(component.instance, path, modelValue(element));
        } catch (error) {
            report(error, component, 'model');
        }
    });
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

function renderText(element, value, removeNode) {
    const text = value == null ? '' : String(value);
    if (element.textContent === text) {
        return;
    }
    if (element.childNodes.length === 1 && element.firstChild.nodeType === Node.TEXT_NODE) {
        element.firstChild.data = text;
        return;
    }

    for (const child of [...element.childNodes]) {
        removeNode(child);
    }
    element.textContent = text;
}
