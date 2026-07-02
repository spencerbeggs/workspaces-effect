import { Cache, Data, Duration, Effect } from "effect";
import { describe, expect, it } from "vitest";

interface AtKeyShape {
	readonly root: string;
	readonly ref: string;
}

describe("at-ref cache construction (effect Cache, capacity-bounded, no TTL)", () => {
	const make = (capacity: number, counter: { count: number }) =>
		Cache.make({
			capacity,
			timeToLive: Duration.infinity,
			lookup: (key: AtKeyShape) => {
				counter.count += 1;
				return Effect.succeed(`snapshot:${key.root}:${key.ref}`);
			},
		});

	it("returns the cached value without re-running the lookup", async () => {
		const counter = { count: 0 };
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const cache = yield* make(64, counter);
				const key = Data.struct({ root: "/r", ref: "abc" });
				const first = yield* cache.get(key);
				const second = yield* cache.get(Data.struct({ root: "/r", ref: "abc" }));
				return [first, second] as const;
			}),
		);
		expect(result[0]).toBe("snapshot:/r:abc");
		expect(result[1]).toBe("snapshot:/r:abc");
		expect(counter.count).toBe(1);
	});

	it("evicts past capacity and re-reads evicted keys correctly", async () => {
		const counter = { count: 0 };
		await Effect.runPromise(
			Effect.gen(function* () {
				const cache = yield* make(2, counter);
				yield* cache.get(Data.struct({ root: "/r", ref: "a" }));
				yield* cache.get(Data.struct({ root: "/r", ref: "b" }));
				yield* cache.get(Data.struct({ root: "/r", ref: "c" }));
				// "a" was evicted (capacity 2); getting it again re-runs the lookup
				// and still returns the correct value.
				const again = yield* cache.get(Data.struct({ root: "/r", ref: "a" }));
				expect(again).toBe("snapshot:/r:a");
			}),
		);
		expect(counter.count).toBe(4);
	});

	it("deduplicates concurrent in-flight lookups for the same key", async () => {
		const counter = { count: 0 };
		await Effect.runPromise(
			Effect.gen(function* () {
				const cache = yield* Cache.make({
					capacity: 64,
					timeToLive: Duration.infinity,
					lookup: (key: AtKeyShape) => {
						counter.count += 1;
						return Effect.succeed(`snapshot:${key.root}:${key.ref}`).pipe(Effect.delay("20 millis"));
					},
				});
				const key = Data.struct({ root: "/r", ref: "abc" });
				yield* Effect.all([cache.get(key), cache.get(key), cache.get(key)], { concurrency: "unbounded" });
			}),
		);
		expect(counter.count).toBe(1);
	});
});
