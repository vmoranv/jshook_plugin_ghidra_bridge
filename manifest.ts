import {
  assertLoopbackUrl,
  toErrorResponse,
  toTextResponse,
} from '@jshookmcp/extension-sdk/bridges';
import {
  createExtension,
  getPluginBooleanConfig,
  loadPluginEnv,
} from '@jshookmcp/extension-sdk/plugin';
import type { ToolArgs, PluginLifecycleContext } from '@jshookmcp/extension-sdk/plugin';

loadPluginEnv(import.meta.url);

async function requestBridge(
  endpoint: string,
  path: string,
  method = 'GET',
  body?: Record<string, unknown>,
): Promise<{ status: number; data: unknown }> {
  const response = await fetch(`${endpoint.replace(/\/$/, '')}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let data: unknown = {};
  if (text) {
    try { data = JSON.parse(text); } catch { data = { text }; }
  }
  return { status: response.status, data };
}

async function handleGhidraBridge(args: ToolArgs) {
  const endpoint = assertLoopbackUrl(
    process.env.GHIDRA_BRIDGE_URL ?? 'http://127.0.0.1:18080',
    'GHIDRA_BRIDGE_URL',
  );
  const action = typeof args.action === 'string' ? args.action : '';
  if (!action) return toErrorResponse('ghidra_bridge', new Error('action is required'));

  try {
    switch (action) {
      case 'status': {
        const { status, data } = await requestBridge(endpoint, '/health');
        return toTextResponse({ success: status < 300, action, status, data, endpoint });
      }
      case 'open_project': {
        const binaryPath = typeof args.binaryPath === 'string' ? args.binaryPath : '';
        if (!binaryPath) throw new Error('binaryPath is required for open_project');
        const { status, data } = await requestBridge(endpoint, '/project/open', 'POST', { binaryPath });
        return toTextResponse({ success: status < 300, action, status, result: data });
      }
      case 'list_functions': {
        const { status, data } = await requestBridge(endpoint, '/functions');
        return toTextResponse({ success: status < 300, action, status, functions: data });
      }
      case 'decompile_function': {
        const functionName = typeof args.functionName === 'string' ? args.functionName : '';
        if (!functionName) throw new Error('functionName is required for decompile_function');
        const { status, data } = await requestBridge(
          endpoint,
          `/functions/${encodeURIComponent(functionName)}/decompile`,
        );
        return toTextResponse({ success: status < 300, action, status, functionName, decompiled: data });
      }
      case 'run_script': {
        const scriptPath = typeof args.scriptPath === 'string' ? args.scriptPath : '';
        if (!scriptPath) throw new Error('scriptPath is required for run_script');
        const scriptArgs = Array.isArray(args.scriptArgs)
          ? (args.scriptArgs as unknown[]).filter((item): item is string => typeof item === 'string')
          : [];
        const { status, data } = await requestBridge(endpoint, '/script/run', 'POST', {
          scriptPath,
          args: scriptArgs,
        });
        return toTextResponse({ success: status < 300, action, status, result: data });
      }
      case 'get_xrefs': {
        const functionName = typeof args.functionName === 'string' ? args.functionName : '';
        if (!functionName) throw new Error('functionName is required for get_xrefs');
        const { status, data } = await requestBridge(
          endpoint,
          `/xrefs/${encodeURIComponent(functionName)}`,
        );
        return toTextResponse({ success: status < 300, action, status, symbol: functionName, xrefs: data });
      }
      case 'search_strings': {
        const searchPattern = typeof args.searchPattern === 'string' ? args.searchPattern : '';
        const { status, data } = await requestBridge(endpoint, '/strings', 'POST', {
          pattern: searchPattern,
        });
        return toTextResponse({ success: status < 300, action, status, strings: data });
      }
      default:
        return toTextResponse({
          success: true,
          guide: {
            actions: ['status', 'open_project', 'list_functions', 'decompile_function', 'run_script', 'get_xrefs', 'search_strings'],
            endpoint,
          },
        });
    }
  } catch (error) {
    return toErrorResponse('ghidra_bridge', error, { action, endpoint });
  }
}

export default createExtension('io.github.vmoranv.ghidra-bridge', '0.1.0')
  .compatibleCore('>=0.1.0')
  .profile(['full'])
  .allowHost(['127.0.0.1', 'localhost', '::1'])
  .allowTool('ghidra_bridge')
  .configDefault('plugins.ghidra-bridge.enabled', true)
  .metric('ghidra_bridge_calls_total')
  .tool(
    'ghidra_bridge',
    'Interact with Ghidra bridge backend. Actions: status, open_project, list_functions, decompile_function, run_script, get_xrefs, search_strings.',
    {
      action: { type: 'string', enum: ['status', 'open_project', 'list_functions', 'decompile_function', 'run_script', 'get_xrefs', 'search_strings'] },
      binaryPath: { type: 'string' },
      functionName: { type: 'string' },
      scriptPath: { type: 'string' },
      scriptArgs: { type: 'array', items: { type: 'string' } },
      searchPattern: { type: 'string' },
    },
    async (args) => handleGhidraBridge(args),
  )
  .onLoad((ctx) => { ctx.setRuntimeData('loadedAt', new Date().toISOString()); })
  .onValidate((ctx: PluginLifecycleContext) => {
    const enabled = getPluginBooleanConfig(ctx, 'ghidra-bridge', 'enabled', true);
    if (!enabled) return { valid: false, errors: ['Plugin disabled by config'] };
    return { valid: true, errors: [] };
  });
