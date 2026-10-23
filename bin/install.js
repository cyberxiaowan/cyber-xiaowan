#!/usr/bin/env node
import { cp, writeFile, mkdir, access, readFile, rename, rm, lstat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const welcome = await readFile(path.join(repoRoot, 'START.md'), 'utf8');

function parseRoots(raw) {
  if (!raw) return null;
  const roots = raw.split(path.delimiter).map((item) => item.trim()).filter(Boolean);
  return roots.length ? roots : null;
}

function defaultRoots() {
  const home = process.env.HOME || os.homedir();
  return [
    { kind: 'Claude Code', dir: path.join(home, '.claude', 'skills') },
    { kind: 'Codex', dir: path.join(home, '.codex', 'skills') },
    { kind: 'Qoder', dir: path.join(home, '.qoder', 'skills') },
    { kind: 'Agents', dir: path.join(home, '.agents', 'skills') },
    { kind: 'DSH', dir: path.join(home, '.dsh', 'skills') },
    { kind: 'Cursor', dir: path.join(home, '.cursor', 'skills') },
    { kind: 'Grok Build', dir: path.join(home, '.grok', 'skills') },
  ];
}

function rootsFromEnv() {
  const raw = process.env.CYBER_XIAOWAN_SKILL_ROOTS;
  const roots = parseRoots(raw);
  if (!roots) return defaultRoots();
  return roots.map((dir) => {
    const lower = dir.toLowerCase();
    let kind = 'Custom';
    if (lower.includes('.claude')) kind = 'Claude Code';
    else if (lower.includes('.codex')) kind = 'Codex';
    else if (lower.includes('.qoder')) kind = 'Qoder';
    else if (lower.includes('.agents')) kind = 'Agents';
    else if (lower.includes('.dsh')) kind = 'DSH';
    else if (lower.includes('.cursor')) kind = 'Cursor';
    else if (lower.includes('.grok')) kind = 'Grok Build';
    return { kind, dir };
  });
}

async function statDir(dir) {
  try {
    const stat = await access(dir, fsConstants.F_OK).then(async () => {
      const info = await import('node:fs/promises').then((m) => m.stat(dir));
      return info;
    });
    const writable = await access(dir, fsConstants.W_OK).then(() => true).catch(() => false);
    return {
      exists: true,
      isDirectory: stat.isDirectory(),
      writable,
    };
  } catch {
    return {
      exists: false,
      isDirectory: false,
      writable: false,
    };
  }
}

async function inspectRoots(roots) {
  const inspected = [];
  for (const root of roots) {
    const stat = await statDir(root.dir);
    inspected.push({ ...root, ...stat });
  }
  return inspected;
}

function printRootTable(items) {
  output.write('检测到的 skill 目录候选：\n');
  for (const item of items) {
    output.write(
      `${item.kind} — ${item.dir} | exists=${item.exists ? 'yes' : 'no'} | dir=${item.isDirectory ? 'yes' : 'no'} | writable=${item.writable ? 'yes' : 'no'}\n`,
    );
  }
}

async function ask(question) {
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(question);
  rl.close();
  return answer;
}

async function chooseTarget(roots) {
  const inspected = await inspectRoots(roots);
  const valid = inspected.filter((item) => item.exists && item.isDirectory && item.writable);

  if (valid.length === 0) {
    output.write('未检测到已知 skill 目录。\n');
    printRootTable(inspected);
    output.write('支持的目标：\n');
    for (const item of roots) output.write(`- ${item.kind}: ${item.dir}\n`);
    const choice = await ask(`请输入要创建并安装到的目标编号（${roots.map((root, index) => `${index + 1}=${root.kind}`).join(', ')}，回车默认 1）：`);
    const index = Number.parseInt(choice, 10);
    const selected = roots[(Number.isFinite(index) && index >= 1 && index <= roots.length ? index : 1) - 1];
    await mkdir(selected.dir, { recursive: true });
    return selected;
  }

  if (valid.length === 1) {
    const only = valid[0];
    output.write(`使用唯一可用目标：${only.kind} — ${only.dir}\n`);
    return only;
  }

  output.write('检测到多个可用 skill 目录：\n');
  valid.forEach((item, index) => {
    output.write(`${index + 1}. ${item.kind} — ${item.dir} | writable=yes\n`);
  });
  const choice = await ask('请选择安装目标编号：');
  const index = Number.parseInt(choice, 10) - 1;
  return valid[index] || valid[0];
}

async function installSkill(targetDir) {
  const target = path.join(targetDir, 'cyber-xiaowan');
  let targetExists = false;
  try {
    await lstat(target);
    targetExists = true;
  } catch {
    targetExists = false;
  }

  if (targetExists) {
    const answer = await ask(`已存在 ${target}，默认不覆盖。是否覆盖？(y/N) `);
    if (!/^y(es)?$/i.test(answer.trim())) {
      output.write('已取消覆盖，未安装。\n');
      return false;
    }
  }

  await mkdir(targetDir, { recursive: true });
  const staging = path.join(targetDir, `.cyber-xiaowan-install-${process.pid}-${Date.now()}`);
  await mkdir(staging);

  try {
    await cp(path.join(repoRoot, 'SKILL.md'), path.join(staging, 'SKILL.md'));
    await cp(path.join(repoRoot, 'START.md'), path.join(staging, 'START.md'));
    await cp(path.join(repoRoot, 'agents'), path.join(staging, 'agents'), { recursive: true });
    await cp(path.join(repoRoot, 'references'), path.join(staging, 'references'), { recursive: true });
    await cp(path.join(repoRoot, 'README.md'), path.join(staging, 'README.md'));
    await writeFile(path.join(staging, 'INSTALLED_BY_CYBER_XIAOWAN.txt'), `${new Date().toISOString()}\n`);

    let backup = null;
    if (targetExists) {
      const stamp = new Date().toISOString().replaceAll(':', '-');
      const backupRoot = path.join(path.dirname(targetDir), 'skill-backups');
      await mkdir(backupRoot, { recursive: true });
      backup = path.join(backupRoot, `cyber-xiaowan.backup-${stamp}-${process.pid}`);
      await rename(target, backup);
    }

    try {
      await rename(staging, target);
    } catch (error) {
      if (backup) await rename(backup, target).catch(() => {});
      throw error;
    }

    if (backup) output.write(`旧版本已保留在：${backup}\n`);
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  return true;
}

const roots = rootsFromEnv();
const target = await chooseTarget(roots);
const installed = await installSkill(target.dir);
if (installed) {
  output.write(`${welcome}\n`);
  output.write(`\n已安装到：${path.join(target.dir, 'cyber-xiaowan')}\n`);
}
