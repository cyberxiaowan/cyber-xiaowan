#!/usr/bin/env node
// Codex CLI 桥：把 agent 生命周期事件映射成桌宠状态，桌宠没开着时顺手把它带起来。
//
// 在 ~/.codex/config.toml 里加一行（路径换成实际安装位置）：
//   notify = ["node", "<skill>/pet/integrations/codex-notify.mjs"]
//
// 行为：
// - 桌宠已在跑：把状态发过去（Codex 每完成一轮 → 鼓掌，出错 → 歪头）。
// - 桌宠没在跑：detached 起一个 `cli.mjs <state>`，窗口自己弹出来，状态一并设好。
//   这样不需要单独开服务、也不需要记地址。
// - 不想被自动拉起：设 CYBER_XIAOWAN_PET_AUTOSTART=0，或放一个空文件
//   ~/.cyber-xiaowan/no-autostart。
// - 任何异常都静默吞掉，绝不阻塞 Codex。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeFile, runtimeHome } from '../runtime-paths.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(here, '..', 'cli.mjs');

function pickState(event) {
  const type = String((event && event.type) || '');
  if (type.includes('turn-complete') || type.includes('task-complete')) return 'clap';
  if (type.includes('error') || type.includes('fail')) return 'question';
  if (type.includes('start') || type.includes('begin')) return 'work';
  return null;
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

function autostartAllowed() {
  if (process.env.CYBER_XIAOWAN_PET_AUTOSTART === '0') return false;
  return !existsSync(path.join(runtimeHome(), 'no-autostart'));
}

function launchPet(state) {
  const child = spawn(process.execPath, [cliPath, state], {
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', () => {});
  child.unref();
}

async function main() {
  const raw = process.argv[2];
  if (!raw) return;
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return;
  }
  const state = pickState(event);
  if (!state) return;

  const port = await runningPort();
  if (port) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/state`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state }),
        signal: AbortSignal.timeout(1500),
      });
    } catch {
      // 网络异常：忽略
    }
    return;
  }

  if (autostartAllowed()) launchPet(state);
}

main();
