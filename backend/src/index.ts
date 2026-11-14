// Local development entry point: `npm run dev:backend`
import 'dotenv/config';
import { createApp } from './app.js';
import { config } from './config.js';
import { storageMode } from './services/itemsService.js';

createApp().listen(config.port, () => {
  console.log(`runman API listening on http://localhost:${config.port} (storage: ${storageMode})`);
});
