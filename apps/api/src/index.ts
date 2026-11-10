import dotenv from 'dotenv';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

dotenv.config();

const config = loadConfig();
const app = buildApp({ config });

const start = async () => {
  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    console.log(`stabsstod api listening on http://${config.HOST}:${config.PORT}`);
  } catch (err) {
    console.error('failed to start api', err);
    process.exit(1);
  }
};

void start();
