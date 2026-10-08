<?php

declare(strict_types=1);

namespace Naf\Flow;

use Psr\Http\Message\ResponseInterface;

use function Naf\request;
use function Naf\View\render;

/** The host chooses both templates; clients never supply a template path. */
function page(string $template, array $vars = [], ?string $fragment = null): ResponseInterface
{
    $isFragment = $fragment !== null && request()->getHeaderLine('X-Flow') === 'fragment';
    $selected   = $isFragment
        ? $fragment
        : $template;

    $response = render($selected, $vars)
        ->withHeader('Content-Type', 'text/html; charset=UTF-8')
        ->withHeader('Vary', 'X-Flow');

    return $isFragment ? $response->withHeader('X-Flow', 'fragment') : $response;
}
