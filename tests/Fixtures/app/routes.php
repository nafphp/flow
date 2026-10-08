<?php

declare(strict_types=1);

use Psr\Http\Message\ResponseInterface;

use function Naf\abort;
use function Naf\Flow\page;
use function Naf\Form\csrf;
use function Naf\json;
use function Naf\param;
use function Naf\redirect;
use function Naf\response;
use function Naf\route;
use function Naf\View\render;

route()->add('GET', '/', static fn(): ResponseInterface => render('index'), 'test.home');
route()->add('GET', '/fragment', static function (): ResponseInterface {
    $query = param()->get('q', '');
    if (!is_string($query)) {
        abort(400, 'Query must be text.');
    }

    return page('index', ['query' => $query], fragment: 'fragment');
}, 'test.fragment');
route()->add('GET', '/token', static fn(): ResponseInterface => json(['token' => csrf()->generate()]), 'test.token');
route()->add('POST', '/echo', static fn(): ResponseInterface => json(param()->all()), 'test.echo');
route()->add('GET', '/status/{code}', static fn(string $code): ResponseInterface => json(['error' => 'test'], (int) $code), 'test.status');
route()->add('GET', '/redirect', static fn(): ResponseInterface => redirect('/', 303), 'test.redirect');
route()->add('GET', '/document', static fn(): ResponseInterface => response('<!doctype html><html><body>Full page</body></html>', 200, [
    'Content-Type' => 'text/html',
]), 'test.document');
route()->add('POST', '/validation', static fn(): ResponseInterface => response('<p id="validation-error">Invalid input</p>', 422, [
    'Content-Type' => 'text/html', 'X-Flow' => 'fragment',
]), 'test.validation');
route()->add('GET', '/empty', static fn(): ResponseInterface => response('', 204), 'test.empty');
