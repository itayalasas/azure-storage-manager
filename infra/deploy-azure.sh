#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
az extension add --name containerapp --upgrade >/dev/null

if [ -f "$REPO_ROOT/backend/.env" ]; then
  # Load local backend settings so the bootstrap matches the app runtime.
  set -a
  # shellcheck disable=SC1090
  . "$REPO_ROOT/backend/.env"
  set +a
fi

RESOURCE_GROUP=${RESOURCE_GROUP:-rg-storage-manager}
LOCATION=${LOCATION:-eastus}
STORAGE_ACCOUNT=${STORAGE_ACCOUNT:-storagemgr$RANDOM$RANDOM}
CONTAINER_NAME=${CONTAINER_NAME:-documents}
ENV_NAME=${ENV_NAME:-storage-manager-env}
ACR_NAME=${ACR_NAME:-acrstorage$RANDOM$RANDOM}
API_APP=${API_APP:-storage-manager-api}
WEB_APP=${WEB_APP:-storage-manager-web}

if [ -z "${AUTH_ENV_URL:-}" ]; then
  echo "AUTH_ENV_URL must be set in backend/.env before running this script" >&2
  exit 1
fi

if [ -z "${AUTH_ENV_ACCESS_KEY:-}" ]; then
  echo "AUTH_ENV_ACCESS_KEY must be set in backend/.env before running this script" >&2
  exit 1
fi

AUTH_CONFIG_CACHE_MS=${AUTH_CONFIG_CACHE_MS:-60000}

az group create --name "$RESOURCE_GROUP" --location "$LOCATION"
az storage account create --name "$STORAGE_ACCOUNT" --resource-group "$RESOURCE_GROUP" --location "$LOCATION" --sku Standard_LRS --kind StorageV2
CONNECTION_STRING=$(az storage account show-connection-string --name "$STORAGE_ACCOUNT" --resource-group "$RESOURCE_GROUP" --query connectionString -o tsv)
az storage container create --name "$CONTAINER_NAME" --connection-string "$CONNECTION_STRING" --auth-mode key

az acr create --resource-group "$RESOURCE_GROUP" --name "$ACR_NAME" --sku Basic --admin-enabled true
ACR_SERVER=$(az acr show --name "$ACR_NAME" --query loginServer -o tsv)
ACR_USER=$(az acr credential show --name "$ACR_NAME" --query username -o tsv)
ACR_PASS=$(az acr credential show --name "$ACR_NAME" --query passwords[0].value -o tsv)

az acr build --registry "$ACR_NAME" --image storage-manager-api:latest "$REPO_ROOT/backend"

az containerapp env create --name "$ENV_NAME" --resource-group "$RESOURCE_GROUP" --location "$LOCATION"

az containerapp create \
  --name "$API_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --environment "$ENV_NAME" \
  --image "$ACR_SERVER/storage-manager-api:latest" \
  --registry-server "$ACR_SERVER" \
  --registry-username "$ACR_USER" \
  --registry-password "$ACR_PASS" \
  --target-port 3000 \
  --ingress external \
  --secrets \
    storage-connection-string="$CONNECTION_STRING" \
    auth-env-access-key="$AUTH_ENV_ACCESS_KEY" \
  --env-vars \
    AZURE_STORAGE_CONNECTION_STRING=secretref:storage-connection-string \
    AZURE_STORAGE_CONTAINER="$CONTAINER_NAME" \
    AUTH_ENV_URL="$AUTH_ENV_URL" \
    AUTH_ENV_ACCESS_KEY=secretref:auth-env-access-key \
    AUTH_CONFIG_CACHE_MS="$AUTH_CONFIG_CACHE_MS"

API_URL=$(az containerapp show --name "$API_APP" --resource-group "$RESOURCE_GROUP" --query properties.configuration.ingress.fqdn -o tsv)

az acr build --registry "$ACR_NAME" --image storage-manager-web:latest --build-arg VITE_API_URL="https://$API_URL" "$REPO_ROOT/frontend"

az containerapp create \
  --name "$WEB_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --environment "$ENV_NAME" \
  --image "$ACR_SERVER/storage-manager-web:latest" \
  --registry-server "$ACR_SERVER" \
  --registry-username "$ACR_USER" \
  --registry-password "$ACR_PASS" \
  --target-port 80 \
  --ingress external

WEB_URL=$(az containerapp show --name "$WEB_APP" --resource-group "$RESOURCE_GROUP" --query properties.configuration.ingress.fqdn -o tsv)

az containerapp update \
  --name "$API_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --set-env-vars PUBLIC_API_URL="https://$API_URL" CORS_ORIGIN="https://$WEB_URL"

echo "API: https://$API_URL"
echo "WEB: https://$WEB_URL"
echo "ACR: $ACR_SERVER"
echo "Resource group: $RESOURCE_GROUP"
