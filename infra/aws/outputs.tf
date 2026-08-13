output "application_url" {
  value = var.domain_name != null ? "https://${var.domain_name}" : "http://${aws_lb.app.dns_name}"
}

output "load_balancer_dns_name" {
  value = aws_lb.app.dns_name
}

output "ecr_repository_url" {
  value = aws_ecr_repository.app.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.app.name
}

output "ecs_service_name" {
  value = aws_ecs_service.app.name
}

output "database_endpoint" {
  value     = var.create_database ? aws_db_instance.database[0].address : null
  sensitive = true
}

output "database_secret_arn" {
  value     = var.create_database ? aws_db_instance.database[0].master_user_secret[0].secret_arn : null
  sensitive = true
}

output "uploads_bucket_name" {
  value = aws_s3_bucket.uploads.id
}
