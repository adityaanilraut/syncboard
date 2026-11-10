terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "SyncBoard" }
  }
}

variable "region" {
  type    = string
  default = "us-west-2"
}

variable "vpc_id" {
  type = string
}

variable "public_subnets" {
  description = "Public subnets in at least two availability zones for the load balancer."
  type        = set(string)
  validation {
    condition     = length(var.public_subnets) >= 2
    error_message = "Supply at least two public subnets."
  }
}

variable "private_subnets" {
  description = "Private subnets in at least two availability zones with outbound access to AWS APIs."
  type        = set(string)
  validation {
    condition     = length(var.private_subnets) >= 2
    error_message = "Supply at least two private subnets."
  }
}

variable "certificate_arn" {
  description = "An issued ACM certificate in the configured region."
  type        = string
}

variable "hostname" {
  description = "Public hostname covered by the certificate."
  type        = string
}

variable "image" {
  description = "Bootstrap image URI in the SyncBoard ECR repository, pinned by digest."
  type        = string
  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.image))
    error_message = "Supply an image URI ending in its sha256 digest."
  }
}

variable "github_oidc_provider_arn" {
  description = "ARN of the existing IAM provider for token.actions.githubusercontent.com."
  type        = string
}

variable "github_oidc_subject" {
  description = "Exact repository and main-branch subject from GitHub's OIDC token."
  type        = string
  validation {
    condition     = can(regex("^repo:[^:*]+:ref:refs/heads/main$", var.github_oidc_subject))
    error_message = "Supply the exact repository subject for main."
  }
}
