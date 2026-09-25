import { createApp } from './app.js';
import { config } from './config.js';
import { tuneSqlite } from './db.js';

await tuneSqlite();
const app = createApp();
app.listen(config.port, () => {
  console.log(`E-QuAART API listening on http://localhost:${config.port}/api/v1`);
});
