import * as http from 'http';

/** Read request body (for API endpoints) */
export const MAX_API_BODY_BYTES = 64 * 1024; // 64 KB limit for API request bodies
export const MAX_LOGIN_BODY_BYTES = 8 * 1024; // login form body should be tiny

export class RequestBodyTooLargeError extends Error {}

export async function readRequestBodyOrRespond(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  limitBytes = MAX_API_BODY_BYTES,
): Promise<string | null> {
  try {
    return await readRequestBody(req, limitBytes);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      res.writeHead(413, { 'Content-Type': 'text/plain' });
      res.end('Payload Too Large');
      return null;
    }
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad Request');
    return null;
  }
}

export async function readRequestBody(req: http.IncomingMessage, limitBytes = MAX_API_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > limitBytes) {
        fail(new RequestBodyTooLargeError('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('aborted', () => fail(new Error('Request aborted')));
    req.on('error', fail);
  });
}
