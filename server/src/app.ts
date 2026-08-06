import express, { type Express, type Request, type Response } from 'express';

const app: Express = express();

app.get('/', (req: Request, res: Response) => {
  res.send('Hello World!');
});

app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({ message: 'Express Server is running!' });
});

export default app;
