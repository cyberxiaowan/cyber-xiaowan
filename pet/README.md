# 赛博小晚 · 桌宠模式

让小晚以真人表情包桌宠的形式住在你的桌面上：不同状态对应不同的动作、表情和一句话，Codex 与 DSH 的会话事件可以实时点亮她。

全部本地运行：零依赖（仅 Node 内置模块），服务只绑定 `127.0.0.1`，不上传任何数据。

## 快速开始

```bash
# 在仓库根目录
node pet/cli.mjs              # 启动桌宠（自动弹出窗口）
node pet/cli.mjs clap         # 让小晚鼓掌
node pet/cli.mjs clap "这步走得漂亮！"
node pet/cli.mjs sleep        # 让她打盹
```

也可以：

```bash
npm run pet
```

## 状态一览

| 状态 | 动作/表情 | 触发命令 | 说明 |
|---|---|---|---|
| `idle` | 😊 挥手待机 | `node pet/cli.mjs idle` | 默认状态 |
| `think` | 🤔 托腮思考 | `node pet/cli.mjs think` | 思考中 |
| `work` | 🛠️ 低头打字 | `node pet/cli.mjs work` | 干活中 |
| `clap` | 👏 真人鼓掌（实拍原图） | `node pet/cli.mjs clap` | 庆祝，几秒后自动回落 |
| `question` | 🧐 歪头疑惑 | `node pet/cli.mjs question` | 有疑问，自动回落 |
| `heart` | ❤️ 双手比心 | `node pet/cli.mjs heart` | 感谢/喜欢，自动回落 |
| `sleep` | 😴 双手当枕打盹 | `node pet/cli.mjs sleep` | 长时间无活动 |
| `bishou` | 🖐 比手大赛（彩蛋） | `node pet/cli.mjs bishou` | 三局两胜，比手掌大小，见下方「彩蛋」 |

`clap.jpg` 是实拍原图；其余状态用同一人设的生图动作贴图（待机、思考、干活、疑问、比心、打盹）。图片态右下角会带对应状态的 emoji 徽标。

交互：拖动卡片移动位置（会记住）；单击切换状态；双击直接鼓掌。窗口以 Chrome/Edge 应用模式打开，没有这些浏览器时回退默认浏览器。

## 彩蛋：比手大赛

`bishou` 是藏在状态清单里的隐藏状态：小晚伸出一双卡通大手，你从三只自己的手（小手 16.2 cm／中手 18.6 cm／大手 20.8 cm）里挑一只，两只手按同一把尺子摆到同一条底线上，比手掌大小。三局两胜，差 0.1 cm 也算赢。

```bash
node pet/cli.mjs bishou          # 直接开赛
```

不爱开命令行也行：**连点卡片左上角的状态牌三下**，或者在小晚窗口里直接敲 `bishou`。窗口里按 `1` `2` `3` 选尺寸，`Esc` 收工。她每局换一个手掌尺寸（15.4–22.4 cm 之间随机），也会对你的选法发表意见，通常不太客气。

手是按 `cm × 3.05px` 真实比例画的，所以肉眼能看出差别；胜负按四舍五入到 0.1 cm 的数值判定。战绩只写在本机浏览器的 localStorage（`cyber-xiaowan-bishou`），不上传、不落日志；清掉它等于抹掉她的记忆。状态清单里 `"game": "bishou"` 是开关：删掉这个字段，它就退回一个普通的 emoji 状态，其他状态不受影响。

## 接入 WorkBuddy

WorkBuddy 的 hooks 与 Claude Code 同构，配置在 `~/.workbuddy/settings.json` 的 `hooks` 字段。一条命令挂上：

```bash
node <repo>/pet/integrations/install-workbuddy-hooks.mjs
```

它会写 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PermissionRequest`、`Notification`、`PreCompact`、`Stop`、`SessionEnd` 八个事件，写前备份 `settings.json.bak-before-pet-<时间戳>`，只替换属于自己的条目，不动别人的钩子。摘掉加 `--remove`。

映射关系：

| WorkBuddy 事件 | 桌宠状态 |
| --- | --- |
| `SessionStart` | 🌱 待机 |
| `UserPromptSubmit` | 🤔 思考中 |
| `PreToolUse`（Read / Grep / Glob / WebFetch…） | 🤔 思考中（在看） |
| `PreToolUse`（Write / Edit / Bash / MCP 工具…） | 🛠️ 干活中（在改） |
| `PermissionRequest` | 🧐 有疑问 |
| `Notification`（`idle_prompt` / `auth_success`） | 🌱 待机 / 🎉 鼓掌 |
| `Stop` | 🎉 鼓掌庆祝，6 秒后回待机 |
| `SessionEnd` | 😴 打盹 |

和 Codex 一样**不要求先开桌宠**：没开着的时候钩子会 detached 起一个 `cli.mjs <state>`，窗口自己弹出来。区别是 WorkBuddy 的 `PreToolUse` 一次任务里会触发上百次，所以这里加了两条保护——同一状态 1.5 秒内只发一次；**比手大赛进行中不抢状态**（否则钩子一响，你正比着的手就没了）。不想被自动拉起仍可用 `CYBER_XIAOWAN_PET_AUTOSTART=0` 或 `~/.cyber-xiaowan/no-autostart`。

钩子永远静默：stdout 为空、退出码 0，绝不会卡住或污染 WorkBuddy 的对话。

## 接入 Codex

Codex CLI 支持 `notify` 钩子。在 `~/.codex/config.toml` 中加一行（路径换成你的仓库实际位置）：

```toml
notify = ["node", "<repo>/pet/integrations/codex-notify.mjs"]
```

效果：Codex 每完成一轮回答，小晚就鼓一次掌；出错时歪头提问。

**桌宠没开着的时候，钩子会自己把桌宠带起来**（detached 起 `cli.mjs <state>`，窗口自动弹出，状态一并设好）。所以接入之后不需要单独起服务、也不用记端口地址：跑 Codex 就行。

不想被自动拉起的话，设 `CYBER_XIAOWAN_PET_AUTOSTART=0`，或在 `~/.cyber-xiaowan/no-autostart` 放一个空文件；两种情况钩子都退回「桌宠没开就静默退出」，绝不影响 Codex。

## 接入 DSH

两种用法可以叠加：

1. **自动观察**（推荐常驻）：

   ```bash
   nohup node <repo>/pet/integrations/dsh-watch.mjs >/dev/null 2>&1 &
   ```

   它轮询本机 DSH 会话目录的写入时间：有会话在写 → `work`；安静 2 分钟 → `idle`；8 分钟 → `sleep`。

2. **Agent 主动触发**：DSH 里的 agent 都能跑 shell，直接让它执行即可。建议在你的 AGENTS.md / 预设里加一条约定，例如：

   ```text
   完成一个阶段性任务后运行：node <repo>/pet/cli.mjs clap
   开始长任务前运行：node <repo>/pet/cli.mjs work
   ```

## HTTP API

服务只监听回环地址，端口写在 `~/.cyber-xiaowan/pet.json`。

```bash
curl http://127.0.0.1:PORT/api/state          # 查询当前状态
curl -X POST -H 'content-type: application/json' \
     -d '{"state":"clap","note":"自定义台词"}' \
     http://127.0.0.1:PORT/api/state           # 切换状态
curl -N http://127.0.0.1:PORT/api/events      # SSE 实时订阅
```

## 添加更多真人表情包素材

`clap.jpg` 是实拍原图；`idle.jpg` / `think.jpg` / `work.jpg` / `question.jpg` / `heart.jpg` / `sleep.jpg` 是按这张原图人设生成的不同动作表情包。补充你自己的素材：

1. 把图片放进 `pet/assets/`（建议 700px 宽以内，jpg/png 均可）。
2. 在 `pet/pets.json` 里给对应状态的 `"image"` 字段填上相对路径（如 `"assets/think.jpg"`）；`"image"` 为空时该状态使用 emoji 形象兜底。
3. 保存后刷新桌宠窗口即可生效，无需重启服务。

有更多实拍动作照片时，直接替换对应文件即可。

素材版权与肖像：请只使用你有权使用的图片。内置素材来自赛博小晚项目作者本人的照片及基于该照片生成的动作图，仅作项目桌宠演示。

### 图片许可

仓库的 MIT 许可只覆盖代码和文字，不覆盖 `pet/assets/*.jpg`。这些图片的版权与肖像权由项目作者保留；未经单独书面许可，不得将图片从本项目中拆出后再分发、修改、用于模型训练或用于商业用途。你可以删除图片引用并使用自己的合法素材，桌宠框架不受影响。

## 文件结构

```text
pet/
├── cli.mjs                    # 入口：启动服务 / 触发状态
├── server.mjs                 # 本地 HTTP 服务（静态文件 + 状态 API + SSE）
├── pets.json                  # 状态清单：贴图、动画、台词、是否自动回落
├── public/index.html          # 桌宠界面（拖拽 / 点击 / 动画）
├── assets/                    # 真人表情包素材
│   ├── clap.jpg               # 「鼓掌」实拍原图（庆祝态）
│   ├── idle.jpg               # 挥手待机
│   ├── think.jpg              # 托腮思考
│   ├── work.jpg               # 低头打字
│   ├── question.jpg           # 歪头疑惑
│   ├── heart.jpg              # 双手比心
│   └── sleep.jpg              # 打盹
└── integrations/
    ├── codex-notify.mjs       # Codex CLI notify 钩子桥
    └── dsh-watch.mjs          # DSH 会话活动观察器
```
