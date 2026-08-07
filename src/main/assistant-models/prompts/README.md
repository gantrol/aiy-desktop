# Assistant prompt profiles

Keep one business scenario per prompt module. Model adapters own transport,
authentication, provider errors, and response parsing; prompt modules own the
scenario instructions, compact creator payload, output budget, sampling
settings, and a versioned profile ID.

- `direction-scout-prompt.ts`: divergent inspiration and adjacent exploration.
- `prompt-optimization-prompt.ts`: structured edits to the user instruction.
- `codex-assist-prompt.ts`: Codex-specific assistant instructions and prompt assembly.
- `*-web-search-prompt.ts`: provider-specific search instructions.
- `creator-assist-payload.ts`: bounded provider-neutral creator input serialization.
- `common.ts`: safety and structured-output rules shared by prompt scenarios.

When behavior changes materially, increment the profile ID. Do not add
provider credentials, application state access, database reads, or hidden
conversation history to a prompt module. Any prior coverage must be explicit,
bounded input persisted with the AssistantRun.
