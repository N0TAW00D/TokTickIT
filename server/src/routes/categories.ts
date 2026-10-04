import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma.ts';

// GET /api/categories — api-spec.md §2.1. Not Requester-scoped: no
// authentication middleware is mounted here at all — it is public reference
// data, per §1.2.
export const categoriesRouter: Router = Router();

categoriesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const categories = await prisma.category.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
    });
    res.status(200).json(categories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'INTERNAL', message: 'An unexpected error occurred.' });
  }
});
