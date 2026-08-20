#!/usr/bin/env node

const DEFAULT_TARGET_URL = 'http://127.0.0.1:5173';
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_ENTRY_MARKER = '/src/main.ts';

function elapsedMilliseconds(startedAt) {
  return Math.max(0, Date.now() - startedAt);
}

function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }
  return {
    name: 'UnknownError',
    message: String(error),
  };
}

function makeCheck(id, ok, details = {}) {
  return {
    id,
    ok: Boolean(ok),
    ...details,
  };
}

function parseTargetUrl(value) {
  try {
    return new URL(value).toString();
  } catch (error) {
    throw new TypeError(`Invalid target URL: ${String(value)} (${serializeError(error).message})`);
  }
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * Fetch the dev document and verify the minimum boot contract without a browser.
 *
 * This intentionally checks only the HTTP/document boundary. Canvas, WebGL,
 * input, resize, and console behavior are covered by browser-smoke.mjs and the
 * coordinator's In-app Browser run.
 */
export async function runHttpSmoke(
  targetUrl = DEFAULT_TARGET_URL,
  {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    expectedEntry = DEFAULT_ENTRY_MARKER,
  } = {},
) {
  const startedAt = Date.now();
  let url;
  try {
    url = parseTargetUrl(targetUrl);
  } catch (error) {
    return {
      schemaVersion: 1,
      ok: false,
      url: String(targetUrl),
      durationMs: elapsedMilliseconds(startedAt),
      checks: [makeCheck('target-url', false, { error: serializeError(error) })],
      error: serializeError(error),
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  let response;
  let body = '';

  try {
    response = await fetch(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'manual',
      signal: controller.signal,
    });
    body = await response.text();
  } catch (error) {
    const serialized = serializeError(error);
    return {
      schemaVersion: 1,
      ok: false,
      url,
      durationMs: elapsedMilliseconds(startedAt),
      checks: [
        makeCheck('reachable', false, {
          error: serialized,
          timeoutMs,
        }),
      ],
      error: serialized,
    };
  } finally {
    clearTimeout(timeout);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const hasHtmlDocument = /<html\b/i.test(body);
  const hasAppMount = /\bid\s*=\s*["']app["']/i.test(body);
  const hasModuleScript = /<script\b[^>]*\btype\s*=\s*["']module["']/i.test(body);
  const hasExpectedEntry = expectedEntry
    ? body.includes(expectedEntry)
    : hasModuleScript;
  const checks = [
    makeCheck('http-status', response.status >= 200 && response.status < 300, {
      expected: '2xx',
      actual: response.status,
      statusText: response.statusText,
    }),
    makeCheck('html-content-type', /^text\/html(?:\s*;|$)/i.test(contentType), {
      expected: 'text/html',
      actual: contentType || null,
    }),
    makeCheck('html-document', hasHtmlDocument, {
      expected: '<html> document element',
    }),
    makeCheck('app-mount', hasAppMount, {
      expected: '#app mount point',
    }),
    makeCheck('module-entry', hasModuleScript && hasExpectedEntry, {
      expected: expectedEntry || 'module script',
      hasModuleScript,
      hasExpectedEntry,
    }),
  ];

  return {
    schemaVersion: 1,
    ok: checks.every((check) => check.ok),
    url,
    durationMs: elapsedMilliseconds(startedAt),
    response: {
      status: response.status,
      statusText: response.statusText,
      contentType: contentType || null,
      redirected: response.redirected,
      bodyBytes: byteLength(body),
    },
    checks,
  };
}

function printUsage() {
  console.log([
    'Usage: node qa/http-smoke.mjs [url] [--timeout-ms=5000] [--expected-entry=/src/main.ts]',
    '',
    `Default URL: ${DEFAULT_TARGET_URL}`,
  ].join('\n'));
}

function parseCli(argv) {
  const options = {};
  let url;
  for (const argument of argv) {
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (argument.startsWith('--timeout-ms=')) {
      const value = Number(argument.slice('--timeout-ms='.length));
      if (!Number.isFinite(value) || value <= 0) {
        throw new TypeError(`--timeout-ms must be a positive number: ${argument}`);
      }
      options.timeoutMs = value;
      continue;
    }
    if (argument.startsWith('--expected-entry=')) {
      options.expectedEntry = argument.slice('--expected-entry='.length);
      continue;
    }
    if (argument.startsWith('-')) {
      throw new TypeError(`Unknown option: ${argument}`);
    }
    if (url !== undefined) {
      throw new TypeError(`Unexpected positional argument: ${argument}`);
    }
    url = argument;
  }
  return { url: url ?? DEFAULT_TARGET_URL, options };
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  try {
    const { url, options } = parseCli(process.argv.slice(2));
    if (options.help) {
      printUsage();
    } else {
      const result = await runHttpSmoke(url, options);
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.ok ? 0 : 1;
    }
  } catch (error) {
    console.error(JSON.stringify({
      schemaVersion: 1,
      ok: false,
      error: serializeError(error),
    }, null, 2));
    process.exitCode = 1;
  }
}
