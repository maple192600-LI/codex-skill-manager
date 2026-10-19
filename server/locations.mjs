import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import { normalize, within } from './state.mjs';

const failure = error => error.code === 'ENOENT' || error.code === 'ENOTDIR' ? '目标不存在' : error.code === 'EACCES' || error.code === 'EPERM' ? '无权读取' : error.code === 'ELOOP' ? '链接循环' : '解析失败';
const linkTypes=new Map();
function linkSignature(file) {const s=fs.lstatSync(file);return `${s.ino}:${s.ctimeMs}`;}
function windowsLinkType(file) {
  const signature=linkSignature(file),cached=linkTypes.get(file);
  if(cached?.signature===signature)return cached.type;
  const result=spawnSync('fsutil.exe',['reparsepoint','query',file],{encoding:'utf8',windowsHide:true,timeout:1500});
  const text=result.stdout||'';
  const type=/0xa0000003/i.test(text)?'目录联接':/0xa000000c/i.test(text)?'软链接':'链接类型未确认';
  linkTypes.set(file,{signature,type});return type;
}
function primeLinkTypes(roots) {
  if(process.platform!=='win32')return;
  const files=[];
  for(const root of roots) {try {for(const e of fs.readdirSync(root.path,{withFileTypes:true})) if(e.isSymbolicLink()) {
    const file=path.join(root.path,e.name);if(linkTypes.get(file)?.signature!==linkSignature(file))files.push(file);
  }}catch{/* Unreadable roots stay visible through discovery diagnostics. */}}
  if(!files.length)return;
  const script='$files = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:SKILL_MANAGER_LINK_PATHS)) | ConvertFrom-Json; $rows = foreach ($p in $files) { try { $i = Get-Item -LiteralPath $p -Force -ErrorAction Stop; @{path=$p;type=$i.LinkType} } catch {} }; ConvertTo-Json -InputObject @($rows) -Compress';
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{env:{...process.env,SKILL_MANAGER_LINK_PATHS:Buffer.from(JSON.stringify(files)).toString('base64')},encoding:'utf8',windowsHide:true,timeout:3000});
  try {for(const row of JSON.parse(result.stdout))linkTypes.set(row.path,{signature:linkSignature(row.path),type:row.type==='Junction'?'目录联接':row.type==='SymbolicLink'?'软链接':'链接类型未确认'});}catch{/* Individual queries provide a bounded fallback. */}
}
export function inspectPath(input, label = '加载入口', io = fs) {
  const entry = { label, path: input, type: '尚未确认', status: '尚未确认', realPath: null, links: [], checkedAt: new Date().toISOString() };
  if (!input || !path.isAbsolute(input)) return entry;
  let current = path.resolve(input);
  const seen = new Set();
  try {
    for (let hops = 0; hops < 32; hops++) {
      const key = normalize(current);
      if (seen.has(key)) { entry.status = '链接循环'; return entry; }
      seen.add(key);
      const root = path.parse(current).root;
      const parts = current.slice(root.length).split(path.sep).filter(Boolean);
      let cursor = root;
      let changed = false;
      for (let i = 0; i < parts.length; i++) {
        cursor = path.join(cursor, parts[i]);
        const stat = io.lstatSync(cursor);
        if (!stat.isSymbolicLink()) continue;
        const raw = io.readlinkSync(cursor);
        const target = path.resolve(path.dirname(cursor), raw.replace(/^\\\\\?\\/, ''));
        entry.links.push({ path: cursor, target, type: process.platform==='win32'&&io===fs?windowsLinkType(cursor):'软链接' });
        entry.type = entry.links[0].type;
        current = path.join(target, ...parts.slice(i + 1));
        entry.declaredTarget = current;
        changed = true;
        break;
      }
      if (changed) continue;
      const stat = io.statSync(current);
      entry.realPath = io.realpathSync.native ? io.realpathSync.native(current) : io.realpathSync(current);
      entry.type = entry.links.length ? entry.links[0].type : '本地目录';
      entry.status = '正常';
      entry.directory = stat.isDirectory() ? input : path.dirname(input);
      entry.realDirectory = stat.isDirectory() ? entry.realPath : path.dirname(entry.realPath);
      entry.fingerprint = crypto.createHash('sha256').update(JSON.stringify([entry.path, entry.realPath, entry.links, String(stat.dev), String(stat.ino)])).digest('hex');
      return entry;
    }
    entry.status = '链接层数过多';
  } catch (error) { entry.status = failure(error); }
  return entry;
}

// Bounded discovery retains directory aliases before canonicalizing SKILL.md.
export function discoverSkills(roots) {
  primeLinkTypes(roots);
  const found = [];
  for (const root of roots) {
    const stack = [{ dir: root.path, depth: 0, parents: new Set() }];
    let visited = 0;
    while (stack.length && visited++ < 1500) {
      const { dir, depth, parents } = stack.pop();
      let real;
      try { real = normalize(fs.realpathSync(dir)); } catch {
        if (depth > 0) { const location = inspectPath(dir); if (location.links.length) found.push({ ...root, file: path.join(dir, 'SKILL.md'), location }); }
        continue;
      }
      if (parents.has(real) || depth > 8) continue;
      const nextParents = new Set([...parents, real]);
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      if (entries.some(e => e.name === 'SKILL.md')) {
        const file = path.join(dir, 'SKILL.md');
        found.push({ ...root, file, location: inspectPath(file) });
        continue;
      }
      for (const entry of entries) {
        if (['node_modules', '.git', 'dist', 'build', '.venv'].includes(entry.name)) continue;
        if (entry.isDirectory() || entry.isSymbolicLink()) stack.push({ dir: path.join(dir, entry.name), depth: depth + 1, parents: nextParents });
      }
    }
  }
  return found;
}

export function safeUrl(value) {
  try { const url = new URL(value); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href; }
  catch { return '连接地址尚未确认'; }
}
export function resolveProgram(command, env = process.env) {
  if (!command) return null;
  if (path.isAbsolute(command)) return command;
  if (command.includes('/') || command.includes('\\')) return null;
  for (const dir of (env.PATH || env.Path || '').split(path.delimiter)) {
    for (const ext of process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : ['']) {
      const file = path.join(dir, command + ext);
      if (fs.existsSync(file)) return file;
    }
  }
  return null;
}
export function mcpLocations(config, configFile, effectiveCwd) {
  const locations = configFile ? [inspectPath(configFile, '配置来源')] : [];
  if (config.url) {
    const url = safeUrl(config.url);
    let local = false;
    try { local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname); } catch { /* unknown */ }
    locations.push({ label: '连接地址', path: url, type: '网络服务', status: local ? '本机地址，部署目录未确认' : '外部地址，部署目录未确认', links: [] });
  } else {
    const command = config.command || '';
    const program = resolveProgram(command);
    if (program) locations.push(inspectPath(program, '启动程序'));
    const cwd = config.cwd && path.isAbsolute(config.cwd) ? config.cwd : effectiveCwd;
    if (cwd) locations.push(inspectPath(cwd, '工作目录'));
    const base = path.basename(command).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
    if(['npx','uvx'].includes(base)) {
      const packageName=(config.args||[]).find(arg=>!arg.startsWith('-')&&/^[A-Za-z@][\w@/.+-]{0,160}$/.test(arg));
      locations.push({label:'启动方式',path:`${base}${packageName?' '+packageName:''}（按需启动，实际包缓存尚未确认）`,type:'尚未确认',status:'尚未确认',links:[]});
    }
    if (['node', 'python', 'python3', 'deno', 'bun'].includes(base)) {
      const script = (config.args || []).find(arg => !arg.startsWith('-') && /\.(mjs|cjs|js|py|ts)$/.test(arg));
      if (script && (path.isAbsolute(script) || cwd)) locations.push(inspectPath(path.resolve(cwd || '.', script), '服务代码'));
    }
    if (!locations.some(l => l.label === '服务代码')) locations.push({ label: '服务包位置', path: '尚未确认；仅凭启动程序不能确定服务安装位置', type: '尚未确认', status: '尚未确认', links: [] });
  }
  return locations;
}
export function locationSummary(locations) {
  if(locations.some(x=>x.type==='内置'))return '内置';
  if (locations.some(x => x.links?.length)) return locations.find(x => x.links?.length).type;
  if (locations.some(x => x.type === '网络服务')) return '网络服务';
  if (locations.some(x => x.label === '已安装版本目录')) return '插件缓存';
  return locations.some(x => x.status === '正常') ? '本地目录' : '尚未确认';
}
export function removableEntry(item, location, roots) {
  if (item.kind !== 'skill' || item.parentPlugin || item.scope === 'system' || !location) return false;
  const target = path.dirname(location.path);
  // Only direct, recognized installation directories; never recursively remove
  // a link target or an arbitrary parent supplied by the UI.
  return roots.some(root => normalize(path.dirname(target)) === normalize(root.path)) &&
    !target.split(path.sep).includes('.system') && location.status === '正常' &&
    location.links.every(link => ['软链接','目录联接'].includes(link.type)&&normalize(link.path) === normalize(target)) && within(path.dirname(target), target);
}
