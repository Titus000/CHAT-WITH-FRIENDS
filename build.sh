#!/usr/bin/env bash

set -e  # stoppe si erreur

echo "Installing Python dependencies..."
cd backend
pip install -r requirements.txt

echo "Installing Node.js dependencies..."
cd ../frontend
yarn install

echo "Building React app..."
yarn build

echo "Copying React build to backend..."
rm -rf ../backend/build
cp -r build ../backend/

echo "Build completed successfully!"
