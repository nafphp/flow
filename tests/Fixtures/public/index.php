<?php

declare(strict_types=1);

use Naf\Core\Event;
use Psr\Http\Message\ResponseInterface;

use function Naf\app;
use function Naf\event;
use function Naf\View\asset;

if (PHP_SAPI === 'cli-server' && parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) === '/app.js') {
    return false;
}

define('BASE_PATH', dirname(__DIR__));
require getenv('FLOW_TEST_AUTOLOAD') ?: dirname(__DIR__, 3) . '/vendor/autoload.php';

event()->listen(Event::RESPONSE_HEADER, static fn(ResponseInterface $response): ResponseInterface => $response->withHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'",
));
asset()->add('/app.js', 'module');
app()->run();
