import { nanoid } from 'nanoid';
import {
  containerClient,
  normalizeContentType,
  sanitizeFileName,
} from './blobService.js';

const DEFAULT_PAGE_SIZE = 8;
const MAX_PAGE_SIZE = 100;
const DEFAULT_SAS_MINUTES = 15;
const PUBLIC_API_BASE_URL = String(
  process.env.PUBLIC_API_URL || process.env.API_URL || `http://localhost:${process.env.PORT || 3000}`,
).replace(/\/+$/, '');

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeProjectId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeTenantId(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizeTenantName(value) {
  return String(value || '').trim();
}

function resolveTenantContext(value = {}) {
  if (typeof value === 'string') {
    return {
      tenantId: normalizeTenantId(value),
      tenantName: '',
    };
  }

  return {
    tenantId: normalizeTenantId(
      value.tenantId
      || value.tenant_id
      || value['X-Tenant-ID']
      || value['x-tenant-id']
      || '',
    ),
    tenantName: normalizeTenantName(
      value.tenantName
      || value.tenant_name
      || value['X-Tenant-Name']
      || value['x-tenant-name']
      || '',
    ),
  };
}

function projectMatchesTenant(manifest, tenantContext = {}) {
  const { tenantId } = resolveTenantContext(tenantContext);
  const manifestTenantId = normalizeTenantId(manifest?.tenantId || manifest?.tenant_id || '');

  if (!tenantId || !manifestTenantId) {
    return true;
  }

  return manifestTenantId === tenantId;
}

function mergeTenantIntoManifest(manifest, tenantContext = {}) {
  const { tenantId, tenantName } = resolveTenantContext(tenantContext);

  return {
    ...manifest,
    tenantId: manifest?.tenantId || tenantId || '',
    tenantName: manifest?.tenantName || tenantName || '',
  };
}

function ensureProjectId(projectId) {
  const safeProjectId = normalizeProjectId(projectId);
  if (!safeProjectId) {
    throw createHttpError(400, 'Project id is required');
  }
  return safeProjectId;
}

function projectNamespacePrefix(projectId) {
  return `projects/${ensureProjectId(projectId)}/`;
}

function projectManifestBlobName(projectId) {
  return `${projectNamespacePrefix(projectId)}project.json`;
}

function projectFilesPrefix(projectId) {
  return `${projectNamespacePrefix(projectId)}files/`;
}

function projectFilesIndexBlobName(projectId) {
  return `${projectFilesPrefix(projectId)}index.json`;
}

function getTimestamp(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function isDateSegment(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function normalizeFolderPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const normalized = raw.replace(/\\/g, '/');
  const segments = normalized
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (!segments.length) return '';
  if (segments.length !== 1) {
    throw createHttpError(400, 'Only one folder level is allowed');
  }

  return slugify(segments[0]);
}

function normalizeFolderRecord(record) {
  let path = '';

  try {
    path = normalizeFolderPath(record?.path || record?.folderPath || record?.name || '');
  } catch {
    return null;
  }

  if (!path) {
    return null;
  }

  const displayName = String(record?.displayName || record?.name || path).trim() || path;

  return {
    path,
    displayName,
    createdAt: record?.createdAt || null,
    updatedAt: record?.updatedAt || record?.createdAt || null,
  };
}

function normalizeProjectFolderInput(folder) {
  const isString = typeof folder === 'string';
  const displayName = String(
    isString
      ? folder
      : folder?.displayName || folder?.name || folder?.path || '',
  ).trim();

  if (!displayName) {
    throw createHttpError(400, 'Folder name is required');
  }

  const pathSource = isString
    ? displayName
    : folder?.path || displayName;
  const path = normalizeFolderPath(pathSource);

  if (!path) {
    throw createHttpError(400, 'Folder name is required');
  }

  return {
    path,
    displayName,
  };
}

function normalizeProjectFolders(folders) {
  if (folders === undefined || folders === null) {
    return [];
  }

  if (!Array.isArray(folders)) {
    throw createHttpError(400, 'folders must be an array');
  }

  const seenPaths = new Set();

  return folders.map((folder) => {
    const normalized = normalizeProjectFolderInput(folder);

    if (seenPaths.has(normalized.path)) {
      throw createHttpError(409, 'Folder already exists');
    }

    seenPaths.add(normalized.path);
    return normalized;
  });
}

function parseJsonBuffer(buffer) {
  return JSON.parse(buffer.toString('utf8'));
}

function normalizeProjectManifest(manifest, fallbackId) {
  const fileCount = Number(manifest?.fileCount);

  return {
    id: String(manifest?.id || fallbackId),
    name: String(manifest?.name || fallbackId),
    description: String(manifest?.description || ''),
    fileCount: Number.isFinite(fileCount) && fileCount >= 0 ? fileCount : 0,
    tenantId: normalizeTenantId(manifest?.tenantId || manifest?.tenant_id || ''),
    tenantName: normalizeTenantName(manifest?.tenantName || manifest?.tenant_name || ''),
    createdAt: manifest?.createdAt || null,
    updatedAt: manifest?.updatedAt || manifest?.createdAt || null,
  };
}

function buildProjectFileRouteUrl(projectId, blobName, mode) {
  return `${PUBLIC_API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(blobName)}/${mode}`;
}

function normalizeProjectFileRecord(record) {
  const lastModified = record?.lastModified || record?.uploadedAt || null;
  const size = Number(record?.size);
  let folderPath = '';

  try {
    folderPath = normalizeFolderPath(record?.folderPath || '');
  } catch {
    folderPath = '';
  }

  return {
    name: String(record?.name || ''),
    projectId: String(record?.projectId || '').toLowerCase(),
    originalName: String(record?.originalName || record?.name?.split('/').pop() || 'file'),
    contentType: record?.contentType || 'application/octet-stream',
    size: Number.isFinite(size) && size >= 0 ? size : 0,
    lastModified,
    uploadedAt: record?.uploadedAt || lastModified,
    source: record?.source || 'unknown',
    folderPath,
    folderName: String(record?.folderName || '').trim() || folderPath,
    tenantId: normalizeTenantId(record?.tenantId || record?.tenant_id || ''),
    tenantName: normalizeTenantName(record?.tenantName || record?.tenant_name || ''),
  };
}

function buildProjectFileResponse(record) {
  const normalized = normalizeProjectFileRecord(record);

  if (!normalized.name) {
    return {
      ...normalized,
      url: null,
      downloadUrl: null,
    };
  }

  const contentType = normalizeContentType(normalized.contentType || 'application/octet-stream', normalized.originalName);

  return {
    ...normalized,
    contentType,
    url: buildProjectFileRouteUrl(normalized.projectId, normalized.name, 'view'),
    downloadUrl: buildProjectFileRouteUrl(normalized.projectId, normalized.name, 'download'),
  };
}

function normalizeFilesIndex(index) {
  const items = Array.isArray(index?.items) ? index.items.map(normalizeProjectFileRecord) : [];
  items.sort((a, b) => getTimestamp(b.lastModified) - getTimestamp(a.lastModified));

  const folders = Array.isArray(index?.folders)
    ? index.folders
      .map(normalizeFolderRecord)
      .filter(Boolean)
    : [];
  const folderMap = new Map();
  for (const folder of folders) {
    if (!folderMap.has(folder.path)) {
      folderMap.set(folder.path, folder);
    }
  }
  for (const item of items) {
    if (item.folderPath && !folderMap.has(item.folderPath)) {
      folderMap.set(item.folderPath, {
        path: item.folderPath,
        displayName: item.folderName || item.folderPath,
        createdAt: null,
        updatedAt: null,
      });
    }
  }

  const total = Number(index?.total);

  return {
    updatedAt: index?.updatedAt || new Date().toISOString(),
    total: Number.isFinite(total) && total >= 0 ? Math.max(total, items.length) : items.length,
    items,
    folders: [...folderMap.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, 'es', { sensitivity: 'base' })),
  };
}

function buildProjectFileBlobName(projectId, folderPath, safeName) {
  const safeProjectId = ensureProjectId(projectId);
  const safeFolderPath = normalizeFolderPath(folderPath);
  const dateFolder = new Date().toISOString().slice(0, 10);
  const fileSegment = `${dateFolder}/${nanoid()}-${safeName}`;

  if (safeFolderPath) {
    return `${projectFilesPrefix(safeProjectId)}_folders/${safeFolderPath}/${fileSegment}`;
  }

  return `${projectFilesPrefix(safeProjectId)}${fileSegment}`;
}

function extractProjectFileLocation(blobName, projectId) {
  const safeProjectId = ensureProjectId(projectId);
  const prefix = projectFilesPrefix(safeProjectId);

  if (!blobName.startsWith(prefix)) {
    return null;
  }

  const relativePath = blobName.slice(prefix.length);
  const segments = relativePath.split('/').filter(Boolean);

  if (segments.length < 2) {
    return null;
  }

  if (segments[0] === '_folders' && segments.length >= 4) {
    return {
      folderPath: normalizeFolderPath(segments[1]),
      folderName: '',
      isFoldered: true,
    };
  }

  if (isDateSegment(segments[0])) {
    return {
      folderPath: '',
      folderName: 'Raiz',
      isFoldered: false,
    };
  }

  if (segments.length >= 3 && isDateSegment(segments[1])) {
    return {
      folderPath: normalizeFolderPath(segments[0]),
      folderName: '',
      isFoldered: true,
    };
  }

  return {
    folderPath: '',
    folderName: 'Raiz',
    isFoldered: false,
  };
}

function buildFolderLookup(index) {
  const folders = Array.isArray(index?.folders) ? index.folders : [];
  const map = new Map();

  for (const folder of folders) {
    map.set(folder.path, folder);
  }

  return map;
}

function summarizeFolders(index) {
  const folderCounts = new Map();

  for (const item of index.items) {
    if (!item.folderPath) {
      continue;
    }

    folderCounts.set(item.folderPath, (folderCounts.get(item.folderPath) || 0) + 1);
  }

  return index.folders.map((folder) => ({
    path: folder.path,
    displayName: folder.displayName,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
    fileCount: folderCounts.get(folder.path) || 0,
  }));
}

async function uploadJsonBlob(blobName, value) {
  const client = containerClient.getBlockBlobClient(blobName);
  const body = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');

  await client.uploadData(body, {
    blobHTTPHeaders: { blobContentType: 'application/json' },
  });
}

async function readJsonBlob(blobName) {
  const client = containerClient.getBlobClient(blobName);

  try {
    const buffer = await client.downloadToBuffer();
    return parseJsonBuffer(buffer);
  } catch (error) {
    if (error?.statusCode === 404 || error?.status === 404) {
      return null;
    }
    throw error;
  }
}

async function writeProjectManifest(manifest) {
  const normalized = normalizeProjectManifest(manifest, manifest.id);
  await uploadJsonBlob(projectManifestBlobName(normalized.id), normalized);
  return normalized;
}

async function writeProjectFilesIndex(projectId, index) {
  const safeProjectId = ensureProjectId(projectId);
  const normalized = normalizeFilesIndex(index);
  await uploadJsonBlob(projectFilesIndexBlobName(safeProjectId), normalized);
  return normalized;
}

async function readProjectManifest(projectId, tenantContext = {}) {
  const safeProjectId = ensureProjectId(projectId);
  const data = await readJsonBlob(projectManifestBlobName(safeProjectId));

  if (!data) {
    throw createHttpError(404, 'Project not found');
  }

  const manifest = normalizeProjectManifest(data, safeProjectId);
  if (!projectMatchesTenant(manifest, tenantContext)) {
    throw createHttpError(404, 'Project not found');
  }

  return manifest;
}

async function readProjectFilesIndex(projectId) {
  const safeProjectId = ensureProjectId(projectId);
  const data = await readJsonBlob(projectFilesIndexBlobName(safeProjectId));
  return data ? normalizeFilesIndex(data) : null;
}

function emptyFilesIndex() {
  return {
    updatedAt: new Date().toISOString(),
    total: 0,
    items: [],
    folders: [],
  };
}

async function deriveProjectFilesIndex(projectId) {
  const safeProjectId = ensureProjectId(projectId);
  const files = [];
  const folders = new Map();

  for await (const blob of containerClient.listBlobsFlat({
    prefix: projectFilesPrefix(safeProjectId),
    includeMetadata: true,
  })) {
    if (blob.name.endsWith('/index.json')) {
      continue;
    }

    const location = extractProjectFileLocation(blob.name, safeProjectId);
    const client = containerClient.getBlobClient(blob.name);
    const folderPath = location?.folderPath || '';

    if (folderPath && !folders.has(folderPath)) {
      folders.set(folderPath, {
        path: folderPath,
        displayName: blob.metadata?.folderName || folderPath,
        createdAt: blob.metadata?.folderCreatedAt || blob.metadata?.uploadedAt || blob.properties.lastModified || null,
        updatedAt: blob.metadata?.folderUpdatedAt || blob.metadata?.uploadedAt || blob.properties.lastModified || null,
      });
    }

    files.push({
      name: blob.name,
      projectId: safeProjectId,
      originalName: blob.metadata?.originalName || blob.name.split('/').pop(),
      contentType: normalizeContentType(blob.properties.contentType, blob.metadata?.originalName || blob.name.split('/').pop()),
      size: blob.properties.contentLength,
      lastModified: blob.properties.lastModified,
      uploadedAt: blob.metadata?.uploadedAt || blob.properties.lastModified || null,
      source: blob.metadata?.source || 'unknown',
      folderPath,
      folderName: blob.metadata?.folderName || (folderPath || ''),
      tenantId: normalizeTenantId(blob.metadata?.tenantId || blob.metadata?.tenant_id || ''),
      tenantName: normalizeTenantName(blob.metadata?.tenantName || blob.metadata?.tenant_name || ''),
    });
  }

  files.sort((a, b) => getTimestamp(b.lastModified) - getTimestamp(a.lastModified));

  return {
    updatedAt: new Date().toISOString(),
    total: files.length,
    items: files,
    folders: [...folders.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, 'es', { sensitivity: 'base' })),
  };
}

async function readOrBuildProjectFilesIndex(projectId) {
  const safeProjectId = ensureProjectId(projectId);

  try {
    const existing = await readProjectFilesIndex(safeProjectId);
    if (existing) {
      return existing;
    }
  } catch (error) {
    console.warn(`Falling back to a derived file index for project ${safeProjectId}`);
    console.warn(error);
  }

  const derived = await deriveProjectFilesIndex(safeProjectId);
  await writeProjectFilesIndex(safeProjectId, derived);
  return derived;
}

async function updateProjectManifestFromCurrent(projectId, updater, tenantContext = {}) {
  const current = await readProjectManifest(projectId, tenantContext);
  const next = updater(current);
  return writeProjectManifest(next);
}

async function readProjectWithFileCount(projectId, tenantContext = {}) {
  const manifest = await readProjectManifest(projectId, tenantContext);
  const index = await readOrBuildProjectFilesIndex(projectId);

  return {
    ...normalizeProjectManifest(
      {
        ...manifest,
        fileCount: index.total,
      },
      manifest.id,
    ),
    folders: index.folders,
  };
}

async function uploadProjectFileBuffer(projectId, buffer, { originalName, contentType, source, folderPath, tenantContext = {} }) {
  const safeProjectId = ensureProjectId(projectId);
  const manifest = await readProjectManifest(safeProjectId, tenantContext);
  const index = await readOrBuildProjectFilesIndex(safeProjectId);
  const safeFolderPath = normalizeFolderPath(folderPath);
  const folder = safeFolderPath ? index.folders.find((entry) => entry.path === safeFolderPath) : null;
  const normalizedContentType = normalizeContentType(contentType, originalName, buffer);
  const resolvedTenant = resolveTenantContext(tenantContext);

  if (safeFolderPath && !folder) {
    throw createHttpError(404, 'Folder not found');
  }

  const safeName = sanitizeFileName(originalName || 'upload.bin');
  const blobName = buildProjectFileBlobName(safeProjectId, safeFolderPath, safeName);
  const client = containerClient.getBlockBlobClient(blobName);
  const now = new Date().toISOString();

  const record = {
    name: blobName,
    projectId: safeProjectId,
    originalName: safeName,
    contentType: normalizedContentType,
    size: buffer.length,
    lastModified: now,
    uploadedAt: now,
    source: source || 'unknown',
    folderPath: safeFolderPath,
    folderName: folder?.displayName || (safeFolderPath || ''),
    tenantId: manifest.tenantId || resolvedTenant.tenantId || '',
    tenantName: manifest.tenantName || resolvedTenant.tenantName || '',
  };

  await client.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: record.contentType },
    metadata: {
      originalName: safeName,
      uploadedAt: now,
      projectId: safeProjectId,
      source: record.source,
      folderPath: safeFolderPath,
      folderName: record.folderName,
      tenantId: record.tenantId,
      tenantName: record.tenantName,
    },
  });

  try {
    const nextIndex = {
      updatedAt: now,
      total: index.total + 1,
      items: [record, ...index.items],
      folders: index.folders,
    };

    await writeProjectFilesIndex(safeProjectId, nextIndex);

    try {
      await writeProjectManifest({
        ...mergeTenantIntoManifest(manifest, resolvedTenant),
        fileCount: nextIndex.total,
        updatedAt: now,
      });
    } catch (manifestError) {
      try {
        await writeProjectFilesIndex(safeProjectId, index);
      } catch (rollbackError) {
        console.warn(`Failed to roll back file index for project ${safeProjectId}`);
        console.warn(rollbackError);
      }

      throw manifestError;
    }
  } catch (error) {
    await client.deleteIfExists();
    throw error;
  }

  return buildProjectFileResponse(record);
}

export async function getProjectFileDelivery(projectId, blobName, tenantContext = {}) {
  const safeProjectId = ensureProjectId(projectId);
  const safeBlobName = String(blobName || '');
  const prefix = projectFilesPrefix(safeProjectId);

  if (!safeBlobName.startsWith(prefix)) {
    throw createHttpError(400, 'Blob does not belong to the project');
  }

  await readProjectManifest(safeProjectId, tenantContext);
  const index = await readOrBuildProjectFilesIndex(safeProjectId);
  const file = index.items.find((item) => item.name === safeBlobName);

  if (!file) {
    throw createHttpError(404, 'File not found');
  }

  const blobClient = containerClient.getBlobClient(safeBlobName);
  const response = await blobClient.download(0);
  const originalName = sanitizeFileName(file.originalName || safeBlobName.split('/').pop() || 'download');
  const contentType = normalizeContentType(
    file.contentType || response.contentType || 'application/octet-stream',
    originalName,
  );

  if (!response.readableStreamBody) {
    throw createHttpError(500, 'File stream is not available');
  }

  return {
    originalName,
    contentType,
    contentLength: response.contentLength ?? file.size ?? 0,
    stream: response.readableStreamBody,
  };
}

function parseBase64Payload(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw createHttpError(400, 'base64 is required');
  }

  const trimmed = value.trim();
  const dataUrlMatch = trimmed.match(/^data:([^;]+);base64,(.+)$/i);

  if (dataUrlMatch) {
    return {
      base64: dataUrlMatch[2].replace(/\s+/g, ''),
      contentType: dataUrlMatch[1],
    };
  }

  return {
    base64: trimmed.replace(/\s+/g, ''),
    contentType: null,
  };
}

function parseUploadName(payload) {
  return payload?.fileName || payload?.originalName || payload?.name || 'upload.bin';
}

export function buildProjectId(name) {
  const base = slugify(name) || 'project';
  return `${base}-${nanoid(8)}`;
}

export function getProjectManifestPath(projectId) {
  return projectManifestBlobName(projectId);
}

export function getProjectFilesPrefix(projectId) {
  return projectFilesPrefix(projectId);
}

export function getProjectNamespacePrefix(projectId) {
  return projectNamespacePrefix(projectId);
}

export async function createProject({ name, description = '', folders = [], tenantId = '', tenantName = '' }) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) {
    throw createHttpError(400, 'Project name is required');
  }

  const tenantContext = resolveTenantContext({ tenantId, tenantName });
  const initialFolders = normalizeProjectFolders(folders);
  const now = new Date().toISOString();
  const manifest = normalizeProjectManifest(
    {
      id: buildProjectId(trimmedName),
      name: trimmedName,
      description: String(description || '').trim(),
      fileCount: 0,
      tenantId: tenantContext.tenantId,
      tenantName: tenantContext.tenantName,
      createdAt: now,
      updatedAt: now,
    },
    trimmedName,
  );

  await writeProjectManifest(manifest);

  try {
    await writeProjectFilesIndex(manifest.id, {
      ...emptyFilesIndex(),
      folders: initialFolders.map((folder) => ({
        ...folder,
        createdAt: now,
        updatedAt: now,
      })),
    });
  } catch (error) {
    await containerClient.getBlobClient(projectManifestBlobName(manifest.id)).deleteIfExists();
    throw error;
  }

  return readProjectWithFileCount(manifest.id, tenantContext);
}

export async function createProjectFolder(projectId, { name, tenantId = '', tenantName = '' } = {}) {
  const safeProjectId = ensureProjectId(projectId);
  const tenantContext = resolveTenantContext({ tenantId, tenantName });
  const manifest = await readProjectManifest(safeProjectId, tenantContext);
  const index = await readOrBuildProjectFilesIndex(safeProjectId);
  const displayName = String(name || '').trim();

  if (!displayName) {
    throw createHttpError(400, 'Folder name is required');
  }

  const path = normalizeFolderPath(displayName);
  if (!path) {
    throw createHttpError(400, 'Folder name is required');
  }

  if (index.folders.some((folder) => folder.path === path)) {
    throw createHttpError(409, 'Folder already exists');
  }

  const now = new Date().toISOString();
  const folder = {
    path,
    displayName,
    createdAt: now,
    updatedAt: now,
  };

  const nextIndex = {
    ...index,
    updatedAt: now,
    folders: [...index.folders, folder],
  };

  await writeProjectFilesIndex(safeProjectId, nextIndex);

  try {
    await writeProjectManifest({
      ...mergeTenantIntoManifest(manifest, tenantContext),
      updatedAt: now,
    });
  } catch (error) {
    try {
      await writeProjectFilesIndex(safeProjectId, index);
    } catch (rollbackError) {
      console.warn(`Failed to roll back folder creation for project ${safeProjectId}`);
      console.warn(rollbackError);
    }

    throw error;
  }

  return folder;
}

export async function listProjects(tenantContext = {}) {
  const resolvedTenant = resolveTenantContext(tenantContext);
  const projects = [];

  for await (const blob of containerClient.listBlobsFlat({ prefix: 'projects/' })) {
    if (!blob.name.endsWith('/project.json')) {
      continue;
    }

    const projectId = blob.name.split('/')[1];

    try {
      projects.push(await readProjectWithFileCount(projectId, resolvedTenant));
    } catch (error) {
      console.warn(`Skipping malformed project manifest: ${blob.name}`);
      console.warn(error);
    }
  }

  return projects.sort((a, b) => getTimestamp(b.updatedAt || b.createdAt) - getTimestamp(a.updatedAt || a.createdAt));
}

export async function getProject(projectId, tenantContext = {}) {
  return readProjectWithFileCount(projectId, tenantContext);
}

export async function updateProject(projectId, updates = {}, tenantContext = {}) {
  const current = await readProjectManifest(projectId, tenantContext);

  const nextName = updates.name !== undefined ? String(updates.name).trim() : current.name;
  if (!nextName) {
    throw createHttpError(400, 'Project name is required');
  }

  const nextDescription = updates.description !== undefined
    ? String(updates.description).trim()
    : current.description;

  const updated = normalizeProjectManifest(
    {
      ...current,
      name: nextName,
      description: nextDescription,
      ...resolveTenantContext(tenantContext),
      updatedAt: new Date().toISOString(),
    },
    current.id,
  );

  await writeProjectManifest(updated);
  return updated;
}

export async function deleteProject(projectId, tenantContext = {}) {
  const safeProjectId = ensureProjectId(projectId);
  await readProjectManifest(safeProjectId, tenantContext);

  let deletedCount = 0;
  for await (const blob of containerClient.listBlobsFlat({ prefix: projectNamespacePrefix(safeProjectId) })) {
    await containerClient.getBlobClient(blob.name).deleteIfExists();
    deletedCount += 1;
  }

  return { projectId: safeProjectId, deletedCount };
}

export async function listProjectFiles(projectId, { page = 1, pageSize = DEFAULT_PAGE_SIZE, folderPath, tenantId = '', tenantName = '' } = {}) {
  const safeProjectId = ensureProjectId(projectId);
  const tenantContext = resolveTenantContext({ tenantId, tenantName });
  await readProjectManifest(safeProjectId, tenantContext);

  const index = await readOrBuildProjectFilesIndex(safeProjectId);
  const normalizedPageSize = clampNumber(pageSize, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  const hasFolderFilter = folderPath !== undefined;
  const normalizedFolderPath = hasFolderFilter ? normalizeFolderPath(folderPath) : null;
  const folderExists = normalizedFolderPath
    ? index.folders.some((folder) => folder.path === normalizedFolderPath)
    : true;

  if (hasFolderFilter && normalizedFolderPath && !folderExists) {
    throw createHttpError(404, 'Folder not found');
  }

  const visibleItems = hasFolderFilter
    ? index.items.filter((item) => item.folderPath === normalizedFolderPath)
    : index.items;

  const total = visibleItems.length;
  const totalPages = Math.max(1, Math.ceil(total / normalizedPageSize));
  const normalizedPage = clampNumber(page, 1, totalPages, 1);
  const startIndex = (normalizedPage - 1) * normalizedPageSize;
  const folders = summarizeFolders(index);
  const folderLookup = buildFolderLookup(index);
  const rootFileCount = index.items.filter((item) => !item.folderPath).length;

  return {
    items: visibleItems.slice(startIndex, startIndex + normalizedPageSize).map((item) => {
      const folder = item.folderPath ? folderLookup.get(item.folderPath) : null;
      return buildProjectFileResponse({
        ...item,
        folderName: folder?.displayName || item.folderName || (item.folderPath || 'Raiz'),
      });
    }),
    folders,
    rootFileCount,
    page: normalizedPage,
    pageSize: normalizedPageSize,
    total,
    totalPages,
    hasPreviousPage: normalizedPage > 1,
    hasNextPage: normalizedPage < totalPages,
  };
}

export async function uploadFileToProject(projectId, file, tenantContext = {}) {
  return uploadProjectFileBuffer(projectId, file.buffer, {
    originalName: file.originalname,
    contentType: file.mimetype,
    source: 'multipart',
    folderPath: file.folderPath,
    tenantContext,
  });
}

export async function uploadBase64FileToProject(projectId, payload, maxFileSizeBytes = Infinity, tenantContext = {}) {
  const safeProjectId = ensureProjectId(projectId);
  const parsed = parseBase64Payload(payload?.base64 || payload?.data || payload?.content);
  const fileName = parseUploadName(payload);
  const buffer = Buffer.from(parsed.base64, 'base64');
  const contentType = normalizeContentType(
    payload?.contentType || payload?.mimeType || parsed.contentType,
    fileName,
    buffer,
  );
  const folderPath = payload?.folderPath;

  if (!buffer.length) {
    throw createHttpError(400, 'base64 payload is invalid');
  }

  if (Number.isFinite(maxFileSizeBytes) && buffer.length > maxFileSizeBytes) {
    throw createHttpError(413, `File exceeds the limit of ${Math.floor(maxFileSizeBytes / 1024 / 1024)} MB`);
  }

  return uploadProjectFileBuffer(safeProjectId, buffer, {
    originalName: fileName,
    contentType,
    source: 'base64',
    folderPath,
    tenantContext,
  });
}

export async function deleteProjectFile(projectId, blobName, tenantContext = {}) {
  const safeProjectId = ensureProjectId(projectId);
  const safeBlobName = String(blobName || '');
  const prefix = projectFilesPrefix(safeProjectId);

  if (!safeBlobName.startsWith(prefix)) {
    throw createHttpError(400, 'Blob does not belong to the project');
  }

  const manifest = await readProjectManifest(safeProjectId, tenantContext);
  const index = await readOrBuildProjectFilesIndex(safeProjectId);

  const nextItems = index.items.filter((item) => item.name !== safeBlobName);
  const now = new Date().toISOString();
  const nextIndex = {
    updatedAt: now,
    total: nextItems.length,
    items: nextItems,
    folders: index.folders,
  };

  await writeProjectFilesIndex(safeProjectId, nextIndex);

  try {
    await writeProjectManifest({
      ...mergeTenantIntoManifest(manifest, tenantContext),
      fileCount: nextIndex.total,
      updatedAt: now,
    });
  } catch (manifestError) {
    try {
      await writeProjectFilesIndex(safeProjectId, index);
    } catch (rollbackError) {
      console.warn(`Failed to roll back file index for project ${safeProjectId}`);
      console.warn(rollbackError);
    }

    throw manifestError;
  }

  try {
    await containerClient.getBlobClient(safeBlobName).deleteIfExists();
  } catch (deleteError) {
    try {
      await writeProjectFilesIndex(safeProjectId, index);
    } catch (rollbackError) {
      console.warn(`Failed to roll back file index for project ${safeProjectId}`);
      console.warn(rollbackError);
    }

    try {
      await writeProjectManifest({
        ...mergeTenantIntoManifest(manifest, tenantContext),
        updatedAt: now,
      });
    } catch (rollbackError) {
      console.warn(`Failed to roll back project manifest for project ${safeProjectId}`);
      console.warn(rollbackError);
    }

    throw deleteError;
  }

  return { deleted: true };
}

export async function createProjectReadSasUrl(projectId, blobName, minutes = 15, tenantContext = {}) {
  const safeProjectId = ensureProjectId(projectId);
  const safeBlobName = String(blobName || '');
  const prefix = projectFilesPrefix(safeProjectId);

  if (!safeBlobName.startsWith(prefix)) {
    throw createHttpError(400, 'Blob does not belong to the project');
  }

  await readProjectManifest(safeProjectId, tenantContext);
  const index = await readOrBuildProjectFilesIndex(safeProjectId);

  if (!index.items.some((item) => item.name === safeBlobName)) {
    throw createHttpError(404, 'File not found');
  }

  return buildProjectFileRouteUrl(safeProjectId, safeBlobName, 'view');
}

export async function createProjectDownloadSasUrl(projectId, blobName, minutes = 15, tenantContext = {}) {
  const safeProjectId = ensureProjectId(projectId);
  const safeBlobName = String(blobName || '');
  const prefix = projectFilesPrefix(safeProjectId);

  if (!safeBlobName.startsWith(prefix)) {
    throw createHttpError(400, 'Blob does not belong to the project');
  }

  await readProjectManifest(safeProjectId, tenantContext);
  const index = await readOrBuildProjectFilesIndex(safeProjectId);
  const file = index.items.find((item) => item.name === safeBlobName);

  if (!file) {
    throw createHttpError(404, 'File not found');
  }

  return buildProjectFileRouteUrl(safeProjectId, safeBlobName, 'download');
}
