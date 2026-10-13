import { describe, expect, it } from 'vitest';
import {
  ACTION_STATUSES,
  isActionTransitionAllowed,
  mergeActionUpdate,
  validateActionCreateBody,
  validateActionDescription,
  validateActionResult,
  validateAttachmentNotes,
  validateClientRequestId,
  validateFollowUp,
  validateVersion,
  type ActionStatus,
  type StoredAction,
} from '../../src/validation/actionRules.ts';
import { hashActionCreateBody } from '../../src/services/actionRequestHash.ts';

// Pure, DB/Express-free coverage of the Lab 4 Action Taken rules
// (docs/lab-04/tests.md UNIT-01..04, 09, 10, 12; specification.md BR-04..09,
// BR-33, BR-35; api-spec.md §2.3-2.4).

const NOW = new Date('2026-10-12T05:00:00.000Z');
const CREATED = new Date('2026-10-01T00:00:00.000Z');
const ctx = { ticketCreatedAt: CREATED, now: NOW };
const FUTURE = '2026-10-13T05:00:00.000Z';

function fieldsOf(r: { ok: boolean; errors?: { field: string }[] }): string[] {
  return r.ok ? [] : (r.errors ?? []).map((e) => e.field);
}

function stored(over: Partial<StoredAction> = {}): StoredAction {
  return {
    description: 'Reset the VPN profile.',
    result: null,
    actionAt: new Date('2026-10-10T00:00:00.000Z'),
    status: 'PLANNED',
    assigneeId: null,
    followUpRequired: false,
    followUpNote: null,
    attachmentNotes: null,
    ...over,
  };
}

describe('UNIT-01 description/result validator (BR-05)', () => {
  it('UNIT-01 rejects empty and whitespace-only descriptions', () => {
    for (const raw of ['', '   ', '\n\t']) {
      expect(validateActionDescription(raw).ok, JSON.stringify(raw)).toBe(false);
    }
  });

  it('UNIT-01 rejects missing / non-string descriptions', () => {
    for (const raw of [undefined, null, 5, {}]) {
      expect(validateActionDescription(raw).ok, JSON.stringify(raw)).toBe(false);
    }
  });

  it('UNIT-01 accepts 2000 characters, rejects 2001, and trims before measuring', () => {
    expect(validateActionDescription('a'.repeat(2000)).ok).toBe(true);
    expect(validateActionDescription('a'.repeat(2001)).ok).toBe(false);
    const padded = validateActionDescription(`  ${'a'.repeat(2000)}  `);
    expect(padded).toEqual({ ok: true, value: 'a'.repeat(2000) });
  });

  it('UNIT-01 result: absent/null/blank means none, 2000 ok, 2001 rejected', () => {
    for (const raw of [undefined, null, '', '   ']) {
      expect(validateActionResult(raw), JSON.stringify(raw)).toEqual({ ok: true, value: null });
    }
    expect(validateActionResult('r'.repeat(2000)).ok).toBe(true);
    const over = validateActionResult('r'.repeat(2001));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error.field).toBe('result');
    expect(validateActionResult(7).ok).toBe(false);
  });
});

describe('UNIT-02 actionAt bounds (BR-04)', () => {
  const base = { description: 'Did a thing.' };

  it('UNIT-02 future instant: rejected for IN_PROGRESS/COMPLETED, accepted for PLANNED', () => {
    const planned = validateActionCreateBody({ ...base, actionAt: FUTURE, status: 'PLANNED' }, ctx);
    expect(planned.ok).toBe(true);
    for (const status of ['IN_PROGRESS', 'COMPLETED']) {
      const r = validateActionCreateBody(
        { ...base, actionAt: FUTURE, status, result: 'done' },
        ctx,
      );
      expect(fieldsOf(r), status).toEqual(['actionAt']);
    }
  });

  it('UNIT-02 instant before the Ticket createdAt is rejected', () => {
    const r = validateActionCreateBody({ ...base, actionAt: '2026-09-30T23:59:59.999Z' }, ctx);
    expect(fieldsOf(r)).toEqual(['actionAt']);
  });

  it('UNIT-02 equal to createdAt and equal to now are accepted', () => {
    expect(validateActionCreateBody({ ...base, actionAt: CREATED.toISOString() }, ctx).ok).toBe(true);
    const atNow = validateActionCreateBody(
      { ...base, actionAt: NOW.toISOString(), status: 'IN_PROGRESS' },
      ctx,
    );
    expect(atNow.ok).toBe(true);
  });

  it('UNIT-02 omitted actionAt defaults to now', () => {
    const r = validateActionCreateBody(base, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.actionAt.toISOString()).toBe(NOW.toISOString());
  });

  it('UNIT-02 malformed / offset-less actionAt is rejected', () => {
    for (const actionAt of ['yesterday', '2026-10-10', '2026-10-10T10:00:00', 12345, true]) {
      expect(fieldsOf(validateActionCreateBody({ ...base, actionAt }, ctx)), String(actionAt)).toEqual([
        'actionAt',
      ]);
    }
  });

  it('UNIT-02 moving a future-dated PLANNED Action to IN_PROGRESS/COMPLETED is rejected', () => {
    const future = stored({ actionAt: new Date(FUTURE) });
    const toProgress = mergeActionUpdate(future, { version: 1, status: 'IN_PROGRESS' }, ctx);
    expect(fieldsOf(toProgress)).toEqual(['actionAt']);
    const toDone = mergeActionUpdate(future, { version: 1, status: 'COMPLETED', result: 'ok' }, ctx);
    expect(fieldsOf(toDone)).toEqual(['actionAt']);
    // staying PLANNED with a future time is fine
    expect(mergeActionUpdate(future, { version: 1, description: 'edited' }, ctx).ok).toBe(true);
  });
});

describe('UNIT-03 follow-up and attachment-notes (BR-06, BR-07)', () => {
  it('UNIT-03 flag on with no/blank note is rejected', () => {
    for (const note of [undefined, null, '', '   ']) {
      const r = validateFollowUp(true, note);
      expect(r.ok, JSON.stringify(note)).toBe(false);
      if (!r.ok) expect(r.error.field).toBe('followUpNote');
    }
  });

  it('UNIT-03 flag off with a note is rejected; off with none is fine', () => {
    expect(validateFollowUp(false, 'check later').ok).toBe(false);
    expect(validateFollowUp(false, undefined)).toEqual({
      ok: true,
      value: { followUpRequired: false, followUpNote: null },
    });
    expect(validateFollowUp(false, null).ok).toBe(true);
  });

  it('UNIT-03 note 1000 ok / 1001 rejected; trimmed', () => {
    expect(validateFollowUp(true, 'n'.repeat(1000)).ok).toBe(true);
    expect(validateFollowUp(true, 'n'.repeat(1001)).ok).toBe(false);
    expect(validateFollowUp(true, '  hi  ')).toEqual({
      ok: true,
      value: { followUpRequired: true, followUpNote: 'hi' },
    });
  });

  it('UNIT-03 non-boolean flag is rejected', () => {
    expect(validateFollowUp('yes', 'x').ok).toBe(false);
  });

  it('UNIT-03 attachment notes 500 ok / 501 rejected, null/absent ok', () => {
    expect(validateAttachmentNotes('a'.repeat(500)).ok).toBe(true);
    expect(validateAttachmentNotes('a'.repeat(501)).ok).toBe(false);
    expect(validateAttachmentNotes(undefined)).toEqual({ ok: true, value: null });
    expect(validateAttachmentNotes(null)).toEqual({ ok: true, value: null });
    expect(validateAttachmentNotes(3).ok).toBe(false);
  });

  it('UNIT-03 merge-on-update clears the stored note when the flag turns off', () => {
    const s = stored({ followUpRequired: true, followUpNote: 'check Friday' });
    const r = mergeActionUpdate(s, { version: 2, followUpRequired: false }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.followUpRequired).toBe(false);
      expect(r.value.followUpNote).toBeNull();
    }
  });

  it('UNIT-03 merge-on-update: note with flag off is rejected; stored note survives other edits', () => {
    const s = stored({ followUpRequired: true, followUpNote: 'check Friday' });
    expect(
      fieldsOf(mergeActionUpdate(s, { version: 2, followUpRequired: false, followUpNote: 'x' }, ctx)),
    ).toEqual(['followUpNote']);
    const kept = mergeActionUpdate(s, { version: 2, description: 'edited' }, ctx);
    expect(kept.ok && kept.value.followUpNote).toBe('check Friday');
    // turning the flag on needs a note in the request
    expect(fieldsOf(mergeActionUpdate(stored(), { version: 2, followUpRequired: true }, ctx))).toEqual([
      'followUpNote',
    ]);
  });
});

describe('UNIT-04 Action lifecycle table (BR-09)', () => {
  const permitted = new Set([
    'PLANNED>IN_PROGRESS',
    'IN_PROGRESS>COMPLETED',
    'PLANNED>CANCELLED',
    'IN_PROGRESS>CANCELLED',
  ]);

  it('UNIT-04 exactly the four permitted pairs are allowed; every other pair and no-op is not', () => {
    for (const from of ACTION_STATUSES) {
      for (const to of ACTION_STATUSES) {
        expect(isActionTransitionAllowed(from, to), `${from}>${to}`).toBe(
          permitted.has(`${from}>${to}`),
        );
      }
    }
  });

  it('UNIT-04 CANCELLED is invalid as an initial status; the other three are valid', () => {
    const base = { description: 'x', result: 'done' };
    expect(fieldsOf(validateActionCreateBody({ ...base, status: 'CANCELLED' }, ctx))).toEqual(['status']);
    for (const status of ['PLANNED', 'IN_PROGRESS', 'COMPLETED'] as ActionStatus[]) {
      expect(validateActionCreateBody({ ...base, status }, ctx).ok, status).toBe(true);
    }
    expect(fieldsOf(validateActionCreateBody({ ...base, status: 'BOGUS' }, ctx))).toEqual(['status']);
  });

  it('UNIT-04 update reports the requested transition for the caller to check', () => {
    const r = mergeActionUpdate(stored(), { version: 1, status: 'IN_PROGRESS' }, ctx);
    expect(r.ok && r.transition).toEqual({ from: 'PLANNED', to: 'IN_PROGRESS' });
    const none = mergeActionUpdate(stored(), { version: 1, description: 'x' }, ctx);
    expect(none.ok && none.transition).toBeNull();
  });
});

describe('UNIT-09 version validator (BR-33)', () => {
  it('UNIT-09 missing, 0, negative, 1.5, string, NaN rejected with field version', () => {
    for (const raw of [undefined, null, 0, -1, 1.5, '1', 'abc', NaN, Infinity]) {
      const r = validateVersion(raw);
      expect(r.ok, String(raw)).toBe(false);
      if (!r.ok) expect(r.error.field).toBe('version');
    }
  });

  it('UNIT-09 positive integer accepted', () => {
    expect(validateVersion(1)).toEqual({ ok: true, value: 1 });
    expect(validateVersion(42)).toEqual({ ok: true, value: 42 });
  });

  it('UNIT-09 update body without a valid version is rejected, and an empty change set is rejected', () => {
    expect(fieldsOf(mergeActionUpdate(stored(), { description: 'x' }, ctx))).toEqual(['version']);
    const empty = mergeActionUpdate(stored(), { version: 1 }, ctx);
    expect(empty.ok).toBe(false);
  });
});

describe('UNIT-10 clientRequestId validator and body hash (BR-35)', () => {
  it('UNIT-10 UUID accepted, malformed rejected, omitted accepted', () => {
    const id = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
    expect(validateClientRequestId(id)).toEqual({ ok: true, value: id });
    expect(validateClientRequestId(id.toUpperCase()).ok).toBe(true);
    for (const raw of ['', 'abc', '3f2b8c1e5a4d4e6f9b7a1c2d3e4f5a6b', 12, true, {}]) {
      const r = validateClientRequestId(raw);
      expect(r.ok, JSON.stringify(raw)).toBe(false);
      if (!r.ok) expect(r.error.field).toBe('clientRequestId');
    }
    expect(validateClientRequestId(undefined)).toEqual({ ok: true, value: null });
    expect(validateClientRequestId(null)).toEqual({ ok: true, value: null });
  });

  it('UNIT-10 create body with a bad clientRequestId is rejected on that field', () => {
    expect(
      fieldsOf(validateActionCreateBody({ description: 'x', clientRequestId: 'nope' }, ctx)),
    ).toEqual(['clientRequestId']);
  });

  const body = { description: 'Fix it', result: 'ok', status: 'COMPLETED', actionAt: NOW.toISOString() };

  it('UNIT-10 hash is equal for whitespace / defaults / server-owned-field differences', () => {
    const h = hashActionCreateBody(body);
    expect(hashActionCreateBody({ ...body, description: '  Fix it \n' })).toBe(h);
    expect(hashActionCreateBody({ ...body, actionAt: '2026-10-12T12:00:00.000+07:00' })).toBe(h);
    expect(
      hashActionCreateBody({ ...body, followUpRequired: false, assigneeId: null, attachmentNotes: '  ' }),
    ).toBe(h);
    expect(
      hashActionCreateBody({
        ...body,
        performedBy: 9,
        createdAt: 'x',
        lastUpdatedBy: 3,
        ticketId: 5,
        id: 7,
        version: 4,
        clientRequestId: '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b',
      }),
    ).toBe(h);
  });

  it('UNIT-10 hash differs for any real field change', () => {
    const h = hashActionCreateBody(body);
    const changes: Record<string, unknown>[] = [
      { description: 'Fix it again' },
      { result: 'different' },
      { status: 'PLANNED' },
      { actionAt: '2026-10-12T04:00:00.000Z' },
      { assigneeId: 3 },
      { followUpRequired: true, followUpNote: 'later' },
      { attachmentNotes: 'see file' },
    ];
    for (const c of changes) {
      expect(hashActionCreateBody({ ...body, ...c }), JSON.stringify(c)).not.toBe(h);
    }
  });
});

describe('UNIT-12 result required to complete (BR-05, D-16)', () => {
  it('UNIT-12 result absent/blank accepted for PLANNED and IN_PROGRESS on create', () => {
    for (const status of ['PLANNED', 'IN_PROGRESS']) {
      for (const result of [undefined, null, '', '  ']) {
        const r = validateActionCreateBody({ description: 'x', status, result }, ctx);
        expect(r.ok, `${status} ${JSON.stringify(result)}`).toBe(true);
      }
    }
  });

  it('UNIT-12 create as COMPLETED with absent/blank result is rejected on field result', () => {
    for (const result of [undefined, null, '', '  ']) {
      const r = validateActionCreateBody({ description: 'x', status: 'COMPLETED', result }, ctx);
      expect(fieldsOf(r), JSON.stringify(result)).toEqual(['result']);
    }
    expect(
      validateActionCreateBody({ description: 'x', status: 'COMPLETED', result: 'done' }, ctx).ok,
    ).toBe(true);
  });

  it('UNIT-12 transition to COMPLETED with no request result and none stored is rejected', () => {
    const s = stored({ status: 'IN_PROGRESS' });
    expect(fieldsOf(mergeActionUpdate(s, { version: 1, status: 'COMPLETED' }, ctx))).toEqual(['result']);
    expect(
      fieldsOf(mergeActionUpdate(s, { version: 1, status: 'COMPLETED', result: '   ' }, ctx)),
    ).toEqual(['result']);
  });

  it('UNIT-12 a stored result satisfies completion without resending; a request result also does', () => {
    const withResult = stored({ status: 'IN_PROGRESS', result: 'fixed' });
    const r = mergeActionUpdate(withResult, { version: 1, status: 'COMPLETED' }, ctx);
    expect(r.ok && r.value.result).toBe('fixed');
    const sent = mergeActionUpdate(stored({ status: 'IN_PROGRESS' }), {
      version: 1,
      status: 'COMPLETED',
      result: ' done ',
    }, ctx);
    expect(sent.ok && sent.value.result).toBe('done');
  });
});
