# Azure Storage Manager

Aplicacion para organizar archivos por proyectos en Azure Blob Storage.

## Stack

- Backend: Node.js + Express + `@azure/storage-blob`
- Frontend: React + Vite
- Storage: Azure Blob Storage

## Que hace

- Crear proyectos.
- Editar y eliminar proyectos.
- Crear subcarpetas de un nivel dentro de cada proyecto.
- Subir archivos a un proyecto especifico.
- Abrir, descargar y eliminar archivos por proyecto.
- Exponer una API publica para subir archivos en base64.

## Ejecutar local

1. Crea un Storage Account en Azure y copia el connection string.
2. Copia `backend/.env.example` a `backend/.env` y completa los datos.
3. Copia `frontend/.env.example` a `frontend/.env` si quieres cambiar la URL del API.

### Backend

```bash
cd backend
npm install
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Con Docker Compose

```bash
cp backend/.env.example backend/.env
docker compose up --build
```

Frontend: http://localhost:5175  
API: http://localhost:3000

## Despliegue automatico en Azure

La app esta pensada para correr en dos Azure Container Apps:

- `storage-manager-api` para el backend
- `storage-manager-web` para el frontend

El flujo recomendado es:

1. Iniciar sesion en Azure CLI con `az login` y seleccionar la suscripcion correcta con `az account set --subscription <id>`.
2. Cargar los valores de `backend/.env` con al menos `AUTH_ENV_URL` y `AUTH_ENV_ACCESS_KEY`.
3. Ejecutar el bootstrap inicial una sola vez:

```bash
bash infra/deploy-azure.sh
```

4. Subir el repositorio a GitHub.
5. Crear una federacion OIDC para GitHub Actions en Microsoft Entra y darle permiso `Contributor` sobre el resource group.
   - El `subject` suele quedar como `repo:<owner>/<repo>:ref:refs/heads/main`.
6. Configurar en GitHub:

- Secrets:
  - `AZURE_SUBSCRIPTION_ID`
  - `AZURE_TENANT_ID`
  - `AZURE_CLIENT_ID`
- Variables:
  - `AZURE_RESOURCE_GROUP`
  - `AZURE_ACR_NAME`
  - `AZURE_API_APP_NAME`
  - `AZURE_WEB_APP_NAME`

7. Hacer `push` a `main`. El workflow `.github/workflows/deploy-containerapps.yml` construye las imagenes y publica nuevas revisiones automaticamente.

Notas:

- El workflow usa `az acr build` para generar las imagenes y `az containerapp update` para publicar nuevas revisiones.
- El frontend se construye con la URL real del backend, tomada desde el Container App del API.
- El bootstrap guarda el connection string de Storage y `AUTH_ENV_ACCESS_KEY` como secretos del Container App.
- El backend queda con `PUBLIC_API_URL` y `CORS_ORIGIN` ajustados al entorno de produccion.

## API

### Legado

- `GET /api/files`
- `POST /api/files`
- `GET /api/files/:blobName/sas`
- `DELETE /api/files/:blobName`

### Proyectos

- `GET /api/projects`
- `POST /api/projects`
- `POST /api/projects/:projectId/folders`
- `GET /api/projects/:projectId`
- `PATCH /api/projects/:projectId`
- `DELETE /api/projects/:projectId`
- `GET /api/projects/:projectId/files?page=1&pageSize=8&folderPath=facturas-2026`
- `POST /api/projects/:projectId/files`
- `GET /api/projects/:projectId/files/:blobName/sas`
- `DELETE /api/projects/:projectId/files/:blobName`

`POST /api/projects/:projectId/files` acepta `folderPath` como campo adicional en el formulario.
Las respuestas de archivos incluyen `url` para abrir en el navegador y `downloadUrl` para descarga forzada.
`GET /api/projects/:projectId/files/:blobName/sas` devuelve las URLs de vista y descarga por compatibilidad con integraciones existentes.
`GET /api/projects/:projectId/files` acepta `folderPath` opcional para filtrar la vista de archivos por carpeta; si lo omites, devuelve todos los archivos del proyecto. Si envias `folderPath=` vacío, devuelve los archivos de la raíz del proyecto.
`POST /api/projects` acepta `folders` opcional como arreglo de carpetas iniciales. Cada carpeta puede enviarse como string o como objeto con `name`, `displayName` o `path`.
`GET /api/projects/:projectId` y la respuesta de `POST /api/projects` incluyen `folders` con las carpetas registradas en el proyecto.

Ejemplo:

```json
{
  "name": "SendCraft",
  "description": "Proyecto principal",
  "folders": ["facturas-2026", "reportes"]
}
```

### Carga publica en base64

- `POST /api/public/files/base64`
- `POST /api/public/projects/:projectId/files/base64`  _(compatibilidad)_
- `POST /api/public/projects`
- `DELETE /api/public/projects/:projectId`

La carga publica requiere `projectId` de forma explicita para saber a que proyecto asociar el archivo.
`POST /api/public/files/base64` espera `projectId` en el JSON y acepta `folderPath` opcional. Si no envias `folderPath`, el archivo se guarda en la raiz del proyecto.
`POST /api/public/projects/:projectId/files/base64` sigue disponible para compatibilidad y tambien acepta `folderPath` opcional.
`POST /api/public/projects` acepta el mismo body que `POST /api/projects`, incluyendo `folders` iniciales.
`DELETE /api/public/projects/:projectId` elimina el proyecto y todos sus archivos.

Ejemplo de body:

```json
{
  "projectId": "sendcraft-qgjulp6x",
  "fileName": "documento.pdf",
  "contentType": "application/pdf",
  "folderPath": "facturas-2026",
  "base64": "JVBERi0xLjQK..."
}
```

Tambien se acepta `data:` URL, por ejemplo:

```json
{
  "fileName": "imagen.png",
  "base64": "data:image/png;base64,iVBORw0KGgoAAA..."
}
```

## Variables de entorno

Backend:

```bash
PORT=3000
PUBLIC_API_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:5173
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=YOUR_ACCOUNT;AccountKey=YOUR_KEY;EndpointSuffix=core.windows.net
AZURE_STORAGE_CONTAINER=documents
MAX_FILE_SIZE_MB=25
JSON_BODY_LIMIT=50mb
AUTH_ENV_URL=https://your-auth-env-endpoint
AUTH_ENV_ACCESS_KEY=your-access-key
AUTH_CONFIG_CACHE_MS=60000
```

`PUBLIC_API_URL` define la base publica con la que se construyen los enlaces de vista y descarga. Si no lo defines, el backend usa el origen de la request recibida.
`AUTH_ENV_URL` y `AUTH_ENV_ACCESS_KEY` son obligatorios para que `/api/auth/config` pueda cargar la configuracion de autenticacion.

## Seguridad recomendada antes de produccion

- Agregar autenticacion para la interfaz privada.
- Proteger o deshabilitar la API publica si va a quedar expuesta en internet.
- No usar `CORS_ORIGIN=*` en produccion.
- Guardar secrets en Azure Container Apps Secrets o Key Vault.
- Validar extensiones y MIME permitidos para los archivos que recibes.
- Si el volumen de proyectos crece mucho, conviene pasar los metadatos a una base de datos.
