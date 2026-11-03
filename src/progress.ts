// A write takes seconds and, until now, said nothing until it finished: a reply
// that stalls in the composer looked exactly like a program that had hung.
// Progress goes to stderr as one JSON line per step, so stdout keeps its single
// envelope and a caller that does not ask for progress is unaffected.

export interface Step {
	step: string;
	at: string;
	elapsed_ms: number;
	detail?: Record<string, unknown>;
}

export type Reproduce = (step: string, detail?: Record<string, unknown>) => void;

export const quiet: Reproduce = () => undefined;

export function progressTo(write: (line: string) => unknown): Reproduce {
	const begun = Date.now();
	return (step, detail) => {
		const now = Date.now();
		const line: Step = { step, at: new Date(now).toISOString(), elapsed_ms: now - begun };
		if (detail) line.detail = detail;
		write(`${JSON.stringify({ progress: line })}\n`);
	};
}
