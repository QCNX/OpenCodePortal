// ---------------------------------------------------------------------------
// Tests: shared/protocol.ts
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  encodeFrame,
  decodeFrame,
  isControlMessage,
  tryParseControlMessage,
  isChannelRequestId,
  isHttpRequestId,
  nextHttpRequestId,
  nextChannelId,
  encodeWsTunnelPayload,
  decodeWsTunnelPayload,
  WS_TUNNEL_TEXT,
  WS_TUNNEL_BINARY,
} from './protocol';
import { ControlMessage } from './types';

// ---------------------------------------------------------------------------
// encodeFrame / decodeFrame
// ---------------------------------------------------------------------------

describe('encodeFrame', () => {
  it('prepends 4-byte big-endian requestId header to payload', () => {
    const payload = Buffer.from('hello');
    const frame = encodeFrame(42, payload);

    // Total length = 4 (header) + 5 (payload) = 9
    expect(frame.length).toBe(9);
    // First 4 bytes = 42 in big-endian
    expect(frame.readUInt32BE(0)).toBe(42);
    // Remaining bytes = payload
    expect(frame.subarray(4).toString()).toBe('hello');
  });

  it('handles requestId = 0', () => {
    const frame = encodeFrame(0, Buffer.from('x'));
    expect(frame.readUInt32BE(0)).toBe(0);
  });

  it('handles requestId at uint32 max', () => {
    const maxUint32 = 0xffff_ffff;
    const frame = encodeFrame(maxUint32, Buffer.from('x'));
    expect(frame.readUInt32BE(0)).toBe(maxUint32);
  });

  it('handles empty payload', () => {
    const frame = encodeFrame(1, Buffer.alloc(0));
    expect(frame.length).toBe(4);
    expect(frame.readUInt32BE(0)).toBe(1);
  });

  it('handles large payload', () => {
    const payload = Buffer.alloc(10000, 0xAB);
    const frame = encodeFrame(7, payload);
    expect(frame.length).toBe(10004);
    expect(frame.readUInt32BE(0)).toBe(7);
    expect(frame.subarray(4).equals(payload)).toBe(true);
  });
});

describe('decodeFrame', () => {
  it('extracts requestId and payload from a valid frame', () => {
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(12345, 0);
    const payload = Buffer.from('world');
    const frame = Buffer.concat([header, payload]);

    const result = decodeFrame(frame);
    expect(result).not.toBeNull();
    expect(result!.requestId).toBe(12345);
    expect(result!.payload.toString()).toBe('world');
  });

  it('returns null for frame shorter than 4 bytes', () => {
    expect(decodeFrame(Buffer.from([1, 2, 3]))).toBeNull();
  });

  it('returns null for empty buffer', () => {
    expect(decodeFrame(Buffer.alloc(0))).toBeNull();
  });

  it('returns empty payload for frame with only header', () => {
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(99, 0);
    const result = decodeFrame(header);
    expect(result).not.toBeNull();
    expect(result!.requestId).toBe(99);
    expect(result!.payload.length).toBe(0);
  });

  it('round-trips through encodeFrame', () => {
    const payload = Buffer.from('round-trip test data');
    for (const id of [0, 1, 42, 0xffff_ffff]) {
      const encoded = encodeFrame(id, payload);
      const decoded = decodeFrame(encoded);
      expect(decoded).not.toBeNull();
      expect(decoded!.requestId).toBe(id);
      expect(decoded!.payload.equals(payload)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// isControlMessage
// ---------------------------------------------------------------------------

describe('isControlMessage', () => {
  it('recognizes "register" message', () => {
    expect(isControlMessage({ type: 'register', token: 'ocp-at-xxx' })).toBe(true);
  });

  it('recognizes "registered" message', () => {
    expect(isControlMessage({ type: 'registered', status: 'ok' })).toBe(true);
  });

  it('recognizes "heartbeat" message', () => {
    expect(isControlMessage({ type: 'heartbeat', sessionCount: 0 })).toBe(true);
  });

  it('recognizes "heartbeat_ack" message', () => {
    expect(isControlMessage({ type: 'heartbeat_ack' })).toBe(true);
  });

  it('recognizes "error" message', () => {
    expect(isControlMessage({ type: 'error', message: 'fail' })).toBe(true);
  });

  it('recognizes "shutdown" message', () => {
    expect(isControlMessage({ type: 'shutdown' })).toBe(true);
  });

  it('recognizes "request_cancel" message', () => {
    expect(isControlMessage({ type: 'request_cancel', requestId: 1 })).toBe(true);
  });

  it('recognizes "channel_open" message', () => {
    expect(isControlMessage({ type: 'channel_open', channelId: 1, path: '/ws' })).toBe(true);
  });

  it('recognizes "channel_opened" message', () => {
    expect(isControlMessage({ type: 'channel_opened', channelId: 1 })).toBe(true);
  });

  it('recognizes "channel_error" message', () => {
    expect(isControlMessage({ type: 'channel_error', channelId: 1, message: 'fail' })).toBe(true);
  });

  it('recognizes "channel_close" message', () => {
    expect(isControlMessage({ type: 'channel_close', channelId: 1 })).toBe(true);
  });

  it('recognizes "channel_closed" message', () => {
    expect(isControlMessage({ type: 'channel_closed', channelId: 1 })).toBe(true);
  });

  it('rejects unknown type', () => {
    expect(isControlMessage({ type: 'unknown' })).toBe(false);
  });

  it('rejects null', () => {
    expect(isControlMessage(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isControlMessage(undefined)).toBe(false);
  });

  it('rejects string', () => {
    expect(isControlMessage('hello')).toBe(false);
  });

  it('rejects number', () => {
    expect(isControlMessage(42)).toBe(false);
  });

  it('rejects array', () => {
    expect(isControlMessage([])).toBe(false);
  });

  it('rejects object without type field', () => {
    expect(isControlMessage({ foo: 'bar' })).toBe(false);
  });

  it('rejects object with non-string type', () => {
    expect(isControlMessage({ type: 123 })).toBe(false);
  });

  it('rejects object with extra fields — only cares about type', () => {
    // Valid type + extra junk is still a control message
    expect(isControlMessage({ type: 'heartbeat', sessionCount: 5, extra: 'junk' })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tryParseControlMessage
// ---------------------------------------------------------------------------

describe('tryParseControlMessage', () => {
  it('parses a valid control message frame', () => {
    const msg = tryParseControlMessage(Buffer.from(JSON.stringify({ type: 'heartbeat', sessionCount: 2 })));
    expect(msg).toEqual({ type: 'heartbeat', sessionCount: 2 });
  });

  it('returns null for frames not starting with {', () => {
    expect(tryParseControlMessage(Buffer.from('GET / HTTP/1.1\r\n\r\n'))).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(tryParseControlMessage(Buffer.from('{"type": "heartbeat"'))).toBeNull();
  });

  it('returns null for JSON that is not a control message', () => {
    expect(tryParseControlMessage(Buffer.from('{"foo": "bar"}'))).toBeNull();
  });

  it('returns null for binary frame data', () => {
    const binary = encodeFrame(42, Buffer.from([0x00, 0x01, 0x02]));
    expect(tryParseControlMessage(binary)).toBeNull();
  });

  it('returns null for an empty buffer', () => {
    expect(tryParseControlMessage(Buffer.alloc(0))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ID namespace predicates
// ---------------------------------------------------------------------------

describe('isChannelRequestId / isHttpRequestId', () => {
  it('classifies allocated IDs into their own namespaces', () => {
    const httpId = nextHttpRequestId();
    const channelId = nextChannelId();
    expect(isHttpRequestId(httpId)).toBe(true);
    expect(isChannelRequestId(httpId)).toBe(false);
    expect(isChannelRequestId(channelId)).toBe(true);
    expect(isHttpRequestId(channelId)).toBe(false);
  });

  it('treats the high bit as the channel discriminator', () => {
    expect(isChannelRequestId(0x8000_0000)).toBe(true);
    expect(isChannelRequestId(0xffff_ffff)).toBe(true);
    expect(isChannelRequestId(0x7fff_ffff)).toBe(false);
    expect(isChannelRequestId(0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tunnel ID namespaces
// ---------------------------------------------------------------------------

describe('tunnel ID namespaces', () => {
  it('allocates HTTP requests below the channel namespace and channels within it', () => {
    const httpId = nextHttpRequestId();
    const channelId = nextChannelId();

    expect(httpId).toBeGreaterThan(0);
    expect(httpId).toBeLessThan(0x80000000);
    expect(channelId).toBeGreaterThanOrEqual(0x80000000);
  });
});

// ---------------------------------------------------------------------------
// encodeWsTunnelPayload / decodeWsTunnelPayload
// ---------------------------------------------------------------------------

describe('encodeWsTunnelPayload', () => {
  it('tags text frames with WS_TUNNEL_TEXT', () => {
    const wrapped = encodeWsTunnelPayload(Buffer.from('hello'), false);
    expect(wrapped[0]).toBe(WS_TUNNEL_TEXT);
    expect(wrapped.subarray(1).toString()).toBe('hello');
  });

  it('tags binary frames with WS_TUNNEL_BINARY', () => {
    const raw = Buffer.from([0x00, 0x7b, 0x22, 0x63]); // \0 + {"c...
    const wrapped = encodeWsTunnelPayload(raw, true);
    expect(wrapped[0]).toBe(WS_TUNNEL_BINARY);
    expect(wrapped.subarray(1)).toEqual(raw);
  });

  it('round-trips through decodeWsTunnelPayload', () => {
    const raw = Buffer.from([0x00, ...Buffer.from('{"cursor":0}')]);
    const wrapped = encodeWsTunnelPayload(raw, true);
    const decoded = decodeWsTunnelPayload(wrapped);
    expect(decoded?.isBinary).toBe(true);
    expect(decoded?.data).toEqual(raw);
  });

  it('treats legacy unwrapped payloads as text', () => {
    const legacy = Buffer.from('echo:hello');
    const decoded = decodeWsTunnelPayload(legacy);
    expect(decoded?.isBinary).toBe(false);
    expect(decoded?.data.toString()).toBe('echo:hello');
  });
});
