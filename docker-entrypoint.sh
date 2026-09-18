#!/bin/sh
set -e
echo "Running database migrations..."
npm run migrate:up
echo "Starting server..."
exec node src/server.js
