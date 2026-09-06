import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import { categoriesRouter } from './routes/categories.ts';
import { requestersRouter } from './routes/requesters.ts';

const app: Express = express();

app.use(cors());

app.get('/', (req: Request, res: Response) => {
  res.send('Hello World!');
});

app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', service: 'TokTickIT API' });
});

app.use('/api/categories', categoriesRouter);

app.use('/api/requesters', requestersRouter);

export default app;
