/**
 * Shared fixture path helpers for integration tests.
 */

import { resolve } from "node:path";

const FIXTURES = resolve(import.meta.dirname, "../integration/fixtures");

export const fixture = (pm: string, version: string) => resolve(FIXTURES, pm, version);
export const pnpmFixture = (version: string) => fixture("pnpm", version);
export const bunFixture = (version: string) => fixture("bun", version);
export const npmFixture = (version: string) => fixture("npm", version);
export const yarnFixture = (version: string) => fixture("yarn", version);

const DISCOVERY_FIXTURES = resolve(import.meta.dirname, "../integration/fixtures/discovery");

export const discoveryFixture = (...segments: string[]) => resolve(DISCOVERY_FIXTURES, ...segments);
