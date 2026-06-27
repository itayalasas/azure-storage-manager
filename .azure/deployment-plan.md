# Azure Deployment Plan

Status: Draft

## Goal

Automate deployments for Azure Storage Manager with GitHub Actions and Azure Container Apps.

## Scope

- Bootstrap Azure resources once.
- Build and push backend and frontend container images to Azure Container Registry.
- Update Azure Container Apps on every push to `main`.
- Keep runtime settings documented and reproducible.

## Deliverables

- `infra/deploy-azure.sh` for first-time Azure bootstrap.
- `.github/workflows/deploy-containerapps.yml` for automatic deployments.
- `README.md` deployment instructions for GitHub and Azure.

