import { Router, type Request, type Response } from 'express';
import { authenticate, passwordChangeGate, requireRole } from '../middleware/authContext.ts';
import { buildRequesterDashboard } from '../services/requesterDashboard.ts';

// api-spec.md §4 and §5. Role-gated collections: a caller whose role never
// reaches the endpoint gets 403 straight after the gate (§1.1), before any
// lookup. Neither endpoint reads any query parameter.
export const dashboardRouter: Router = Router();

function internalError(res: Response): void {
  res.status(500).json({ error: 'INTERNAL', message: 'An unexpected error occurred.' });
}

dashboardRouter.get(
  '/requester',
  authenticate,
  passwordChangeGate,
  requireRole('REQUESTER'),
  async (req: Request, res: Response) => {
    try {
      res.status(200).json(await buildRequesterDashboard(req.authUser!.id, new Date()));
    } catch (error) {
      console.error('Error building requester dashboard:', error);
      internalError(res);
    }
  }
);
