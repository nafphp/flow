<?php

declare(strict_types=1);

namespace Naf\Flow\Http;

use Psr\Http\Message\ResponseInterface;
use RuntimeException;

use function Naf\request;
use function Naf\response;

final class RuntimeController
{
    public function show(): ResponseInterface
    {
        $contents = file_get_contents(dirname(__DIR__) . '/Resources/public/flow.min.js');
        if ($contents === false) {
            throw new RuntimeException('The NAF Flow runtime is missing.');
        }

        $etag    = '"' . hash('sha256', $contents) . '"';
        $headers = [
            'Content-Type'           => 'text/javascript; charset=UTF-8',
            'Cache-Control'          => 'public, max-age=0, must-revalidate',
            'ETag'                   => $etag,
            'X-Content-Type-Options' => 'nosniff',
        ];

        foreach (explode(',', request()->getHeaderLine('If-None-Match')) as $candidate) {
            $candidate = trim($candidate);
            if ($candidate === '*' || preg_replace('/^W\//', '', $candidate) === $etag) {
                return response('', 304, $headers);
            }
        }

        return response($contents, 200, $headers);
    }
}
