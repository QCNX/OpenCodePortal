// ---------------------------------------------------------------------------
// OpenCode Portal — tunnel protocol helpers
// ---------------------------------------------------------------------------
//
// Binary frame format:
//   [4 bytes: requestId (uint32 big-endian)] [N bytes: payload]
//
// Text frame: JSON control messages (see types.ts).
// ---------------------------------------------------------------------------

import { ControlMessage } from './types';

// -- Binary frame encoding / decoding ---------------------------------------

/**
 * Encode payload into a binary frame with requestId header.
 * Returns a Buffer suitable for sending over WSS binary frame.
 */
export function encodeFrame(requestId: number, payload: Buffer): Buffer {
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(requestId >>> 0, 0);
  return Buffer.concat([header, payload]);
}

/**
 * Decode a binary frame into requestId + payload.
 * Returns null if the frame is too short (missing header).
 */
export function decodeFrame(data: Buffer): { requestId: number; payload: Buffer } | null {
  if (data.length < 4) return null;
  const requestId = data.readUInt32BE(0);
  const payload = data.subarray(4);
  return { requestId, payload };
}

// -- Control message helpers -------------------------------------------------

export function isControlMessage(obj: unknown): obj is ControlMessage {
  if (typeof obj !== 'object' || obj === null) return false;
  const msg = obj as Record<string, unknown>;
  return typeof msg.type === 'string' && CONTROL_MESSAGE_TYPES.has(msg.type);
}

const CONTROL_MESSAGE_TYPES = new Set([
  'register',
  'registered',
  'heartbeat',
  'heartbeat_ack',
  'error',
  'shutdown',
  'request_cancel',
  'channel_open',
  'channel_opened',
  'channel_error',
  'channel_close',
  'channel_closed',
]);

// -- WS channel tunnel framing -----------------------------------------------
//
// WebSocket channel payloads inside binary tunnel frames are prefixed with a
// 1-byte frame-type tag so Gateway preserves text vs binary when relaying
// (OpenCode PTY uses binary frames for cursor metadata: 0x00 + JSON).

export const WS_TUNNEL_TEXT = 0x00;
export const WS_TUNNEL_BINARY = 0x01;

/** Wrap WS payload with text/binary discriminator for tunnel transport. */
export function encodeWsTunnelPayload(data: Buffer, isBinary: boolean): Buffer {
  const header = Buffer.allocUnsafe(1);
  header[0] = isBinary ? WS_TUNNEL_BINARY : WS_TUNNEL_TEXT;
  return Buffer.concat([header, data]);
}

/** Unwrap WS tunnel payload. Returns null if empty. */
export function decodeWsTunnelPayload(
  payload: Buffer,
): { isBinary: boolean; data: Buffer } | null {
  if (payload.length === 0) return null;
  const tag = payload[0];
  if (tag !== WS_TUNNEL_TEXT && tag !== WS_TUNNEL_BINARY) {
    // Legacy unwrapped payload — treat as text
    return { isBinary: false, data: payload };
  }
  return { isBinary: tag === WS_TUNNEL_BINARY, data: payload.subarray(1) };
}

// -- Request ID generators ---------------------------------------------------
//
// HTTP proxy requests and browser WebSocket channels share the same tunnel
// frame header, but must not share a dispatch namespace. The high bit marks a
// channel ID; HTTP IDs occupy the lower half of uint32.

const CHANNEL_ID_MASK = 0x80000000;
const HTTP_ID_MAX = CHANNEL_ID_MASK - 1;
let _nextHttpId = 1;
let _nextChannelId = CHANNEL_ID_MASK;

export function nextHttpRequestId(): number {
  const id = _nextHttpId;
  _nextHttpId = _nextHttpId === HTTP_ID_MAX ? 1 : _nextHttpId + 1;
  return id;
}

export function nextChannelId(): number {
  const id = _nextChannelId;
  _nextChannelId = _nextChannelId === 0xffff_ffff ? CHANNEL_ID_MASK : _nextChannelId + 1;
  return id;
}

/** @deprecated Use nextHttpRequestId() or nextChannelId(). */
export function nextRequestId(): number {
  return nextHttpRequestId();
}
