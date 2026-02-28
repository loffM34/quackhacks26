#!/bin/bash
# Deploy backend to Render / Railway
# Run: bash infra/deploy-backend.sh

set -e

echo "🚀 Deploying AI Content Shield backend..."

# Option 1: Render (using render.yaml or deploy hook)
if [ -n "$RENDER_DEPLOY_HOOK_URL" ]; then
  echo "Deploying to Render via deploy hook..."
  curl -X POST "$RENDER_DEPLOY_HOOK_URL"
  echo "✅ Deploy triggered on Render"
  exit 0
fi

# Option 2: Railway
if command -v railway &> /dev/null; then
  echo "Deploying to Railway..."
  cd backend
  railway up
  echo "✅ Deployed to Railway"
  exit 0
fi

# Option 3: Docker (generic)
echo "Building Docker image..."
cd backend
docker build -t ai-content-shield-backend .
echo "✅ Docker image built: ai-content-shield-backend"
echo ""
echo "Run with:"
echo "  docker run -p 3001:3001 --env-file .env ai-content-shield-backend"
