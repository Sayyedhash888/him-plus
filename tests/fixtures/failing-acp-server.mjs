#!/usr/bin/env node
// Mock ACP agent that fails like a missing/invalid CLI: prints a diagnostic to
// stderr and exits 1. Used by tests/acpClient.test.ts.
process.stderr.write("error: unknown option '--acp'\n");
process.stderr.write('Run with --help to see available options.\n');
process.exit(1);
