// ---------------------------------------------------------------------------
// Tests: shared/state.ts — stripJsoncComments
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { stripJsoncComments } from './state';

describe('stripJsoncComments', () => {
  it('strips JSONC trailing commas', () => {
    const input = '{"tags":["a",],"count":1,}';
    const stripped = stripJsoncComments(input);
    expect(JSON.parse(stripped)).toEqual({ tags: ['a'], count: 1 });
  });

  it('does not alter commas inside double-quoted strings', () => {
    const input = '{"key":"value,}","other":1}';
    const stripped = stripJsoncComments(input);
    expect(JSON.parse(stripped)).toEqual({ key: 'value,}', other: 1 });
  });

  it('does not alter commas inside single-quoted strings', () => {
    const input = "{'note':',]'}";
    const stripped = stripJsoncComments(input);
    expect(stripped).toBe("{'note':',]'}");
  });

  it('strips line and block comments but preserves // inside strings', () => {
    const input = `{
      // instance list
      "url": "https://example.com/path", // not a comment
      "items": [1, /* block */ 2,],
    }`;
    const stripped = stripJsoncComments(input);
    expect(JSON.parse(stripped)).toEqual({
      url: 'https://example.com/path',
      items: [1, 2],
    });
  });

  it('preserves escaped quotes inside strings', () => {
    const input = '{"msg":"say \\"hello,}\\"","x":1,}';
    const stripped = stripJsoncComments(input);
    expect(JSON.parse(stripped)).toEqual({ msg: 'say "hello,}"', x: 1 });
  });
});
