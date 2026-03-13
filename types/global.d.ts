export {};

declare global {
	namespace NodeJS {
		interface ProcessEnv {
			/** Automatic package version injected at build time */
			__PACKAGE_VERSION__: string;
		}
	}

	/** Minimal process type for layer construction (cwd discovery). */
	const process: {
		cwd(): string;
		env: NodeJS.ProcessEnv;
	};

	/** Standard Web API available in Node.js and modern runtimes. */
	class TextEncoder {
		encode(input?: string): Uint8Array;
	}
}
