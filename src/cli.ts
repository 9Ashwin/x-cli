#!/usr/bin/env node
import { run } from "./main.ts";

// A reader that stops early — `xx --version | head -1`, or any pipeline whose
// consumer exits — closes the pipe and the next write raises EPIPE. Node's
// default turns that into an unhandled error, which makes a normal `head` look
// like a crash.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
	if (error.code === "EPIPE") process.exit(0);
	throw error;
});

const controller = new AbortController();
const cancel = () => controller.abort(new DOMException("Operation cancelled", "AbortError"));
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
try {
	process.exitCode = await run(process.argv.slice(2), undefined, controller.signal);
} finally {
	process.removeListener("SIGINT", cancel);
	process.removeListener("SIGTERM", cancel);
}
