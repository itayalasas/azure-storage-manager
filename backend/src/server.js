import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import multer from 'multer';
import { pipeline } from 'node:stream/promises';
import {
  createReadSasUrl,
  deleteFile,
  ensureContainer,
  listFiles,
  uploadFile,
} from './blobService.js';
import {
  exchangeAuthCode,
  getAuthConfig,
  verifyAuthToken,
} from './authService.js';
import {
  createProject,
  createProjectDownloadSasUrl,
  createProjectFolder,
  createProjectReadSasUrl,
  deleteProject,
  deleteProjectFile,
  getProjectFileDelivery,
  getProject,
  listProjectFiles,
  listProjects,
  updateProject,
  uploadBase64FileToProject,
  uploadFileToProject,
} from './projectService.js';

const app = express();
const port = process.env.PORT || 3000;
const maxFileSizeMb = Number(process.env.MAX_FILE_SIZE_MB || 25);
const maxFileSizeBytes = maxFileSizeMb * 1024 * 1024;
const jsonBodyLimit = process.env.JSON_BODY_LIMIT || '50mb';
const LOCALHOST_ORIGINS = /^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i;
const configuredCorsOrigins = String(process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.set('trust proxy', true);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (configuredCorsOrigins.includes('*')) {
      callback(null, true);
      return;
    }

    if (configuredCorsOrigins.includes(origin) || LOCALHOST_ORIGINS.test(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`CORS blocked for origin ${origin}`));
  },
}));
app.use(morgan('dev'));
app.use(express.json({ limit: jsonBodyLimit }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxFileSizeBytes },
});

function parsePositiveInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function getPublicBaseUrl(req) {
  const configuredBaseUrl = String(process.env.PUBLIC_API_URL || process.env.API_URL || '').trim().replace(/\/+$/, '');

  if (configuredBaseUrl && !LOCALHOST_ORIGINS.test(configuredBaseUrl)) {
    return configuredBaseUrl;
  }

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'http';
  const host = forwardedHost || req.get('host');

  return `${protocol}://${host}`;
}

function getTenantContext(req) {
  return {
    tenantId: String(req.headers['x-tenant-id'] || '').trim(),
    tenantName: String(req.headers['x-tenant-name'] || '').trim(),
  };
}

function rewriteUrl(value, baseUrl) {
  if (typeof value !== 'string' || !value) {
    return value;
  }

  if (value.startsWith('/')) {
    return `${baseUrl}${value}`;
  }

  try {
    const parsed = new URL(value);
    if (LOCALHOST_ORIGINS.test(parsed.origin)) {
      return `${baseUrl}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    // Ignore malformed URLs and return the original value.
  }

  return value;
}

function attachPublicBaseUrl(payload, baseUrl) {
  if (Array.isArray(payload)) {
    return payload.map((item) => attachPublicBaseUrl(item, baseUrl));
  }

  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const next = { ...payload };

  if ('url' in next) {
    next.url = rewriteUrl(next.url, baseUrl);
  }

  if ('downloadUrl' in next) {
    next.downloadUrl = rewriteUrl(next.downloadUrl, baseUrl);
  }

  if (Array.isArray(next.items)) {
    next.items = next.items.map((item) => attachPublicBaseUrl(item, baseUrl));
  }

  return next;
}

function buildContentDisposition(mode, fileName) {
  const safeName = String(fileName || 'download').replace(/"/g, '\\"');
  return `${mode}; filename="${safeName}"`;
}

async function streamProjectFileResponse(req, res, next, projectId, blobName, mode) {
  try {
    const file = await getProjectFileDelivery(projectId, blobName, getTenantContext(req));
    res.status(200);
    res.setHeader('Content-Type', file.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', buildContentDisposition(mode, file.originalName));

    if (Number.isFinite(file.contentLength) && file.contentLength >= 0) {
      res.setHeader('Content-Length', String(file.contentLength));
    }

    await pipeline(file.stream, res);
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }

    next(error);
  }
}

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/api/auth/config', async (_req, res, next) => {
  try {
    res.json(await getAuthConfig());
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/exchange-code', async (req, res, next) => {
  try {
    const result = await exchangeAuthCode(req.body || {});
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/verify-token', async (req, res, next) => {
  try {
    const result = await verifyAuthToken(req.body || {});
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/api/files', async (_req, res, next) => {
  try {
    const files = await listFiles();
    res.json(attachPublicBaseUrl(files, getPublicBaseUrl(_req)));
  } catch (error) {
    next(error);
  }
});

app.post('/api/files', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'File is required' });
    }

    const result = await uploadFile(req.file);
    res.status(201).json(attachPublicBaseUrl(result, getPublicBaseUrl(req)));
  } catch (error) {
    next(error);
  }
});

app.get('/api/files/:blobName/sas', async (req, res, next) => {
  try {
    const blobName = decodeURIComponent(req.params.blobName);
    const minutes = parsePositiveInt(req.query.minutes, 15, 1, 1440);
    res.json(attachPublicBaseUrl({ url: createReadSasUrl(blobName, minutes), expiresInMinutes: minutes }, getPublicBaseUrl(req)));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/files/:blobName', async (req, res, next) => {
  try {
    await deleteFile(decodeURIComponent(req.params.blobName));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.get('/api/projects', async (_req, res, next) => {
  try {
    res.json(await listProjects(getTenantContext(_req)));
  } catch (error) {
    next(error);
  }
});

app.post('/api/projects', async (req, res, next) => {
  try {
    const project = await createProject({
      ...req.body,
      ...getTenantContext(req),
    });
    res.status(201).json(attachPublicBaseUrl(project, getPublicBaseUrl(req)));
  } catch (error) {
    next(error);
  }
});

app.post('/api/public/projects', async (req, res, next) => {
  try {
    const project = await createProject({
      ...req.body,
      ...getTenantContext(req),
    });
    res.status(201).json(attachPublicBaseUrl(project, getPublicBaseUrl(req)));
  } catch (error) {
    next(error);
  }
});

app.post('/api/projects/:projectId/folders', async (req, res, next) => {
  try {
    const projectId = decodeURIComponent(req.params.projectId);
    const folder = await createProjectFolder(projectId, {
      ...req.body,
      ...getTenantContext(req),
    });
    res.status(201).json(folder);
  } catch (error) {
    next(error);
  }
});

app.get('/api/projects/:projectId', async (req, res, next) => {
  try {
    const projectId = decodeURIComponent(req.params.projectId);
    res.json(await getProject(projectId, getTenantContext(req)));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/projects/:projectId', async (req, res, next) => {
  try {
    const projectId = decodeURIComponent(req.params.projectId);
    const project = await updateProject(projectId, req.body || {}, getTenantContext(req));
    res.json(project);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/projects/:projectId', async (req, res, next) => {
  try {
    const projectId = decodeURIComponent(req.params.projectId);
    const result = await deleteProject(projectId, getTenantContext(req));
    res.json(attachPublicBaseUrl(result, getPublicBaseUrl(req)));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/public/projects/:projectId', async (req, res, next) => {
  try {
    const projectId = decodeURIComponent(req.params.projectId);
    const result = await deleteProject(projectId, getTenantContext(req));
    res.json(attachPublicBaseUrl(result, getPublicBaseUrl(req)));
  } catch (error) {
    next(error);
  }
});

app.get('/api/projects/:projectId/files', async (req, res, next) => {
  try {
    const projectId = decodeURIComponent(req.params.projectId);
    const page = parsePositiveInt(req.query.page, 1, 1, 1000000);
    const pageSize = parsePositiveInt(req.query.pageSize ?? req.query.limit, 8, 1, 100);
    const folderPath = typeof req.query.folderPath === 'string' ? req.query.folderPath : undefined;
    const result = await listProjectFiles(projectId, { page, pageSize, folderPath, ...getTenantContext(req) });
    res.json(attachPublicBaseUrl(result, getPublicBaseUrl(req)));
  } catch (error) {
    next(error);
  }
});

app.post('/api/projects/:projectId/files', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'File is required' });
    }

    const projectId = decodeURIComponent(req.params.projectId);
    const result = await uploadFileToProject(projectId, {
      ...req.file,
      folderPath: req.body?.folderPath,
    }, getTenantContext(req));
    res.status(201).json(attachPublicBaseUrl(result, getPublicBaseUrl(req)));
  } catch (error) {
    next(error);
  }
});

app.get('/api/projects/:projectId/files/:blobName/sas', async (req, res, next) => {
  try {
    const projectId = decodeURIComponent(req.params.projectId);
    const blobName = decodeURIComponent(req.params.blobName);
    const minutes = parsePositiveInt(req.query.minutes, 15, 1, 1440);
    const [url, downloadUrl] = await Promise.all([
      createProjectReadSasUrl(projectId, blobName, minutes, getTenantContext(req)),
      createProjectDownloadSasUrl(projectId, blobName, minutes, getTenantContext(req)),
    ]);
    res.json(attachPublicBaseUrl({ url, downloadUrl, expiresInMinutes: minutes }, getPublicBaseUrl(req)));
  } catch (error) {
    next(error);
  }
});

app.get('/api/projects/:projectId/files/:blobName/view', async (req, res, next) => {
  const projectId = decodeURIComponent(req.params.projectId);
  const blobName = decodeURIComponent(req.params.blobName);
  return streamProjectFileResponse(req, res, next, projectId, blobName, 'inline');
});

app.get('/api/projects/:projectId/files/:blobName/download', async (req, res, next) => {
  const projectId = decodeURIComponent(req.params.projectId);
  const blobName = decodeURIComponent(req.params.blobName);
  return streamProjectFileResponse(req, res, next, projectId, blobName, 'attachment');
});

app.delete('/api/projects/:projectId/files/:blobName', async (req, res, next) => {
  try {
    const projectId = decodeURIComponent(req.params.projectId);
    const blobName = decodeURIComponent(req.params.blobName);
    await deleteProjectFile(projectId, blobName, getTenantContext(req));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

function resolveProjectId(value) {
  return decodeURIComponent(String(value || '').trim());
}

async function handlePublicBase64Upload(req, res, next, projectId) {
  try {
    const resolvedProjectId = resolveProjectId(projectId ?? req.body?.projectId);

    if (!resolvedProjectId) {
      return res.status(400).json({ message: 'Project id is required' });
    }

    const result = await uploadBase64FileToProject(resolvedProjectId, req.body || {}, maxFileSizeBytes, getTenantContext(req));
    res.status(201).json(attachPublicBaseUrl(result, getPublicBaseUrl(req)));
  } catch (error) {
    next(error);
  }
}

app.post('/api/public/files/base64', async (req, res, next) => {
  return handlePublicBase64Upload(req, res, next, req.body?.projectId);
});

app.post('/api/public/projects/:projectId/files/base64', async (req, res, next) => {
  return handlePublicBase64Upload(req, res, next, req.params.projectId);
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({ message: error.message || 'Internal server error' });
});

ensureContainer().then(() => {
  app.listen(port, () => console.log(`API running on port ${port}`));
});
