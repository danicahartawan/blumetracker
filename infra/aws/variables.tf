variable "name" {
  description = "Short application name used in AWS resource names."
  type        = string
  default     = "blume"
}

variable "environment" {
  description = "Deployment environment name."
  type        = string
  default     = "dev"
}

variable "aws_region" {
  description = "AWS region for this deployment."
  type        = string
  default     = "us-west-2"
}

variable "vpc_cidr" {
  type    = string
  default = "10.42.0.0/16"
}

variable "container_port" {
  type    = number
  default = 8080
}

variable "container_image" {
  description = "Optional complete image URI. When null, the bootstrap service or this stack's ECR image is used."
  type        = string
  default     = null
  nullable    = true
}

variable "image_tag" {
  description = "Tag in the ECR repository, used only when container_image is null and use_ecr_image is true."
  type        = string
  default     = "latest"
}

variable "use_ecr_image" {
  description = "Use this stack's ECR image instead of the temporary nginx image."
  type        = bool
  default     = false
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "cpu" {
  type    = number
  default = 256
}

variable "memory" {
  type    = number
  default = 512
}

variable "health_check_path" {
  type    = string
  default = "/health"
}

variable "certificate_arn" {
  description = "Optional ACM certificate ARN. Supplying it enables HTTPS and redirects HTTP."
  type        = string
  default     = null
  nullable    = true
}

variable "domain_name" {
  description = "Optional application hostname, such as app.blume.com."
  type        = string
  default     = null
  nullable    = true
}

variable "route53_zone_id" {
  description = "Route 53 hosted zone ID. With domain_name, creates DNS and an ACM certificate."
  type        = string
  default     = null
  nullable    = true
}

variable "private_tasks" {
  description = "Run tasks in private subnets behind a NAT gateway. Recommended for production."
  type        = bool
  default     = false
}

variable "enable_waf" {
  description = "Attach AWS managed WAF protections to the load balancer."
  type        = bool
  default     = false
}

variable "alert_email" {
  description = "Optional email address for CloudWatch alarm notifications."
  type        = string
  default     = null
  nullable    = true
}

variable "github_repository" {
  description = "Optional GitHub repository in owner/name form for OIDC-based deployments."
  type        = string
  default     = null
  nullable    = true
}

variable "github_environment" {
  description = "GitHub environment allowed to assume the deployment role."
  type        = string
  default     = "production"
}

variable "environment_variables" {
  description = "Non-secret application environment variables."
  type        = map(string)
  default     = {}
}

variable "secret_arns" {
  description = "Map of environment variable names to Secrets Manager secret ARNs."
  type        = map(string)
  default     = {}
}

variable "create_database" {
  type    = bool
  default = false
}

variable "database_name" {
  type    = string
  default = "blume"
}

variable "database_username" {
  type    = string
  default = "blume_admin"
}

variable "database_multi_az" {
  description = "Use a standby database in a second AZ. Recommended for production."
  type        = bool
  default     = false
}
