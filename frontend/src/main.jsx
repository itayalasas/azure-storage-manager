import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowRight,
  BadgeCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Building2,
  DatabaseZap,
  ExternalLink,
  FileUp,
  Download,
  Folder,
  FolderPlus,
  Fingerprint,
  KeyRound,
  Layers3,
  LogIn,
  LockKeyhole,
  MoveRight,
  PanelLeft,
  Pencil,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Workflow,
  Trash2,
  UserPlus,
  Upload,
} from 'lucide-react';
import {
  buildAuthHeaders,
  buildLoginUrl,
  buildRegisterUrl,
  clearAuthSession,
  exchangeAuthCode,
  getSessionDisplayName,
  getStoredAuthSession,
  getTenantDisplayName,
  loadAuthConfig,
  normalizeAuthSession,
  persistAuthSession,
  verifyAuthToken,
} from './auth.js';
import './styles.css';

const APP_NAME = 'Azure Storage Manager';
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const PAGE_SIZE_OPTIONS = [8, 12, 24];
const BRAND_ICON = '/brand-icon.png';
const AUTH_ROUTE_PATHS = new Set(['/', '/login', '/callback', '/dashboard']);
const API_EXAMPLES = [
  {
    key: 'upload',
    title: 'Subir archivo base64',
    method: 'POST',
    route: '/api/public/files/base64',
    icon: FileUp,
    description: 'Envía cualquier archivo codificado en base64 al proyecto correcto.',
    note: 'Si no envias `folderPath`, el archivo se guarda en la raiz del proyecto.',
    code: `POST /api/public/files/base64
{
  "projectId": "sendcraft-qgjulp6x",
  "fileName": "documento.pdf",
  "contentType": "application/pdf",
  "folderPath": "facturas-2026",
  "base64": "JVBERi0xLjQK..."
}`,
  },
  {
    key: 'create-project',
    title: 'Crear proyecto',
    method: 'POST',
    route: '/api/public/projects',
    icon: FolderPlus,
    description: 'Crea un proyecto y deja listas sus carpetas iniciales en una sola llamada.',
    note: 'El campo `folders` es opcional. Si lo omites, el proyecto se crea vacio.',
    code: `POST /api/public/projects
{
  "name": "SendCraft",
  "description": "Documentos y archivos del flujo",
  "folders": [
    "facturas-2026",
    "clientes"
  ]
}`,
  },
  {
    key: 'delete-project',
    title: 'Eliminar proyecto',
    method: 'DELETE',
    route: '/api/public/projects/:projectId',
    icon: Trash2,
    description: 'Borra el proyecto completo junto con su contenido y metadatos.',
    note: 'No requiere body. Solo cambia el `projectId` en la ruta.',
    code: `DELETE /api/public/projects/sendcraft-qgjulp6x`,
  },
];

function formatBytes(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(1)} ${units[index]}`;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
}

function defaultPagination(pageSize = 8) {
  return {
    page: 1,
    pageSize,
    total: 0,
    totalPages: 1,
    hasPreviousPage: false,
    hasNextPage: false,
  };
}

function formatFolderName(folderPath, folderName) {
  if (!folderPath) {
    return 'Raíz';
  }

  return folderName || folderPath;
}

function getFolderViewLabel(folderPath, folders = []) {
  if (folderPath === null) {
    return 'todo el proyecto';
  }

  if (folderPath === '') {
    return 'la raíz';
  }

  return folders.find((folder) => folder.path === folderPath)?.displayName || folderPath;
}

async function requestJson(url, options = {}) {
  const headers = {
    ...(options.headers || {}),
    ...buildAuthHeaders(),
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });
  const text = await response.text();
  let body = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const message = body && typeof body === 'object' && body.message
      ? body.message
      : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return body;
}

function sortProjects(projectsList) {
  return [...projectsList].sort((a, b) => {
    const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return bTime - aTime;
  });
}

function normalizePathname(pathname) {
  const raw = String(pathname || '/').trim();
  const base = raw.split('?')[0].replace(/\/+$/, '');
  if (!base) {
    return '/';
  }

  return base.startsWith('/') ? base : `/${base}`;
}

function navigateTo(pathname, { replace = false } = {}) {
  const nextPath = normalizePathname(pathname);

  if (replace) {
    window.history.replaceState({}, '', nextPath);
  } else {
    window.history.pushState({}, '', nextPath);
  }

  window.dispatchEvent(new PopStateEvent('popstate'));
}

function safeAuthUrl(builder) {
  try {
    return builder();
  } catch {
    return '';
  }
}

function AuthLoadingState({ title, message }) {
  return (
    <main className="auth-shell">
      <div className="auth-orb auth-orb-a" />
      <div className="auth-orb auth-orb-b" />
      <section className="auth-loading-card">
        <span className="auth-loading-spinner">
          <RefreshCw size={20} />
        </span>
        <p className="section-kicker">Autenticacion</p>
        <h1>{title}</h1>
        <p>{message}</p>
      </section>
    </main>
  );
}

function AuthFeatureCard({ icon: Icon, title, description }) {
  return (
    <article className="auth-feature-card">
      <span className="auth-feature-icon">
        <Icon size={18} />
      </span>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
    </article>
  );
}

function AuthStateRow({ label, value }) {
  return (
    <div className="auth-state-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LandingMetric({ icon: Icon, label, value, detail }) {
  return (
    <article className="landing-metric">
      <div className="landing-metric-head">
        {Icon && (
          <span className="landing-metric-icon">
            <Icon size={14} />
          </span>
        )}
        <p>{label}</p>
      </div>
      <strong>{value}</strong>
      <span>{detail}</span>
    </article>
  );
}

function LandingStep({ index, icon: Icon, title, description }) {
  return (
    <article className="landing-step">
      <div className="landing-step-index">{index}</div>
      <span className="landing-step-icon">
        <Icon size={15} />
      </span>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
    </article>
  );
}

function LandingSignal({ icon: Icon, label, value, detail }) {
  return (
    <article className="landing-signal">
      <div className="landing-signal-head">
        <span className="landing-signal-icon">
          <Icon size={14} />
        </span>
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function LandingHighlight({ icon: Icon, title, description }) {
  return (
    <article className="landing-highlight">
      <span className="landing-highlight-icon">
        <Icon size={18} />
      </span>
      <strong>{title}</strong>
      <p>{description}</p>
    </article>
  );
}

function LandingPage({
  authConfig,
  authLoading,
  authError,
  session,
  onGoLogin,
  onGoDashboard,
  onLogout,
}) {
  const projectName = authConfig?.project_name || APP_NAME;
  const description = authConfig?.description || 'Acceso empresarial para proyectos y almacenamiento multi-tenant.';
  const hasSession = Boolean(session);

  return (
    <main className="auth-shell auth-landing">
      <div className="auth-orb auth-orb-a" />
      <div className="auth-orb auth-orb-b" />
      <div className="auth-grid">
        <section className="auth-copy">
          <div className="brand-lockup auth-brand-lockup">
            <img src={BRAND_ICON} alt="" aria-hidden="true" />
            <div>
              <p className="eyebrow">{projectName}</p>
              <span>Acceso seguro a tu ecosistema de archivos</span>
            </div>
          </div>

          <span className="auth-eyebrow">
            <ShieldCheck size={14} />
            Multi-tenant ready
          </span>

          <h1>Una puerta de entrada elegante para tu storage empresarial.</h1>
          <p className="auth-lead">
            Valida usuarios con el flujo de autenticacion externo, conserva la sesion del tenant y
            entra al dashboard solo cuando el token ya fue intercambiado y verificado.
          </p>

          <div className="auth-feature-list">
            <AuthFeatureCard
              icon={ShieldCheck}
              title="Sesion verificada"
              description="El code se intercambia por tokens y luego se valida la sesion antes de abrir el panel."
            />
            <AuthFeatureCard
              icon={Building2}
              title="Tenant compartido"
              description="Varios usuarios pueden operar bajo el mismo tenant con el mismo contexto."
            />
            <AuthFeatureCard
              icon={KeyRound}
              title="URLs dinamicas"
              description="El login y el registro se construyen con la configuracion cargada desde la API."
            />
          </div>

          <div className="auth-actions">
            <button type="button" onClick={onGoLogin}>
              <LogIn size={16} />
              Iniciar sesión
            </button>
            {hasSession && (
              <button type="button" className="secondary" onClick={onGoDashboard}>
                <ArrowRight size={16} />
                Ir al dashboard
              </button>
            )}
            {hasSession && (
              <button type="button" className="danger" onClick={onLogout}>
                Cerrar sesión
              </button>
            )}
          </div>

          <div className="auth-footnote">
            <span>
              <Sparkles size={14} />
              {projectName}
            </span>
            {authError ? (
              <span className="auth-error-inline">{authError}</span>
            ) : (
              <span>{authLoading ? 'Cargando configuracion de autenticacion...' : description}</span>
            )}
          </div>
        </section>

        <aside className="auth-panel auth-landing-panel">
          <div className="auth-panel-top">
            <p className="section-kicker">Acceso</p>
            <h2>{authLoading ? 'Cargando configuracion...' : projectName}</h2>
            <p>{description}</p>
          </div>

          <div className="auth-signal-card">
            <AuthStateRow
              label="Estado"
              value={authLoading ? 'Sincronizando' : 'Listo'}
            />
            <AuthStateRow
              label="Redirect"
              value={authConfig?.variables?.VITE_REDIRECT_URI || `${window.location.origin}/callback`}
            />
            <AuthStateRow
              label="App ID"
              value={authConfig?.variables?.VITE_AUTH_APP_ID || '...'}
            />
          </div>

          <div className="auth-login-preview">
            <div className="auth-login-preview-head">
              <BadgeCheck size={18} />
              <div>
                <strong>Flujo seguro</strong>
                <p>Config remota, login externo, callback local y dashboard protegido.</p>
              </div>
            </div>

            <div className="auth-login-preview-footer">
              <button type="button" className="secondary" onClick={onGoLogin}>
                Abrir login
              </button>
              {hasSession && (
                <button type="button" className="secondary" onClick={onGoDashboard}>
                  Ir al panel
                </button>
              )}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function LandingPageV2({
  authConfig,
  authLoading,
  authError,
  session,
  onGoLogin,
  onGoDashboard,
  onLogout,
}) {
  const projectName = authConfig?.project_name || APP_NAME;
  const description = authConfig?.description || 'Acceso empresarial para proyectos y almacenamiento multi-tenant.';
  const hasSession = Boolean(session);
  const redirectUri = authConfig?.variables?.VITE_REDIRECT_URI || `${window.location.origin}/callback`;
  const authUrl = authConfig?.variables?.VITE_AUTH_URL || '';
  const appId = authConfig?.variables?.VITE_AUTH_APP_ID || '...';
  const variableCount = authConfig?.variables ? Object.keys(authConfig.variables).length : 0;
  const statusTone = authError ? 'danger' : authLoading ? 'loading' : 'ready';
  const statusText = authError
    ? 'Error de configuracion'
    : authLoading
      ? 'Sincronizando con la API'
      : 'API conectada y lista';

  return (
    <main className="lp">
      <div className="lp-grid-bg" aria-hidden="true" />
      <div className="lp-glow lp-glow-1" aria-hidden="true" />
      <div className="lp-glow lp-glow-2" aria-hidden="true" />
      <div className="lp-glow lp-glow-3" aria-hidden="true" />

      <nav className="lp-nav">
        <div className="lp-nav-brand">
          <img src={BRAND_ICON} alt="" aria-hidden="true" />
          <div>
            <strong>{projectName}</strong>
            <span>Storage Platform</span>
          </div>
        </div>
        <div className="lp-nav-links">
          <a href="#flujo">Flujo</a>
          <a href="#api">API</a>
          <a href="#plataforma">Plataforma</a>
        </div>
        <div className="lp-nav-cta">
          <span className={`lp-status lp-status-${statusTone}`}>
            <span className="lp-status-dot" />
            {statusText}
          </span>
          <button type="button" onClick={hasSession ? onGoDashboard : onGoLogin}>
            {hasSession ? 'Abrir dashboard' : 'Iniciar sesion'}
            <ArrowRight size={16} />
          </button>
        </div>
      </nav>

      <section className="lp-hero">
        <span className="lp-badge">
          <Sparkles size={14} />
          v2 · Multi-tenant ready
        </span>
        <h1 className="lp-hero-title">
          Almacenamiento Azure
          <br />
          <em>seguro, multi-tenant,</em>
          <br />
          listo para produccion.
        </h1>
        <p className="lp-hero-sub">
          La pantalla carga la configuracion remota, arma las URLs de login y registro, y deja listo
          el flujo de callback para validar la sesion antes de entrar al dashboard.
        </p>
        <div className="lp-hero-cta">
          <button type="button" onClick={hasSession ? onGoDashboard : onGoLogin}>
            <LogIn size={16} />
            {hasSession ? 'Continuar al dashboard' : 'Iniciar sesion segura'}
          </button>
          <a className="lp-ghost" href="#flujo">
            Ver flujo de acceso
            <MoveRight size={14} />
          </a>
        </div>

        <div className="lp-marquee">
          <span><ShieldCheck size={14} /> OAuth code + verify</span>
          <span><Building2 size={14} /> Tenants aislados</span>
          <span><KeyRound size={14} /> URLs dinamicas</span>
          <span><DatabaseZap size={14} /> Config remota</span>
          <span><Layers3 size={14} /> API publica</span>
        </div>
      </section>

      <section className="lp-terminal" aria-label="Configuracion en vivo">
        <div className="lp-terminal-head">
          <span className="lp-dots"><i /><i /><i /></span>
          <span className="lp-terminal-title">auth.config — live</span>
          <span className={`lp-pill lp-pill-${statusTone}`}>
            <span className="lp-status-dot" />
            {authLoading ? 'syncing' : authError ? 'error' : 'ok'}
          </span>
        </div>
        <div className="lp-terminal-body">
          <div className="lp-kv"><span>project</span><code>{projectName}</code></div>
          <div className="lp-kv"><span>app_id</span><code>{appId}</code></div>
          <div className="lp-kv"><span>auth_url</span><code>{authUrl || '—'}</code></div>
          <div className="lp-kv"><span>redirect_uri</span><code>{redirectUri}</code></div>
          <div className="lp-kv"><span>variables</span><code>{authLoading ? '...' : `${variableCount} loaded`}</code></div>
          <div className="lp-kv"><span>session</span><code>{hasSession ? getSessionDisplayName(session) : 'none'}</code></div>
        </div>
      </section>

      <section className="lp-section" id="flujo">
        <div className="lp-section-head">
          <span className="lp-kicker">Flujo de acceso</span>
          <h2>Tres pasos. Sin sorpresas.</h2>
          <p>Configuracion remota + OAuth + verificacion del token antes de persistir la sesion.</p>
        </div>
        <ol className="lp-steps">
          <li>
            <span className="lp-step-num">01</span>
            <div className="lp-step-icon"><LogIn size={20} /></div>
            <h3>Solicitar acceso</h3>
            <p>Se arma la URL con <code>app_id</code>, <code>redirect_uri</code> y <code>api_key</code> desde la configuracion remota.</p>
          </li>
          <li>
            <span className="lp-step-num">02</span>
            <div className="lp-step-icon"><MoveRight size={20} /></div>
            <h3>Recibir callback</h3>
            <p>El proveedor responde con <code>code</code> y <code>state</code> autenticado para continuar el flujo.</p>
          </li>
          <li>
            <span className="lp-step-num">03</span>
            <div className="lp-step-icon"><BadgeCheck size={20} /></div>
            <h3>Validar sesion</h3>
            <p>Intercambiamos el code por tokens y validamos el access token antes de persistir la sesion.</p>
          </li>
        </ol>
      </section>

      <section className="lp-section lp-section-split" id="api">
        <div className="lp-split-left">
          <span className="lp-kicker">API publica</span>
          <h2>Integra storage en minutos, no en sprints.</h2>
          <p className="lp-split-lead">
            Endpoints REST listos para subir archivos en base64, crear proyectos y organizar carpetas.
            Respuestas JSON consistentes y errores tipados.
          </p>
          <ul className="lp-check-list">
            <li><BadgeCheck size={16} /> Upload base64 con auto-organizacion por carpeta</li>
            <li><BadgeCheck size={16} /> CRUD completo de proyectos y carpetas</li>
            <li><BadgeCheck size={16} /> Auth por API key + tenant, sin SDK obligatorio</li>
            <li><BadgeCheck size={16} /> Webhooks y URLs firmadas para descargas</li>
          </ul>
        </div>
        <div className="lp-split-right">
          <div className="lp-code">
            <div className="lp-code-head">
              <span className="lp-dots"><i /><i /><i /></span>
              <span className="lp-code-file">curl · upload.sh</span>
            </div>
            <div className="lp-code-tab">
              <span className="lp-method lp-method-post">POST</span>
              <code>/api/public/files/base64</code>
            </div>
            <pre>{`{
  "projectId": "sendcraft-qgjulp6x",
  "fileName": "documento.pdf",
  "contentType": "application/pdf",
  "folderPath": "facturas-2026",
  "base64": "JVBERi0xLjQK..."
}`}</pre>
          </div>
        </div>
      </section>

      <section className="lp-section" id="plataforma">
        <div className="lp-section-head">
          <span className="lp-kicker">Plataforma</span>
          <h2>Construida para equipos serios.</h2>
          <p>Todo lo que necesitas para operar storage multi-tenant sin reinventar la rueda.</p>
        </div>
        <div className="lp-features">
          <article>
            <div className="lp-feature-icon"><ShieldCheck size={22} /></div>
            <h3>Seguridad empresarial</h3>
            <p>La sesion solo se guarda despues de intercambiar el code y verificar el access token.</p>
          </article>
          <article>
            <div className="lp-feature-icon"><Layers3 size={22} /></div>
            <h3>Organizacion por capas</h3>
            <p>Pensado para proyectos, carpetas y archivos por contexto de tenant.</p>
          </article>
          <article>
            <div className="lp-feature-icon"><Workflow size={22} /></div>
            <h3>Flujo consistente</h3>
            <p>Login, callback y dashboard comparten la misma configuracion remota.</p>
          </article>
          <article>
            <div className="lp-feature-icon"><DatabaseZap size={22} /></div>
            <h3>Configuracion viva</h3>
            <p>Variables, URLs y endpoints se sincronizan en caliente desde la API.</p>
          </article>
          <article>
            <div className="lp-feature-icon"><Building2 size={22} /></div>
            <h3>Multi-tenant nativo</h3>
            <p>Aislamiento por tenant en todo el stack: storage, identidad y permisos.</p>
          </article>
          <article>
            <div className="lp-feature-icon"><Fingerprint size={22} /></div>
            <h3>Identidad verificada</h3>
            <p>Cada peticion incluye headers firmados y la sesion se valida en el cliente.</p>
          </article>
        </div>
      </section>

      <section className="lp-cta">
        <div className="lp-cta-inner">
          <span className="lp-kicker">Comenzar</span>
          <h2>¿Listo para entrar?</h2>
          <p>Inicia sesion para abrir el workspace y empezar a operar tus archivos.</p>
          <div className="lp-cta-actions">
            <button type="button" onClick={hasSession ? onGoDashboard : onGoLogin}>
              <LogIn size={16} />
              {hasSession ? 'Abrir dashboard' : 'Iniciar sesion'}
            </button>
            {hasSession && (
              <button type="button" className="secondary" onClick={onLogout}>
                Cerrar sesion
              </button>
            )}
          </div>
          <div className="lp-cta-meta">
            <span><ShieldCheck size={14} /> Code exchange + verify</span>
            <span><KeyRound size={14} /> URLs dinamicas</span>
            <span><Building2 size={14} /> Tenant: {hasSession ? getTenantDisplayName(session) : 'sin sesion'}</span>
          </div>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-footer-brand">
          <img src={BRAND_ICON} alt="" aria-hidden="true" />
          <div>
            <strong>{projectName}</strong>
            <span>{description}</span>
          </div>
        </div>
        <span className="lp-footer-meta">
          © {new Date().getFullYear()} · {authError ? authError : authLoading ? 'Cargando configuracion...' : 'Configuracion sincronizada'}
        </span>
      </footer>
    </main>
  );
}

function LoginPage({
  authConfig,
  authLoading,
  authError,
  session,
  onGoHome,
  onGoDashboard,
  onLogin,
  onRegister,
  onLogout,
}) {
  const loginUrl = safeAuthUrl(() => buildLoginUrl(authConfig));
  const registerUrl = safeAuthUrl(() => buildRegisterUrl(authConfig));
  const projectName = authConfig?.project_name || APP_NAME;
  const tenantLabel = session ? getTenantDisplayName(session) : 'Sin tenant activo';
  const userLabel = session ? getSessionDisplayName(session) : 'Sin sesion activa';

  return (
    <main className="auth-shell auth-login">
      <div className="auth-orb auth-orb-a" />
      <div className="auth-orb auth-orb-b" />
      <div className="auth-grid auth-grid-login">
        <section className="auth-copy">
          <div className="brand-lockup auth-brand-lockup">
            <img src={BRAND_ICON} alt="" aria-hidden="true" />
            <div>
              <p className="eyebrow">{projectName}</p>
              <span>Inicia sesion y entra al workspace</span>
            </div>
          </div>

          <span className="auth-eyebrow">
            <LogIn size={14} />
            Inicio de sesion
          </span>

          <h1>Accede con tu cuenta y regresa con una sesion ya validada.</h1>
          <p className="auth-lead">
            La pantalla obtiene la configuracion desde una API interna, arma las URLs de login y
            registro, y deja listo el callback para intercambiar el code por tokens.
          </p>

          <div className="auth-feature-list compact">
            <AuthFeatureCard
              icon={Fingerprint}
              title="Code exchange"
              description="Recibimos el code del callback y lo intercambiamos por access y refresh token."
            />
            <AuthFeatureCard
              icon={ShieldCheck}
              title="Token validation"
              description="La sesion se valida antes de guardar cualquier estado en localStorage."
            />
            <AuthFeatureCard
              icon={Building2}
              title="Contexto tenant"
              description="El tenant queda disponible para que el storage se organice por empresa."
            />
          </div>

          <div className="auth-actions">
            <button
              type="button"
              onClick={() => onLogin(loginUrl)}
              disabled={authLoading || !loginUrl}
            >
              <LogIn size={16} />
              Iniciar sesión
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => onRegister(registerUrl)}
              disabled={authLoading || !registerUrl}
            >
              <UserPlus size={16} />
              Crear cuenta
            </button>
          </div>

          <div className="auth-footnote">
            <span>
              <Sparkles size={14} />
              {authConfig?.project_name || APP_NAME}
            </span>
            {authError ? (
              <span className="auth-error-inline">{authError}</span>
            ) : (
              <span>
                {authLoading
                  ? 'Cargando configuracion de autenticacion...'
                  : `Redirect: ${authConfig?.variables?.VITE_REDIRECT_URI || `${window.location.origin}/callback`}`}
              </span>
            )}
          </div>
        </section>

        <aside className="auth-panel auth-login-panel">
          <div className="auth-panel-top">
            <p className="section-kicker">Sesion</p>
            <h2>{userLabel}</h2>
            <p>{session ? `Tenant: ${tenantLabel}` : 'Inicia sesion para abrir el dashboard.'}</p>
          </div>

          <div className="auth-signal-card">
            <AuthStateRow label="App ID" value={authConfig?.variables?.VITE_AUTH_APP_ID || '...'} />
            <AuthStateRow
              label="Login URL"
              value={loginUrl ? 'Lista para abrir' : 'Esperando configuracion'}
            />
            <AuthStateRow
              label="Registro"
              value={registerUrl ? 'Lista para abrir' : 'Esperando configuracion'}
            />
          </div>

          <div className="auth-login-preview">
            <div className="auth-login-preview-head">
              <BadgeCheck size={18} />
              <div>
                <strong>Dashboard protegido</strong>
                <p>Solo se abre cuando la sesion ya fue firmada y guardada localmente.</p>
              </div>
            </div>

            <div className="auth-login-preview-footer">
              {session ? (
                <>
                  <button type="button" className="secondary" onClick={onGoDashboard}>
                    Ir al dashboard
                  </button>
                  <button type="button" className="secondary" onClick={onLogout}>
                    Cerrar sesión
                  </button>
                </>
              ) : (
                <button type="button" className="secondary" onClick={onGoHome}>
                  Volver al inicio
                </button>
              )}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function CallbackPage({ authConfig, onSessionReady, onAbort }) {
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('Procesando respuesta de autenticacion...');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function processCallback() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const state = params.get('state');

      if (!code || state !== 'authenticated') {
        setStatus('error');
        setError('El callback no contiene un code valido o el state no coincide.');
        return;
      }

      try {
        setStatus('loading');
        setMessage('Intercambiando el code por tokens...');
        const exchangeResponse = await exchangeAuthCode(API_URL, code);

        if (!exchangeResponse?.success) {
          throw new Error(exchangeResponse?.message || 'No se pudo intercambiar el code.');
        }

        const accessToken = exchangeResponse?.data?.access_token;
        if (!accessToken) {
          throw new Error('El intercambio no devolvio access_token.');
        }

        setMessage('Validando la sesion con el token emitido...');
        const verificationResponse = await verifyAuthToken(API_URL, accessToken);

        if (!verificationResponse?.success || !verificationResponse?.data?.valid) {
          throw new Error('La validacion del token no fue exitosa.');
        }

        const session = normalizeAuthSession(exchangeResponse, verificationResponse, authConfig);
        persistAuthSession(session);

        if (!active) {
          return;
        }

        onSessionReady(session);
        window.setTimeout(() => {
          navigateTo('/dashboard', { replace: true });
        }, 0);
      } catch (processError) {
        if (!active) {
          return;
        }

        clearAuthSession();
        setStatus('error');
        setError(processError.message || 'No se pudo completar la autenticacion.');
      }
    }

    processCallback();

    return () => {
      active = false;
    };
  }, [onSessionReady]);

  if (status === 'error') {
    return (
      <main className="auth-shell">
        <div className="auth-orb auth-orb-a" />
        <div className="auth-orb auth-orb-b" />
        <section className="auth-loading-card auth-error-card">
          <span className="auth-loading-spinner danger">
            <ShieldCheck size={20} />
          </span>
          <p className="section-kicker">Error</p>
          <h1>No se pudo completar la sesion</h1>
          <p>{error}</p>
          <div className="auth-login-preview-footer">
            <button type="button" onClick={() => onAbort('/login')}>
              Volver al login
            </button>
            <button type="button" className="secondary" onClick={() => onAbort('/')}>
              Ir al inicio
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <AuthLoadingState
      title="Estamos validando tu acceso"
      message={message}
    />
  );
}

function DashboardPage({ session, onSignOut }) {
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectEditName, setProjectEditName] = useState('');
  const [projectEditDescription, setProjectEditDescription] = useState('');
  const [files, setFiles] = useState([]);
  const [projectFolders, setProjectFolders] = useState([]);
  const [selectedFolderPath, setSelectedFolderPath] = useState(null);
  const [rootFileCount, setRootFileCount] = useState(0);
  const [filePage, setFilePage] = useState(1);
  const [filePageSize, setFilePageSize] = useState(8);
  const [filePagination, setFilePagination] = useState(defaultPagination(8));
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadFolderPath, setUploadFolderPath] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [notice, setNotice] = useState(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [apiExampleKey, setApiExampleKey] = useState('upload');

  const activeProject = projects.find((project) => project.id === selectedProjectId) || null;
  const activeApiExample = API_EXAMPLES.find((example) => example.key === apiExampleKey) || API_EXAMPLES[0];
  const totalProjectFiles = projects.reduce((sum, project) => sum + (project.fileCount || 0), 0);
  const activeFolderLabel = getFolderViewLabel(selectedFolderPath, projectFolders);
  const filesScopeDescription = selectedFolderPath === null ? 'del proyecto' : `en ${activeFolderLabel}`;
  const emptyFilesMessage = selectedFolderPath === null
    ? 'No hay archivos para mostrar en este proyecto.'
    : selectedFolderPath === ''
      ? 'No hay archivos en la raíz.'
      : `No hay archivos en ${activeFolderLabel}.`;
  const fileRangeStart = filePagination.total === 0
    ? 0
    : ((filePagination.page - 1) * filePagination.pageSize) + 1;
  const fileRangeEnd = Math.min(filePagination.total, filePagination.page * filePagination.pageSize);

  function showNotice(type, text) {
    setNotice({ type, text });
  }

  function syncEditor(project) {
    setProjectEditName(project?.name || '');
    setProjectEditDescription(project?.description || '');
  }

  function updateProjectInList(projectId, updater) {
    setProjects((current) => sortProjects(current.map((project) => (
      project.id === projectId ? updater(project) : project
    ))));
  }

  function adjustProjectFileCount(projectId, delta) {
    const now = new Date().toISOString();
    updateProjectInList(projectId, (project) => ({
      ...project,
      fileCount: Math.max(0, (project.fileCount || 0) + delta),
      updatedAt: now,
    }));
  }

  async function loadProjects(preferredProjectId) {
    setProjectsLoading(true);

    try {
      const data = await requestJson(`${API_URL}/api/projects`);
      const nextProjects = Array.isArray(data) ? sortProjects(data) : [];
      const currentSelectedProjectId = selectedProjectId;
      const nextSelectedId = (
        (preferredProjectId && nextProjects.some((project) => project.id === preferredProjectId) && preferredProjectId)
        || (currentSelectedProjectId && nextProjects.some((project) => project.id === currentSelectedProjectId) && currentSelectedProjectId)
        || nextProjects[0]?.id
        || ''
      );
      const selectionChanged = nextSelectedId !== currentSelectedProjectId;

      setProjects(nextProjects);
      setSelectedProjectId(nextSelectedId);

      if (nextSelectedId) {
        const nextProject = nextProjects.find((project) => project.id === nextSelectedId) || null;
        if (selectionChanged || !currentSelectedProjectId) {
          syncEditor(nextProject);
          setSelectedFolderPath(null);
          setUploadFolderPath('');
        }
      } else {
        syncEditor(null);
        setFiles([]);
        setProjectFolders([]);
        setSelectedFolderPath(null);
        setFilePagination(defaultPagination(filePageSize));
        setUploadFolderPath('');
        setRootFileCount(0);
      }

      if (selectionChanged || !nextSelectedId) {
        setFilePage(1);
      }

      return { nextSelectedId, selectionChanged };
    } catch (error) {
      showNotice('error', error.message);
      return { nextSelectedId: '', selectionChanged: false };
    } finally {
      setProjectsLoading(false);
    }
  }

  async function loadFiles(
    projectId = selectedProjectId,
    folderPath = selectedFolderPath,
    page = filePage,
    pageSize = filePageSize,
  ) {
    if (!projectId) {
      setFiles([]);
      setProjectFolders([]);
      setSelectedFolderPath(null);
      setUploadFolderPath('');
      setRootFileCount(0);
      setFilePagination(defaultPagination(pageSize));
      return null;
    }

    setFilesLoading(true);
    setFiles([]);

    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });

      if (folderPath !== null) {
        params.set('folderPath', folderPath);
      }

      const response = await requestJson(
        `${API_URL}/api/projects/${encodeURIComponent(projectId)}/files?${params.toString()}`,
      );

      const items = Array.isArray(response?.items) ? response.items : [];
      const folders = Array.isArray(response?.folders) ? response.folders : [];
      const resolvedPage = Number.isFinite(Number(response?.page)) ? Number(response.page) : page;
      const resolvedPageSize = Number.isFinite(Number(response?.pageSize)) ? Number(response.pageSize) : pageSize;
      const resolvedTotal = Number.isFinite(Number(response?.total)) ? Number(response.total) : items.length;
      const resolvedTotalPages = Number.isFinite(Number(response?.totalPages))
        ? Number(response.totalPages)
        : Math.max(1, Math.ceil(resolvedTotal / resolvedPageSize));
      const resolvedRootFileCount = Number.isFinite(Number(response?.rootFileCount))
        ? Number(response.rootFileCount)
        : 0;

      const nextPagination = {
        page: resolvedPage,
        pageSize: resolvedPageSize,
        total: resolvedTotal,
        totalPages: resolvedTotalPages,
        hasPreviousPage: Boolean(response?.hasPreviousPage ?? resolvedPage > 1),
        hasNextPage: Boolean(response?.hasNextPage ?? resolvedPage < resolvedTotalPages),
      };

      setFiles(items);
      setProjectFolders(folders);
      setRootFileCount(resolvedRootFileCount);
      setFilePagination(nextPagination);
      setUploadFolderPath((current) => (
        current && folders.some((folder) => folder.path === current) ? current : ''
      ));

      if (folderPath !== null && folderPath !== '' && !folders.some((folder) => folder.path === folderPath)) {
        setSelectedFolderPath(null);
        setUploadFolderPath('');
      }

      if (resolvedPage !== page) {
        setFilePage(resolvedPage);
      }

      return nextPagination;
    } catch (error) {
      setFiles([]);
      setFilePagination(defaultPagination(pageSize));
      showNotice('error', error.message);
      return null;
    } finally {
      setFilesLoading(false);
    }
  }

  async function createProject(event) {
    event.preventDefault();

    if (!projectName.trim()) {
      showNotice('error', 'Escribe un nombre para el proyecto');
      return;
    }

    setCreatingProject(true);

    try {
      const created = await requestJson(`${API_URL}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: projectName,
          description: projectDescription,
        }),
      });

      setProjects((current) => sortProjects([created, ...current.filter((project) => project.id !== created.id)]));
      setSelectedProjectId(created.id);
      syncEditor(created);
      setProjectName('');
      setProjectDescription('');
      setFilePage(1);
      setProjectFolders([]);
      setSelectedFolderPath(null);
      setUploadFolderPath('');
      setRootFileCount(0);
      await loadFiles(created.id, null, 1, filePageSize);
      showNotice('success', 'Proyecto creado');
    } catch (error) {
      showNotice('error', error.message);
    } finally {
      setCreatingProject(false);
    }
  }

  async function createFolder(event) {
    event.preventDefault();

    if (!selectedProjectId) {
      showNotice('error', 'Selecciona un proyecto');
      return;
    }

    if (!newFolderName.trim()) {
      showNotice('error', 'Escribe un nombre para la carpeta');
      return;
    }

    setCreatingFolder(true);

    try {
      const created = await requestJson(
        `${API_URL}/api/projects/${encodeURIComponent(selectedProjectId)}/folders`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newFolderName }),
        },
      );

      updateProjectInList(selectedProjectId, (project) => ({
        ...project,
        updatedAt: new Date().toISOString(),
      }));
      setNewFolderName('');
      setUploadFolderPath(created.path || '');
      await loadFiles(selectedProjectId, selectedFolderPath, filePage, filePageSize);
      showNotice('success', `Carpeta "${created.displayName || created.path}" creada`);
    } catch (error) {
      showNotice('error', error.message);
    } finally {
      setCreatingFolder(false);
    }
  }

  async function updateProject(event) {
    event.preventDefault();

    if (!activeProject) {
      return;
    }

    if (!projectEditName.trim()) {
      showNotice('error', 'El nombre del proyecto es obligatorio');
      return;
    }

    setSavingProject(true);

    try {
      const updated = await requestJson(`${API_URL}/api/projects/${encodeURIComponent(activeProject.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: projectEditName,
          description: projectEditDescription,
        }),
      });

      setProjects((current) => sortProjects(current.map((project) => (
        project.id === updated.id ? updated : project
      ))));
      syncEditor(updated);
      showNotice('success', 'Proyecto actualizado');
    } catch (error) {
      showNotice('error', error.message);
    } finally {
      setSavingProject(false);
    }
  }

  async function removeProject() {
    if (!activeProject) {
      return;
    }

    if (!window.confirm(`Eliminar "${activeProject.name}" y todos sus archivos?`)) {
      return;
    }

    setDeletingProject(true);

    try {
      await requestJson(`${API_URL}/api/projects/${encodeURIComponent(activeProject.id)}`, { method: 'DELETE' });
      showNotice('success', 'Proyecto eliminado');

      const { nextSelectedId } = await loadProjects();
      if (nextSelectedId) {
        await loadFiles(nextSelectedId, null, 1, filePageSize);
      } else {
        setFiles([]);
        setFilePagination(defaultPagination(filePageSize));
      }
    } catch (error) {
      showNotice('error', error.message);
    } finally {
      setDeletingProject(false);
    }
  }

  async function uploadFile(event) {
    event.preventDefault();

    if (!selectedProjectId) {
      showNotice('error', 'Selecciona un proyecto');
      return;
    }

    if (!selectedFile) {
      showNotice('error', 'Selecciona un archivo');
      return;
    }

    setUploadingFile(true);

    const formData = new FormData();
    formData.append('file', selectedFile);
    if (uploadFolderPath) {
      formData.append('folderPath', uploadFolderPath);
    }

    try {
      await requestJson(`${API_URL}/api/projects/${encodeURIComponent(selectedProjectId)}/files`, {
        method: 'POST',
        body: formData,
      });

      setSelectedFile(null);
      event.target.reset();
      setFilePage(1);
      adjustProjectFileCount(selectedProjectId, 1);
      await loadFiles(selectedProjectId, selectedFolderPath, 1, filePageSize);
      showNotice('success', 'Archivo subido al proyecto');
    } catch (error) {
      showNotice('error', error.message);
    } finally {
      setUploadingFile(false);
    }
  }

  async function openFile(file) {
    try {
      const url = file.url || (await requestJson(
        `${API_URL}/api/projects/${encodeURIComponent(file.projectId)}/files/${encodeURIComponent(file.name)}/sas`,
      )).url;
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      showNotice('error', error.message);
    }
  }

  async function downloadFile(file) {
    try {
      const data = file.downloadUrl ? { downloadUrl: file.downloadUrl } : await requestJson(
        `${API_URL}/api/projects/${encodeURIComponent(file.projectId)}/files/${encodeURIComponent(file.name)}/sas`,
      );
      const url = data.downloadUrl || data.url;

      if (!url) {
        throw new Error('No se pudo generar el enlace de descarga');
      }

      const link = document.createElement('a');
      link.href = url;
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      showNotice('error', error.message);
    }
  }

  async function removeFile(file) {
    if (!window.confirm('Eliminar este archivo?')) return;

    try {
      await requestJson(
        `${API_URL}/api/projects/${encodeURIComponent(file.projectId)}/files/${encodeURIComponent(file.name)}`,
        { method: 'DELETE' },
      );

      adjustProjectFileCount(file.projectId, -1);
      await loadFiles(file.projectId, selectedFolderPath, filePage, filePageSize);
      showNotice('success', 'Archivo eliminado');
    } catch (error) {
      showNotice('error', error.message);
    }
  }

  function handleSelectProject(project) {
    setSelectedProjectId(project.id);
    syncEditor(project);
    setSelectedFolderPath(null);
    setFilePage(1);
    setUploadFolderPath('');
    setProjectFolders([]);
    setRootFileCount(0);
    void loadFiles(project.id, null, 1, filePageSize);
  }

  function handleSelectFolder(folderPath) {
    if (!selectedProjectId) {
      return;
    }

    setSelectedFolderPath(folderPath);
    setUploadFolderPath(folderPath === null ? '' : folderPath);
    setFilePage(1);
    void loadFiles(selectedProjectId, folderPath, 1, filePageSize);
  }

  async function handleRefreshProjects() {
    const { nextSelectedId, selectionChanged } = await loadProjects(selectedProjectId);

    if (nextSelectedId) {
      await loadFiles(
        nextSelectedId,
        selectionChanged ? null : selectedFolderPath,
        selectionChanged ? 1 : filePage,
        filePageSize,
      );
    }
  }

  function handlePageBack() {
    if (!filePagination.hasPreviousPage || !selectedProjectId) return;
    const nextPage = Math.max(1, filePage - 1);
    setFilePage(nextPage);
    void loadFiles(selectedProjectId, selectedFolderPath, nextPage, filePageSize);
  }

  function handlePageNext() {
    if (!filePagination.hasNextPage || !selectedProjectId) return;
    const nextPage = Math.min(filePagination.totalPages, filePage + 1);
    setFilePage(nextPage);
    void loadFiles(selectedProjectId, selectedFolderPath, nextPage, filePageSize);
  }

  function handlePageSizeChange(event) {
    const nextPageSize = Number(event.target.value);
    setFilePageSize(nextPageSize);
    setFilePage(1);
    if (selectedProjectId) {
      void loadFiles(selectedProjectId, selectedFolderPath, 1, nextPageSize);
    }
  }

  useEffect(() => {
    let active = true;

    (async () => {
      const { nextSelectedId } = await loadProjects();
      if (!active) {
        return;
      }

      if (nextSelectedId) {
        await loadFiles(nextSelectedId, null, 1, filePageSize);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="page-shell">
      <header className="hero">
        <div className="hero-copy">
          <div className="brand-lockup">
            <img src={BRAND_ICON} alt="" aria-hidden="true" />
            <div>
              <p className="eyebrow">{APP_NAME}</p>
              <span>Organiza archivos y enlaces seguros</span>
            </div>
          </div>
          <h1>Proyectos, archivos y carga base64 publica</h1>
          <p>
            Crea proyectos, organiza archivos por espacio de trabajo, agrupa en subcarpetas de un
            nivel y expone una API simple para integraciones externas.
          </p>

          <div className="hero-note">
            <span>{projects.length} proyectos</span>
            <span>{totalProjectFiles} archivos totales</span>
            <span>{activeProject ? `Activo: ${activeProject.name}` : 'Sin proyecto seleccionado'}</span>
          </div>

          {session && (
            <div className="hero-session-bar">
              <div>
                <small>Sesion activa</small>
                <strong>{getSessionDisplayName(session)}</strong>
                <span>{getTenantDisplayName(session)}</span>
              </div>

              <button type="button" className="secondary" onClick={onSignOut}>
                Cerrar sesion
              </button>
            </div>
          )}
        </div>

        <div className="hero-stats">
          <div>
            <strong>{projects.length}</strong>
            <span>Proyectos</span>
          </div>
          <div>
            <strong>{totalProjectFiles}</strong>
            <span>Archivos</span>
          </div>
        </div>
      </header>

      {notice && (
        <p className={`notice notice-${notice.type}`}>
          {notice.text}
        </p>
      )}

      <div className="workspace">
        <aside className="sidebar">
          <section className="panel">
            <div className="section-head">
              <div>
                <p className="section-kicker">Catalogo</p>
                <h2>Proyectos</h2>
              </div>

              <button type="button" className="icon-button" onClick={handleRefreshProjects}>
                <RefreshCw size={16} />
              </button>
            </div>

            {projectsLoading && <p className="muted">Cargando proyectos...</p>}

            {!projectsLoading && projects.length > 0 && (
              <div className="project-list">
                {projects.map((project) => {
                  const isActive = project.id === selectedProjectId;

                  return (
                    <button
                      key={project.id}
                      type="button"
                      className={`project-card ${isActive ? 'active' : ''}`}
                      onClick={() => handleSelectProject(project)}
                    >
                      <div className="project-card-top">
                        <Folder size={16} />
                        <span>{project.id}</span>
                      </div>

                      <div className="project-card-title">
                        <strong>{project.name}</strong>
                        <span className="project-chip">{project.fileCount || 0} archivos</span>
                      </div>

                      <p>{project.description || 'Sin descripcion'}</p>
                    </button>
                  );
                })}
              </div>
            )}

            {!projectsLoading && !projects.length && (
              <div className="empty-state">
                <FolderPlus size={28} />
                <strong>No hay proyectos</strong>
                <p>Crea el primero para empezar a subir archivos.</p>
              </div>
            )}
          </section>

          <section className="panel tree-panel">
            <div className="section-head">
              <div>
                <p className="section-kicker">Estructura</p>
                <h2>{activeProject ? activeProject.name : 'Explorador del proyecto'}</h2>
              </div>
            </div>

            {activeProject ? (
              <>
                <p className="muted">Haz clic en una carpeta para ver solo sus archivos.</p>
                <div className="tree-view">
                  <button
                    type="button"
                    className={`tree-node tree-root ${selectedFolderPath === null ? 'selected' : ''}`}
                    onClick={() => handleSelectFolder(null)}
                  >
                    <ChevronDown size={14} />
                    <Folder size={16} />
                    <div className="tree-node-copy">
                      <strong>Todos los archivos</strong>
                      <span>{activeProject.fileCount || 0} archivos</span>
                    </div>
                  </button>

                  <div className="tree-branch">
                    <button
                      type="button"
                      className={`tree-node ${selectedFolderPath === '' ? 'selected' : ''}`}
                      onClick={() => handleSelectFolder('')}
                    >
                      <ChevronRight size={14} />
                      <Folder size={16} />
                      <div className="tree-node-copy">
                        <strong>Raíz</strong>
                        <span>{rootFileCount} archivos</span>
                      </div>
                    </button>

                    {projectFolders.map((folder) => {
                      const isActiveFolder = selectedFolderPath === folder.path;

                      return (
                        <button
                          key={folder.path}
                          type="button"
                          className={`tree-node ${isActiveFolder ? 'selected' : ''}`}
                          onClick={() => handleSelectFolder(folder.path)}
                        >
                          <ChevronRight size={14} />
                          <Folder size={16} />
                          <div className="tree-node-copy">
                            <strong>{folder.displayName}</strong>
                            <span>{folder.fileCount || 0} archivos</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-state">
                <Folder size={28} />
                <strong>Selecciona un proyecto</strong>
                <p>La estructura del proyecto aparecera aqui para explorar carpetas.</p>
              </div>
            )}
          </section>

          <form className="panel form-panel" onSubmit={createProject}>
            <div className="section-head">
              <div>
                <p className="section-kicker">Nuevo</p>
                <h2>Crear proyecto</h2>
              </div>
            </div>

            <label>
              Nombre
              <input
                type="text"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="Proyecto de facturacion"
              />
            </label>

            <label>
              Descripcion
              <textarea
                rows="4"
                value={projectDescription}
                onChange={(event) => setProjectDescription(event.target.value)}
                placeholder="Breve descripcion del objetivo del proyecto"
              />
            </label>

            <button type="submit" disabled={creatingProject}>
              <FolderPlus size={16} />
              {creatingProject ? 'Creando...' : 'Crear proyecto'}
            </button>
          </form>

          <section className="panel api-panel">
            <div className="section-head">
              <div>
                <p className="section-kicker">API publica</p>
                <h2>Ejemplos listos para integrar</h2>
              </div>
              <span className="pill">{API_EXAMPLES.length} ejemplos</span>
            </div>

            <p className="muted">
              Usa estos ejemplos como base para integrar la carga de archivos, la creacion de proyectos y
              la eliminacion de proyectos sin salir del panel.
            </p>

            <div className="api-switcher" role="tablist" aria-label="Ejemplos de API publica">
              {API_EXAMPLES.map((example) => {
                const ExampleIcon = example.icon;
                const isActive = example.key === apiExampleKey;

                return (
                  <button
                    key={example.key}
                    type="button"
                    className={`api-switcher-tab${isActive ? ' active' : ''}`}
                    onClick={() => setApiExampleKey(example.key)}
                    aria-pressed={isActive}
                  >
                    <span className={`api-method-chip ${example.method.toLowerCase()}`}>
                      {example.method}
                    </span>
                    <strong className="api-switcher-title">
                      <ExampleIcon size={16} />
                      <span>{example.title}</span>
                    </strong>
                    <small>{example.route}</small>
                  </button>
                );
              })}
            </div>

            <article className="api-example">
              <div className="api-example-head">
                <div className="api-example-copy">
                  <div className="api-example-meta">
                    <span className={`api-method-chip ${activeApiExample.method.toLowerCase()}`}>
                      {activeApiExample.method}
                    </span>
                    <span className="api-route-badge">{activeApiExample.route}</span>
                  </div>
                  <h3>{activeApiExample.title}</h3>
                  <p>{activeApiExample.description}</p>
                  <p className="api-example-note">{activeApiExample.note}</p>
                </div>
              </div>

              <pre>{activeApiExample.code}</pre>
            </article>
          </section>
        </aside>

        <section className="main-panel">
          <section className="panel active-project">
            <div className="active-project-head">
              <div>
                <p className="section-kicker">Proyecto activo</p>
                <h2>{activeProject ? activeProject.name : 'Selecciona un proyecto'}</h2>
                <p>
                  {activeProject
                    ? activeProject.description || 'Este proyecto no tiene descripcion'
                    : 'Elige un proyecto en el panel lateral o crea uno nuevo.'}
                </p>
              </div>

              {activeProject && (
                <div className="project-badge">
                  <span>ID</span>
                  <strong>{activeProject.id}</strong>
                  <small>{activeProject.fileCount || 0} archivos</small>
                </div>
              )}
            </div>

            {activeProject ? (
              <form className="project-editor" onSubmit={updateProject}>
                <div className="editor-grid">
                  <label>
                    Nombre del proyecto
                    <input
                      type="text"
                      value={projectEditName}
                      onChange={(event) => setProjectEditName(event.target.value)}
                      placeholder="Nombre visible del proyecto"
                    />
                  </label>

                  <label>
                    Descripcion
                    <textarea
                      rows="4"
                      value={projectEditDescription}
                      onChange={(event) => setProjectEditDescription(event.target.value)}
                      placeholder="Descripcion corta del proyecto"
                    />
                  </label>
                </div>

                <div className="project-actions">
                  <button type="submit" disabled={savingProject}>
                    <Save size={16} />
                    {savingProject ? 'Guardando...' : 'Guardar cambios'}
                  </button>
                  <button type="button" className="danger" onClick={removeProject} disabled={deletingProject}>
                    <Trash2 size={16} />
                    {deletingProject ? 'Eliminando...' : 'Eliminar proyecto'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="empty-state wide">
                <Pencil size={28} />
                <strong>Sin proyecto activo</strong>
                <p>Selecciona un proyecto para editar su nombre, descripcion y archivos.</p>
              </div>
            )}
          </section>

          <form className="panel upload-panel" onSubmit={uploadFile}>
            <div className="section-head">
              <div>
                <p className="section-kicker">Carga</p>
                <h2>Subir archivo al proyecto</h2>
              </div>

              <button
                type="button"
                className="icon-button"
                onClick={() => loadFiles(selectedProjectId, selectedFolderPath, filePage, filePageSize)}
                disabled={!selectedProjectId}
              >
                <RefreshCw size={16} />
              </button>
            </div>

            <div className="upload-row">
              <label className="file-input">
                <Upload size={18} />
                <span>{selectedFile ? selectedFile.name : 'Seleccionar archivo'}</span>
                <input
                  type="file"
                  onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                />
              </label>

              <label className="inline-select upload-folder-select">
                Carpeta destino
                <select
                  value={uploadFolderPath}
                  onChange={(event) => setUploadFolderPath(event.target.value)}
                  disabled={!selectedProjectId}
                >
                  <option value="">Raíz</option>
                  {projectFolders.map((folder) => (
                    <option key={folder.path} value={folder.path}>
                      {folder.displayName} ({folder.fileCount || 0})
                    </option>
                  ))}
                </select>
              </label>

              <button type="submit" disabled={!selectedProjectId || !selectedFile || uploadingFile}>
                <FileUp size={16} />
                {uploadingFile ? 'Subiendo...' : 'Subir archivo'}
              </button>
            </div>

            {!selectedProjectId && <p className="muted">Selecciona un proyecto para habilitar la carga.</p>}
          </form>

          <form className="panel folder-panel" onSubmit={createFolder}>
            <div className="section-head">
              <div>
                <p className="section-kicker">Carpetas</p>
                <h2>Crear subcarpeta</h2>
              </div>
            </div>

            <p className="muted">
              Crea una carpeta de un solo nivel para agrupar los archivos dentro del proyecto.
            </p>

            <div className="folder-row">
              <label>
                Nombre de la carpeta
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(event) => setNewFolderName(event.target.value)}
                  placeholder="facturas-2026"
                />
              </label>

              <button type="submit" disabled={!selectedProjectId || creatingFolder}>
                <FolderPlus size={16} />
                {creatingFolder ? 'Creando...' : 'Crear carpeta'}
              </button>
            </div>
          </form>

          <section className="panel files-panel">
            <div className="files-head">
              <div>
                <p className="section-kicker">Archivos</p>
                <h2>Contenido del proyecto</h2>
                <p className="muted">
                  {filePagination.total === 0
                    ? emptyFilesMessage
                    : `Mostrando ${fileRangeStart}-${fileRangeEnd} de ${filePagination.total} archivos ${filesScopeDescription}.`}
                </p>
              </div>

              <div className="files-head-actions">
                <label className="inline-select">
                  Tamano de pagina
                  <select value={filePageSize} onChange={handlePageSizeChange} disabled={!selectedProjectId}>
                    {PAGE_SIZE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>

                <span className="pill">{filePagination.total} archivos</span>
              </div>
            </div>

            <div className="pager">
              <button
                type="button"
                className="secondary"
                onClick={handlePageBack}
                disabled={!selectedProjectId || !filePagination.hasPreviousPage || filesLoading}
              >
                <ChevronLeft size={16} />
                Anterior
              </button>

              <span className="pager-info">
                Pagina {filePagination.page} de {filePagination.totalPages}
              </span>

              <button
                type="button"
                className="secondary"
                onClick={handlePageNext}
                disabled={!selectedProjectId || !filePagination.hasNextPage || filesLoading}
              >
                Siguiente
                <ChevronRight size={16} />
              </button>
            </div>

            {filesLoading && <p className="muted">Cargando archivos...</p>}

            {!filesLoading && files.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Archivo</th>
                      <th>Carpeta</th>
                      <th>Tipo</th>
                      <th>Tamano</th>
                      <th>Actualizado</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((file) => (
                      <tr key={file.name}>
                        <td>
                          <strong>{file.originalName}</strong>
                          <small>{file.name}</small>
                        </td>
                        <td>
                          <span className="folder-pill">
                            {formatFolderName(file.folderPath, file.folderName)}
                          </span>
                        </td>
                        <td>{file.contentType || '-'}</td>
                        <td>{formatBytes(file.size)}</td>
                        <td>{formatDate(file.lastModified)}</td>
                        <td>
                          <div className="actions">
                            <button type="button" onClick={() => openFile(file)}>
                              <ExternalLink size={16} />
                              Abrir
                            </button>
                            <button type="button" className="secondary" onClick={() => downloadFile(file)}>
                              <Download size={16} />
                              Descargar
                            </button>
                            <button type="button" className="danger" onClick={() => removeFile(file)}>
                              <Trash2 size={16} />
                              Eliminar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!filesLoading && !selectedProjectId && (
              <div className="empty-state wide">
                <FileUp size={28} />
                <strong>Selecciona un proyecto</strong>
                <p>El contenido del proyecto aparecera aqui con paginacion.</p>
              </div>
            )}

            {!filesLoading && selectedProjectId && !files.length && (
              <div className="empty-state wide">
                <FileUp size={28} />
                <strong>No hay archivos todavia</strong>
                <p>{emptyFilesMessage}</p>
              </div>
            )}
          </section>
        </section>
      </div>
    </main>
  );
}

function App() {
  const [pathname, setPathname] = useState(() => normalizePathname(window.location.pathname));
  const [authConfig, setAuthConfig] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [session, setSession] = useState(() => getStoredAuthSession());

  useEffect(() => {
    const syncPath = () => setPathname(normalizePathname(window.location.pathname));
    window.addEventListener('popstate', syncPath);
    return () => window.removeEventListener('popstate', syncPath);
  }, []);

  useEffect(() => {
    let active = true;

    async function loadConfig() {
      setAuthLoading(true);

      try {
        const config = await loadAuthConfig(API_URL);
        if (!active) {
          return;
        }

        setAuthConfig(config);
        setAuthError('');
      } catch (error) {
        if (!active) {
          return;
        }

        setAuthError(error.message || 'No se pudo cargar la configuracion de autenticacion.');
      } finally {
        if (active) {
          setAuthLoading(false);
        }
      }
    }

    loadConfig();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!AUTH_ROUTE_PATHS.has(pathname)) {
      navigateTo('/', { replace: true });
    }
  }, [pathname]);

  useEffect(() => {
    if (pathname === '/dashboard' && !session && !authLoading) {
      navigateTo('/login', { replace: true });
    }
  }, [pathname, session, authLoading]);

  useEffect(() => {
    if (pathname === '/') {
      document.title = `${APP_NAME} | Acceso`;
      return;
    }

    if (pathname === '/login') {
      document.title = `${APP_NAME} | Iniciar sesion`;
      return;
    }

    if (pathname === '/callback') {
      document.title = `${APP_NAME} | Validando acceso`;
      return;
    }

    if (pathname === '/dashboard') {
      document.title = `${APP_NAME} | Dashboard`;
    }
  }, [pathname]);

  function handleLogout() {
    clearAuthSession();
    setSession(null);
    navigateTo('/login', { replace: true });
  }

  function handleLogin(url) {
    if (!url) {
      return;
    }

    window.location.assign(url);
  }

  function handleRegister(url) {
    if (!url) {
      return;
    }

    window.location.assign(url);
  }

  const commonAuthProps = {
    authConfig,
    authLoading,
    authError,
    session,
    onGoHome: () => navigateTo('/', { replace: true }),
    onGoLogin: () => navigateTo('/login'),
    onGoDashboard: () => navigateTo('/dashboard'),
    onLogout: handleLogout,
  };

  if (pathname === '/callback') {
    return (
      <CallbackPage
        authConfig={authConfig}
        onSessionReady={setSession}
        onAbort={(path) => navigateTo(path, { replace: true })}
      />
    );
  }

  if (pathname === '/dashboard') {
    if (!session) {
      return (
        <AuthLoadingState
          title="Verificando tu sesion"
          message="Estamos preparando el acceso al dashboard."
        />
      );
    }

    return <DashboardPage session={session} onSignOut={handleLogout} />;
  }

  if (pathname === '/login') {
    return (
      <LoginPage
        {...commonAuthProps}
        onLogin={handleLogin}
        onRegister={handleRegister}
      />
    );
  }

  return <LandingPageV2 {...commonAuthProps} />;
}

createRoot(document.getElementById('root')).render(<App />);
