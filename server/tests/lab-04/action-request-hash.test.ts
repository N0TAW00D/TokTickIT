import { describe, expect, it } from 'vitest';
import {
  canonicaliseActionCreateBody,
  hashActionCreateBody,
} from '../../src/services/actionRequestHash.js';

// BR-35 / api-spec.md §1.4: the idempotency hash is the SHA-256 of the
// canonicalised create body. Pure functions, no database.

const base = {
  description: 'Reproduced the timeout.',
  result: 'Confirmed on staging.',
  actionAt: '2026-10-01T10:00:00.000Z',
  status: 'COMPLETED',
  assigneeId: 7,
  followUpRequired: true,
  followUpNote: 'Check again tomorrow.',
  attachmentNotes: 'See ticket.',
};

describe('Action create-body hash', () => {
  it('is a 64-char hex SHA-256', () => {
    expect(hashActionCreateBody(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is equal for bodies differing only in whitespace, explicit defaults or server-owned fields', () => {
    const h = hashActionCreateBody(base);
    expect(
      hashActionCreateBody({
        ...base,
        description: '  Reproduced the timeout.  ',
        followUpNote: '\tCheck again tomorrow.\n',
        actionAt: '2026-10-01T17:00:00+07:00',
        clientRequestId: '00000000-0000-4000-8000-000000000001',
        performedBy: 99,
        id: 5,
        version: 3,
        createdAt: 'x',
        lastUpdatedBy: 1,
        ticketId: 2,
      })
    ).toBe(h);

    const minimal = { description: 'Do it.' };
    expect(
      hashActionCreateBody({
        description: ' Do it. ',
        result: '   ',
        status: 'PLANNED',
        assigneeId: null,
        followUpRequired: false,
        followUpNote: null,
        attachmentNotes: '',
      })
    ).toBe(hashActionCreateBody(minimal));
  });

  it('sorts keys so property order is irrelevant', () => {
    const reversed = Object.fromEntries(Object.entries(base).reverse());
    expect(canonicaliseActionCreateBody(reversed)).toBe(canonicaliseActionCreateBody(base));
  });

  it('differs for any real field change', () => {
    const h = hashActionCreateBody(base);
    const changes: Array<Record<string, unknown>> = [
      { description: 'Different.' },
      { result: 'Other result.' },
      { actionAt: '2026-10-01T10:00:01.000Z' },
      { status: 'IN_PROGRESS' },
      { assigneeId: 8 },
      { assigneeId: null },
      { followUpRequired: false, followUpNote: null },
      { followUpNote: 'Check the day after.' },
      { attachmentNotes: 'Other.' },
      { attachmentNotes: null },
    ];
    for (const change of changes) {
      expect(hashActionCreateBody({ ...base, ...change }), JSON.stringify(change)).not.toBe(h);
    }
  });
});
