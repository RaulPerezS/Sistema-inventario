import { execSync } from 'node:child_process';
import { config } from 'dotenv';

export default function setup() {
  const { parsed } = config({ path: '.env.test', override: true });
  // Aplica las migraciones pendientes sobre la base de datos de pruebas (no destructivo)
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, ...parsed },
  });
}
