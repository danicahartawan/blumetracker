#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${AWS_REGION:-}" ]]; then
  echo "AWS_REGION is required (example: AWS_REGION=us-west-2 $0)" >&2
  exit 1
fi

if [[ ! -f Dockerfile ]]; then
  echo "No Dockerfile found at the repository root." >&2
  exit 1
fi

repository_url="$(terraform -chdir=infra/aws output -raw ecr_repository_url)"
registry_host="${repository_url%%/*}"
image_tag="$(git rev-parse --short=12 HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"

aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$registry_host"
docker build --platform linux/amd64 -t "$repository_url:$image_tag" .
docker push "$repository_url:$image_tag"

echo "Pushed $repository_url:$image_tag"
echo "Deploy with: terraform -chdir=infra/aws apply -var='use_ecr_image=true' -var='image_tag=$image_tag'"

