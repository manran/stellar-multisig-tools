import { createServer } from 'node:http';

import { closeCoordinationPool } from '../../db/postgres.js';
import { handleNodeHttpRequest } from './httpAdapter.js';

const port = Number.parseInt(process.env.PORT?.trim() || '3000', 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const server = createServer((request, response) => {
  void handleNodeHttpRequest(request, response);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`MST Stellar API listening on 0.0.0.0:${port}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}; shutting down.`);
  server.close(async () => {
    try {
      await closeCoordinationPool();
      process.exit(0);
    } catch (cause) {
      console.error('Unable to close PostgreSQL pool cleanly', cause);
      process.exit(1);
    }
  });
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void shutdown(signal);
  });
}
