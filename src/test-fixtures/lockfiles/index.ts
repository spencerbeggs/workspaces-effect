import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const fixtures = {
	pnpm: join(__dirname, "pnpm-lock.yaml"),
	npm: join(__dirname, "package-lock.json"),
	yarn: join(__dirname, "yarn.lock"),
	bun: join(__dirname, "bun.lock"),
} as const;
