#!/usr/bin/env bash

echo "Starting Chat with Friends application..."
cd backend
uvicorn server:app --host 0.0.0.0 --port 10000
