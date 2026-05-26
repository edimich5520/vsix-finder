#!/usr/bin/env node
'use strict';

const http = require('http');
const { URL } = require('url');
const fs = require('fs/promises');
const path = require('path');

const PORT = Number(process.env.PORT || 3434);
const MAX_RESULTS = 20;
const PUBLIC_DIR = __dirname;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*'
  });
  res.end(body);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' });
  res.end(text);
}

async function sendFile(res, filePath, contentType) {
  const body = await fs.readFile(filePath);
  res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' });
  res.end(body);
}

function safeFilePart(value) {
  return String(value || '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'extension';
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'accept': 'application/json',
      'user-agent': 'vsix-finder/1.0',
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${response.status} ${response.statusText}${text ? `: ${text.slice(0, 180)}` : ''}`);
  }

  return response.json();
}

async function searchVSCodeMarketplace(query) {
  const url = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery?api-version=7.2-preview.1';
  const body = {
    filters: [{
      criteria: [
        { filterType: 10, value: query },
        { filterType: 8, value: 'Microsoft.VisualStudio.Code' }
      ],
      pageNumber: 1,
      pageSize: MAX_RESULTS,
      sortBy: 0,
      sortOrder: 0
    }],
    assetTypes: [],
    flags: 914
  };

  const data = await fetchJson(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json;api-version=7.2-preview.1'
    },
    body: JSON.stringify(body)
  });

  const extensions = data?.results?.[0]?.extensions || [];

  return extensions.map((item) => {
    const latest = item.versions?.[0] || {};
    const publisher = item.publisher?.publisherName || item.publisher?.displayName || '';
    const name = item.extensionName || '';
    const id = `${publisher}.${name}`;
    const displayName = item.displayName || id;
    const version = latest.version || '';
    const installCount = item.statistics?.find((s) => s.statisticName === 'install')?.value;

    return {
      source: 'VS Code Marketplace',
      publisher,
      name,
      id,
      displayName,
      description: item.shortDescription || '',
      version,
      lastUpdated: latest.lastUpdated || item.lastUpdated || '',
      installCount,
      pageUrl: `https://marketplace.visualstudio.com/items?itemName=${encodeURIComponent(id)}`,
      downloadUrl: `/api/download?source=vscode&publisher=${encodeURIComponent(publisher)}&name=${encodeURIComponent(name)}&version=${encodeURIComponent(version)}`
    };
  });
}

async function searchOpenVSX(query) {
  const url = `https://open-vsx.org/api/-/search?query=${encodeURIComponent(query)}&size=${MAX_RESULTS}`;
  const data = await fetchJson(url);
  const extensions = data.extensions || [];

  return extensions.map((item) => {
    const namespace = item.namespace || '';
    const name = item.name || '';
    const version = item.version || item.latestVersion || '';
    const id = `${namespace}.${name}`;

    return {
      source: 'Open VSX',
      publisher: namespace,
      name,
      id,
      displayName: item.displayName || id,
      description: item.description || '',
      version,
      lastUpdated: item.timestamp || item.lastUpdated || '',
      installCount: item.downloadCount,
      pageUrl: `https://open-vsx.org/extension/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
      downloadUrl: `/api/download?source=openvsx&publisher=${encodeURIComponent(namespace)}&name=${encodeURIComponent(name)}&version=${encodeURIComponent(version)}`
    };
  });
}

async function downloadVSCode(res, publisher, name, version) {
  const encodedPublisher = encodeURIComponent(publisher);
  const encodedName = encodeURIComponent(name);
  const encodedVersion = encodeURIComponent(version || 'latest');

  const url = version
    ? `https://marketplace.visualstudio.com/_apis/public/gallery/publishers/${encodedPublisher}/vsextensions/${encodedName}/${encodedVersion}/vspackage`
    : `https://${encodedPublisher}.gallery.vsassets.io/_apis/public/gallery/publisher/${encodedPublisher}/extension/${encodedName}/latest/assetbyname/Microsoft.VisualStudio.Services.VSIXPackage`;

  await proxyVsix(res, url, `${safeFilePart(publisher)}.${safeFilePart(name)}-${safeFilePart(version || 'latest')}.vsix`);
}

async function getOpenVSXDownloadUrl(publisher, name, version) {
  const base = `https://open-vsx.org/api/${encodeURIComponent(publisher)}/${encodeURIComponent(name)}`;
  const detailUrl = version ? `${base}/${encodeURIComponent(version)}` : base;
  const data = await fetchJson(detailUrl);

  if (data?.files?.download) return data.files.download;
  if (data?.versions?.[0]?.files?.download) return data.versions[0].files.download;

  const v = data.version || version;
  if (!v) throw new Error('Open VSX did not return a downloadable version.');

  return `https://open-vsx.org/api/${encodeURIComponent(publisher)}/${encodeURIComponent(name)}/${encodeURIComponent(v)}/file/${encodeURIComponent(publisher)}.${encodeURIComponent(name)}-${encodeURIComponent(v)}.vsix`;
}

async function downloadOpenVSX(res, publisher, name, version) {
  const url = await getOpenVSXDownloadUrl(publisher, name, version);
  await proxyVsix(res, url, `${safeFilePart(publisher)}.${safeFilePart(name)}-${safeFilePart(version || 'latest')}.vsix`);
}

async function proxyVsix(res, upstreamUrl, filename) {
  const upstream = await fetch(upstreamUrl, {
    redirect: 'follow',
    headers: { 'user-agent': 'vsix-finder/1.0' }
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    throw new Error(`Download failed: ${upstream.status} ${upstream.statusText}${text ? `: ${text.slice(0, 180)}` : ''}`);
  }

  res.writeHead(200, {
    'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
    'content-disposition': `attachment; filename="${filename}"`,
    'cache-control': 'no-store'
  });

  const reader = upstream.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}

async function handle(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html') {
    return sendFile(res, path.join(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8');
  }

  if (requestUrl.pathname === '/api/search') {
    const q = (requestUrl.searchParams.get('q') || '').trim();
    const sources = new Set((requestUrl.searchParams.get('sources') || 'vscode,openvsx').split(',').map(s => s.trim()));

    if (!q) return sendJson(res, 400, { error: 'Missing search query.' });

    const jobs = [];

    if (sources.has('vscode')) {
      jobs.push(
        searchVSCodeMarketplace(q)
          .then(results => ({ source: 'VS Code Marketplace', results }))
          .catch(error => ({ source: 'VS Code Marketplace', error: error.message, results: [] }))
      );
    }

    if (sources.has('openvsx')) {
      jobs.push(
        searchOpenVSX(q)
          .then(results => ({ source: 'Open VSX', results }))
          .catch(error => ({ source: 'Open VSX', error: error.message, results: [] }))
      );
    }

    const settled = await Promise.all(jobs);
    const results = settled.flatMap(x => x.results);
    const errors = settled.filter(x => x.error).map(({ source, error }) => ({ source, error }));

    return sendJson(res, 200, { query: q, results, errors });
  }

  if (requestUrl.pathname === '/api/download') {
    const source = requestUrl.searchParams.get('source');
    const publisher = requestUrl.searchParams.get('publisher');
    const name = requestUrl.searchParams.get('name');
    const version = requestUrl.searchParams.get('version') || '';

    if (!source || !publisher || !name) {
      return sendJson(res, 400, { error: 'Missing source, publisher, or name.' });
    }

    if (source === 'vscode') return downloadVSCode(res, publisher, name, version);
    if (source === 'openvsx') return downloadOpenVSX(res, publisher, name, version);

    return sendJson(res, 400, { error: 'Unsupported source.' });
  }

  return sendJson(res, 404, { error: 'Not found.' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    if (!res.headersSent) sendJson(res, 500, { error: error.message });
    else res.end();
  });
});

server.listen(PORT, () => {
  console.log(`VSIX Finder running at http://localhost:${PORT}`);
});
