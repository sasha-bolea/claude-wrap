# Release notes (legal / licensing constraints)

_Technical release matters go in `deploy.md`; this file holds only legal, licensing and publication constraints._

## Subscription login in a third-party app — TO VERIFY before publishing
The Agent SDK documentation (as remembered, not yet re-verified on the current source) says that, without approval, third-party products built on the SDK **must not offer claude.ai login nor use subscription limits**; they should use API key authentication (or Bedrock / Vertex / Foundry).

To decide before the open source release:
- personal use with the subscription: the SDK uses the login of the CLI already installed on the user's machine (`~/.claude`), which is how Sasha runs it, on the PC and on the home server;
- published version: decide whether "the app uses the user's CLI login as it is" is acceptable, or whether only the API key may be exposed as the official method.

## Licence
- Our code: **MIT** (decided 2026-10-02).
- The SDK package `LICENSE.md` (verified on 0.3.285): "© Anthropic PBC. All rights reserved. Use is subject to the Legal Agreements outlined here: https://code.claude.com/docs/en/legal-and-compliance".
- So our code can be open source, but **redistributing the SDK and the CLI binary inside an installer is doubtful**. Until this is verified: **no public installers**; the repository does not include the SDK, which arrives through `npm install`. Packaged builds (`electron-builder --dir`) are for personal use only.
- Re-check dependency licences before publishing. Added on 2026-10-03: `highlight.js` 11 (BSD-3-Clause: keep its copyright notice in a bundled release).
