import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execNodeScript } from "../../scripts/test-db.lib.js";

// Regression test for the `shell: true` defect raised in PR #22 review round
// 2: `test-db.lib.ts` used to run `execFileSync("npx", args, { shell:
// process.platform === "win32" })`. With a shell, argv is concatenated into
// one command line and re-split by the shell's own quoting rules, so any
// argument containing a space silently becomes two arguments — exactly what
// happens to a seed path derived from a repository checked out under e.g.
// "C:\Users\me\My Documents\TokTickIT". `execNodeScript` fixes this by
// spawning `process.execPath` directly against a resolved entry script with
// no `shell` option at all, so argv is never re-parsed by anything.
//
// This is also why the full `npm test` run never prints a `[DEP0190]`
// DeprecationWarning: that warning fires specifically when `shell: true` is
// combined with an argv array, and nothing in this codebase sets `shell`
// any more (verified separately by grepping a full test run's output).

describe("execNodeScript argv handling (PR #22 review round 2, point 1)", () => {
  let workDir: string;

  beforeAll(() => {
    workDir = mkdtempSync(path.join(tmpdir(), "test-db-runner-"));
  });

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  // The exact string that broke under `shell: true`: a space (the reported
  // failure mode) plus a shell metacharacter (`;`) that a shell would be
  // tempted to treat as a command separator.
  const dangerousArg = "/tmp/My Documents/seed.ts; touch pwned";

  it("execFileSync with an argv array and no shell option preserves a spaced, metacharacter-bearing argument", () => {
    const echoArgvScript = path.join(workDir, "echo-argv.js");
    writeFileSync(
      echoArgvScript,
      "console.log(JSON.stringify(process.argv.slice(2)));\n"
    );

    // This is deliberately the same shape as `execNodeScript`'s own call —
    // `execFileSync(process.execPath, [script, ...args], { ...no shell })`
    // — spelled out directly so the property being guarded is visible at
    // the call site, not hidden behind the helper under test.
    const output = execFileSync(
      process.execPath,
      [echoArgvScript, dangerousArg],
      { cwd: workDir, encoding: "utf-8" }
    );
    const receivedArgv = JSON.parse(output) as string[];

    // The whole point: exactly one argv element, byte-for-byte identical to
    // what was passed in. Under the old `shell: true` behaviour this
    // argument would arrive split into "/tmp/My" and "Documents/seed.ts;
    // touch pwned" (or worse, with `;` interpreted as a command
    // separator) — this assertion fails under that behaviour and passes
    // under the array-based spawn.
    expect(receivedArgv).toHaveLength(1);
    expect(receivedArgv[0]).toBe(dangerousArg);
  });

  it("execNodeScript — the library's actual invocation — round-trips the same argument intact", () => {
    const outFile = path.join(workDir, "out.json");
    const writeArgvScript = path.join(workDir, "write-argv.js");
    writeFileSync(
      writeArgvScript,
      `require("node:fs").writeFileSync(${JSON.stringify(
        outFile
      )}, JSON.stringify(process.argv.slice(2)));\n`
    );

    execNodeScript(writeArgvScript, [dangerousArg], {
      cwd: workDir,
      stdio: "pipe",
    });

    const receivedArgv = JSON.parse(readFileSync(outFile, "utf-8")) as string[];

    expect(receivedArgv).toHaveLength(1);
    expect(receivedArgv[0]).toBe(dangerousArg);
  });
});
