import { describe, expect, it } from 'vitest';
import { validateCommentBody } from '../../src/validation/commentFields.ts';

// UNIT-11 (docs/lab-03/tests.md §2.1; specification.md BR-17; AC-22, AC-23):
// pure, DB/Express-free coverage of the Public Comment (and, later,
// Internal Note — #72 reuses the same validator) body rule — 1-2000
// characters after trimming, empty/whitespace-only rejected. HTTP-level
// coverage of the same rule lives in comments-notes.api.test.ts's API-35;
// this file is the unit-level half tests.md's UNIT-11 row asks for
// (password.test.ts's own header comment flags UNIT-11 as this file's job,
// not its own).

describe('validateCommentBody (BR-17, UNIT-11)', () => {
  it('rejects an empty string', () => {
    const result = validateCommentBody('');
    expect(result.ok).toBe(false);
  });

  it('rejects whitespace-only input (spaces, tabs, newlines)', () => {
    for (const raw of ['   ', '\t\t', '\n\t \n']) {
      const result = validateCommentBody(raw);
      expect(result.ok, JSON.stringify(raw)).toBe(false);
    }
  });

  it('rejects a missing/non-string value', () => {
    for (const raw of [undefined, null, 42, {}, []]) {
      const result = validateCommentBody(raw);
      expect(result.ok, JSON.stringify(raw)).toBe(false);
    }
  });

  it('accepts exactly 1 character', () => {
    const result = validateCommentBody('x');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('x');
  });

  it('accepts exactly 2000 characters', () => {
    const body = 'a'.repeat(2000);
    const result = validateCommentBody(body);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(2000);
  });

  it('rejects 2001 characters', () => {
    const result = validateCommentBody('a'.repeat(2001));
    expect(result.ok).toBe(false);
  });

  it('trims before measuring length — leading/trailing whitespace does not count toward the 1-2000 range', () => {
    const padded = `  ${'a'.repeat(2000)}  `;
    const result = validateCommentBody(padded);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('a'.repeat(2000));
  });

  it('trims before storing — internal whitespace is preserved, only leading/trailing is stripped', () => {
    const result = validateCommentBody('  hello   world  ');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('hello   world');
  });

  it('a value that trims to empty (e.g. all-whitespace) is rejected, not silently accepted as ""', () => {
    const result = validateCommentBody('           ');
    expect(result.ok).toBe(false);
  });
});
