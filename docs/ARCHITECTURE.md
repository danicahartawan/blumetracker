# Blume deployment architecture

## Decisions

### One container contract

Blume ships as an immutable Docker image and listens on port 8080. ECS/Fargate was chosen over Kubernetes because it provides rolling deployment, isolation, autoscaling, and mature AWS integration without a cluster operations burden.

### PostgreSQL as the system of record

RDS PostgreSQL is the default relational store. AWS manages the master password in Secrets Manager. Production enables Multi-AZ and deletion protection; development stays single-AZ to control cost.

### S3 for customer files

Uploaded files and generated artifacts belong in private, encrypted, versioned S3—not on container disks. The application task receives access only to its own bucket through its IAM role.

### Two operating profiles

- Development uses one Fargate task in restricted public subnets. This removes the fixed NAT Gateway cost.
- Production uses at least two tasks in private subnets, a NAT Gateway, WAF, HTTPS, Multi-AZ PostgreSQL, backups, and alerts.

### Secure continuous delivery

GitHub Actions authenticates through OIDC and receives short-lived AWS credentials. Images use the Git commit SHA as an immutable tag. ECS creates a new task-definition revision and waits for the service to stabilize.

### Customer isolation

Start with environment-level stacks in Blume's AWS account. For customers with strong security or ownership requirements, instantiate the same Terraform stack in a dedicated customer AWS account. Do not build one-off infrastructure by hand.

## Application contract

- Bind HTTP to `0.0.0.0:${PORT}`.
- Return HTTP 200 from `GET /health` without authentication.
- Treat the local filesystem as temporary.
- Write structured logs to stdout/stderr.
- Handle `SIGTERM` and stop accepting requests before exit.
- Run schema migrations as a separate deployment step, not concurrently in every web task.
- Use presigned S3 URLs for large uploads.
- Receive credentials from environment variables backed by Secrets Manager.
- Keep user identity and authorization checks in the application; infrastructure isolation is an additional boundary, not a substitute.

## Environment defaults

| Setting | Development | Production |
|---|---:|---:|
| Desired tasks | 1 | 2 |
| Task networking | Restricted public | Private + NAT |
| PostgreSQL | Single-AZ | Multi-AZ |
| WAF | Off | On |
| HTTPS | Optional | Required |
| Deletion protection | Off | On |
| Autoscaling maximum | 3 | 10 |

## Later, when demand proves it is needed

Add a separate worker service and SQS for long-running workflows, ElastiCache only after measured cache/queue needs, and cross-region disaster recovery only after recovery objectives justify the cost. These are intentionally not baseline dependencies.

