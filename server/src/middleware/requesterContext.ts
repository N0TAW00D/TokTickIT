import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma.ts';

// The reusable building block every Requester-scoped ("🔒") endpoint mounts
// (api-spec.md §1.2, BR-13, A-10). It resolves the caller from the
// `X-Requester-Id` header and, once resolved, exposes a minimal, typed
// requester context to downstream handlers via `req.requester`.
//
// Reference-data endpoints (/categories, /related-systems, /requesters) do
// not mount this middleware and therefore ignore the header entirely, as
// required by api-spec.md §1.2.

export interface RequesterContext {
  id: number;
  name: string;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Populated by `requesterContext` once the header resolves to an active Requester. */
      requester?: RequesterContext;
    }
  }
}

function missingRequester(res: Response): void {
  res.status(400).json({
    error: 'MISSING_REQUESTER',
    message: 'A valid X-Requester-Id header is required.',
  });
}

function invalidRequester(res: Response): void {
  res.status(400).json({
    error: 'INVALID_REQUESTER',
    message: 'X-Requester-Id does not reference an active Requester.',
  });
}

export async function requesterContext(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.header('X-Requester-Id');
  const trimmed = header?.trim() ?? '';

  // Missing, empty, non-numeric, or <= 0 -> 400 MISSING_REQUESTER.
  // A strict all-digits check rejects signs, decimals, and exponents, which
  // "non-numeric" is meant to cover (api-spec.md §1.2).
  if (trimmed === '' || !/^\d+$/.test(trimmed)) {
    missingRequester(res);
    return;
  }

  const id = Number(trimmed);
  if (!Number.isSafeInteger(id) || id <= 0) {
    missingRequester(res);
    return;
  }

  try {
    const requester = await prisma.requesterUser.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, isActive: true },
    });

    if (!requester || !requester.isActive) {
      invalidRequester(res);
      return;
    }

    req.requester = { id: requester.id, name: requester.name, email: requester.email };
    next();
  } catch (error) {
    console.error('Error resolving requester context:', error);
    res.status(500).json({ error: 'INTERNAL', message: 'An unexpected error occurred.' });
  }
}
