import { describe, expect, it } from 'vitest';
import {
  ALL_TICKET_STATUSES,
  evaluateClosingGate,
  evaluateResolutionGate,
  isTicketTransitionAllowed,
} from '../../src/validation/ticketTransitions.ts';
import type { TicketStatus } from '../../src/generated/prisma/client.ts';

// UNIT-05 (transition matrix unchanged) and UNIT-06 (resolution gate) -
// docs/lab-04/tests.md; specification.md §5.1, BR-16, BR-17, BR-40.

// specification.md §5.1, typed out independently of the module under test.
const PERMITTED: Array<[TicketStatus, TicketStatus]> = [
  ['NEW', 'OPEN'],
  ['NEW', 'IN_PROGRESS'],
  ['NEW', 'CANCELLED'],
  ['OPEN', 'IN_PROGRESS'],
  ['OPEN', 'WAITING_FOR_REQUESTER'],
  ['OPEN', 'RESOLVED'],
  ['OPEN', 'CANCELLED'],
  ['IN_PROGRESS', 'WAITING_FOR_REQUESTER'],
  ['IN_PROGRESS', 'RESOLVED'],
  ['IN_PROGRESS', 'CANCELLED'],
  ['WAITING_FOR_REQUESTER', 'IN_PROGRESS'],
  ['WAITING_FOR_REQUESTER', 'RESOLVED'],
  ['WAITING_FOR_REQUESTER', 'CANCELLED'],
  ['RESOLVED', 'CLOSED'],
  ['RESOLVED', 'REOPENED'],
  ['CLOSED', 'REOPENED'],
  ['REOPENED', 'IN_PROGRESS'],
  ['REOPENED', 'WAITING_FOR_REQUESTER'],
  ['REOPENED', 'RESOLVED'],
  ['REOPENED', 'CANCELLED'],
];

describe('UNIT-05: ticket transition matrix', () => {
  it('knows exactly the eight statuses', () => {
    expect([...ALL_TICKET_STATUSES].sort()).toEqual(
      ['CANCELLED', 'CLOSED', 'IN_PROGRESS', 'NEW', 'OPEN', 'REOPENED', 'RESOLVED', 'WAITING_FOR_REQUESTER'].sort(),
    );
  });

  it.each(PERMITTED)('%s -> %s is permitted', (from, to) => {
    expect(isTicketTransitionAllowed(from, to)).toBe(true);
  });

  it('rejects every other pair, including each status to itself (44 pairs)', () => {
    const permitted = new Set(PERMITTED.map(([f, t]) => `${f}->${t}`));
    const statuses = ALL_TICKET_STATUSES as TicketStatus[];
    let rejected = 0;
    for (const from of statuses) {
      for (const to of statuses) {
        if (permitted.has(`${from}->${to}`)) continue;
        rejected += 1;
        expect(isTicketTransitionAllowed(from, to), `${from} -> ${to}`).toBe(false);
      }
    }
    expect(rejected).toBe(44);
  });
});

describe('UNIT-06: resolution gate', () => {
  const codes = (r: { code: string }[]) => r.map((x) => x.code);

  it('holds with an owner, a COMPLETED Action and nothing open', () => {
    expect(evaluateResolutionGate({ hasOwner: true, actionStatuses: ['COMPLETED'] })).toEqual([]);
    expect(evaluateResolutionGate({ hasOwner: true, actionStatuses: ['COMPLETED', 'CANCELLED', 'COMPLETED'] })).toEqual([]);
  });

  it('fails alone on a missing owner', () => {
    const r = evaluateResolutionGate({ hasOwner: false, actionStatuses: ['COMPLETED'] });
    expect(codes(r)).toEqual(['OWNER_MISSING']);
  });

  it('fails alone with no COMPLETED Action (no Actions at all)', () => {
    expect(codes(evaluateResolutionGate({ hasOwner: true, actionStatuses: [] }))).toEqual(['NO_COMPLETED_ACTION']);
  });

  it('fails alone when an Action is still open, with the count', () => {
    const r = evaluateResolutionGate({ hasOwner: true, actionStatuses: ['COMPLETED', 'PLANNED', 'IN_PROGRESS'] });
    expect(codes(r)).toEqual(['OPEN_ACTIONS_REMAIN']);
    expect(r[0]).toMatchObject({ count: 2, message: '2 Actions Taken are still Planned or In Progress.' });
  });

  it('uses the singular for one open Action', () => {
    const r = evaluateResolutionGate({ hasOwner: true, actionStatuses: ['COMPLETED', 'PLANNED'] });
    expect(r[0]).toMatchObject({ count: 1, message: '1 Action Taken is still Planned or In Progress.' });
  });

  it('lists every failed condition in the fixed order', () => {
    const r = evaluateResolutionGate({ hasOwner: false, actionStatuses: ['PLANNED', 'IN_PROGRESS'] });
    expect(codes(r)).toEqual(['OWNER_MISSING', 'NO_COMPLETED_ACTION', 'OPEN_ACTIONS_REMAIN']);
    expect(r[2]!.count).toBe(2);
    expect(r[0]).not.toHaveProperty('count');
  });

  it('CANCELLED Actions neither satisfy (b) nor block (c)', () => {
    const r = evaluateResolutionGate({ hasOwner: true, actionStatuses: ['CANCELLED', 'CANCELLED'] });
    expect(codes(r)).toEqual(['NO_COMPLETED_ACTION']);
  });
});

describe('UNIT-06: closing gate (BR-40)', () => {
  it('is open when no Action is PLANNED or IN_PROGRESS', () => {
    expect(evaluateClosingGate([])).toEqual([]);
    expect(evaluateClosingGate(['COMPLETED', 'CANCELLED'])).toEqual([]);
  });

  it('reports only OPEN_ACTIONS_REMAIN with the count', () => {
    const r = evaluateClosingGate(['PLANNED', 'IN_PROGRESS', 'COMPLETED']);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ code: 'OPEN_ACTIONS_REMAIN', count: 2 });
  });
});
