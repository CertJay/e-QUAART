import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();
app.listen(config.port, () => {
  console.log(`E-QuAART API listening on http://localhost:${config.port}/api/v1`);
});
