# Desktop Commander 0.2.48 — long-session reliability evidence

## Result

- Full regression: **54/54 passed**, 0 failed, 256.7s.
- Focused long-session tests: **PASS**.
- Enforced three-mode benchmark: **PASS**.
- Production dependency audit: **0 vulnerabilities**.

## Plugin comparison after changes

| Mode | Shell median | Streaming median | Duplicate search sessions | Search elapsed |
|---|---:|---:|---:|---:|
| No plugin (direct) | 81.01 ms | 0.18 ms | — | — |
| Legacy plugin | 118.24 ms | 51.38 ms | 2 | 120.39 ms |
| Optimized 0.2.48 plugin | 101.54 ms | 18.88 ms | 1 | 50.07 ms |

The optimized plugin is **14.1% faster** for shell startup, **63.3% faster** for streaming, and **58.4% faster** for the duplicate-search scenario than the legacy plugin in the isolated run. It also reuses one search session instead of creating two.

## Baseline 0.2.47 → 0.2.48

- Direct shell: 116.82 → 81.01 ms (-30.7%).
- Optimized plugin shell: 148.32 → 101.54 ms (-31.5%).
- Optimized plugin streaming: 35.33 → 18.88 ms (-46.6%).
- Optimized duplicate search: 104.29 → 50.07 ms (-52.0%).

Benchmarks use seven repetitions on macOS x64 with Node v22.23.0. Timing varies by host load; functional assertions and search-session counts are enforced separately.

## Commands

```sh
npm run test:long-sessions
npm test
npm run test:three-modes
npm audit --omit=dev
```

## Windows x64 verification

Focused reliability tests and the enforced three-mode benchmark also passed on Windows x64 with Node v24.18.0.

| Mode | Shell median | Streaming median | Duplicate search sessions | Search elapsed |
|---|---:|---:|---:|---:|
| No plugin (direct) | 30.56 ms | 0.11 ms | — | — |
| Legacy plugin | 133.16 ms | 62.45 ms | 2 | 199.01 ms |
| Optimized 0.2.48 plugin | 48.40 ms | 12.71 ms | 1 | 34.58 ms |

On Windows, the optimized plugin was 63.7% faster than the legacy plugin for shell startup, 79.6% faster for streaming, and 82.6% faster for duplicate search. The optimized profile used `cmd.exe`; the legacy profile used `powershell.exe`.
