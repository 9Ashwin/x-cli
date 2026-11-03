import { execFileSync } from "node:child_process";
import { chmod, mkdir } from "node:fs/promises";
import { build } from "esbuild";

// The page adapter is bundled separately: it runs inside the page and is
// injected as one string, so it cannot be an ES module and cannot import at
// runtime.
await mkdir("dist", { recursive: true });
await build({
	entryPoints: ["src/page/index.ts"],
	bundle: true,
	format: "iife",
	globalName: "XPage",
	target: "chrome120",
	outfile: "dist/page-adapter.js",
});
execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"], { stdio: "inherit" });
await chmod("dist/cli.js", 0o755);
