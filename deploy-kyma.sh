#!/bin/bash
# DealFlow AI Runner — Kyma Deployment Script
# Usage: ./deploy-kyma.sh
# Prerequisites: Docker Desktop running, kubectl configured with Kyma kubeconfig

set -e

DOCKER_IMAGE="adamlalor72/dealflow-ai-runner"
RUNNER_API_KEY="2fa0bbe5f1c820668e7a6d25e09d3d05ec1ffd82685764a6cfd3d2b57abddee0"

echo "=== DealFlow AI Runner — Kyma Deploy ==="

# 1. Build Docker image
echo ""
echo "→ Building Docker image..."
docker build -t $DOCKER_IMAGE:latest .

# 2. Push to Docker Hub
echo ""
echo "→ Pushing to Docker Hub..."
docker push $DOCKER_IMAGE:latest

# 3. Create/update the Kubernetes secret for the runner API key
echo ""
echo "→ Creating Kubernetes secret..."
kubectl delete secret dealflow-runner-secret --ignore-not-found
kubectl create secret generic dealflow-runner-secret \
  --from-literal=runner-api-key="$RUNNER_API_KEY"

# 4. Apply the deployment
echo ""
echo "→ Applying Kubernetes deployment..."
kubectl apply -f k8s-deployment.yml

# 5. Restart to pick up new image (force pull)
echo ""
echo "→ Restarting deployment to pull latest image..."
kubectl rollout restart deployment/dealflow-ai-runner

# 6. Wait for rollout
echo ""
echo "→ Waiting for rollout to complete..."
kubectl rollout status deployment/dealflow-ai-runner --timeout=120s

echo ""
echo "✅ Deploy complete!"
echo ""
echo "Useful commands:"
echo "  kubectl get pods                          — check pod status"
echo "  kubectl logs -f deployment/dealflow-ai-runner  — tail logs"
echo "  kubectl describe pod <pod-name>           — debug issues"
