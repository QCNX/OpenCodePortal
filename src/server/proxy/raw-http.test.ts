import { describe, it, expect } from 'vitest';
import { serializeHttpRequest, parseRawResponse } from './raw-http';
import { parseRawHttp } from '../../agent/forwarder';
import { createMockReq } from '../test-helpers';

describe('HTTP serialization round-trip', () => {
  describe('serializeHttpRequest → parseRawHttp (Gateway → Agent)', () => {
    it('preserves method, path, headers, and body', () => {
      const req = createMockReq('/api/test', 'POST', {
        'content-type': 'application/json',
        'x-custom': 'value1',
      });
      const body = Buffer.from(JSON.stringify({ key: 'value' }));

      const raw = serializeHttpRequest(req, body, '/api/test');
      const parsed = parseRawHttp(raw);

      expect(parsed).not.toBeNull();
      expect(parsed!.method).toBe('POST');
      expect(parsed!.path).toBe('/api/test');
      expect(parsed!.headers['content-type']).toBe('application/json');
      expect(parsed!.headers['x-custom']).toBe('value1');
      expect(parsed!.body.toString()).toBe(JSON.stringify({ key: 'value' }));
    });

    it('preserves host but strips connection and transfer-encoding headers', () => {
      const req = createMockReq('/', 'GET', {
        host: 'gateway.example.com',
        connection: 'keep-alive',
        'transfer-encoding': 'chunked',
        accept: 'text/html',
      });

      const raw = serializeHttpRequest(req, Buffer.alloc(0), '/');
      const parsed = parseRawHttp(raw);

      expect(parsed!.headers['host']).toBe('gateway.example.com');
      expect(parsed!.headers['connection']).toBeUndefined();
      expect(parsed!.headers['transfer-encoding']).toBeUndefined();
      expect(parsed!.headers['accept']).toBe('text/html');
    });

    it('handles GET request with no body', () => {
      const req = createMockReq('/health', 'GET', { accept: 'application/json' });

      const raw = serializeHttpRequest(req, Buffer.alloc(0), '/health');
      const parsed = parseRawHttp(raw);

      expect(parsed).not.toBeNull();
      expect(parsed!.method).toBe('GET');
      expect(parsed!.path).toBe('/health');
      expect(parsed!.body.length).toBe(0);
    });

    it('handles request with no headers', () => {
      const req = createMockReq('/empty', 'DELETE');

      const raw = serializeHttpRequest(req, Buffer.alloc(0), '/empty');
      const parsed = parseRawHttp(raw);

      expect(parsed).not.toBeNull();
      expect(parsed!.method).toBe('DELETE');
    });

    it('handles large binary body', () => {
      const req = createMockReq('/upload', 'PUT', {
        'content-type': 'application/octet-stream',
      });
      const body = Buffer.alloc(10000, 0xFF);

      const raw = serializeHttpRequest(req, body, '/upload');
      const parsed = parseRawHttp(raw);

      expect(parsed!.body.length).toBe(10000);
      expect(parsed!.body.equals(body)).toBe(true);
    });

    it('handles path with query string', () => {
      const req = createMockReq('/api/data', 'GET');
      const raw = serializeHttpRequest(req, Buffer.alloc(0), '/api/data?page=1&limit=10');
      const parsed = parseRawHttp(raw);

      expect(parsed!.path).toBe('/api/data?page=1&limit=10');
    });

    it('preserves duplicate request headers', () => {
      const req = createMockReq('/cookies', 'GET', {
        cookie: ['a=1', 'b=2'],
      });
      const raw = serializeHttpRequest(req, Buffer.alloc(0), '/cookies');
      const parsed = parseRawHttp(raw);

      expect(parsed!.headers['cookie']).toEqual(['a=1', 'b=2']);
    });
  });

  describe('parseRawResponse (Agent → Gateway)', () => {
    it('parses a valid HTTP/1.1 response', () => {
      const raw = Buffer.from(
        'HTTP/1.1 200 OK\r\n' +
        'Content-Type: application/json\r\n' +
        'Content-Length: 15\r\n' +
        '\r\n' +
        '{"status":"ok"}',
      );

      const parsed = parseRawResponse(raw);
      expect(parsed).not.toBeNull();
      expect(parsed!.statusCode).toBe(200);
      expect(parsed!.statusMessage).toBe('OK');
      expect(parsed!.headers['content-type']).toBe('application/json');
      expect(parsed!.headers['content-length']).toBe('15');
      expect(parsed!.body.toString()).toBe('{"status":"ok"}');
    });

    it('parses 404 response', () => {
      const raw = Buffer.from(
        'HTTP/1.1 404 Not Found\r\n' +
        'Content-Type: text/plain\r\n' +
        '\r\n' +
        'Not Found',
      );

      const parsed = parseRawResponse(raw);
      expect(parsed!.statusCode).toBe(404);
      expect(parsed!.statusMessage).toBe('Not Found');
    });

    it('preserves duplicate response headers', () => {
      const raw = Buffer.from(
        'HTTP/1.1 200 OK\r\n' +
        'Set-Cookie: a=1; Path=/\r\n' +
        'Set-Cookie: b=2; Path=/\r\n' +
        '\r\n',
      );

      const parsed = parseRawResponse(raw);
      expect(parsed!.headers['set-cookie']).toEqual(['a=1; Path=/', 'b=2; Path=/']);
    });

    it('returns null for invalid data (no header end)', () => {
      const raw = Buffer.from('garbage data without headers\r\n');
      expect(parseRawResponse(raw)).toBeNull();
    });

    it('handles empty body', () => {
      const raw = Buffer.from('HTTP/1.1 204 No Content\r\n\r\n');
      const parsed = parseRawResponse(raw);
      expect(parsed!.statusCode).toBe(204);
      expect(parsed!.body.length).toBe(0);
    });
  });
});
