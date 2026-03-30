/**
 * Integration tests for DependencyGraph and TopologicalSorter against real fixtures.
 *
 * Uses actual FileSystem reads (NodeFileSystem.layer) against the generated
 * fixture workspaces. Only WorkspaceRoot is mocked to point at fixtures.
 */

import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { DependencyGraphLive } from "../../src/layers/DependencyGraphLive.js";
import { TopologicalSorterLive } from "../../src/layers/TopologicalSorterLive.js";
import { DependencyGraph } from "../../src/services/DependencyGraph.js";
import { TopologicalSorter } from "../../src/services/TopologicalSorter.js";
import { bunFixture, npmFixture, pnpmFixture, yarnFixture } from "../utils/fixtures.js";
import { makeDiscoveryLayer } from "../utils/layers.js";

// ── Test layer builder ───────────────────────────────────────────────

const makeGraphLayer = (fixturePath: string) => {
	const discoveryLayer = makeDiscoveryLayer(fixturePath);
	const graphLayer = DependencyGraphLive.pipe(Layer.provide(discoveryLayer));
	const sorterLayer = TopologicalSorterLive.pipe(Layer.provide(graphLayer));
	return Layer.mergeAll(graphLayer, sorterLayer);
};

// ── Helpers ──────────────────────────────────────────────────────────

const runGraph = <A>(fixturePath: string, program: Effect.Effect<A, any, DependencyGraph | TopologicalSorter>) =>
	Effect.runPromise(program.pipe(Effect.provide(makeGraphLayer(fixturePath))));

// ── pnpm ─────────────────────────────────────────────────────────────

describe("DependencyGraph + TopologicalSorter integration: pnpm", () => {
	describe("v1", () => {
		const fixturePath = pnpmFixture("v1");

		it("topological sort → snapshot package names in order", async () => {
			const result = await runGraph(
				fixturePath,
				Effect.gen(function* () {
					const sorter = yield* TopologicalSorter;
					return yield* sorter.sort();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("topological levels → snapshot array of level arrays", async () => {
			const result = await runGraph(
				fixturePath,
				Effect.gen(function* () {
					const sorter = yield* TopologicalSorter;
					return yield* sorter.levels();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("dependentsOf(@test-monorepo/utils) → snapshot (core depends on utils)", async () => {
			const result = await runGraph(
				fixturePath,
				Effect.gen(function* () {
					const graph = yield* DependencyGraph;
					return yield* graph.dependentsOf("@test-monorepo/utils");
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("dependenciesOf(@test-monorepo/core) → snapshot (core depends on utils)", async () => {
			const result = await runGraph(
				fixturePath,
				Effect.gen(function* () {
					const graph = yield* DependencyGraph;
					return yield* graph.dependenciesOf("@test-monorepo/core");
				}),
			);
			expect(result).toMatchSnapshot();
		});
	});

	describe("v2", () => {
		const fixturePath = pnpmFixture("v2");

		it("topological sort → snapshot (should include new-pkg)", async () => {
			const result = await runGraph(
				fixturePath,
				Effect.gen(function* () {
					const sorter = yield* TopologicalSorter;
					return yield* sorter.sort();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("topological levels → snapshot array of level arrays", async () => {
			const result = await runGraph(
				fixturePath,
				Effect.gen(function* () {
					const sorter = yield* TopologicalSorter;
					return yield* sorter.levels();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("dependentsOf(@test-monorepo/utils) → snapshot (core + new-pkg depend on utils)", async () => {
			const result = await runGraph(
				fixturePath,
				Effect.gen(function* () {
					const graph = yield* DependencyGraph;
					return yield* graph.dependentsOf("@test-monorepo/utils");
				}),
			);
			expect(result).toMatchSnapshot();
		});
	});
});

// ── bun ──────────────────────────────────────────────────────────────

describe("DependencyGraph + TopologicalSorter integration: bun", () => {
	describe("v1", () => {
		const fixturePath = bunFixture("v1");

		it("topological sort → snapshot package names in order", async () => {
			const result = await runGraph(
				fixturePath,
				Effect.gen(function* () {
					const sorter = yield* TopologicalSorter;
					return yield* sorter.sort();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("topological levels → snapshot array of level arrays", async () => {
			const result = await runGraph(
				fixturePath,
				Effect.gen(function* () {
					const sorter = yield* TopologicalSorter;
					return yield* sorter.levels();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("dependentsOf(@test-monorepo/utils) → snapshot (core depends on utils)", async () => {
			const result = await runGraph(
				fixturePath,
				Effect.gen(function* () {
					const graph = yield* DependencyGraph;
					return yield* graph.dependentsOf("@test-monorepo/utils");
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("dependenciesOf(@test-monorepo/core) → snapshot (core depends on utils)", async () => {
			const result = await runGraph(
				fixturePath,
				Effect.gen(function* () {
					const graph = yield* DependencyGraph;
					return yield* graph.dependenciesOf("@test-monorepo/core");
				}),
			);
			expect(result).toMatchSnapshot();
		});
	});

	describe("v2", () => {
		const fixturePath = bunFixture("v2");

		it("topological sort → snapshot (should include new-pkg)", async () => {
			const result = await runGraph(
				fixturePath,
				Effect.gen(function* () {
					const sorter = yield* TopologicalSorter;
					return yield* sorter.sort();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("topological levels → snapshot array of level arrays", async () => {
			const result = await runGraph(
				fixturePath,
				Effect.gen(function* () {
					const sorter = yield* TopologicalSorter;
					return yield* sorter.levels();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("dependentsOf(@test-monorepo/utils) → snapshot (core + new-pkg depend on utils)", async () => {
			const result = await runGraph(
				fixturePath,
				Effect.gen(function* () {
					const graph = yield* DependencyGraph;
					return yield* graph.dependentsOf("@test-monorepo/utils");
				}),
			);
			expect(result).toMatchSnapshot();
		});
	});
});

// ── npm ──────────────────────────────────────────────────────────────

describe("DependencyGraph + TopologicalSorter integration: npm", () => {
	describe("v1", () => {
		const fixturePath = npmFixture("v1");

		it("topological sort → snapshot package names in order", async () => {
			const result = await runGraph(
				fixturePath,
				Effect.gen(function* () {
					const sorter = yield* TopologicalSorter;
					return yield* sorter.sort();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("topological levels → snapshot array of level arrays", async () => {
			const result = await runGraph(
				fixturePath,
				Effect.gen(function* () {
					const sorter = yield* TopologicalSorter;
					return yield* sorter.levels();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("dependentsOf(@test-monorepo/utils) → snapshot (core depends on utils)", async () => {
			const result = await runGraph(
				fixturePath,
				Effect.gen(function* () {
					const graph = yield* DependencyGraph;
					return yield* graph.dependentsOf("@test-monorepo/utils");
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("dependenciesOf(@test-monorepo/core) → snapshot (core depends on utils)", async () => {
			const result = await runGraph(
				fixturePath,
				Effect.gen(function* () {
					const graph = yield* DependencyGraph;
					return yield* graph.dependenciesOf("@test-monorepo/core");
				}),
			);
			expect(result).toMatchSnapshot();
		});
	});

	describe("v2", () => {
		const fixturePath = npmFixture("v2");

		it("topological sort → snapshot (should include new-pkg)", async () => {
			const result = await runGraph(
				fixturePath,
				Effect.gen(function* () {
					const sorter = yield* TopologicalSorter;
					return yield* sorter.sort();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("topological levels → snapshot array of level arrays", async () => {
			const result = await runGraph(
				fixturePath,
				Effect.gen(function* () {
					const sorter = yield* TopologicalSorter;
					return yield* sorter.levels();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("dependentsOf(@test-monorepo/utils) → snapshot (core + new-pkg depend on utils)", async () => {
			const result = await runGraph(
				fixturePath,
				Effect.gen(function* () {
					const graph = yield* DependencyGraph;
					return yield* graph.dependentsOf("@test-monorepo/utils");
				}),
			);
			expect(result).toMatchSnapshot();
		});
	});
});

// ── yarn ─────────────────────────────────────────────────────────────

describe("DependencyGraph + TopologicalSorter integration: yarn", () => {
	describe("v1", () => {
		const fixturePath = yarnFixture("v1");

		it("topological sort → snapshot package names in order", async () => {
			const result = await runGraph(
				fixturePath,
				Effect.gen(function* () {
					const sorter = yield* TopologicalSorter;
					return yield* sorter.sort();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("topological levels → snapshot array of level arrays", async () => {
			const result = await runGraph(
				fixturePath,
				Effect.gen(function* () {
					const sorter = yield* TopologicalSorter;
					return yield* sorter.levels();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("dependentsOf(@test-monorepo/utils) → snapshot (core depends on utils)", async () => {
			const result = await runGraph(
				fixturePath,
				Effect.gen(function* () {
					const graph = yield* DependencyGraph;
					return yield* graph.dependentsOf("@test-monorepo/utils");
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("dependenciesOf(@test-monorepo/core) → snapshot (core depends on utils)", async () => {
			const result = await runGraph(
				fixturePath,
				Effect.gen(function* () {
					const graph = yield* DependencyGraph;
					return yield* graph.dependenciesOf("@test-monorepo/core");
				}),
			);
			expect(result).toMatchSnapshot();
		});
	});

	describe("v2", () => {
		const fixturePath = yarnFixture("v2");

		it("topological sort → snapshot (should include new-pkg)", async () => {
			const result = await runGraph(
				fixturePath,
				Effect.gen(function* () {
					const sorter = yield* TopologicalSorter;
					return yield* sorter.sort();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("topological levels → snapshot array of level arrays", async () => {
			const result = await runGraph(
				fixturePath,
				Effect.gen(function* () {
					const sorter = yield* TopologicalSorter;
					return yield* sorter.levels();
				}),
			);
			expect(result).toMatchSnapshot();
		});

		it("dependentsOf(@test-monorepo/utils) → snapshot (core + new-pkg depend on utils)", async () => {
			const result = await runGraph(
				fixturePath,
				Effect.gen(function* () {
					const graph = yield* DependencyGraph;
					return yield* graph.dependentsOf("@test-monorepo/utils");
				}),
			);
			expect(result).toMatchSnapshot();
		});
	});
});
