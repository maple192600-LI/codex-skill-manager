export function createBridge(host, { timeoutMs = 15000, inventoryTimeoutMs = 75000 } = {}) {
  if(host?.document&&host.addEventListener) host.addEventListener('message',event=>{
    if(event.source!==host.parent||event.data?.jsonrpc!=='2.0'||event.data.method!=='ui/notifications/host-context-changed')return;
    const theme=event.data.params?.theme;
    if(theme==='light'||theme==='dark')host.document.documentElement.dataset.theme=theme;
  });
  function bounded(promise, ms, operation) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${operation}超时；结果待确认，请刷新后再操作。`)), ms);
      Promise.resolve(promise).then(resolve, reject).finally(() => clearTimeout(timer));
    });
  }
  function connect() {
    if (typeof host?.openai?.callTool !== 'function') throw new Error('请从 Codex 侧栏打开技能管理器；当前页面没有连接 Codex。');
    const theme=host.openai.theme;
    if(host.document&&(theme==='light'||theme==='dark'))host.document.documentElement.dataset.theme=theme;
    return host.openai;
  }
  return {
    async call(name, args = {}, options = {}) {
      const bridge = connect();
      // Codex validates JSON before dispatch. Encode optional JavaScript
      // fields such as cwd:undefined as absent fields, as required by JSON.
      const payload = JSON.parse(JSON.stringify(args));
      const result = await bounded(bridge.callTool(name, payload), options.timeoutMs || (name==='skill_manager_inventory'?inventoryTimeoutMs:timeoutMs), '请求');
      return unwrapToolResult(result);
    },
    async openLink(url) {
      const bridge=connect();
      if(typeof bridge.openExternal!=='function')throw new Error('Codex 未提供打开页面的接口');
      return unwrapToolResult(await bounded(bridge.openExternal({ href: url }), timeoutMs, '打开安装页面'));
    },
  };
}
export function unwrapToolResult(result) {
  const value = result?.result ?? result;
  if (value?.isError || value?.error) throw new Error(value.error?.message || value.content?.filter(x => x.type === 'text').map(x => x.text).join('\n') || '操作失败');
  if (value?.structuredContent) return value.structuredContent;
  const text = value?.content?.find(x => x.type === 'text')?.text;
  if (text) { try { return JSON.parse(text); } catch { /* Plain text success. */ } }
  return value;
}
const bridge = createBridge(typeof window === 'undefined' ? undefined : window);
export const callBridgeTool = (...args) => bridge.call(...args);
export const openHostLink = url => bridge.openLink(url);
