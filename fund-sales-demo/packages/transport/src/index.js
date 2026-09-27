import fs from 'node:fs/promises';
import path from 'node:path';
import SftpClient from 'ssh2-sftp-client';

const normalize = (value) => value.replaceAll('\\', '/').replace(/\/+$/, '');

export class ExchangeTransport {
  constructor(options = {}) {
    this.mode = options.mode || process.env.TRANSPORT_MODE || 'local';
    this.localRoot = options.localRoot || process.env.EXCHANGE_ROOT || path.resolve('exchange');
    this.sftp = {
      host: process.env.SFTP_HOST || 'sftp', port: Number(process.env.SFTP_PORT || 22),
      username: process.env.SFTP_USER || 'exchange', password: process.env.SFTP_PASSWORD || 'exchange'
    };
    this.remoteRoot = normalize(process.env.SFTP_ROOT || '/upload');
  }

  async #withSftp(action) {
    const client = new SftpClient();
    await client.connect(this.sftp);
    try { return await action(client); } finally { await client.end(); }
  }

  batchPath(direction, scenarioId, date, batchId) {
    return `${direction}/${scenarioId}/${date}/${batchId}`;
  }

  async putBatch(direction, scenarioId, date, batchId, files) {
    const relative = this.batchPath(direction, scenarioId, date, batchId);
    if (this.mode === 'local') {
      const dir = path.join(this.localRoot, relative);
      await fs.mkdir(dir, { recursive: true });
      for (const [name, content] of Object.entries(files)) await fs.writeFile(path.join(dir, name), content);
      return relative;
    }
    return this.#withSftp(async (client) => {
      const dir = `${this.remoteRoot}/${relative}`;
      await client.mkdir(dir, true);
      for (const [name, content] of Object.entries(files)) await client.put(content, `${dir}/${name}`);
      return relative;
    });
  }

  async listBatches(direction, scenarioId) {
    if (this.mode === 'local') {
      const root = path.join(this.localRoot, direction, scenarioId);
      try {
        const dates = await fs.readdir(root, { withFileTypes: true });
        const out = [];
        for (const date of dates.filter((v) => v.isDirectory())) {
          const batches = await fs.readdir(path.join(root, date.name), { withFileTypes: true });
          for (const batch of batches.filter((v) => v.isDirectory())) {
            out.push({ date: date.name, batchId: batch.name, relative: `${direction}/${scenarioId}/${date.name}/${batch.name}` });
          }
        }
        return out.sort((a, b) => a.relative.localeCompare(b.relative));
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
    }
    return this.#withSftp(async (client) => {
      const root = `${this.remoteRoot}/${direction}/${scenarioId}`;
      if (!await client.exists(root)) return [];
      const out = [];
      for (const date of (await client.list(root)).filter((v) => v.type === 'd')) {
        for (const batch of (await client.list(`${root}/${date.name}`)).filter((v) => v.type === 'd')) {
          out.push({ date: date.name, batchId: batch.name, relative: `${direction}/${scenarioId}/${date.name}/${batch.name}` });
        }
      }
      return out.sort((a, b) => a.relative.localeCompare(b.relative));
    });
  }

  async readBatch(relative) {
    if (this.mode === 'local') {
      const dir = path.join(this.localRoot, relative);
      const names = await fs.readdir(dir);
      return Object.fromEntries(await Promise.all(names.map(async (name) => [name, await fs.readFile(path.join(dir, name))])));
    }
    return this.#withSftp(async (client) => {
      const dir = `${this.remoteRoot}/${relative}`;
      const entries = (await client.list(dir)).filter((v) => v.type === '-');
      return Object.fromEntries(await Promise.all(entries.map(async ({ name }) => [name, await client.get(`${dir}/${name}`)])));
    });
  }
}
