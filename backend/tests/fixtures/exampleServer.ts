import { createApp } from '../../src/app.js';

const server = createApp().listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  console.log(JSON.stringify({ port: address.port }));
});
