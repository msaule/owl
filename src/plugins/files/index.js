import fs from 'node:fs';
import path from 'node:path';
import { createId } from '../../utils/id.js';
import { looksLikeTextFile, truncate } from '../../utils/text.js';

let pluginConfig = {
  paths: [],
  maxSnippetLength: 500
};

function shouldIgnore(filePath) {
  const normalized = filePath.toLowerCase();
  return (
    normalized.includes('\\node_modules\\') ||
    normalized.includes('\\.git\\') ||
    normalized.endsWith('.tmp') ||
    normalized.endsWith('.crdownload')
  );
}

/**
 * Extract title/metadata from PDF files by reading the raw binary header.
 * Looks for /Title in the PDF info dictionary — works for most modern PDFs.
 */
function extractPdfMetadata(filePath) {
  try {
    // Read only the first 8KB — metadata is usually near the start
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(8192);
    fs.readSync(fd, buffer, 0, 8192, 0);
    fs.closeSync(fd);
    const text = buffer.toString('latin1');

    const meta = {};
    const titleMatch = text.match(/\/Title\s*\(([^)]{1,200})\)/);
    if (titleMatch) {
      meta.title = titleMatch[1].replace(/\\[()\\]/g, (m) => m[1]);
    }
    const authorMatch = text.match(/\/Author\s*\(([^)]{1,200})\)/);
    if (authorMatch) {
      meta.author = authorMatch[1].replace(/\\[()\\]/g, (m) => m[1]);
    }
    const subjectMatch = text.match(/\/Subject\s*\(([^)]{1,200})\)/);
    if (subjectMatch) {
      meta.subject = subjectMatch[1].replace(/\\[()\\]/g, (m) => m[1]);
    }
    return Object.keys(meta).length ? meta : null;
  } catch {
    return null;
  }
}

/**
 * Extract title/metadata from DOCX files.
 * DOCX is a ZIP archive; the core properties are in docProps/core.xml.
 * We do lightweight scanning of the raw bytes to find the XML without
 * a full ZIP library.
 */
function extractDocxMetadata(filePath) {
  try {
    const raw = fs.readFileSync(filePath);
    const text = raw.toString('utf8', 0, Math.min(raw.length, 32768));

    const meta = {};
    const titleMatch = text.match(/<dc:title>([^<]{1,300})<\/dc:title>/);
    if (titleMatch) {
      meta.title = titleMatch[1].trim();
    }
    const creatorMatch = text.match(/<dc:creator>([^<]{1,200})<\/dc:creator>/);
    if (creatorMatch) {
      meta.author = creatorMatch[1].trim();
    }
    const subjectMatch = text.match(/<dc:subject>([^<]{1,200})<\/dc:subject>/);
    if (subjectMatch) {
      meta.subject = subjectMatch[1].trim();
    }
    const descMatch = text.match(/<dc:description>([^<]{1,400})<\/dc:description>/);
    if (descMatch) {
      meta.description = descMatch[1].trim();
    }
    return Object.keys(meta).length ? meta : null;
  } catch {
    return null;
  }
}

function summarizeFile(filePath) {
  let stats;
  try {
    stats = fs.statSync(filePath);
  } catch {
    return null;
  }

  if (!stats.isFile() || shouldIgnore(filePath)) {
    return null;
  }

  const extension = path.extname(filePath).toLowerCase();
  const summary = {
    filePath,
    filename: path.basename(filePath),
    extension,
    size: stats.size
  };

  if (looksLikeTextFile(filePath)) {
    try {
      summary.snippet = truncate(fs.readFileSync(filePath, 'utf8'), pluginConfig.maxSnippetLength || 500);
    } catch {
      summary.snippet = '';
    }
  } else if (extension === '.pdf') {
    const meta = extractPdfMetadata(filePath);
    if (meta) {
      summary.metadata = meta;
      if (meta.title) {
        summary.title = meta.title;
      }
    }
  } else if (extension === '.docx') {
    const meta = extractDocxMetadata(filePath);
    if (meta) {
      summary.metadata = meta;
      if (meta.title) {
        summary.title = meta.title;
      }
    }
  }

  return summary;
}

function createAsyncQueue() {
  const values = [];
  const waiters = [];

  return {
    push(value) {
      if (waiters.length) {
        waiters.shift()(value);
      } else {
        values.push(value);
      }
    },
    next() {
      if (values.length) {
        return Promise.resolve(values.shift());
      }
      return new Promise((resolve) => waiters.push(resolve));
    }
  };
}

export default {
  name: 'files',
  description: 'Watches configured local directories for created and modified files.',

  async setup(config = {}) {
    pluginConfig = { ...pluginConfig, ...config };
  },

  async *watch() {
    const queue = createAsyncQueue();
    const watchers = [];

    for (const watchPath of pluginConfig.paths || []) {
      if (!fs.existsSync(watchPath)) {
        continue;
      }

      const watcher = fs.watch(
        watchPath,
        { recursive: true },
        (eventType, relativePath) => {
          if (!relativePath) {
            return;
          }

          const fullPath = path.join(watchPath, relativePath);
          const file = summarizeFile(fullPath);
          if (!file) {
            return;
          }

          const action = eventType === 'rename' ? 'New file' : 'Updated file';
          const label = file.title ? `${file.filename} — "${file.title}"` : file.filename;
          const importance = (file.extension === '.pdf' || file.extension === '.docx')
            ? 0.6
            : file.extension === '.md' ? 0.65 : 0.4;

          queue.push({
            id: createId('event'),
            source: 'files',
            type: eventType === 'rename' ? 'file.created' : 'file.modified',
            timestamp: new Date().toISOString(),
            summary: `${action}: ${label}`,
            data: file,
            importance
          });
        }
      );

      watchers.push(watcher);
    }

    try {
      while (true) {
        yield await queue.next();
      }
    } finally {
      for (const watcher of watchers) {
        watcher.close();
      }
    }
  },

  async query(question) {
    return { plugin: 'files', question };
  }
};
