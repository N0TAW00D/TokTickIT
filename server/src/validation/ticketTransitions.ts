// Pure Ticket-workflow rules (specification.md §5.1, BR-16, BR-17, BR-40;
// api-spec.md §3.2). DB- and Express-free: the transaction that holds the
// Ticket lock supplies the Ticket's owner and its Actions' statuses.

import { TicketStatus } from '../generated/prisma/client.ts';

/**
 * The status transition matrix (specification.md §5.1): every status mapped to
 * the statuses it may move to directly. Unchanged from Lab 3. A pair not
 * listed - including a status to itself - is `409 INVALID_TRANSITION`.
 * `Record<TicketStatus, ...>` makes TypeScript enforce a row per enum member.
 */
export const TICKET_STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  [TicketStatus.NEW]: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.CANCELLED],
  [TicketStatus.OPEN]: [
    TicketStatus.IN_PROGRESS,
    TicketStatus.WAITING_FOR_REQUESTER,
    TicketStatus.RESOLVED,
    TicketStatus.CANCELLED,
  ],
  [TicketStatus.IN_PROGRESS]: [TicketStatus.WAITING_FOR_REQUESTER, TicketStatus.RESOLVED, TicketStatus.CANCELLED],
  [TicketStatus.WAITING_FOR_REQUESTER]: [TicketStatus.IN_PROGRESS, TicketStatus.RESOLVED, TicketStatus.CANCELLED],
  [TicketStatus.RESOLVED]: [TicketStatus.CLOSED, TicketStatus.REOPENED],
  [TicketStatus.CLOSED]: [TicketStatus.REOPENED],
  [TicketStatus.REOPENED]: [
    TicketStatus.IN_PROGRESS,
    TicketStatus.WAITING_FOR_REQUESTER,
    TicketStatus.RESOLVED,
    TicketStatus.CANCELLED,
  ],
  // Terminal: an empty row (not an absent one) keeps the lookup total.
  [TicketStatus.CANCELLED]: [],
};

export const ALL_TICKET_STATUSES: readonly string[] = Object.values(TicketStatus);

export function isTicketTransitionAllowed(from: TicketStatus, to: TicketStatus): boolean {
  return TICKET_STATUS_TRANSITIONS[from].includes(to);
}

export type GateReasonCode = 'OWNER_MISSING' | 'NO_COMPLETED_ACTION' | 'OPEN_ACTIONS_REMAIN';

export interface GateReason {
  code: GateReasonCode;
  message: string;
  /** Present only on OPEN_ACTIONS_REMAIN. */
  count?: number;
}

type ActionStatusName = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

const isOpen = (s: ActionStatusName) => s === 'PLANNED' || s === 'IN_PROGRESS';

function openActionsReason(count: number): GateReason {
  return {
    code: 'OPEN_ACTIONS_REMAIN',
    message: `${count} ${count === 1 ? 'Action Taken is' : 'Actions Taken are'} still Planned or In Progress.`,
    count,
  };
}

/**
 * Resolution gate (BR-17): an Owner, at least one COMPLETED Action and no
 * PLANNED / IN_PROGRESS Action. Returns every failed condition, in the fixed
 * order OWNER_MISSING, NO_COMPLETED_ACTION, OPEN_ACTIONS_REMAIN; an empty
 * list means the gate holds. CANCELLED Actions satisfy neither (b) nor block
 * (c). A requester-resolved indication is deliberately not an input (BR-18).
 */
export function evaluateResolutionGate(input: {
  hasOwner: boolean;
  actionStatuses: readonly ActionStatusName[];
}): GateReason[] {
  const reasons: GateReason[] = [];
  if (!input.hasOwner) reasons.push({ code: 'OWNER_MISSING', message: 'Assign a Ticket Owner first.' });
  if (!input.actionStatuses.includes('COMPLETED')) {
    reasons.push({ code: 'NO_COMPLETED_ACTION', message: 'Complete at least one Action Taken.' });
  }
  const open = input.actionStatuses.filter(isOpen).length;
  if (open > 0) reasons.push(openActionsReason(open));
  return reasons;
}

/** Closing gate (BR-40): the single reason OPEN_ACTIONS_REMAIN while any Action is open. */
export function evaluateClosingGate(actionStatuses: readonly ActionStatusName[]): GateReason[] {
  const open = actionStatuses.filter(isOpen).length;
  return open > 0 ? [openActionsReason(open)] : [];
}
