#!/usr/bin/env bash

# Install Python dependencies
echo "Installing Python dependencies..."
cd backend
pip install -r requirements.txt

# Install Node.js dependencies and build React app
echo "Installing Node.js dependencies..."
cd ../frontend
yarn install

# Build React app for production
echo "Building React app..."
yarn build

echo "Build completed successfully!"