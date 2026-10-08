<?php

declare(strict_types=1);

use Composer\InstalledVersions;
use Naf\Flow\Http\RuntimeController;
use Nyholm\Psr7\ServerRequest;
use Psr\Http\Message\RequestInterface;

use function Naf\app;
use function Naf\route;
use function Naf\View\asset;

define('BASE_PATH', __DIR__ . '/Fixtures');
require $argv[1] ?? dirname(__DIR__) . '/vendor/autoload.php';

function check(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$application = app();
check($application->hasPlugin('naf/flow'), 'Composer did not discover naf/flow.');
check($application->getPlugin('naf/flow')->isBooted(), 'Flow did not boot.');
check(array_search('naf/view', array_keys($application->getPluginBootPlan()), true)
    < array_search('naf/flow', array_keys($application->getPluginBootPlan()), true), 'View did not boot before Flow.');
check(in_array('/_flow/flow.js', asset()->list('js', 'module'), true), 'The runtime asset was not registered.');
check(route('flow.runtime') === '/_flow/flow.js', 'The public runtime route is missing.');
check(function_exists('Naf\\Flow\\page'), 'The Flow page helper was not loaded.');

$application->container()->set(RequestInterface::class, new ServerRequest('GET', '/_flow/flow.js'));
$runtime = (new RuntimeController())->show();
check($runtime->getStatusCode() === 200, 'The installed runtime could not be served.');
$minifiedPath = InstalledVersions::getInstallPath('naf/flow') . '/src/Resources/public/flow.min.js';
check((string) $runtime->getBody() === file_get_contents($minifiedPath), 'The shipped minified runtime was not served.');

echo 'Installed host discovery, boot order, assets, routes and helper passed: '
    . InstalledVersions::getInstallPath('naf/flow') . PHP_EOL;
