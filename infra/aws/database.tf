resource "aws_security_group" "database" {
  count       = var.create_database ? 1 : 0
  name        = "${local.prefix}-database"
  description = "PostgreSQL access from Blume tasks only"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }
}

resource "aws_db_subnet_group" "database" {
  count      = var.create_database ? 1 : 0
  name       = local.prefix
  subnet_ids = aws_subnet.database[*].id
}

resource "aws_db_instance" "database" {
  count                        = var.create_database ? 1 : 0
  identifier                   = local.prefix
  engine                       = "postgres"
  engine_version               = "16"
  instance_class               = "db.t4g.micro"
  allocated_storage            = 20
  max_allocated_storage        = 100
  storage_type                 = "gp3"
  storage_encrypted            = true
  db_name                      = var.database_name
  username                     = var.database_username
  manage_master_user_password  = true
  db_subnet_group_name         = aws_db_subnet_group.database[0].name
  vpc_security_group_ids       = [aws_security_group.database[0].id]
  publicly_accessible          = false
  backup_retention_period      = 7
  deletion_protection          = var.environment == "prod"
  skip_final_snapshot          = var.environment != "prod"
  final_snapshot_identifier    = var.environment == "prod" ? "${local.prefix}-final" : null
  auto_minor_version_upgrade   = true
  apply_immediately            = var.environment != "prod"
  performance_insights_enabled = true
  multi_az                     = var.database_multi_az
}
