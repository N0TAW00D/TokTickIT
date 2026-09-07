import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { categoriesRouter } from './routes/categories.ts';
import { relatedSystemsRouter } from './routes/relatedSystems.ts';
import { requestersRouter } from './routes/requesters.ts';
import { ticketsRouter } from './routes/tickets.ts';
import { attachmentsRouter } from './routes/attachments.ts';

const app: Express = express();

app.use(cors());

// Routes that must NEVER go through the global JSON body parser below.
//
// POST /api/tickets/:id/attachments requires multipart/form-data and, per
// api-spec.md §1.4a, must answer anything else with 400 NO_FILE — that
// classification is entirely multer's job, done inside the route itself
// (src/routes/tickets.ts). If express.json() ran first it would intercept
// the request before the route ever saw it: a body that's invalid JSON
// became 400 MALFORMED_BODY, and a body over express.json()'s default
// 100kb limit became a bare Express 413 with no `error` key at all (§1.3
// requires one on every error, and §1.5 reserves 413 for an oversized
// *attachment file*, not an oversized JSON body). So this path is skipped
// entirely — multer becomes the only body parser that ever runs for it,
// and it reports every non-multipart request as NO_FILE.
//
// Add further entries here as needed. DELETE /api/attachments/:id (slice
// 9b, not on this branch) requires `application/json` per §1.4a and must
// NOT be added — it needs to keep going through the parser below.
const JSON_PARSING_SKIP_ROUTES: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  { method: 'POST', pattern: /^\/api\/tickets\/[^/]+\/attachments\/?$/ },
];

function skipsJsonParsing(req: Request): boolean {
  return JSON_PARSING_SKIP_ROUTES.some(({ method, pattern }) => req.method === method && pattern.test(req.path));
}

// JSON body parsing for POST /api/tickets and (later) DELETE
// /api/attachments/:id (api-spec.md §1.4). express.json() leaves req.body
// undefined when Content-Type isn't application/json — routes treat that as
// MALFORMED_BODY themselves — but throws a SyntaxError for a body that *is*
// declared as JSON and isn't parsable. Without the handler below, Express's
// default error handler would turn that into an unstyled 400 HTML page (or,
// depending on error-handling middleware order elsewhere, an unhandled
// 500) instead of the standard `{ error: "MALFORMED_BODY" }` body §1.3
// requires.
const jsonBodyParser = express.json();
app.use((req: Request, res: Response, next: NextFunction) => {
  if (skipsJsonParsing(req)) {
    next();
    return;
  }
  jsonBodyParser(req, res, next);
});
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
app.use('/api/attachments', attachmentsRouter);

export default app;
