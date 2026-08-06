import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';

const app: Express = express();

app.use(cors());

app.get('/', (req: Request, res: Response) => {
  res.send('Hello World!');
});

app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', service: 'TokTickIT API' });
});

export default app;
