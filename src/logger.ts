import fs from 'fs';
import path from 'path';

const LOG_DIR = path.join(__dirname, '..', 'logs');

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function write(file: string, msg: string): void {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  fs.appendFileSync(path.join(LOG_DIR, file), `[${ts}] ${msg}\n`);
}

export const log = {
  server(msg: string): void {
    const line = `[SERVER] ${msg}`;
    console.log(line);
    write('server.log', line);
  },

  engine(msg: string): void {
    const line = `[ENGINE] ${msg}`;
    console.log(line);
    write('engine.log', line);
  },

  error(msg: string, err?: Error): void {
    const stack = err?.stack ? `\n${err.stack}` : '';
    const line = `[ERROR] ${msg}${stack}`;
    console.error(line);
    write('errors.log', line);
  },
};
