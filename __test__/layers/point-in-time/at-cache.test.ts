import { Cache, Data, Duration, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

interface AtKeyShape {
	readonly root: string;
	readonly ref: string;
}

describe("at-ref cache construction (effect Cache.makeWith, capacity-bounded, failure-evicting)", () => {
	// Mirrors the exact construction PointInTimeWorkspaceLive ships: capacity
	// bound plus an exit-dependent TTL -- successes are pinned forever (refs
	// are immutable), failures expire immediately so the next get retries.
	const make = <E = never>(
		capacity: number,
		counter: { count: number },
		lookup: (key: AtKeyShape, counter: { count: number }) => Effect.Effect<string, E>,
	) =>
		Cache.makeWith({
			capacity,
			lookup: (key: AtKeyShape) => {
				counter.count += 1;
				return lookup(key, counter);
			},
			timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),
		});

	const succeed = (key: AtKeyShape) => Effect.succeed(`snapshot:${key.root}:${key.ref}`);

	it("returns the cached value without re-running the lookup", async () => {
		const counter = { count: 0 };
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const cache = yield* make(64, counter, succeed);
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
				const cache = yield* make(2, counter, succeed);
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
				const cache = yield* make(64, counter, (key) => succeed(key).pipe(Effect.delay("20 millis")));
				const key = Data.struct({ root: "/r", ref: "abc" });
				yield* Effect.all([cache.get(key), cache.get(key), cache.get(key)], { concurrency: "unbounded" });
			}),
		);
		expect(counter.count).toBe(1);
	});

	it("does not memoize failures: a failed get retries and the success is then pinned", async () => {
		const counter = { count: 0 };
		await Effect.runPromise(
			Effect.gen(function* () {
				const cache = yield* make(64, counter, (key, c) =>
					c.count === 1 ? Effect.fail("transient" as const) : succeed(key),
				);
				const key = Data.struct({ root: "/r", ref: "abc" });
				const first = yield* Effect.exit(cache.get(key));
				expect(Exit.isFailure(first)).toBe(true);
				// The zero-TTL expiry check in effect 3.21 uses strict > on wall-clock
				// millis, so a same-millisecond re-read could still see the failed
				// entry as live -- sleep past the millisecond boundary before retrying.
				yield* Effect.sleep("5 millis");
				const second = yield* cache.get(key);
				expect(second).toBe("snapshot:/r:abc");
				expect(counter.count).toBe(2);
				// The success exit is pinned (infinite TTL): no further lookup.
				const third = yield* cache.get(key);
				expect(third).toBe("snapshot:/r:abc");
				expect(counter.count).toBe(2);
			}),
		);
	});
});
