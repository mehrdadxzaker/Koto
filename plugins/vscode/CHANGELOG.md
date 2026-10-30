# Changelog

## 0.1.0 — implementation preview

- Add native project and saved-session navigation for VS Code and Cursor.
- Open the pinned Koto CLI in an owned native IDE pseudoterminal.
- Reuse Koto's subscriptions, optional local models and protected saved state.
- Keep helper setup, work launch, continuation, review and integration explicit.
- Refresh shared session state after stopping a CLI before opening the selected saved session.
- Present confirmed intentional stops as normal terminal closure while retaining actual exit codes in ownership receipts.
- Stop owned work on terminal close/deactivation and retain cleanup uncertainty.
- Restrict execution to trusted local desktop workspaces and User runtime settings.

Installed native workflow qualification is recorded separately from these source
changes and the VSIX package identity.
