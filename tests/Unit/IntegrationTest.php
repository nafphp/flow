<?php

declare(strict_types=1);

namespace Tests\Unit;

use Naf\Flow\Http\RuntimeController;
use Nyholm\Psr7\ServerRequest;
use PHPUnit\Framework\TestCase;
use Psr\Http\Message\RequestInterface;

use function Naf\app;
use function Naf\route;
use function Naf\View\asset;

final class IntegrationTest extends TestCase
{
    protected function setUp(): void
    {
        app()->container()->set(RequestInterface::class, new ServerRequest('GET', '/_flow/flow.js'));
    }

    public function testComposerDiscoveryBootOrderAndAutomaticAsset(): void
    {
        self::assertTrue(app()->hasPlugin('naf/flow'));
        self::assertTrue(app()->getPlugin('naf/view')->isBooted());
        self::assertArrayHasKey('naf/view', app()->getPluginBootPlan()['naf/flow']['after']);
        self::assertContains('/_flow/flow.js', asset()->list('js', 'module'));
        self::assertSame('/_flow/flow.js', route('flow.runtime'));
    }

    public function testRuntimeHasModuleMimeAndCacheValidation(): void
    {
        $response = (new RuntimeController())->show();

        self::assertSame(200, $response->getStatusCode());
        self::assertSame('text/javascript; charset=UTF-8', $response->getHeaderLine('Content-Type'));
        self::assertSame('nosniff', $response->getHeaderLine('X-Content-Type-Options'));
        self::assertSame('public, max-age=0, must-revalidate', $response->getHeaderLine('Cache-Control'));
        self::assertStringContainsString('export const Flow', (string) $response->getBody());
        self::assertSame('"' . hash('sha256', (string) $response->getBody()) . '"', $response->getHeaderLine('ETag'));
    }

    public function testWeakAndListedEtagsReturnAnEmptyNotModifiedResponse(): void
    {
        $etag = (new RuntimeController())->show()->getHeaderLine('ETag');
        app()->container()->set(RequestInterface::class, new ServerRequest('GET', '/_flow/flow.js', [
            'If-None-Match' => '"another", W/' . $etag,
        ]));

        $response = (new RuntimeController())->show();

        self::assertSame(304, $response->getStatusCode());
        self::assertSame('', (string) $response->getBody());
        self::assertSame($etag, $response->getHeaderLine('ETag'));
    }

    public function testChangedEtagReturnsRuntimeAndRegistrationEmitsNothing(): void
    {
        app()->container()->set(RequestInterface::class, new ServerRequest('GET', '/_flow/flow.js', ['If-None-Match' => '"old"']));
        self::assertSame(200, (new RuntimeController())->show()->getStatusCode());
        ob_start();
        require dirname(__DIR__, 2) . '/bootstrap.php';
        $output = ob_get_clean();

        self::assertSame('', $output);
        self::assertSame(1, count(array_filter(asset()->list('js', 'module'), static fn($path) => $path === '/_flow/flow.js')));
    }
}
