# Blume AWS deployment target

This repository starts with the AWS deployment foundation while the Blume app is still being built.

The current Vite/React application now has a production multi-stage Docker image. The target can later run any replacement image that honors the same port and health contract. It provisions:

- an ECR container registry;
- a two-AZ VPC;
- an internet-facing Application Load Balancer;
- an ECS/Fargate service with rolling deployments;
- private security boundaries between the load balancer, app, and optional database;
- CloudWatch logs;
- an optional encrypted PostgreSQL RDS instance;
- an optional ACM certificate and HTTPS listener.
- a private, encrypted, versioned S3 uploads bucket;
- CPU autoscaling and operational alarms;
- optional WAF managed rules and automatic Route 53 TLS;
- optional GitHub OIDC deployment access without stored AWS keys.

Development deliberately runs Fargate tasks in tightly restricted public subnets. This avoids a NAT Gateway charge while allowing inbound traffic only from the load balancer. The production profile uses private application subnets, WAF, TLS, database redundancy, and customer-specific AWS accounts when isolation requires them. See [the architecture decisions](docs/ARCHITECTURE.md).

## Prerequisites

- Terraform 1.6+
- AWS CLI authenticated to the target AWS account
- Docker

## First deployment

```bash
cd infra/aws
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan -out=blume.tfplan
terraform apply blume.tfplan
```

The default image is a tiny public HTTP echo service, so the infrastructure can be tested before the Blume app exists.

## Deploy the Blume app

Build an image whose process listens on port `8080`, then run:

```bash
AWS_REGION=us-west-2 ./scripts/push-image.sh
cd infra/aws
terraform apply -var='image_tag=<printed-tag>'
```

Set `container_image` explicitly if the app image lives outside the ECR repository created here.

## HTTPS and database

For automatic HTTPS, set `domain_name` and `route53_zone_id`; Terraform creates and validates the ACM certificate. Alternatively, set `certificate_arn`. For PostgreSQL, set `create_database = true`; RDS generates and stores its master password in Secrets Manager.

## Production values

Use these as the production baseline:

```hcl
environment       = "prod"
desired_count     = 2
private_tasks     = true
enable_waf        = true
create_database   = true
database_multi_az = true
domain_name       = "app.your-domain.com"
route53_zone_id   = "YOUR_ZONE_ID"
github_repository = "YOUR_ORG/YOUR_REPOSITORY"
alert_email       = "YOUR_OPERATIONS_EMAIL"
```

After Terraform creates `github_actions_role_arn`, save it as the GitHub Actions repository variable `AWS_DEPLOY_ROLE_ARN`. The included workflow deploys every commit to `main`; protect the GitHub `production` environment if approval is required.

## Application contract

The eventual application must:

1. expose an unauthenticated `GET /health` endpoint returning HTTP 200;
2. listen on `0.0.0.0:8080` by default;
3. write logs to stdout/stderr;
4. exit non-zero when startup fails;
5. read configuration from environment variables and secrets, never local files.
