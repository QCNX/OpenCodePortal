import { describe, it, expect } from 'vitest';
import {
  headerToString,
  parseByteHeader,
  isEventStreamContentType,
  buildBasicAuthHeader,
  parseHeaderBlock,
} from './http-headers';

describe('headerToString', () => {
  it('returns empty string for undefined', () => {
    expect(headerToString(undefined)).toBe('');
  });

  it('returns a single string value', () => {
    expect(headerToString('text/html')).toBe('text/html');
  });

  it('joins array values with comma', () => {
    expect(headerToString(['a', 'b'])).toBe('a,b');
  });
});

describe('parseByteHeader', () => {
  it('parses a plain numeric string', () => {
    expect(parseByteHeader('1234')).toBe(1234);
  });

  it('uses the first value when given an array', () => {
    expect(parseByteHeader(['42', '43'])).toBe(42);
  });

  it('returns null for undefined', () => {
    expect(parseByteHeader(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseByteHeader('')).toBeNull();
  });

  it('returns null for non-numeric values', () => {
    expect(parseByteHeader('abc')).toBeNull();
  });

  it('returns null for negative values', () => {
    expect(parseByteHeader('-5')).toBeNull();
  });

  it('accepts zero', () => {
    expect(parseByteHeader('0')).toBe(0);
  });
});

describe('isEventStreamContentType', () => {
  it('detects text/event-stream', () => {
    expect(isEventStreamContentType('text/event-stream')).toBe(true);
  });

  it('detects text/event-stream with parameters', () => {
    expect(isEventStreamContentType('text/event-stream; charset=utf-8')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isEventStreamContentType('Text/Event-Stream')).toBe(true);
  });

  it('rejects other content types', () => {
    expect(isEventStreamContentType('application/json')).toBe(false);
    expect(isEventStreamContentType('text/html')).toBe(false);
  });
});

describe('buildBasicAuthHeader', () => {
  it('builds Basic auth from user and password', () => {
    expect(buildBasicAuthHeader('admin', 'upstream-pass')).toBe(
      'Basic ' + Buffer.from('admin:upstream-pass').toString('base64'),
    );
  });

  it('defaults the user to opencode when undefined', () => {
    expect(buildBasicAuthHeader(undefined, 'secret')).toBe(
      'Basic ' + Buffer.from('opencode:secret').toString('base64'),
    );
  });

  it('defaults the user to opencode when empty', () => {
    expect(buildBasicAuthHeader('', 'secret')).toBe(
      'Basic ' + Buffer.from('opencode:secret').toString('base64'),
    );
  });
});

describe('parseHeaderBlock', () => {
  it('parses headers after the first (request/status) line', () => {
    const text = 'GET / HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n';
    expect(parseHeaderBlock(text)).toEqual({
      host: 'localhost',
      'content-type': 'application/json',
    });
  });

  it('lowercases keys and trims values', () => {
    const text = 'GET / HTTP/1.1\r\nX-Custom:  value with spaces  \r\nOther: x\r\n';
    expect(parseHeaderBlock(text)).toEqual({
      'x-custom': 'value with spaces',
      other: 'x',
    });
  });

  it('merges duplicate headers into arrays', () => {
    const text = 'HTTP/1.1 200 OK\r\nSet-Cookie: a=1; Path=/\r\nSet-Cookie: b=2; Path=/\r\n';
    expect(parseHeaderBlock(text)).toEqual({
      'set-cookie': ['a=1; Path=/', 'b=2; Path=/'],
    });
  });

  it('merges three or more duplicate headers', () => {
    const text = 'GET / HTTP/1.1\r\nX-Multi: 1\r\nX-Multi: 2\r\nX-Multi: 3\r\n';
    expect(parseHeaderBlock(text)).toEqual({
      'x-multi': ['1', '2', '3'],
    });
  });

  it('skips malformed lines without a colon', () => {
    const text = 'GET / HTTP/1.1\r\nnot-a-header\r\nAccept: text/html\r\n';
    expect(parseHeaderBlock(text)).toEqual({ accept: 'text/html' });
  });

  it('returns an empty map when only the first line is present', () => {
    expect(parseHeaderBlock('GET / HTTP/1.1')).toEqual({});
  });
});
