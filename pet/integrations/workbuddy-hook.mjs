#!/usr/bin/env node
// WorkBuddy 桥：把 hook 事件映射成桌宠状态，桌宠没开着时顺手把它带起来。
//
// 在 ~/.workbuddy/settings.json 的 hooks 字段里挂上（路径换成实际安装位置）：
//   "PreToolUse": [{
//     "matcher": ".*",
//     "hooks": [{ "type": "command",
//                 "command": "/usr/local/bin/node <skill>/pet/integrations/workbuddy-hook.mjs",
//                 "timeout": 5 }]
//   }]
//
// 行为：
// - 从 stdin 读 hook payload，按事件映射成一个状态发过去：
//   SessionStart → 待机，UserPromptSubmit → 思考，PreToolUse → 看/干活，
//   PermissionRequest → 有疑问，Notification → 待机/鼓掌，Stop → 鼓掌，SessionEnd → 打盹。
// - 桌宠没在跑：detached 起一个 `cli.mjs <state>`，窗口自己弹出来，状态一并设好。
//   这样不需要单独起服务、也不需要记地址。
// - 比手大赛进行中不抢状态，免得把正在玩的对局顶掉。
// - 同一状态 1.5 秒内不重复发送；任何异常都吞掉，stdout 永远为空，退出码永远是 0。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, writeSync, closeSync, statSync, unlinkSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeFile, runtimeHome } from '../runtime-paths.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(here, '..', 'cli.mjs');
const lockPath = path.join(runtimeHome(), 'hook-autostart.lock');
const memoryPath = path.join(runtimeHome(), 'hook-state.json');
const GAME_HOLD_MS = 120000;   // 比手大赛期间让位
const REPEAT_MS = 1500;        // 同状态去抖

const READ_TOOL = /^(read|grep|glob|list|find|search|webfetch|websearch|browse|toolsearch|notebookread|taskget|tasklist)/i;
const WRITE_TOOL = /^(write|edit|multiedit|bash|shell|command|delete|move|copy|rename|apply|patch|notebookedit|taskcreate|taskupdate)/i;

function pickState(event) {
  const name = String(event.hook_event_name || event.hookEventName || '').trim();
  switch (name) {
    case 'SessionStart':
      return 'idle';
    case 'UserPromptSubmit':
      return 'think';
    case 'PreToolUse': {
      const tool = String(event.tool_name || '');
      if (READ_TOOL.test(tool)) return 'think';
      if (WRITE_TOOL.test(tool)) return 'work';
      return 'work';
    }
    case 'PermissionRequest':
      return 'question';
    case 'Notification': {
      const kind = String(event.notification_type || '');
      if (!kind) return null;
      if (kind.includes('auth')) return 'clap';
      if (kind.includes('idle')) return 'idle';
      return null;
    }
    case 'Stop':
      return 'clap';
    case 'PreCompact':
      return 'think';
    case 'SessionEnd':
      return 'sleep';
    // PostToolUse / SubagentStop 不映射：前者与 PreToolUse 重复，后者会打断主流程状态
    default:
      return null;
  }
}

function readStdin(timeoutMs = 400) {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve) => {
    let data = '';
    const finish = () => {
      clearTimeout(timer);
      try { process.stdin.pause(); } catch {}
      resolve(data);
    };
    const timer = setTimeout(finish, timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.once('end', finish);
    process.stdin.once('error', finish);
  });
}

async function probe() {
  try {
    const info = JSON.parse(await readFile(runtimeFile(), 'utf8'));
    if (!info.port) return null;
    const response = await fetch(`http://127.0.0.1:${info.port}/api/state`, {
      signal: AbortSignal.timeout(600),
    });
    if (!response.ok) return null;
    const state = await response.json();
    return { port: info.port, state };
  } catch {
    return null;
  }
}

function autostartAllowed() {
  if (process.env.CYBER_XIAOWAN_PET_AUTOSTART === '0') return false;
  return !existsSync(path.join(runtimeHome(), 'no-autostart'));
}

function acquireLock() {
  try {
    mkdirSync(runtimeHome(), { recursive: true });
  } catch {
    return false;
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockPath, 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return true;
    } catch (error) {
      if (error.code !== 'EEXIST') return false;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs < 8000) return false;
        unlinkSync(lockPath);
      } catch {
        return false;
      }
    }
  }
  return false;
}

function launchPet(state) {
  const child = spawn(process.execPath, [cliPath, state], {
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', () => {});
  child.unref();
}

async function remembered() {
  try {
    return JSON.parse(await readFile(memoryPath, 'utf8')) || {};
  } catch {
    return {};
  }
}

async function remember(state) {
  try {
    mkdirSync(runtimeHome(), { recursive: true });
    await writeFile(memoryPath, JSON.stringify({ state, at: Date.now() }), 'utf8');
  } catch {}
}

async function post(port, state) {
  try {
    await fetch(`http://127.0.0.1:${port}/api/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state }),
      signal: AbortSignal.timeout(1500),
    });
  } catch {}
}

async function main() {
  let event;
  try {
    event = JSON.parse(await readStdin());
  } catch {
    return;
  }
  const state = pickState(event);
  if (!state) return;

  const last = await remembered();
  if (last.state === state && Date.now() - Number(last.at || 0) < REPEAT_MS) return;

  const live = await probe();
  if (live) {
    // 对局中让位：状态切走会把正在比的手收起来
    if (live.state && live.state.name === 'bishou' && Date.now() - Number(live.state.since || 0) < GAME_HOLD_MS) return;
    await post(live.port, state);
    await remember(state);
    return;
  }

  if (!autostartAllowed()) return;
  if (!acquireLock()) return;
  launchPet(state);
  await remember(state);
}

main().catch(() => {}).finally(() => process.exit(0));
