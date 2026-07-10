// Load apps/api/.env for tests (jest does not load it by itself).
import * as fs from 'fs';
import * as path from 'path';

// Tests must not register BullMQ repeatable jobs.
process.env.DISABLE_SYNC_QUEUE = '1';
// Rate limiting is off for functional suites; the rate-limit spec re-enables it.
process.env.DISABLE_RATE_LIMIT = '1';

const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2];
    }
  }
}
