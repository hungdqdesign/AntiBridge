#!/bin/bash

# AntiBridge - Open Antigravity with CDP (Mac Version)
# This script opens Antigravity IDE with remote debugging enabled

APP_PATH="/Applications/Antigravity.app"

if [ ! -d "$APP_PATH" ]; then
    echo "❌ Antigravity not found at $APP_PATH"
    echo "Please make sure Antigravity is installed in your Applications folder."
    exit 1
fi

echo "🚀 Starting Antigravity with CDP enabled on port 9000..."
open -a Antigravity --args --remote-debugging-port=9000

echo "✅ Antigravity is starting."
echo "Now run ./START_MAC.sh to start the AntiBridge server."
