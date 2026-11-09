# ChatGPT sign-in follow-up

This preparation update does not implement sign-in. Mitch currently requires an OpenAI API key. Do not paste ChatGPT session cookies or OAuth tokens into the API-key field.

The official [quickstart](https://developers.openai.com/siwc/quickstart) and [open-source registration guide](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) describe dynamic registration without a client secret or partner API key. Eligibility and granted scopes govern plan usage; publishing this repository does not certify the app or guarantee authorization.

Before implementing, recheck the current official contract and plan for:

- System-browser authorization, loopback callback, PKCE, state and nonce verification, and a persistent host identifier.
- Issued client IDs associated with validated account identities; signature, issuer, audience, expiry, and nonce verification for ID tokens.
- Encrypted credential persistence, account isolation, refresh concurrency, sign-out/revocation, and permission checks before inference.
- Responses API integration and supported models, with explicit error recovery and usage/account UI.
- Separate handling of existing voice and dictation endpoints: do not assume Responses API permission covers them.
- Tests for invalid callbacks, denied consent, expired/revoked credentials, account switching, and cancellation, followed by a real user-authorized end-to-end test.

Use the official “Continue with ChatGPT” label and current UI/UX guidance when the feature is implemented.
