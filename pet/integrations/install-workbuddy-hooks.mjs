#!/usr/bin/env node
// 把桌宠挂到 WorkBuddy 的 hooks 上（可重复执行；只动 hooks 里属于自己的条目）。
//
//   node pet/integrations/install-workbuddy-hooks.mjs           # 安装/更新
//   node pet/integrations/install-workbuddy-hooks.mjs --remove  # 摘掉
//
// 选项：
//   --settings <path>  默认 ~/.workbuddy/settings.json
//   --node <path>      默认 /usr/local/bin/node（不存在则用当前 node）
//
// 写之前会备份成 settings.json.bak-before-pet-<时间戳>。
import { existsSync, copyFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const hookPath = path.join(here, 'workbuddy-hook.mjs');

const args = process.argv.slice(2);
const remove = args.includes('--remove');
const option = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const settingsPath = option('--settings', path.join(os.homedir(), '.workbuddy', 'settings.json'));
const nodePath = option('--node', existsSync('/usr/local/bin/node') ? '/usr/local/bin/node' : process.execPath);
const command = `${nodePath} ${hookPath}`;

const hook = (timeout) => ({ type: 'command', command, timeout });
const EVENTS = {
  SessionStart: { timeout: 8 },
  UserPromptSubmit: { timeout: 5 },
  PreToolUse: { timeout: 5, matcher: '.*' },
  PermissionRequest: { timeout: 5 },
  Notification: { timeout: 5 },
  PreCompact: { timeout: 5 },
  Stop: { timeout: 5 },
  SessionEnd: { timeout: 5 },
};

const ours = (entry) => JSON.stringify(entry).includes('workbuddy-hook.mjs');

async function load() {
  if (!existsSync(settingsPath)) return {};
  const raw = await readFile(settingsPath, 'utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

async function main() {
  const settings = await load();
  settings.hooks = settings.hooks || {};

  if (remove) {
    let removed = 0;
    for (const [event, list] of Object.entries(settings.hooks)) {
      if (!Array.isArray(list)) continue;
      const kept = list.filter((entry) => !ours(entry));
      removed += list.length - kept.length;
      if (kept.length) settings.hooks[event] = kept;
      else delete settings.hooks[event];
    }
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
    console.log(removed ? `已摘掉 ${removed} 组桌宠钩子：${settingsPath}` : '没有找到桌宠钩子，未改动。');
    return;
  }

  const backup = `${settingsPath}.bak-before-pet-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  if (existsSync(settingsPath)) copyFileSync(settingsPath, backup);

  const touched = [];
  for (const [event, conf] of Object.entries(EVENTS)) {
    const list = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    const kept = list.filter((entry) => !ours(entry));
    const entry = { hooks: [hook(conf.timeout)] };
    if (conf.matcher) entry.matcher = conf.matcher;
    settings.hooks[event] = kept.concat(entry);
    touched.push(event);
  }

  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  console.log(`已挂上 ${touched.length} 个事件：${touched.join(', ')}`);
  console.log(`配置文件：${settingsPath}`);
  console.log(`备份：${backup}`);
  console.log('下次 WorkBuddy 发事件时生效（实测无需重启）。');
}

main().catch((error) => {
  console.error('安装失败：' + (error && error.message ? error.message : String(error)));
  process.exitCode = 1;
});
