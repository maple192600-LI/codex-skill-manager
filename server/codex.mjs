import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const REQUEST_TIMEOUT_MS = 10_000;
const ownedChildren=new Set();
process.once('exit',()=>{for(const child of ownedChildren)if(!child.killed)child.kill();});

function configuredCodexPath() {
  const configured = process.env.SKILL_MANAGER_CODEX_PATH?.trim();
  if (configured) return configured;
  if (process.platform === 'win32') {
    const root = path.join(process.env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin');
    try {
      const candidates = fs.readdirSync(root).map(dir => path.join(root, dir, 'codex.exe')).filter(file => fs.existsSync(file));
      candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      if (candidates.length) return candidates[0];
    } catch { /* Fall back to PATH outside the desktop runtime. */ }
  }
  return "codex";
}

function parseJsonLines(text) {
  const result = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      result.push(JSON.parse(trimmed));
    } catch {
      // Codex may write diagnostic text beside JSONL events. Keep it out of the
      // data path; callers receive the raw stderr/stdout when a command fails.
    }
  }
  return result;
}

export function codexPath() {
  return configuredCodexPath();
}

export class CodexAppServer {
  constructor({ timeoutMs = REQUEST_TIMEOUT_MS, cwd = os.homedir(), env = process.env } = {}) {
    this.timeoutMs = timeoutMs;
    this.cwd = cwd;
    this.env = env;
    this.child = null;
    this.reader = null;
    this.nextId = 1;
    this.pending = new Map();
    this.startPromise = null;
    this.closed = false;
  }

  async start() {
    if (this.startPromise) return this.startPromise;
    if (this.child && !this.child.killed) return;
    this.closed = false;
    this.startPromise = (async () => {
      let resolveStart;
      let rejectStart;
      const initializeResponse = new Promise((resolve, reject) => {
        resolveStart = resolve;
        rejectStart = reject;
      });
      const child = spawn(codexPath(), ["app-server", "--stdio"], {
        cwd: this.cwd,
        env: this.env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });
      this.child = child;
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        if (stderr.length > 12_000) stderr = stderr.slice(-12_000);
      });
      child.once("error", (error) => {
        this.rejectAll(error);
        rejectStart(new Error(`无法启动 Codex App Server：${error.message}`));
      });
      child.once("exit", (code, signal) => {
        const suffix = signal ? ` (${signal})` : ` (退出码 ${code ?? "未知"})`;
        const error = new Error(`Codex App Server 已退出${suffix}${stderr ? `：${stderr.trim()}` : ""}`);
        this.rejectAll(error);
        rejectStart(error);
        if (!this.closed && this.child === child) this.child = null;
      });
      this.reader = readline.createInterface({ input: child.stdout });
      this.reader.on("line", (line) => this.handleLine(line));
      const initializeId = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(String(initializeId));
        rejectStart(new Error("Codex App Server 初始化超时"));
      }, this.timeoutMs);
      this.pending.set(String(initializeId), {
        resolve: (value) => {
          clearTimeout(timer);
          resolveStart(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          rejectStart(error);
        },
        timer
      });
      await this.write({
        jsonrpc: "2.0",
        id: initializeId,
        method: "initialize",
        params: {
          clientInfo: { name: "skill-manager", version: "0.1.0" },
          capabilities: {}
        }
      });
      await initializeResponse;
      await this.write({ jsonrpc: "2.0", method: "initialized", params: {} });
    })().catch(async error => { await this.close(); throw error; }).finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  handleLine(line) {
    const trimmed = String(line || "").trim();
    if (!trimmed) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (message.id === undefined || message.id === null) return;
    const pending = this.pending.get(String(message.id));
    if (!pending) return;
    this.pending.delete(String(message.id));
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(new Error(message.error.message || "Codex App Server 请求失败"));
    } else {
      pending.resolve(message.result);
    }
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  write(message) {
    return new Promise((resolve, reject) => {
      if (!this.child || this.child.killed || !this.child.stdin.writable) {
        reject(new Error("Codex App Server 尚未启动"));
        return;
      }
      this.child.stdin.write(`${JSON.stringify(message)}\n`, "utf8", (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async request(method, params = {}, { timeoutMs = this.timeoutMs } = {}) {
    await this.start();
    const id = this.nextId++;
    const key = String(id);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`Codex App Server 请求超时：${method}`));
      }, timeoutMs);
      this.pending.set(key, { resolve, reject, timer });
      this.write({ jsonrpc: "2.0", id, method, params }).catch((error) => {
        this.pending.delete(key);
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  async close() {
    this.closed = true;
    this.rejectAll(new Error("Codex App Server 客户端已关闭"));
    this.reader?.close();
    this.reader = null;
    if (this.child && !this.child.killed) {
      const child=this.child;
      await new Promise(resolve=>{
        const timer=setTimeout(resolve,2000);
        child.once('exit',()=>{clearTimeout(timer);resolve();});
        child.kill();
      });
    }
    this.child = null;
  }
}

export async function runCodexCli(args, { timeoutMs = REQUEST_TIMEOUT_MS, input = null, cwd = os.homedir(), env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(codexPath(), args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    ownedChildren.add(child);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Codex 命令超时：codex ${args.join(" ")}`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 40_000_000) stdout = stdout.slice(-40_000_000);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 12_000) stderr = stderr.slice(-12_000);
    });
    child.once("error", (error) => {
      ownedChildren.delete(child);
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      ownedChildren.delete(child);
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Codex 命令失败（退出码 ${code ?? "未知"}${signal ? `，信号 ${signal}` : ""}）：${stderr.trim() || stdout.trim()}`));
        return;
      }
      resolve({ stdout, stderr, events: parseJsonLines(stdout) });
    });
    if (input !== null) child.stdin.end(input);
    else child.stdin.end();
  });
}

export async function codexExecJson(prompt, { timeoutMs = 180_000 } = {}) {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "skill-manager-translate-"));
  const outputPath = path.join(tempRoot, "last-message.json");
  const schemaPath = path.join(tempRoot, "output-schema.json");
  const schema = {
    type: "object",
    required: ["items"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          required: ["identity", "nameZh", "summaryZh", "descriptionZh", "scenariosZh", "inputsZh", "outputsZh", "permissionsZh", "risksZh"],
          properties: {
            identity: { type: "string" },
            nameZh: { type: "string" },
            summaryZh: { type: "string" },
            descriptionZh: { type: "string" },
            scenariosZh: { type: "array", items: { type: "string" } },
            inputsZh: { type: "array", items: { type: "string" } },
            outputsZh: { type: "array", items: { type: "string" } },
            permissionsZh: { type: "array", items: { type: "string" } },
            risksZh: { type: "array", items: { type: "string" } }
          },
          additionalProperties: false
        }
      }
    },
    additionalProperties: false
  };
  await fsp.writeFile(schemaPath, JSON.stringify(schema), "utf8");
  try {
    const result = await runCodexCli([
      "exec",
      "--ephemeral",
      '-c',
      'model_reasoning_effort="low"',
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--json",
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath,
      '-'
    ], { timeoutMs, input: prompt, cwd: tempRoot });
    const lastMessage = await fsp.readFile(outputPath, "utf8").catch(() => "");
    let parsed;
    try {
      parsed = JSON.parse(lastMessage);
    } catch {
      const candidates = result.events
        .flatMap((event) => [event?.text, event?.message?.content, event?.item?.text, event?.item?.content])
        .flatMap((value) => Array.isArray(value) ? value.map((part) => part?.text) : [value])
        .filter((value) => typeof value === "string");
      for (const candidate of candidates.reverse()) {
        try {
          parsed = JSON.parse(candidate);
          break;
        } catch {
          // Try the next final-message candidate.
        }
      }
    }
    if (!parsed || !Array.isArray(parsed.items)) {
      throw new Error("Codex 翻译结果不是约定的 JSON 格式");
    }
    return parsed;
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

export async function appServerRequest(method, params = {}, options = {}) {
  const client = new CodexAppServer(options);
  try {
    return await client.request(method, params, options);
  } finally {
    await client.close();
  }
}

export async function codexJson(args, options = {}) {
  const { stdout } = await runCodexCli(args, options);
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Codex 返回了无法解析的数据：${error.message}`);
  }
}
