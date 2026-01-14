#!/bin/bash

# AntiBridge v1.2.0 - Server (Mac Version)

cd "$(dirname "$0")/backend"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "[*] Dependencies not installed. Running npm install..."
    npm install
fi

echo "[*] Starting server..."
npm start
