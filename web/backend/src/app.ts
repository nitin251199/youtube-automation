import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import { config } from './config.js';
import { videosRouter, HttpError } from './routes/videos.js';
import { systemRouter } from './routes/system.js';
import type { Bus } from './bus.js';
import type { JobQueue } from './queue.js';

export function createApp(bus: Bus, queue: JobQueue) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: config.origin }));
  app.use(express.json({ limit: '2mb' }));
  app.get('/api/health', (_req, res) => { res.json({ ok: true }); });
  app.use('/api/videos', videosRouter(bus, queue));
  app.use('/api/system', systemRouter(queue));
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Not found.' }); });
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = error instanceof HttpError ? error.status : error instanceof multer.MulterError ? 400 : 500;
    if (status === 500) console.error(error);
    if (res.headersSent) return res.end();
    res.status(status).json({ error: status === 500 ? 'Unexpected server error. Check the backend log.' : error.message });
  });
  return app;
}
