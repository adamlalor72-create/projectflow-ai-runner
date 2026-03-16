#!/bin/bash
# DealFlow AI Runner — Start Script

export DEALFLOW_RUNNER_KEY="$(security find-generic-password -s 'dealflow-runner-key' -w 2>/dev/null)"
export ANTHROPIC_API_KEY="$(security find-generic-password -s 'anthropic-api-key' -w 2>/dev/null)"

if [ -z "$DEALFLOW_RUNNER_KEY" ]; then
  echo "⚠️  DEALFLOW_RUNNER_KEY not found in Keychain."
  echo "    To store it permanently, run:"
  echo "    security add-generic-password -s 'dealflow-runner-key' -a 'runner' -w 'your-key-here'"
  echo ""
  read -s -p "Enter runner API key: " DEALFLOW_RUNNER_KEY
  echo ""
fi

echo "✓ Runner key loaded"
echo "✓ Anthropic API key $([ -n "$ANTHROPIC_API_KEY" ] && echo "loaded" || echo "NOT FOUND — Computer Use agent will not work")"
echo "✓ Starting DealFlow AI Runner..."
echo ""

cd "$(dirname "$0")"
node runner.js "$@"
