# Proposal: Paired Input/Output Prompt Syncing for Oh My Prompt

## Overview
Currently, the system logs individual input prompts to MinIO using content-based hashing. To improve analysis quality, we need to capture the assistant's output (responses) and link them directly to the corresponding input prompts.

## Proposed Schema

### 1. Storage Structure (MinIO)
We will maintain the multi-user structure but introduce a pairing suffix:

- **Input Prompt**: `{USER_TOKEN}/{YYYY}/{MM}/{DD}/{INPUT_HASH}.json`
- **Output Prompt**: `{USER_TOKEN}/{YYYY}/{MM}/{DD}/{INPUT_HASH}_output.json`

Using the same `INPUT_HASH` for both files ensures a 1:1 relationship that is easy to join without complex database lookups.

### 2. JSON Payloads

#### Input JSON
```json
{
  "timestamp": "ISO-8601",
  "working_directory": "path/to/project",
  "project_name": "name",
  "prompt": "Full input text...",
  "prompt_length": 123,
  "type": "input"
}
```

#### Output JSON
```json
{
  "timestamp": "ISO-8601",
  "input_hash": "original_input_hash",
  "input_timestamp": "ISO-8601",
  "response": "Full assistant text...",
  "response_length": 456,
  "type": "output"
}
```

## Implementation Strategy

### A. Real-time Hook Improvement (`~/.claude/hooks/prompt-logger.sh`)
1. **Input Stage**: 
   - Calculate `INPUT_HASH`.
   - Write `INPUT_HASH` to a local state file: `/tmp/claude_last_prompt_{SESSION_ID}.hash`.
   - Upload input JSON.
2. **Output Stage**:
   - Read `INPUT_HASH` from the state file.
   - Upload output JSON using `{INPUT_HASH}_output.json`.

### B. Background Sync Service Improvement
- Modify `src/services/sync.ts` and the backup scripts to process `.jsonl` files turn-by-turn.
- Ensure that an `assistant` message is always mapped to the immediately preceding `user` message.

## Benefits
- **Paired Analysis**: Directly compare "Prompt vs Response" in the UI.
- **Deduplication**: Content-based hashing prevents redundant storage of identical prompts while allowing unique responses to be captured.
- **Multi-tenancy**: Fully compatible with the existing `USER_TOKEN` isolation.
