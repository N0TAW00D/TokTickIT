import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import { prisma } from './lib/prisma.ts';

const app: Express = express();

app.use(cors());

app.get('/', (req: Request, res: Response) => {
  res.send('Hello World!');
});

app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', service: 'TokTickIT API' });
});

app.get('/api/categories', async (req: Request, res: Response) => {
  try{
    const categories = await prisma.category.findMany({
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
    });
    res.status(200).json(categories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default app;
