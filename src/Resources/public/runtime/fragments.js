// Copy trusted server fragments into fresh nodes without executable markup.

export function parseFragment(html) {
    if (/<(?:!doctype|html|head|body)(?:\s|>)/i.test(html)) {
        throw new TypeError('Flow cannot insert a full HTML document as a fragment.');
    }
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const result = document.createDocumentFragment();
    for (const child of [...parsed.body.childNodes]) {
        const copied = copyFragmentNode(child);
        if (copied) {
            result.append(copied);
        }
    }
    return result;
}

function copyFragmentNode(node) {
    if (!(node instanceof Element)) {
        return document.importNode(node, false);
    }
    if (['SCRIPT', 'BASE', 'IFRAME', 'OBJECT', 'EMBED'].includes(node.tagName.toUpperCase())) {
        return null;
    }
    const element = document.createElementNS(node.namespaceURI, node.localName);
    for (const attribute of [...node.attributes]) {
        if (
            /^on/i.test(attribute.name) ||
            attribute.name === 'srcdoc' ||
            (['href', 'src', 'xlink:href', 'action', 'formaction'].includes(attribute.name) &&
                /^(?:javascript|vbscript|data):/i.test(
                    attribute.value.replace(/[\u0000-\u0020]/g, ''),
                ))
        ) {
            continue;
        }
        if (attribute.namespaceURI) {
            element.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
        } else {
            element.setAttribute(attribute.name, attribute.value);
        }
    }
    const source = node instanceof HTMLTemplateElement ? node.content : node;
    const target = element instanceof HTMLTemplateElement ? element.content : element;
    for (const child of [...source.childNodes]) {
        const copied = copyFragmentNode(child);
        if (copied) {
            target.append(copied);
        }
    }
    return element;
}
