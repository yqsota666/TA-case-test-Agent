import fs from 'node:fs/promises';
import path from 'node:path';

const cleanPart = value => String(value || '').replace(/^\/+|\/+$/g, '');
const normalizeKey = (...parts) => parts.map(cleanPart).filter(Boolean).join('/');

export class ArtifactStorage {
  constructor(options = {}) {
    this.mode = options.mode || process.env.STORAGE_MODE || 'local';
    this.localRoot = options.localRoot || process.env.ARTIFACT_ROOT || path.resolve('artifacts');
    this.prefix = cleanPart(options.prefix ?? process.env.OSS_PREFIX ?? 'fund-data-factory');
    this.ossOptions = options.oss || {
      region: process.env.OSS_REGION,
      endpoint: process.env.OSS_ENDPOINT,
      bucket: process.env.OSS_BUCKET,
      accessKeyId: process.env.OSS_ACCESS_KEY_ID,
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
      stsToken: process.env.OSS_STS_TOKEN
    };
    this.client = null;
  }

  status() {
    const configured = this.mode === 'local' || Boolean(
      this.ossOptions.bucket && this.ossOptions.accessKeyId && this.ossOptions.accessKeySecret &&
      (this.ossOptions.region || this.ossOptions.endpoint)
    );
    return {
      mode: this.mode,
      configured,
      bucket: this.mode === 'oss' ? this.ossOptions.bucket || null : null,
      prefix: this.prefix
    };
  }

  async #ossClient() {
    if (this.client) return this.client;
    if (!this.status().configured) throw new Error('OSS 未配置完整：需要 bucket、region/endpoint 和访问凭证');
    const { default: OSS } = await import('ali-oss');
    this.client = new OSS(Object.fromEntries(Object.entries(this.ossOptions).filter(([, value]) => value)));
    return this.client;
  }

  objectKey(relative, fileName) {
    return normalizeKey(this.prefix, relative, fileName);
  }

  async putBatch(relative, files) {
    const objects = [];
    if (this.mode === 'local') {
      const dir = path.join(this.localRoot, relative);
      await fs.mkdir(dir, { recursive: true });
      for (const [fileName, content] of Object.entries(files)) {
        await fs.writeFile(path.join(dir, fileName), content);
        objects.push({ fileName, key: this.objectKey(relative, fileName) });
      }
      return { mode: this.mode, relative, objects };
    }
    if (this.mode !== 'oss') throw new Error(`不支持的存储模式：${this.mode}`);
    const client = await this.#ossClient();
    for (const [fileName, content] of Object.entries(files)) {
      const key = this.objectKey(relative, fileName);
      await client.put(key, content, { headers: { 'Content-Type': 'text/plain; charset=GB18030' } });
      objects.push({ fileName, key });
    }
    return { mode: this.mode, relative, objects };
  }

  async signedUrl(relative, fileName, expires = 900) {
    if (this.mode !== 'oss') return null;
    const client = await this.#ossClient();
    return client.signatureUrl(this.objectKey(relative, fileName), { expires });
  }
}

export { normalizeKey };
