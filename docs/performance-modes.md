# Remote Desktop Commander performance modes (v0.2.47)

Version 0.2.47 adds a reproducible three-mode test matrix and an optimized production profile.

## Modes

| Mode | Purpose | How it runs |
|---|---|---|
| `direct` | Baseline without the plugin | Native `child_process` and direct process streams |
| `legacy-plugin` | Compatibility comparison with 0.2.46 behavior | Default configured shell, 50 ms polling, separate identical searches |
| `optimized-plugin` | New default in 0.2.47 | Safe fast-shell routing, adaptive polling, search coalescing, corrected line buffering |

The production default is `optimized-plugin`. To temporarily use the old execution behavior:

```bash
DC_PLUGIN_MODE=legacy-plugin node dist/index.js
```

Return to the optimized mode with `DC_PLUGIN_MODE=optimized-plugin`, or remove the variable.

## Test commands

```bash
npm test
npm run test:three-modes
```

The three-mode runner writes a JSON report to `artifacts/performance/three-mode-<platform>-<arch>.json` containing median shell and streaming latency plus duplicate-search session counts.

## Optimizations

- Conservative `cmd.exe` or `/bin/sh` fast path for allow-listed simple commands.
- PowerShell, zsh, variables, pipelines, redirection, and compound expressions remain on the configured shell.
- Identical active searches share one `ripgrep` process, including concurrent starts.
- Polling uses 10 ms intervals for the first 250 ms, then backs off to 50 ms.
- Python and other prompts emitted through `stderr` are recognized immediately.
- Streaming line buffers no longer mutate completed lines behind the read cursor.
- Remote launcher examples use direct stream redirection instead of per-line PowerShell `Add-Content`.

## Rollback

Runtime rollback does not require reinstalling: set `DC_PLUGIN_MODE=legacy-plugin`. Source rollback is the Git tag preceding `v0.2.47`.
