// ---------------------------------------------------------------------------
// Tests: agent/forwarder.ts — HTTP forwarding + SSE streaming
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import type * as Http from 'http';
import { encodeWsTunnelPayload, nextChannelId } from '../shared/protocol';

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
}));

vi.mock('http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('http')>();
  return {
    ...actual,
    request: requestMock,
  };
});

import {
  Forwarder,
  serializeResponseHeaders,
} from './forwarder';
import { isEventStreamContentType } from '../shared/http-headers';
import { MAX_PROXY_RESPONSE_BODY_BYTES } from '../shared/types';

function mockResponse(opts: {
  statusCode: number;
  statusMessage?: string;
  headers: Record<string, string | string[]>;
  chunks: Buffer[];
  autoEnd?: boolean;
}): Http.IncomingMessage {
  const res = new EventEmitter() as Http.IncomingMessage;
  (res as any).statusCode = opts.statusCode;
  (res as any).statusMessage = opts.statusMessage ?? 'OK';
  (res as any).headers = opts.headers;
  (res as any).destroy = vi.fn();
  process.nextTick(() => {
    for (const chunk of opts.chunks) {
      res.emit('data', chunk);
    }
    if (opts.autoEnd !== false) {
      res.emit('end');
    }
  });
  return res;
}

describe('isEventStreamContentType', () => {
  it('detects text/event-stream', () => {
    expect(isEventStreamContentType('text/event-stream')).toBe(true);
    expect(isEventStreamContentType('text/event-stream; charset=utf-8')).toBe(true);
    expect(isEventStreamContentType('application/json')).toBe(false);
  });
});

describe('serializeResponseHeaders', () => {
  it('serializes status line and headers without body', () => {
    const raw = serializeResponseHeaders(200, 'OK', {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
    });
    expect(raw).toContain('HTTP/1.1 200 OK\r\n');
    expect(raw).toContain('content-type: text/event-stream\r\n');
    expect(raw.endsWith('\r\n\r\n')).toBe(true);
  });
});

describe('Forwarder.handleRequest', () => {
  const sentFrames: { requestId: number; payload: Buffer }[] = [];
  let forwarder: Forwarder;
  let tunnel: { setSessionCount: ReturnType<typeof vi.fn>; sendBinary: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    sentFrames.length = 0;
    requestMock.mockReset();
    tunnel = {
      setSessionCount: vi.fn(),
      sendBinary: vi.fn((requestId: number, payload: Buffer) => {
        sentFrames.push({ requestId, payload });
      }),
    };
    forwarder = new Forwarder(3001, '127.0.0.1', tunnel as any);
  });

  function mockHttpRequest(response: Http.IncomingMessage): void {
    requestMock.mockImplementation((_opts: any, callback?: (res: Http.IncomingMessage) => void) => {
      const req = new EventEmitter() as Http.ClientRequest;
      (req as any).write = vi.fn();
      (req as any).destroy = vi.fn();
      (req as any).end = vi.fn(() => {
        callback?.(response);
      });
      return req as Http.ClientRequest;
    });
  }

  const rawGet = Buffer.from('GET /test HTTP/1.1\r\nHost: localhost\r\n\r\n');

  it('buffers non-SSE responses into a single frame', async () => {
    mockHttpRequest(
      mockResponse({
        statusCode: 200,
        headers: { 'content-type': 'application/json', 'content-length': '2' },
        chunks: [Buffer.from('{}')],
      }),
    );

    forwarder.handleRequest(1, rawGet);
    await vi.waitFor(() => expect(sentFrames.length).toBe(1));

    const frame = sentFrames[0].payload.toString('utf8');
    expect(frame).toContain('HTTP/1.1 200 OK');
    expect(frame).toContain('application/json');
    expect(frame).toContain('{}');
  });

  it('rejects non-SSE responses with oversized content-length', async () => {
    mockHttpRequest(
      mockResponse({
        statusCode: 200,
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String(MAX_PROXY_RESPONSE_BODY_BYTES + 1),
        },
        chunks: [],
      }),
    );

    forwarder.handleRequest(2, rawGet);
    await vi.waitFor(() => expect(sentFrames.length).toBe(1));

    const frame = sentFrames[0].payload.toString('utf8');
    expect(frame).toContain('HTTP/1.1 502 Bad Gateway');
    expect(frame).toContain('response too large');
  });

  it('streams SSE as headers frame, data chunks, and empty end marker', async () => {
    mockHttpRequest(
      mockResponse({
        statusCode: 200,
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
        chunks: [
          Buffer.from('data: {"type":"server.connected"}\n\n'),
          Buffer.from('data: {"type":"ping"}\n\n'),
        ],
      }),
    );

    forwarder.handleRequest(7, rawGet);
    await vi.waitFor(() => expect(sentFrames.length).toBe(4));

    expect(sentFrames[0].requestId).toBe(7);
    expect(sentFrames[0].payload.toString('utf8')).toContain('text/event-stream');

    expect(sentFrames[1].payload.toString('utf8')).toContain('server.connected');
    expect(sentFrames[2].payload.toString('utf8')).toContain('ping');
    expect(sentFrames[3].payload.length).toBe(0);
  });

  it('cancels an active SSE request and decrements session count', async () => {
    const response = mockResponse({
      statusCode: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
      chunks: [Buffer.from('data: {"type":"server.connected"}\n\n')],
      autoEnd: false,
    });
    mockHttpRequest(response);

    forwarder.handleRequest(8, rawGet);
    await vi.waitFor(() => expect(sentFrames.length).toBe(2));

    forwarder.cancelRequest(8);

    expect((response as any).destroy).toHaveBeenCalled();
    expect(tunnel.setSessionCount).toHaveBeenLastCalledWith(0);
    expect(sentFrames.some((frame) => frame.requestId === 8 && frame.payload.length === 0)).toBe(false);
  });

  it('discards channel-namespace frames with no active channel (no HTTP parse)', () => {
    const channelId = nextChannelId();
    expect(channelId).toBeGreaterThanOrEqual(0x80000000);

    forwarder.handleRequest(channelId, Buffer.from('GET / HTTP/1.1\r\nHost: localhost\r\n\r\n'));

    expect(requestMock).not.toHaveBeenCalled();
    expect(sentFrames.length).toBe(0);
  });

  it('relays channel-namespace frames to the active channel', () => {
    const channelId = nextChannelId();
    const ws = { readyState: 1, send: vi.fn() }; // WebSocket.OPEN === 1
    (forwarder as any).activeChannels.set(channelId, ws);

    const payload = encodeWsTunnelPayload(Buffer.from('cursor-data'), true);
    forwarder.handleRequest(channelId, payload);

    expect(ws.send).toHaveBeenCalledWith(Buffer.from('cursor-data'), { binary: true });
    expect(requestMock).not.toHaveBeenCalled();
  });
});
