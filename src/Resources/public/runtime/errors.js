// Expected cancellations are silent; other failures reach the owning container.

export class FlowHttpError extends Error {
    constructor(response, data, message = `Flow request failed (${response.status}).`) {
        super(message);
        this.name = 'FlowHttpError';
        this.status = response.status;
        this.data = data;
        this.response = response;
    }
}

export function abortError() {
    return new DOMException('Flow request was cancelled.', 'AbortError');
}

export function report(error, record, phase) {
    if (error?.name === 'AbortError') {
        return;
    }
    const target = record?.root ?? document;
    const handled = !target.dispatchEvent(
        new CustomEvent('flow:error', {
            bubbles: true,
            cancelable: true,
            detail: { error, root: record?.root ?? null, phase },
        }),
    );
    if (!handled) {
        console.error(`[NAF Flow: ${phase}]`, error);
    }
}
