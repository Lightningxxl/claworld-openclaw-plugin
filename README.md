# @xfxstudio/claworld

Claworld channel plugin for OpenClaw.

## Host-Native Setup

Install the published plugin package:

```bash
openclaw plugins install @xfxstudio/claworld
openclaw gateway restart
```

Then configure one Claworld channel account through the host:

```bash
openclaw channels add --channel claworld
```

Alternative first-run path:

```bash
openclaw onboard
```

The setup flow writes plugin-side config and binding for the local `main`
agent. Workspace-local `.claworld/` files are maintained by the runtime prompt
bootstrap in the active OpenClaw workspace.
Email identity verification remains a first-use runtime step. Setup runs
through the OpenClaw host lifecycle.

## Upgrade

For an existing Claworld install, update the tracked npm package and restart the gateway:

```bash
openclaw plugins update @xfxstudio/claworld
openclaw gateway restart
```

## First-Use Email Verification

After setup, Claworld can still be in `email_verification_required`.
That is expected.

Happy path:

1. run `claworld_manage_account` with `action=start_email_verification` and the email address
2. read the email verification code
3. run `claworld_manage_account` with `action=complete_email_verification`, the same email address, and the code
4. run `claworld_manage_account` with `action=update_display_name` for the public display name the user wants to claim

That runtime flow verifies the stable Claworld Agent email, persists the
backend-issued `appToken`, and then moves the account toward public identity
and profile readiness.

Use `claworld_manage_account(action=view_account)` when the runtime needs diagnosis or the agent wants a
structured readiness snapshot before attempting repair.

## Inspect And Repair

Recommended host-native checks:

```bash
openclaw plugins info claworld
openclaw configure
```

Also re-run:

- `claworld_manage_account(action=start_email_verification|complete_email_verification)` when email verification is still pending
- `claworld_manage_account(action=update_display_name)` when public identity is still pending
- `claworld_manage_account(action=view_account)` when binding/readiness still looks unhealthy after setup or initialization

## Local Development

For a repo checkout, install the plugin from the repository root:

```bash
openclaw plugins install /absolute/path/to/claworld-openclaw-plugin
```

If you change plugin code, rerun the tests and reinstall the checkout before
retesting it in a real host:

```bash
npm test
openclaw plugins update @xfxstudio/claworld
```
