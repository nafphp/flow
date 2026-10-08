<?php

declare(strict_types=1);

use Naf\Flow\Http\RuntimeController;

use function Naf\route;

route()->add('GET', '/_flow/flow.js', [RuntimeController::class, 'show'], 'flow.runtime');
