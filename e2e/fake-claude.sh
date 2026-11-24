#!/bin/sh
# Stand-in for Claude Code in the e2e run (TESSERA_CLAUDE_PATH): speaks the same stream-json as
# `claude -p --output-format stream-json`, answers every request with one fixed SQL block, and saves
# the prompt it was given to $TESSERA_FAKE_CLAUDE_LOG so the test can check what Tessera sends.
if [ "$1" = "--version" ]; then
  echo "9.9.9 (Fake Claude Code)"
  exit 0
fi
cat > "${TESSERA_FAKE_CLAUDE_LOG:-/dev/null}"
cat <<'EOF'
{"type":"system","subtype":"init","model":"fake"}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Counting the paid orders:\n\n```sql\nselect count(*) from orders where status = 'paid';\n```\n"}}}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"I used `status = 'paid'`."}}}
{"type":"result","subtype":"success","is_error":false,"result":"Counting the paid orders:\n\n```sql\nselect count(*) from orders where status = 'paid';\n```\nI used `status = 'paid'`.","total_cost_usd":0.0012,"duration_ms":12}
EOF
