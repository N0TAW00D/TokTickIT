import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { categoriesRouter } from './routes/categories.ts';
import { relatedSystemsRouter } from './routes/relatedSystems.ts';
import { requestersRouter } from './routes/requesters.ts';
import { ticketsRouter } from './routes/tickets.ts';

const app: Express = express();

app.use(cors());

// JSON body parsing for POST /api/tickets and (later) DELETE
// /api/attachments/:id (api-spec.md §1.4). express.json() leaves req.body
// undefined when Content-Type isn't application/json — routes treat that as
// MALFORMED_BODY themselves — but throws a SyntaxError for a body that *is*
// declared as JSON and isn't parsable. Without the handler below, Express's
// default error handler would turn that into an unstyled 400 HTML page (or,
// depending on error-handling middleware order elsewhere, an unhandled
// 500) instead of the standard `{ error: "MALFORMED_BODY" }` body §1.3
// requires.
app.use(express.json());
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  const isJsonParseError =
    err instanceof SyntaxError && 'status' in err && (err as { status?: unknown }).status === 400 && 'body' in err;
  if (!isJsonParseError) {
    next(err);
    return;
  }
  res.status(400).json({
    error: 'MALFORMED_BODY',
    message: 'Request body must be valid JSON.',
  });
});

app.get('/', (req: Request, res: Response) => {
  res.send('Hello World!');
});

app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', service: 'TokTickIT API' });
});

app.use('/api/categories', categoriesRouter);

app.use('/api/related-systems', relatedSystemsRouter);

app.use('/api/requesters', requestersRouter);
app.use('/api/tickets', ticketsRouter);

export default app;
