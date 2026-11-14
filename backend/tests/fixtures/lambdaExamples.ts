import { handler } from '../../src/lambda.js';

const results: { method: string; path: string; status: number; body: string }[] = [];
for (const path of ['/api/items', '/api/items/example', '/api/health']) {
  for (const method of path === '/api/health' ? ['GET'] : ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const result = await handler({
      version: '2.0',
      routeKey: '$default',
      rawPath: path,
      rawQueryString: '',
      headers: { host: 'localhost', 'content-type': 'application/json' },
      requestContext: {
        http: { method, path, sourceIp: '127.0.0.1', protocol: 'HTTP/1.1', userAgent: 'test' },
      },
      body: method === 'POST' ? '{' : undefined,
      isBase64Encoded: false,
    }, {}) as { statusCode: number; body: string };
    results.push({ method, path, status: result.statusCode, body: result.body });
  }
}
console.log(JSON.stringify(results));
