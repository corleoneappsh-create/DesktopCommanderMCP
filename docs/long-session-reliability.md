# Long-session reliability (0.2.48)

Desktop Commander distinguishes a tool-call wait timeout from the lifetime of the spawned process. A timeout returns the PID and leaves the process running.

## Reliability changes

- The default initial wait is 10 seconds instead of 1 second.
- Refreshed remote-auth sessions are queued and written atomically after every `TOKEN_REFRESHED` event.
- Every spawned process receives a private persistent log and registry record under `~/.desktop-commander/jobs`.
- A new server instance can rediscover a still-running PID and read its persistent output after reconnect or agent restart.
- Recovered jobs are read/terminate capable. Interactive stdin cannot be reconstructed after the original parent process exits.
- Per-job persistent logs are capped at 100 MB; terminal memory remains capped separately at 50 MB.
- Remote launchers use one cross-platform supervisor with an atomic lock, bounded retry backoff, live log rotation, and no duplicate-process takeover.
- Remote tool arguments/results are compacted before diagnostic logging.

## Verification

```sh
npm run test:long-sessions
npm test
npm run test:three-modes
npm audit --omit=dev
```

`test:three-modes` compares direct execution without a plugin, the legacy plugin profile, and the optimized 0.2.48 plugin profile.

## Rollback

The changes are isolated in the 0.2.48 reliability commits. Restore the previous release directory or reset the deployment symlink to 0.2.47, then restart the platform supervisor. Existing job logs and registry files are local evidence and may be retained or removed independently.
