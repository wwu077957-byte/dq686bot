# dq686BOT

多情的私人 AI 机器人（Telegram）。

- 大脑：DeepSeek API（聊天、答疑、写代码，带最近 10 轮记忆）
- 看图：Groq 免费视觉模型（可选，填了 `GROQ_API_KEY` 才启用）
- 作图：Pollinations 免费接口（`/draw 描述`）
- 护栏：白名单 `ALLOWED_IDS`、每人每天 100 次、全机器人每天 2000 次上限

纯 Python 标准库实现，无第三方依赖。Webhook 模式，适配 Render 免费版。

## 部署（Render Blueprint）

1. Render 登录后选 New → Blueprint，选本仓库，Apply。
2. 在服务的 Environment 里填：
   - `BOT_TOKEN`：BotFather 给的新 token（不要写进代码、不要发聊天里）
   - `DEEPSEEK_API_KEY`：DeepSeek 的 key（若用中转，把 `DEEPSEEK_BASE_URL` 改成中转地址）
   - `ALLOWED_IDS`：主人自己的 Telegram 数字 ID（先私聊机器人发 `/myid` 可查到；不填时第一个 /start 的人会被临时认作主人）
   - `GROQ_API_KEY`（可选）：开通看图功能
3. 部署完成后机器人自动设置 Webhook。私聊机器人发 `/help` 验证。

## 命令

- 直接发消息：聊天
- `/new`：清空记忆
- `/draw 描述`：画图
- 发图片：看图解读（需 Groq key）
- `/myid`：查看自己的数字 ID
- `/help`：说明
