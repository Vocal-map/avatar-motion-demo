# MILO · 3D 动作实验室

一个原生 JavaScript + Three.js 的网页 Demo。页面主体为可旋转的 3D 机器人，下方支持本地动作指令与 DeepSeek AI 对话。LLM 生成文字回复，并选择动作、顺序、次数、速度和幅度。

## 运行

需要 Node.js 18 或更新版本，无需安装 npm 依赖。

Windows 可直接双击项目里的 `start-demo.cmd`，然后在浏览器打开终端显示的地址。也可以手动启动：

```powershell
cd D:\Documents\WebProjects\avatar-motion-demo
node scripts/serve.mjs
```

打开 **http://127.0.0.1:5173**。也可以运行 `npm.cmd run dev`。在 Windows PowerShell 中使用 `npm.cmd` 可避免系统禁止执行 `npm.ps1` 的问题。端口冲突时设置 `$env:PORT = '5174'` 后重新启动。

请通过 HTTP 服务打开页面，不能直接双击 `index.html`，因为浏览器 ES Modules 需要 HTTP 环境。

## 交互

默认处于**本地动作**模式。配置 DeepSeek 后，点击输入框上方的 **AI 对话**切换模式；“已配置”表示服务端读取到了配置，实际连接在发送消息时验证。

| 输入 | 角色动作 |
| --- | --- |
| 打招呼 | 抬起右臂、摆动前臂并轻轻歪头 |
| 欢迎光临 | 从腰部向前鞠躬、低头致意，再恢复站立 |
| 跳跃 | 下蹲蓄力、双臂上扬起跳、落地缓冲 |

- 支持点击 11 个动作快捷按钮；输入框外按 `1` / `2` / `3` 也可触发动作。
- 输入框内按 Enter 发送，已处理中文输入法确认文字时的误提交。
- 同义表达也可识别，例如“你好”“挥手”“鞠躬”“跳起来”以及 `hello`、`welcome`、`jump`。
- 本地模式中，空白、未知、否定及同时包含多个动作的指令会提示用户，不会猜测执行。
- 本地模式中，连续指令按顺序播放，最多排队 3 个动作。AI 模式支持模型编排的组合动作。
- 鼠标/触屏拖动可旋转，滚轮或双指可缩放；右上角按钮重置视角。
- 窗口尺寸变化时自动适配；切换后台标签页时暂停动画循环。
- WebGL 不可用、网络加载失败时显示原因及重新加载按钮。
- 尊重系统“减少动态效果”设置，关闭非必要待机动作；主动触发的演示动作仍会播放。

## 接入 DeepSeek

1. 将 `.env.example` 复制为项目根目录的 `.env`（已有 `.env` 时直接编辑，不要覆盖密钥）。
2. 填入 API Key。默认设置已针对 DeepSeek 配好：

```dotenv
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-flash
LLM_API_KEY=在本机填写你的密钥
LLM_RESPONSE_FORMAT=json_object
LLM_THINKING=disabled
```

也支持官方示例使用的 `DEEPSEEK_API_KEY` 环境变量；同时提供时优先使用 `LLM_API_KEY`。终端环境变量优先于 `.env`。

3. 重启 `start-demo.cmd` 或 `node scripts/serve.mjs`，刷新页面，选择 **AI 对话**。
4. 输入例如：

- “先挥手，再慢慢鞠躬两次，欢迎新朋友。”
- “开心地跳两下，告诉我今天也要加油。”
- “不要做动作，用英语介绍一下你自己。”

“角色设定”可调整角色身份、语气与回复语言，保存在当前浏览器，下次请求生效。“朗读回复”使用浏览器语音合成，默认关闭；优先使用匹配语言的本地语音，部分语音可能由浏览器的网络服务提供。没有麦克风输入或口型同步。

AI 回复展示在对话区，角色气泡展示简短预览。动作与朗读从回复到达后开始，不做逐词对齐。保留最近 6 轮成功对话作为上下文；清空对话或刷新页面后重置。请求期间不能重复发送，点击“停止”、切换模式或清空对话会取消正在进行的请求、朗读与动作。直接动作按钮不调用 LLM，并会替换正在播放的 AI 动作方案。

可在普通本机终端进行一次真实接口检查（会调用一次 DeepSeek）：

每次模型成功返回 HTTP 响应后，启动服务的终端会打印 `[DeepSeek] 原始响应`（完整响应体，包含 `choices`、`usage` 等返回字段）；动作校验通过后，还会格式化打印 `[DeepSeek] 解析后的回复与动作`（`reply` 与 `actions`）。日志中会遮盖当前配置的 API Key。修改代码后需要重启服务，新的日志才会生效。

```powershell
node scripts/check-llm.mjs
```

如果出现 `Network code: EACCES`，表示启动进程的执行环境禁止了网络连接，请从你自己的普通终端启动。鉴权失败、额度不足、网络失败、超时、空内容、截断及非法动作方案均有明确提示；错误不会被当作成功回复执行。

接口参数依据 [DeepSeek 官方首次调用文档](https://api-docs.deepseek.com/zh-cn/)、[JSON Output 文档](https://api-docs.deepseek.com/zh-cn/guides/json_mode/) 和 [Chat Completions 参数文档](https://api-docs.deepseek.com/api/create-chat-completion/)（核对日期：2026-11-06）。默认使用 `deepseek-flash` 与 JSON Output，并关闭思考模式以适合即时角色互动。模型名仍可通过环境变量更换。

### LLM 动作协议

服务端调用 `POST /chat/completions`，要求返回以下 JSON，并在服务端和浏览器分别校验：

```json
{
  "reply": "欢迎新朋友！很高兴见到你。",
  "actions": [
    { "name": "wave", "speed": 1, "intensity": 1, "repeat": 1 },
    { "name": "bow", "speed": 0.7, "intensity": 1, "repeat": 2 }
  ]
}
```

`actions: []` 表示只回复、不执行动作。允许的动作是 `wave`（挥手）、`bow`（鞠躬）、`jump`（跳跃）、`nod`（点头）、`shake`（摇头）、`shrug`（耸肩）、`cheer`（欢呼）、`dance`（跳舞）、`stretch`（伸懒腰）、`think`（思考）、`salute`（敬礼）；每组最多 4 步、合计最多执行 6 次；单步重复 1～3 次，速度为 0.6～1.6 倍，幅度为 0.5～1.2 倍。LLM 不生成或执行 JavaScript，不直接写入任意关节参数。

若需要新增转身等全新动作，在 `src/commands.js` 注册动作信息，在 `src/motion.js` 实现对应动画，系统提示词会自动读取注册表中的动作名称与标签。`src/action-plan.js` 会从动作注册表生成白名单。

### 服务端配置与数据

- API Key 仅从服务端环境变量 / `.env` 读取；`.env` 已被 Git 忽略，不会被静态服务器访问，也不进入 `dist/`。
- `GET /api/config` 只返回配置状态、模型名、服务域名和超时设置，不返回密钥。
- `POST /api/chat` 发送当前消息、最多 6 轮成功对话、角色设定与回复语言；只在选择 AI 模式后调用模型服务。
- 本地服务只监听 `127.0.0.1`，检查 Host / Origin，限制请求体大小和并发请求数量；不会把模型服务的原始错误内容转发给网页。
- 可配置 `LLM_TIMEOUT_MS`（默认 30000）、`LLM_MAX_TOKENS`（默认 2048）。
- 若接其他兼容服务，可修改 `LLM_BASE_URL` 和 `LLM_MODEL`。`LLM_RESPONSE_FORMAT` 支持 `json_object`、`json_schema`、`none`；DeepSeek 使用 `json_object`。`LLM_TOKEN_PARAMETER` 可显式指定 `max_tokens` 或 `max_completion_tokens`，默认按服务域名选择。

## 模型来源

**MILO 为本项目原创的程序化 3D 模型**，代码位于 `src/robot.js`。通过圆角立方体、胶囊、球体、圆柱及曲线管道构造，没有下载第三方角色或使用外部模型服务。

头部、腰部、肩部、肘部、髋部、膝部及脚部均有独立的层级关节。动画使用按时间采样的关节姿态；鞠躬围绕腰部进行，跳跃下蹲时补偿腿部长度并保持脚掌水平。

可直接修改 `src/robot.js` 中的材质色值和几何参数，更换角色外观；修改 `src/motion.js` 可调整动作幅度与节奏。

## 网络与第三方组件

- Three.js **0.180.0** 及其 OrbitControls / RoundedBoxGeometry 从 `cdn.jsdelivr.net` 加载，版本已固定在 `index.html` 的 import map 中。浏览器首次加载需要能访问该 CDN。
- Google Fonts 提供 DM Sans / Space Grotesk 字体，加载失败时自动使用系统字体，不影响功能。
- 3D 模型、动画与本地指令识别在浏览器运行。本地动作无需密钥；AI 模式会通过本机服务端向配置的模型服务发送消息及上下文。
- 离线部署可把 Three.js 对应版本的 `build/`、`examples/jsm/` 文件放入 `src/vendor/three/`，将 import map 的两项地址分别改为 `/src/vendor/three/build/three.module.js` 与 `/src/vendor/three/examples/jsm/`，并移除 CSS 顶部的字体 `@import`。
- Three.js 使用 MIT 许可：[官方项目与许可证](https://github.com/mrdoob/three.js/blob/r180/LICENSE)。[OrbitControls 文档](https://threejs.org/docs/pages/OrbitControls.html)。

## 检查与构建

```powershell
node --test tests/*.test.js
node scripts/build.mjs
node scripts/serve.mjs --dist
```

构建结果在 `dist/`。`node scripts/serve.mjs --dist` 同时提供构建后的页面和 AI 接口。只上传 `dist/` 到静态托管时，本地动作仍可运行，AI 功能需要另外部署后端。当前 Node 服务面向本机 Demo；要公开部署，需补充身份验证与用户配额，并迁移到目标平台支持的后端运行方式。不要将 `.env` 上传到静态托管。

测试覆盖指令映射、动作衔接、不同幅度下的脚掌接地、动作方案校验、对话历史边界、DeepSeek 请求格式、超时与取消、错误输出，以及“本机 HTTP 服务 → 模拟兼容模型接口 → 动作方案”的完整链路。自动化测试使用模拟接口，不消耗实际模型额度；真实接口可用上述 `check-llm.mjs` 单独检查。

## 文件结构

```text
index.html          页面布局与依赖 import map
src/style.css       页面样式、响应式布局
src/main.js         交互、加载状态、动画队列与帧循环
src/chat.js         AI 模式、对话记录、角色偏好和朗读
src/action-plan.js  前后端共享的动作协议与校验
src/commands.js     指令映射与识别
src/motion.js       动画姿态与有界队列（可单独测试）
src/robot.js        原创 3D 角色与关节层级
src/scene.js        摄像机、灯光、阴影、舞台和视角操作
server/config.mjs  服务端环境配置与公开状态
server/llm.mjs     DeepSeek / 兼容接口适配、提示词与错误处理
server/app.mjs     本地 HTTP 服务与 API 路由
scripts/serve.mjs   服务启动入口
scripts/check-llm.mjs  真实接口诊断（调用一次模型）
scripts/build.mjs   静态构建
tests/behavior.test.js  行为与运动约束测试
tests/llm.test.js       协议、接口与异常测试
tests/ui-fixture.mjs    独立浏览器联调服务（5180 端口，模拟回复）
```

动作组合示例（AI 模式）：先思考再点头；敬礼后鞠躬；先欢呼再跳舞。本地模式可直接输入点头、摇头、耸肩、欢呼、跳舞、伸懒腰、思考或敬礼。新增动作复用现有骨骼关节，支持速度、幅度和重复次数，结束时平滑回到待机。
