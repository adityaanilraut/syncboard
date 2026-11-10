# AWS setup

The Terraform configuration expects an existing VPC, two public and two private subnets across at least two availability zones, an issued ACM certificate, and a GitHub OIDC provider. Private subnets need outbound HTTPS access for the Fargate agent to reach ECR and CloudWatch. The ElastiCache endpoint is accessible from the ECS task security group.

1. Set the variables in a private `.tfvars` file. Use the exact GitHub OIDC `sub` claim for this repository's `main` branch. For new repositories, get the owner and repository IDs with `gh api repos/OWNER/REPO --jq '[.owner.id, .id]'`, then set `repo:OWNER@OWNER-ID/REPO@REPO-ID:ref:refs/heads/main`.
2. Bootstrap the ECR repository using `terraform apply -target=aws_ecr_repository.board`. Terraform requires all inputs for the targeted run, so a syntactically valid placeholder digest may be used for this step.
3. Authenticate Docker to ECR, build a Linux AMD64 image, and push a bootstrap tag. Look up the pushed digest and set `image` to `ECR_URL@sha256:…`.
4. Review a full `terraform plan` and apply it when ready. Point the configured hostname at the `alb_dns_name` output.
5. Set GitHub repository variables `AWS_REGION`, `AWS_DEPLOY_ROLE_ARN`, `ECR_URL`, and `SYNCBOARD_ORIGIN` using the deployment outputs and hostname. Run **Deploy SyncBoard** manually from `main`. The workflow builds a commit-tagged image, deploys its immutable digest, and verifies the service revision and health endpoint.

Local validation uses `terraform fmt -check`, `terraform init -backend=false`, and `terraform validate`. Terraform and OpenTofu can validate the configuration without AWS credentials.
