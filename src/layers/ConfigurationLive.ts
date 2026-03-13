import { Layer } from "effect";
import { DiscoveryLive } from "./DiscoveryLive.js";
import { LockfileReaderLive } from "./LockfileReaderLive.js";

/** All Phase 4 services. */
export const ConfigurationLive = LockfileReaderLive;

/** Full stack: Discovery + Configuration. */
export const FullConfigLive = ConfigurationLive.pipe(Layer.provide(DiscoveryLive));
