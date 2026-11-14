// Example CRUD resource. Use as a template for new routes.

import { Router } from 'express';
import type { CreateItemRequest } from '@runman/shared';
import { itemsStore } from '../services/itemsService.js';
import { HttpError } from '../middleware/errorHandler.js';

export const itemsRouter = Router();

itemsRouter.get('/', async (_req, res) => {
  res.json(await itemsStore.list());
});

itemsRouter.get('/:id', async (req, res) => {
  const item = await itemsStore.get(req.params.id);
  if (!item) throw new HttpError(404, 'Item not found');
  res.json(item);
});

itemsRouter.post('/', async (req, res) => {
  const body = req.body as Partial<CreateItemRequest>;
  if (!body?.name || typeof body.name !== 'string') {
    throw new HttpError(400, '`name` is required');
  }
  const item = await itemsStore.create({ name: body.name, description: body.description });
  res.status(201).json(item);
});

itemsRouter.delete('/:id', async (req, res) => {
  await itemsStore.remove(req.params.id);
  res.status(204).end();
});
