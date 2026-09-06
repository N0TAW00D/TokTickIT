import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma.ts';

// GET /api/related-systems — api-spec.md §2.2. Not Requester-scoped: no
// requesterContext middleware is mounted here, so the X-Requester-Id header
// is ignored, per §1.2.
export const relatedSystemsRouter: Router = Router();

relatedSystemsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const relatedSystems = await prisma.relatedSystem.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    res.status(200).json(relatedSystems);
  } catch (error) {
    console.error('Error fetching related systems:', error);
    res.status(500).json({ error: 'INTERNAL', message: 'An unexpected error occurred.' });
  }
});
