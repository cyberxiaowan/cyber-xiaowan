#!/usr/bin/env node
// 赛博小晚桌宠 · 命令行入口
//
//   node pet/cli.mjs              启动桌宠（已运行则显示地址）
//   node pet/cli.mjs clap         触发一个状态：idle/think/work/clap/question/heart/sleep/bishou
//   node pet/cli.mjs clap "台词"  触发状态并自定义气泡文本
//   node pet/cli.mjs --port 7632  指定端口
//   node pet/cli.mjs --no-open    只起服务，不弹窗口
//
// 零依赖，仅 Node 内置模块；服务只绑定 127.0.0.1。
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { runtimeFile } from './runtime-paths.mjs';

function parseArgs(argv) {
  const options = { port: Number(process.env.CYBER_XIAOWAN_PET_PORT) || 0, open: true, state: null, note: '' };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-open') options.open = false;
    else if (arg.startsWith('--port=')) options.port = Number(arg.slice(7)) || options.port;
    else if (arg === '--port') options.port = Number(argv[++i]) || options.port;
    else positional.push(arg);
  }
  if (positional.length) {
    options.state = positional[0];
    options.note = positional.slice(1).join(' ');
  }
  return options;
}

async function runningPort() {
  try {
    const info = JSON.parse(await readFile(runtimeFile(), 'utf8'));
    if (!info.port) return null;
    const response = await fetch(`http://127.0.0.1:${info.port}/api/state`, {
      signal: AbortSignal.timeout(600),
    });
    return response.ok ? info.port : null;
  } catch {
    return null;
  }
}

async function postState(port, state, note) {
  const response = await fetch(`http://127.0.0.1:${port}/api/state`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state, note }),
    signal: AbortSignal.timeout(1200),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

function spawnDetached(command, args) {
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

function openWindow(url) {
  const app = url.replace(/\/$/, '');
  if (process.platform === 'darwin') {
    const apps = [
      '/Applications/Google Chrome.app',
      '/Applications/Microsoft Edge.app',
      '/Applications/Chromium.app',
      '/Applications/Brave Browser.app',
    ];
    const found = apps.find((dir) => existsSync(dir));
    if (found) {
      execFile('open', ['-na', path.basename(found, '.app'), '--args', `--app=${app}`, '--window-size=380,520'], () => {});
    } else {
      execFile('open', [app], () => {});
    }
    return;
  }
  if (process.platform === 'win32') {
    spawnDetached('cmd', ['/c', 'start', 'chrome', `--app=${app}`]);
    return;
  }
  for (const bin of ['chromium-browser', 'chromium', 'google-chrome']) {
    try {
      spawnDetached(bin, [`--app=${app}`, '--window-size=380,520']);
      return;
    } catch {
      // 尝试下一个浏览器
    }
  }
  spawnDetached('xdg-open', [app]);
}

const options = parseArgs(process.argv.slice(2));

if (options.state && !options.state.match(/^[a-z]+$/)) {
  console.error(`未知状态：${options.state}`);
  process.exit(1);
}

const port = await runningPort();

if (port) {
  if (options.state) {
    await postState(port, options.state, options.note).then(() => {
      console.log(`已触发状态：${options.state}${options.note ? `（${options.note}）` : ''}`);
    }).catch((error) => {
      console.error(`触发状态失败：${error.message}`);
      process.exitCode = 1;
    });
  } else {
    console.log(`小晚桌宠已在运行：http://127.0.0.1:${port}/`);
    if (options.open) openWindow(`http://127.0.0.1:${port}/`);
  }
} else {
  const { start } = await import('./server.mjs');
  const { url } = await start({ port: options.port || 0 });
  console.log(`小晚桌宠已上线：${url}`);
  console.log('触发状态示例：node pet/cli.mjs clap');
  if (options.state) {
    await postState(new URL(url).port, options.state, options.note).catch(() => {});
  } else if (options.open) {
    openWindow(url);
  }

  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    process.exit(0);
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}
