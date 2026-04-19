import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load env from worker project root (works for `tsx src/index.ts` and `node dist/index.js`).
 * Order: .env then .env.local (later overrides).
 */
export function loadWorkerEnv(): void {
  const root = resolve(__dirname, "..");
  config({ path: resolve(root, ".env") });
  config({ path: resolve(root, ".env.local") });
}
