data "aws_partition" "current" {}
data "aws_caller_identity" "current" {}

resource "aws_ecr_repository" "board" {
  name                 = "syncboard"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_security_group" "alb" {
  name   = "syncboard-alb"
  vpc_id = var.vpc_id
}

resource "aws_security_group" "board" {
  name   = "syncboard-tasks"
  vpc_id = var.vpc_id
}

resource "aws_security_group" "redis" {
  name   = "syncboard-redis"
  vpc_id = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "https" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "alb_tasks" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.board.id
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
}

resource "aws_vpc_security_group_ingress_rule" "tasks_alb" {
  security_group_id            = aws_security_group.board.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
}

resource "aws_vpc_security_group_egress_rule" "task_aws_apis" {
  security_group_id = aws_security_group.board.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "tasks_redis" {
  security_group_id            = aws_security_group.board.id
  referenced_security_group_id = aws_security_group.redis.id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
}

resource "aws_vpc_security_group_ingress_rule" "redis_tasks" {
  security_group_id            = aws_security_group.redis.id
  referenced_security_group_id = aws_security_group.board.id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
}

resource "aws_lb" "board" {
  name               = "syncboard"
  load_balancer_type = "application"
  subnets            = var.public_subnets
  security_groups    = [aws_security_group.alb.id]
  idle_timeout       = 120
}

resource "aws_lb_target_group" "board" {
  name        = "syncboard"
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id
  health_check {
    path                = "/healthz"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.board.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = var.certificate_arn
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.board.arn
  }
}

resource "aws_elasticache_subnet_group" "board" {
  name       = "syncboard"
  subnet_ids = var.private_subnets
}

resource "aws_elasticache_replication_group" "board" {
  replication_group_id       = "syncboard"
  description                = "SyncBoard room streams and pub/sub"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = "cache.t4g.small"
  num_cache_clusters         = 2
  subnet_group_name          = aws_elasticache_subnet_group.board.name
  security_group_ids         = [aws_security_group.redis.id]
  automatic_failover_enabled = true
  multi_az_enabled           = true
  transit_encryption_enabled = true
  at_rest_encryption_enabled = true
  snapshot_retention_limit   = 1
}

resource "aws_cloudwatch_log_group" "board" {
  name              = "/ecs/syncboard"
  retention_in_days = 14
}

resource "aws_iam_role" "execution" {
  name = "syncboard-ecs-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Condition = {
        StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
        ArnLike = {
          "aws:SourceArn" = "arn:${data.aws_partition.current.partition}:ecs:${var.region}:${data.aws_caller_identity.current.account_id}:*"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "execution" {
  role = aws_iam_role.execution.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = "ecr:GetAuthorizationToken", Resource = "*" },
      {
        Effect   = "Allow"
        Action   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
        Resource = aws_ecr_repository.board.arn
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.board.arn}:log-stream:*"
      }
    ]
  })
}

resource "aws_ecs_cluster" "board" {
  name = "syncboard"
}

resource "aws_ecs_task_definition" "board" {
  family                   = "syncboard"
  cpu                      = 512
  memory                   = 1024
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.execution.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name         = "board"
    image        = var.image
    essential    = true
    portMappings = [{ containerPort = 3000, protocol = "tcp" }]
    environment = [
      { name = "APP_ORIGIN", value = "https://${var.hostname}" },
      { name = "REDIS_URL", value = "rediss://${aws_elasticache_replication_group.board.primary_endpoint_address}:6379" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.board.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "board"
      }
    }
  }])
}

resource "aws_ecs_service" "board" {
  name            = "syncboard"
  cluster         = aws_ecs_cluster.board.id
  task_definition = aws_ecs_task_definition.board.arn
  desired_count   = 2
  launch_type     = "FARGATE"
  network_configuration {
    subnets         = var.private_subnets
    security_groups = [aws_security_group.board.id]
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.board.arn
    container_name   = "board"
    container_port   = 3000
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  health_check_grace_period_seconds = 60
  depends_on                        = [aws_lb_listener.https, aws_iam_role_policy.execution]
  lifecycle {
    # Image releases update the service revision from GitHub Actions.
    ignore_changes = [task_definition]
  }
}
