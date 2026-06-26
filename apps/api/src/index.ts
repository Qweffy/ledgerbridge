import { buildServer } from './server';

const PORT = Number(process.env.PORT ?? 3001);

async function start(): Promise<void> {
  const app = buildServer();
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void start();
