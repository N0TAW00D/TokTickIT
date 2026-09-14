import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma.ts';

// GET /api/requesters — api-spec.md §2.3. Not Requester-scoped: no
// requesterContext middleware is mounted here, so the X-Requester-Id header
// is ignored, per §1.2.
export const requestersRouter: Router = Router();

requestersRouter.get('/', async (_req: Request, res: Response) => {
  try {
    // Lab 3 renames RequesterUser to User and adds IT Staff/Administrator
    // rows to the same table (docs/lab-03/specification.md §7.4 item 1) —
    // the role filter keeps this Lab 2 endpoint returning only Requesters,
    // as it always has.
    const requesters = await prisma.user.findMany({
      where: { isActive: true, role: 'REQUESTER' },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });
    res.status(200).json(requesters);
  } catch (error) {
    console.error('Error fetching requesters:', error);
    res.status(500).json({ error: 'INTERNAL', message: 'An unexpected error occurred.' });
  }
});
