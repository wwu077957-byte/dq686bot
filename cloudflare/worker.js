// dq686BOT v5 - Cloudflare Workers 版
// 大脑 (可切换, 共用同一份聊天记录):
//   DeepSeek 日常 (deepseek-chat) / DeepSeek 深度思考 (deepseek-reasoner)
//   GPT-OSS 120B (Groq 免费) / GPT-OSS 20B (Groq 免费, 更快)
// v5 新增: 长期记忆库 (/remember /memory /forget)、人设切换 (/persona)、智能选模型 (/auto)
//   四模型自检 (/check)、双模型擂台 (/arena)、换模型重答 (/retry)、定时提醒 (/remind)
//   网页盯梢 (/watch, 并入每日早报)、代码工坊 (/audit /explain /refactor /tr)
//   导出 (/export)、假装失忆 (/incognito)、状态卡 (/status)
// v5.7 新增: 每日早报加「过年倒计时」行 (春节 2027-02-06 大年初一, 提前每天报天数,
//   当天报过年好, 过了自动不再出现)
// 看图: Groq 视觉模型 (GROQ_API_KEY); 作图: Pollinations 免费接口
// 代码交付: 回复带按钮, 一点把代码块存成文件发送; 说"文件"或代码太长时自动发文件
// 读链接: 发网址自动抓正文总结; 读文件: txt/md/代码/日志/Word(docx) 发来就能读
// 语音: 发语音自动转文字再回答 (Groq Whisper, 与看图同一把 key)
// 联网搜索: /s 关键词 (需 TAVILY_API_KEY, 没接时会老实说未接入)
// GitHub: /gh 用户名/仓库名 查仓库动态
// 定时: 控制台给 Worker 加两条 Cron 触发器: "0 0 * * *" (UTC, 每天北京时间 08:00 早报)
//   和 "*/15 * * * *" (每 15 分钟检查到期提醒)
// 存储: KV (绑定名 BOT_KV) 存会话记忆/长期记忆/人设/提醒/盯梢/白名单主人/每日计数/模型选择
//
// 环境变量 (在 Workers 设置里填, 不要写进代码):
//   BOT_TOKEN        必需, BotFather 的 token (密钥)
//   DEEPSEEK_API_KEY DeepSeek 官方 key (密钥); 有它默认大脑就是 DeepSeek
//   GROQ_API_KEY     Groq 的 key (密钥); Groq 聊天 + 看图用
//   TAVILY_API_KEY   可选 (密钥), Tavily 搜索 key; 没有则 /s 提示未接入
//   ALLOWED_IDS      可选, 逗号分隔的 Telegram 数字 ID; 空 = 第一个 /start 的人临时认主
//   DEEPSEEK_MODEL   可选, 覆盖 DeepSeek 日常模型名, 默认 deepseek-chat
//   GROQ_MODEL       可选, 覆盖 GPT-OSS 120B 模型名 (也兼容旧变量名 AI_MODEL)
//   VISION_MODEL     可选, 默认 qwen/qwen3.8-27b (Scout/Maverick 已被 Groq 于 2026 年关停)
//   WEBHOOK_SECRET   可选, 默认 dq686hook (webhook 路径)
// 部署后打开 https://<你的worker地址>/<WEBHOOK_SECRET>/setwebhook 注册 webhook

const NL = String.fromCharCode(10);
const PER_USER_DAILY = 100;
const GLOBAL_DAILY = 2000;
const MEM_ROUNDS = 10;

const HELP = `我是小多, 多情的私人 AI 助手。

【聊天】
直接发消息 = 聊天 (记得最近 10 轮 + 长期记忆, 换模型不丢)
发语音 = 转文字再回答; 发图片 = 看图; 发链接 = 读完总结
发文件 = txt、代码、日志、Word 文档这类我能读懂再回答
记一下 XXX = 让我永久记住 (偏好、项目、暗号都行)
/memory - 看我的长期记忆 (能逐条删)
/new - 清空短期记忆, 开新话题

【大脑】
/model - 切换大脑 (DeepSeek 两档 / GPT-OSS 两档)
/auto - 智能选模型开关 (闲聊走快档, 代码难题走强档)
/persona - 换人设 (代码助手 / 故事编剧 / 翻译官 / 毒舌损友)
/check - 自检四个大脑的死活和延迟
/arena 问题 - 两个模型同答, 并排对比
/retry - 换个模型重答上一题

【工具】
/draw 描述 - 画图
/s 关键词 - 联网搜索 (要先接入搜索 key)
/gh 用户名/仓库名 - 查 GitHub 仓库动态
/remind 30分钟后 内容 - 定时提醒 (也支持 /remind 20:30 内容)
/reminders - 看我有哪些提醒
/watch 网址 - 盯梢网页, 内容变了在早报里告诉你
/audit /explain /refactor - 代码审计 / 讲解 / 重构 (发命令后贴代码)
/tr - 翻译模式 (发命令后贴要翻译的)
/export - 导出我的记忆和聊天记录
/incognito - 假装失忆模式开关 (不读不存记忆)
/status - 我的状态卡
/panel - ✨ 高级面板 (消息里的小程序卡片)
/model - 🧠 看当前用的哪个模型 / 换模型
/tool - 🧩 现做一个消息里能点的小工具 (例: /tool AA分账计算器)
/topics - 🧵 话题工作台 (一键建 工作/日常/灵感/临时 四个独立话题, 记忆互不串)
/stickers - 🎴 我学会的贴纸 (直接发贴纸教我)
/addpack - 🎴 整包添加表情包 (把 t.me/addstickers 链接直接发聊天里也行)
/music 歌名 - 搜歌点歌 (点结果里的数字就发歌; 也可直接说 放+歌名)
/morning - 今日早报
/myid - 我的 Telegram 数字 ID
/settings - ⚙️ 设置面板 (大脑/温度/长度/预算一页搞定)
/usage - 📈 本月 token 用量和费用估算
/temp 0.7 - 创造性 (0 严谨 ~ 2 放飞); /max 2000 - 回复长度上限
/bill - 🧾 账本 (聊天里直接发「午饭35」自动记账; /bill 点评 有 AI 点评)
/todo 周五前交报告 - ✅ 待办; /todos 看清单 (说「周五前…」也会自动记)
/note 内容 - 📝 备忘; /notes 关键词 - 搜备忘
/save 名字 内容 - 💾 存提示词模板; /use 名字 - 调用模板
/tr /sum /fix /en 内容 - 翻译/总结/改错字/转英文 (也可引用消息)
/undo - ↩️ 撤销上一步 (记账/待办/备忘/提醒/模板)
/pin 内容 - 📌 钉住一条重要信息, 每轮聊天都带着; /unpin 取消
/backup - 📦 导出全部数据备份 (每天自动快照留 7 天); /restore 恢复
/habit - 🔥 习惯打卡 (聊天说「打卡 喝水」也行)
/diary - 📔 日记本 (每晚 10 点我会喊你写两句)
关键词直答: 问「还有多久过年」「服务器状态」「用量」直接秒回, 不烧额度

点菜单按钮也能办大部分事, 不用记命令。输入框下面还有一排常驻按钮; 直接给我发贴纸, 我会学会, 聊天对上心情时也会回你一张。`;

const MENU_KB = {
  inline_keyboard: [
    [{ text: "✨ 高级面板", callback_data: "m:panel", style: "primary" }],
    [
      { text: "🎨 画图", callback_data: "m:draw" },
      { text: "🆕 新话题", callback_data: "m:new" },
    ],
    [
      { text: "🧠 换模型", callback_data: "m:model" },
      { text: "🎵 音乐", callback_data: "m:music" },
    ],
    [
      { text: "🔍 搜索", callback_data: "m:search" },
      { text: "☀️ 今日早报", callback_data: "m:morning" },
    ],
    [
      { text: "🐙 查仓库", callback_data: "m:gh" },
      { text: "🎭 人设", callback_data: "m:persona" },
    ],
    [
      { text: "📝 我的记忆", callback_data: "m:memory" },
      { text: "❓ 帮助", callback_data: "m:help" },
    ],
    [
      { text: "🧵 话题", callback_data: "m:topics" },
      { text: "🆔 我的ID", callback_data: "m:myid" },
    ],
  ],
};

// 输入框下方常驻按钮 (回复键盘): 点了就是发一条同名文本, 由 handleUpdate 路由
const REPLY_KB = {
  keyboard: [
    [{ text: "✨ 高级面板" }, { text: "🎵 点歌" }],
    [{ text: "🧠 当前模型" }, { text: "☀️ 今日早报" }],
    [{ text: "🧵 话题" }, { text: "🎨 画图" }],
    [{ text: "🆕 新话题" }, { text: "❓ 帮助" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

const MODEL_KB = {
  inline_keyboard: [
    [
      { text: "🧠 DeepSeek 日常", callback_data: "b:deepseek" },
      { text: "🤔 DeepSeek 深度思考", callback_data: "b:deepseek-pro" },
    ],
    [
      { text: "⚡ GPT-OSS 120B", callback_data: "b:gptoss" },
      { text: "🚀 GPT-OSS 20B", callback_data: "b:gptoss20" },
    ],
    [
      { text: "🌩️ Workers AI", callback_data: "b:cfai" },
      { text: "🌸 Pollinations 兜底", callback_data: "b:polli" },
    ],
    [
      { text: "🔀 OpenRouter", callback_data: "b:openrouter" },
      { text: "🇫🇷 Mistral", callback_data: "b:mistral" },
    ],
    [{ text: "↩️ 返回菜单", callback_data: "m:menu" }],
  ],
};

const FILE_KB = {
  inline_keyboard: [
    [{ text: "📄 把代码存成文件发我", callback_data: "f:file" }],
    [{ text: "🏠 菜单", callback_data: "m:menu" }],
  ],
};

// AI 回复下方常驻按钮: 有代码多一个存文件按钮, 永远有重答+菜单
function replyKb(hasCode) {
  const rows = [];
  if (hasCode) rows.push([{ text: "📄 把代码存成文件发我", callback_data: "f:file" }]);
  rows.push([
    { text: "🔁 换个模型重答", callback_data: "r:retry" },
    { text: "🏠 菜单", callback_data: "m:menu" },
  ]);
  return { inline_keyboard: rows };
}

// ---------- 人设 ----------
const PERSONAS = {
  default: {
    label: "小多本人",
    style: "语气像个机灵靠谱的兄弟, 亲切口语化, 可以适当用一两个 emoji, 不要刷屏。",
  },
  coder: {
    label: "代码助手",
    style: "你当前的人设是硬核代码助手: 先给可运行的完整代码, 再给简短说明; 少寒暄, 不用 emoji, 技术结论要准。",
  },
  story: {
    label: "故事编剧",
    style: "你当前的人设是故事编剧: 想象力拉满, 擅长人物、冲突和悬念, 回复有画面感, 可以适当用 emoji 点缀。",
  },
  translator: {
    label: "翻译官",
    style: "你当前的人设是专业翻译官: 用户发什么就翻译什么 (中英互译为主), 只输出译文, 最多在末尾加一句简短注释; 保留原文格式、代码和技术术语。",
  },
  roast: {
    label: "毒舌损友",
    style: "你当前的人设是嘴贱心善的损友: 可以调侃吐槽、开得起玩笑, 但不许真骂人、不许人身攻击, 关键信息必须给准给全。",
  },
};

const PERSONA_KB = {
  inline_keyboard: [
    [
      { text: "😎 小多本人", callback_data: "p:default" },
      { text: "👨‍💻 代码助手", callback_data: "p:coder" },
    ],
    [
      { text: "📖 故事编剧", callback_data: "p:story" },
      { text: "🌐 翻译官", callback_data: "p:translator" },
    ],
    [{ text: "😏 毒舌损友", callback_data: "p:roast" }],
    [{ text: "↩️ 返回菜单", callback_data: "m:menu" }],
  ],
};

const BRAIN_IDS = ["deepseek", "deepseek-pro", "gptoss", "gptoss20", "cfai", "openrouter", "mistral", "polli"];
const VERSION = "v6.8.3";

// ---------- v6.4 设置 (温度/长度/预算) ----------
function monthKey() {
  const d = new Date();
  return d.getUTCFullYear() + "-" + ("0" + (d.getUTCMonth() + 1)).slice(-2);
}
async function getSettings(env, chatId) {
  const s = { temp: null, max: null, budget: 0, quiet: 0, follow: 1 };
  const raw = await kvGet(env, `set:${chatId}`);
  if (raw) {
    try {
      const j = JSON.parse(raw);
      if (typeof j.temp === "number") s.temp = j.temp;
      if (typeof j.max === "number" && j.max > 0) s.max = j.max;
      if (typeof j.budget === "number" && j.budget > 0) s.budget = j.budget;
      if (typeof j.quiet === "number") s.quiet = j.quiet;
      if (typeof j.follow === "number") s.follow = j.follow;
    } catch {}
  }
  return s;
}
async function saveSettings(env, chatId, s) {
  await kvPut(env, `set:${chatId}`, JSON.stringify(s), 60 * 60 * 24 * 365);
}
async function chatBody(env, chatId, cfg, messages, stream) {
  const st = await getSettings(env, chatId);
  const body = { model: cfg.model, messages };
  if (st.temp != null) body.temperature = st.temp;
  if (st.max) body.max_tokens = st.max;
  if (stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }
  return body;
}

// ---------- v6.4 用量记账 (token + 费用估算) ----------
const PRICE = {
  deepseek: { i: 2, o: 8 },
  "deepseek-pro": { i: 4, o: 16 },
  gptoss: { i: 0, o: 0 },
  gptoss20: { i: 0, o: 0 },
};
function estCost(brainId, pin, pout) {
  const p = PRICE[brainId] || { i: 0, o: 0 };
  return (pin * p.i + pout * p.o) / 1000000;
}
async function readTok(env, key) {
  const raw = await kvGet(env, key);
  if (raw) {
    try { return JSON.parse(raw); } catch {}
  }
  return { i: 0, o: 0, brains: {} };
}
async function recordUsage(env, chatId, brainId, usage) {
  const pin = usage.prompt_tokens || 0;
  const pout = usage.completion_tokens || 0;
  if (!pin && !pout) return;
  const mk = monthKey();
  const mKey = `tok:${mk}`;
  const m = await readTok(env, mKey);
  m.i += pin; m.o += pout;
  const b = m.brains[brainId] || { i: 0, o: 0 };
  b.i += pin; b.o += pout;
  m.brains[brainId] = b;
  await kvPut(env, mKey, JSON.stringify(m), 60 * 60 * 24 * 70);
  const dKey = `tokd:${new Date().toISOString().slice(0, 10)}`;
  const d = await readTok(env, dKey);
  d.i += pin; d.o += pout;
  await kvPut(env, dKey, JSON.stringify(d), 60 * 60 * 24 * 4);
  const st = await getSettings(env, chatId);
  if (st.budget > 0) {
    const total = m.i + m.o;
    const pct = total / st.budget;
    if (pct >= 1) {
      const eco = await kvGet(env, `eco:${chatId}`);
      if (eco !== mk) {
        await kvPut(env, `eco:${chatId}`, mk, 60 * 60 * 24 * 40);
        await sendText(env, chatId, `💰 本月 token 已用 ${total}，超过你设的预算 ${st.budget}，我先切到省钱模式（GPT-OSS 20B 免费档）顶着。你手动 /model 选一次大脑可以解除。`);
      }
    } else if (pct >= 0.8) {
      const wKey = `tokwarn:${mk}:${chatId}`;
      if (!(await kvGet(env, wKey))) {
        await kvPut(env, wKey, "1", 60 * 60 * 24 * 40);
        await sendText(env, chatId, `💰 提醒一下：本月 token 已用 ${total}，到你预算 ${st.budget} 的 80% 了。发 /usage 看明细。`);
      }
    }
  }
}
async function usageText(env, chatId) {
  const mk = monthKey();
  const m = await readTok(env, `tok:${mk}`);
  const d = await readTok(env, `tokd:${new Date().toISOString().slice(0, 10)}`);
  let cost = 0;
  const lines = ["📈 用量与费用（估算）", `今天：输入 ${d.i} / 输出 ${d.o} token`, `本月：输入 ${m.i} / 输出 ${m.o} token`];
  for (const id of Object.keys(m.brains || {})) {
    const bb = m.brains[id];
    const c = estCost(id, bb.i, bb.o);
    cost += c;
    lines.push(`· ${brainConfig(env, id).label}：${bb.i + bb.o} token，约 ¥${c.toFixed(3)}`);
  }
  lines.push(`本月估算花费：约 ¥${cost.toFixed(2)}（DeepSeek 按官方价估算，Groq 两档免费不计费；只统计 v6.4 上线后的对话）`);
  const st = await getSettings(env, chatId);
  if (st.budget > 0) {
    const total = m.i + m.o;
    const pct = Math.floor((total / st.budget) * 100);
    const eco = (await kvGet(env, `eco:${chatId}`)) === mk;
    lines.push(`月预算：${st.budget} token，已用 ${pct}%${eco ? "（省钱模式中）" : ""}`);
  } else {
    lines.push("月预算：未设置（在 /settings 里可以设，超支自动切免费档）");
  }
  return lines.join(NL);
}

// ---------- v6.4 对话自动总结压缩 ----------
async function rollMem(env, chatId, memKey, history, cfg) {
  if (history.length <= MEM_ROUNDS * 2) return history;
  try {
    const keep = history.slice(-12);
    const overflow = history.slice(0, history.length - 12);
    const prev = (await kvGet(env, `sum:${memKey}`)) || "";
    const render = overflow.map((mm) => `${mm.role === "user" ? "主人" : "小多"}：${String(mm.content || "").slice(0, 500)}`).join(NL).slice(-6000);
    const sc = brainConfig(env, "gptoss20").key ? brainConfig(env, "gptoss20") : cfg;
    const prompt = [
      "把下面这段对话压缩成不超过 250 字的中文摘要，保留：聊过的话题、主人的偏好和决定、没聊完的事。不要寒暄，直接给摘要正文。",
      prev ? `已有旧摘要：${prev}` : "",
      "新对话：",
      render,
    ].filter(Boolean).join(NL);
    const r = await fetch(`${sc.base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sc.key}` },
      body: JSON.stringify({ model: sc.model, messages: [{ role: "user", content: prompt }], max_tokens: 400 }),
    });
    if (!r.ok) throw new Error("sum http " + r.status);
    const data = await r.json();
    const digest = (data.choices?.[0]?.message?.content || "").trim().slice(0, 900);
    if (!digest) throw new Error("sum empty");
    await kvPut(env, `sum:${memKey}`, digest, 60 * 60 * 24 * 7);
    return keep;
  } catch (e) {
    console.log("rollMem err", e);
    return history.slice(-MEM_ROUNDS * 2);
  }
}

const TEXT_EXTS = [
  "txt", "md", "markdown", "json", "csv", "log", "py", "js", "ts", "html",
  "htm", "css", "xml", "yml", "yaml", "ini", "sh", "java", "c", "cpp", "h",
  "go", "rs", "php", "sql", "vue",
];

function systemPrompt(brainLabel) {
  return [
    "你是「多情」的私人 AI 助手, 运行在 Telegram 上, 名字叫小多。",
    "用中文回答, 口语化, 直接, 温暖, 简洁实用, 不说废话套话。",
    "你擅长聊天答疑, 写作, 翻译和写代码; 给代码时用代码块, 给完整可运行的版本。",
    "不知道的事情就直说不知道, 不要编造。",
    `你当前使用的大脑模型是 ${brainLabel}。如果被问到你是什么模型, 就如实说这个, 不要自称 GPT-4、ChatGPT 或其他模型。`,
  ].join(NL);
}

// ---------- 长期记忆 (偏好库) ----------
async function getPrefs(env, chatId) {
  const raw = await kvGet(env, `prefs:${chatId}`);
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function setPrefs(env, chatId, arr) {
  await kvPut(env, `prefs:${chatId}`, JSON.stringify(arr.slice(0, 50)));
}

// 完整系统提示词 = 基础人设 + 当前人设风格 + 长期记忆 (失忆模式下不带记忆)
async function buildSystem(env, chatId, brainLabel) {
  const lines = [systemPrompt(brainLabel)];
  const personaId = (await kvGet(env, `persona:${chatId}`)) || "default";
  const P = PERSONAS[personaId] || PERSONAS.default;
  if (P.style) lines.push(P.style);
  lines.push("你自带点歌功能: 主人想听歌时, 他点菜单里的「🎵 音乐」按钮或发 /music 歌名, 你就能把歌以音乐文件的形式发给他听。不要说你放不了音乐、只能发文字, 那是错的。");
  lines.push("你就是 Telegram 机器人小多本人, 不只是聊天模型。你能听懂语音 (主人发来的语音会被转成文字再给你, 永远不要说你听不见、没耳朵), 能看图片, 自带提醒/记账/待办/备忘/点歌/画图功能。主人让你设提醒或记账但说法没对上时, 用一句话告诉他正确说法 (比如: 提醒我 明天9点 交报告), 不要教他写代码自己实现, 更不要声称你做不到。");
  const ghost = (await kvGet(env, `ghost:${chatId}`)) === "1";
  if (!ghost) {
    const prefs = await getPrefs(env, chatId);
    if (prefs.length) {
      lines.push("关于主人的长期记忆 (回答时自然参考, 不要主动复述, 除非正好相关):");
      prefs.slice(0, 30).forEach((p, i) => lines.push(`${i + 1}. ${p}`));
    }
    const pin = await kvGet(env, `pin:${chatId}`);
    if (pin) lines.push(`主人钉住的重要信息 (每一轮都要记牢): ${pin}`);
  }
  return lines.join(NL);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const secret = env.WEBHOOK_SECRET || "dq686hook";
    const path = url.pathname.replace(/^\/+/, "");

    if (request.method === "GET" && (path === "" || path === "health")) {
      return new Response("dq686bot is alive (cloudflare worker v6.8.1)", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    if (request.method === "GET" && path === `${secret}/setwebhook`) {
      const hook = `${url.origin}/${secret}`;
      const res = await tg(env, "setWebhook", { url: hook, drop_pending_updates: true });
      return Response.json({ webhook: hook, telegram: res });
    }
    if (request.method === "POST" && path === secret) {
      let update;
      try {
        update = await request.json();
      } catch {
        return new Response("bad json", { status: 400 });
      }
      ctx.waitUntil(handleUpdate(env, update).catch((e) => console.log("update err", e)));
      return new Response("ok");
    }
    return new Response("not found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        await fireDueReminders(env).catch((e) => console.log("remind err", e));
        await fireDueTodos(env).catch((e) => console.log("todo err", e));
        const owner = [...allowedIds(env)][0];
        if (owner) {
          await maybeChangelog(env, owner).catch((e) => console.log("changelog err", e));
          await flushQuiet(env, owner).catch((e) => console.log("quiet flush err", e));
          if (event.cron === "0 14 * * *") await sendDiaryPrompt(env, owner).catch((e) => console.log("diary err", e));
        }
        if (!event.cron || event.cron === "0 0 * * *") {
          await sendBriefing(env).catch((e) => console.log("briefing err", e));
          if (owner) {
            await dailySnapshot(env, owner).catch((e) => console.log("snapshot err", e));
            await healthCheck(env, owner).catch((e) => console.log("health err", e));
          }
        }
      })()
    );
  },
};


// ---------- v5.8 高级面板 (Bot API 10.4 Widget) ----------
const PANEL_HTML = `<style>
body{margin:0;font-family:-apple-system,sans-serif}
.hd{background:linear-gradient(125deg,#0f3d2e,#1F6B52 55%,#37916f);border-radius:18px;padding:15px;color:#fff;position:relative;overflow:hidden}
.hd:after{content:'';position:absolute;right:-30px;top:-30px;width:110px;height:110px;border-radius:50%;background:rgba(255,255,255,.09)}
.logo{width:42px;height:42px;border-radius:13px;background:rgba(255,255,255,.16);display:flex;align-items:center;justify-content:center;font-size:21px;float:left;margin-right:11px}
.tt{font-size:17px;font-weight:700;letter-spacing:.5px;line-height:42px}
.sub{display:flex;gap:8px;clear:both;padding-top:11px;font-size:12px}
.sub span{background:rgba(255,255,255,.14);border-radius:999px;padding:4px 10px}
.tabs{display:flex;gap:6px;margin:10px 0}
.tabs button{flex:1;padding:9px 2px;font-size:13px;border-radius:12px}
.tabs button.on{background:linear-gradient(125deg,#14532d,#1F6B52);color:#fff}
.bar{height:6px;border-radius:99px;background:var(--tg-theme-secondary-bg-color);margin:11px 1px 5px;overflow:hidden}
.fill{height:100%;border-radius:99px;background:linear-gradient(90deg,#1F6B52,#34a853)}
.barlb{display:flex;justify-content:space-between;font-size:11px;color:var(--tg-theme-hint-color);margin:0 1px 10px}
.cny{background:linear-gradient(125deg,#6d0f0f,#991b1b 50%,#c02626);border-radius:18px;padding:14px;color:#fff;margin-bottom:10px;position:relative;overflow:hidden}
.cny:after{content:'🧧';position:absolute;right:8px;top:2px;font-size:52px;opacity:.16}
.cny .lb{font-size:12px;letter-spacing:3px;opacity:.85}
.cny .row{display:flex;align-items:baseline;gap:6px;margin-top:3px}
.cny b{font-size:38px;color:#fcd34d;line-height:1}
.cny .hms{font-size:13px;opacity:.92;margin-top:5px;letter-spacing:1px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
button{border:0;border-radius:15px;padding:13px 6px;font-size:15px;font-weight:600;background:var(--tg-theme-secondary-bg-color);color:var(--tg-theme-text-color)}
button:active{opacity:.55}
.main{background:linear-gradient(125deg,#14532d,#1F6B52);color:#fff}
.wide{width:100%;margin-top:8px}
.msg{text-align:center;font-size:13px;color:var(--tg-theme-hint-color);min-height:18px;padding-top:8px}
.card{background:var(--tg-theme-secondary-bg-color);border-radius:15px;padding:12px;margin-bottom:8px;font-size:14px}
.crow{display:flex;align-items:center;gap:8px;font-size:13px;margin:7px 0}
.cbar{flex:1;height:8px;border-radius:99px;background:rgba(127,127,127,.25);overflow:hidden}
.cbar i{display:block;height:100%;background:linear-gradient(90deg,#1F6B52,#34a853)}
.ubar i{background:linear-gradient(90deg,#2563eb,#38bdf8)}
.trow{display:flex;align-items:center;gap:8px;background:var(--tg-theme-secondary-bg-color);border-radius:13px;padding:10px;margin-bottom:7px;font-size:14px}
.trow .tx{flex:1}
.trow .due{font-size:11px;color:var(--tg-theme-hint-color)}
.trow button{padding:7px 10px;font-size:13px;border-radius:10px}
input.tin{width:100%;box-sizing:border-box;padding:12px;border-radius:13px;border:1px solid rgba(127,127,127,.4);font-size:15px;margin-bottom:8px;background:transparent;color:var(--tg-theme-text-color)}
.opt{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:6px}
.opt button{padding:10px 4px;font-size:13px;border-radius:12px}
.opt button.on{background:linear-gradient(125deg,#14532d,#1F6B52);color:#fff}
.lb2{font-size:12px;color:var(--tg-theme-hint-color);margin:9px 1px 5px}
.big{font-size:16px;font-weight:700}
</style>
<div class="hd"><div class="logo">✨</div><div class="tt">小多 · 高级面板</div>
<div class="sub"><span id="dt"></span><span id="wx"></span></div></div>
<div class="tabs">
<button data-tab="home">🏠 今日</button>
<button data-tab="bill">🧾 记账</button>
<button data-tab="todo">✅ 待办</button>
<button data-tab="set">⚙️ 设置</button>
</div>
<div id="home">
<div class="bar"><div class="fill" id="fill"></div></div>
<div class="barlb"><span id="c2"></span><span id="c3"></span></div>
<div class="barlb"><span id="cB"></span></div>
<div class="cny"><div class="lb">距 离 过 年</div><div class="row"><b id="cny">--</b><span>天 · 大年初一</span></div><div class="hms" id="hms"></div></div>
<div class="grid">
<button class="main" id="bBrief">☀️ 今日早报</button>
<button id="bMusic">🎵 点歌</button>
<button id="bPersona">🎭 换人设</button>
<button id="bNew">🆕 新话题</button>
</div>
</div>
<div id="persona" style="display:none">
<div class="grid" id="plist"></div>
<button class="wide" id="bBack">↩️ 返回面板</button>
</div>
<div id="bill" style="display:none">
<div class="card"><span class="big" id="bM"></span><div id="bDW" style="margin-top:5px;font-size:13px"></div></div>
<div class="lb2">本月分类</div>
<div class="card" id="cats"></div>
<div class="lb2">近 7 天 token 用量</div>
<div class="card" id="u7"></div>
<div class="lb2">最近记账</div>
<div class="card" id="brec"></div>
</div>
<div id="todo" style="display:none">
<input class="tin" id="tdin" placeholder="输入待办, 比如: 周五前交报告">
<button class="wide main" id="tdadd" style="margin:0 0 10px">➕ 添加待办</button>
<div id="tdlist"></div>
<div class="msg" id="tdmsg"></div>
</div>
<div id="set" style="display:none">
<div class="lb2">🧠 大脑</div>
<div class="opt" id="sbrains">
<button data-wsb="deepseek">🧠 DeepSeek</button>
<button data-wsb="deepseek-pro">🤔 深度思考</button>
<button data-wsb="gptoss">⚡ GPT-OSS 120B</button>
<button data-wsb="gptoss20">🚀 GPT-OSS 20B</button>
<button data-wsb="cfai">🌩️ Workers AI</button>
<button data-wsb="polli">🌸 Pollinations</button>
<button data-wsb="openrouter">🔀 OpenRouter</button>
<button data-wsb="mistral">🇫🇷 Mistral</button>
</div>
<button class="wide" id="wsauto">🤖 智能选模型</button>
<div class="lb2">🌡️ 温度</div>
<div class="opt">
<button data-wst="0.3">0.3 严谨</button>
<button data-wst="0.7">0.7 日常</button>
<button data-wst="1.2">1.2 放飞</button>
</div>
<div class="lb2">📏 回复长度上限</div>
<div class="opt">
<button data-wsm="800">短 800</button>
<button data-wsm="2000">中 2000</button>
<button data-wsm="4000">长 4000</button>
<button data-wsm="0">不限</button>
</div>
<div class="lb2">💰 月 token 预算</div>
<div class="opt">
<button data-wsbg="0">关</button>
<button data-wsbg="100000">10万</button>
<button data-wsbg="500000">50万</button>
<button data-wsbg="1000000">100万</button>
</div>
</div>
<div class="msg" id="msg"></div>
<script>
var S={};
var PS=[['default','😎 小多本人'],['coder','👨‍💻 代码助手'],['story','📖 故事编剧'],['translator','🌐 翻译官'],['roast','😏 毒舌损友']];
function parse(s){try{return JSON.parse(s||'{}')}catch(e){return{}}}
function pad(n){return (n<10?'0':'')+n}
function tick(){
 if(!S.cnts)return;
 var diff=Math.floor(S.cnts-Date.now()/1000);
 if(diff<0)diff=0;
 var d=Math.floor(diff/86400),h=Math.floor(diff%86400/3600),m=Math.floor(diff%3600/60),s=diff%60;
 document.getElementById('cny').textContent=d;
 document.getElementById('hms').textContent='还剩 '+h+' 小时 '+m+' 分 '+pad(s)+' 秒';
}
function esc(t){return String(t||'').replace(/</g,'&lt;')}
function draw(read){
 if(read)S=parse(TelegramWidget.chatData);
 document.getElementById('dt').textContent='🗓 '+(S.dt||'');
 var wx=document.getElementById('wx');
 if(S.wx){wx.textContent='🌤 '+S.wx;wx.style.display=''}else{wx.style.display='none'}
 document.getElementById('c2').textContent='🎭 当前人设 · '+(S.pn||'小多本人');
 document.getElementById('c3').textContent='今日额度 '+(S.use||0)+'/'+(S.mx||100);
 document.getElementById('cB').textContent='🧠 当前模型 · '+(S.br||'');
 var pct=Math.min(100,Math.round((S.use||0)/(S.mx||100)*100));
 document.getElementById('fill').style.width=pct+'%';
 document.getElementById('cny').textContent=(S.cny==null?'--':S.cny);
 tick();
 var cur=S.pg||'home';
 var pages=['home','persona','bill','todo','set'];
 for(var i=0;i<pages.length;i++)document.getElementById(pages[i]).style.display=(pages[i]===cur)?'block':'none';
 var tab=(cur==='persona')?'home':cur;
 var tabs=document.querySelectorAll('[data-tab]');
 for(var t2=0;t2<tabs.length;t2++)tabs[t2].className=(tabs[t2].getAttribute('data-tab')===tab)?'on':'';
 if(cur==='persona'){
  var htm='';
  for(var i2=0;i2<PS.length;i2++)htm+='<button data-ps="'+PS[i2][0]+'">'+PS[i2][1]+'</button>';
  document.getElementById('plist').innerHTML=htm;
  var bs=document.querySelectorAll('[data-ps]');
  for(var j=0;j<bs.length;j++)bs[j].onclick=function(){say('换好啦 🎭');req('ps:'+this.getAttribute('data-ps'))};
 }
 if(cur==='bill'&&S.bl){
  document.getElementById('bM').textContent='本月支出 ¥'+S.bl.m;
  document.getElementById('bDW').textContent='今日 ¥'+S.bl.d+' · 本周 ¥'+S.bl.w+' · 本月收入 ¥'+S.bl.inc;
  var ch='';
  for(var c=0;c<S.bl.cats.length;c++)ch+='<div class="crow"><span style="width:38px">'+esc(S.bl.cats[c][0])+'</span><span class="cbar"><i style="width:'+S.bl.cats[c][2]+'%"></i></span><span>¥'+S.bl.cats[c][1]+'</span></div>';
  document.getElementById('cats').innerHTML=ch||'本月还没记账';
  var uh='';
  for(var u=0;u<(S.u7||[]).length;u++)uh+='<div class="crow"><span style="width:38px">'+S.u7[u][0]+'</span><span class="cbar ubar"><i style="width:'+S.u7[u][2]+'%"></i></span><span>'+S.u7[u][1]+'</span></div>';
  document.getElementById('u7').innerHTML=uh||'暂无数据';
  var rh='';
  for(var r2=0;r2<(S.bl.rec||[]).length;r2++)rh+='<div class="crow"><span style="flex:1">'+esc(S.bl.rec[r2][0])+'</span><span>'+S.bl.rec[r2][1]+'</span></div>';
  document.getElementById('brec').innerHTML=rh||'暂无';
 }
 if(cur==='todo'){
  var th='';
  var list=S.td||[];
  for(var d=0;d<list.length;d++)th+='<div class="trow"><span class="tx">'+esc(list[d][1])+(list[d][2]?'<div class="due">'+list[d][2]+'</div>':'')+'</span><button data-tdd="'+list[d][0]+'">✅</button><button data-tdx="'+list[d][0]+'">❌</button></div>';
  document.getElementById('tdlist').innerHTML=th||'<div class="card">没有未完成的待办 🎉</div>';
  document.getElementById('tdmsg').textContent=(S.tdt!=null)?('未完成 '+S.tdt+' 件 · 已完成 '+(S.tdn||0)+' 件'):'';
  var db=document.querySelectorAll('[data-tdd]');
  for(var d2=0;d2<db.length;d2++)db[d2].onclick=function(){req('tdd:'+this.getAttribute('data-tdd'))};
  var xb=document.querySelectorAll('[data-tdx]');
  for(var d3=0;d3<xb.length;d3++)xb[d3].onclick=function(){req('tdx:'+this.getAttribute('data-tdx'))};
 }
 if(cur==='set'&&S.st){
  var bb=document.querySelectorAll('[data-wsb]');
  for(var b=0;b<bb.length;b++)bb[b].className=(bb[b].getAttribute('data-wsb')===S.st.brid)?'on':'';
  var au=document.getElementById('wsauto');
  au.textContent='🤖 智能选模型：'+(S.st.auto?'开':'关');
  au.className='wide'+(S.st.auto?' main':'');
  var tb=document.querySelectorAll('[data-wst]');
  for(var b2=0;b2<tb.length;b2++)tb[b2].className=(parseFloat(tb[b2].getAttribute('data-wst'))===S.st.temp)?'on':'';
  var mb=document.querySelectorAll('[data-wsm]');
  for(var b3=0;b3<mb.length;b3++)mb[b3].className=(parseInt(mb[b3].getAttribute('data-wsm'),10)===(S.st.max||0))?'on':'';
  var gb=document.querySelectorAll('[data-wsbg]');
  for(var b4=0;b4<gb.length;b4++)gb[b4].className=(parseInt(gb[b4].getAttribute('data-wsbg'),10)===(S.st.budget||0))?'on':'';
 }
}
function say(t){document.getElementById('msg').textContent=t||''}
function apply(a){if(a&&a.result){var n=parse(a.result);if(n&&(n.pg||n.pn)){S=n;draw(false)}}}
function req(d){TelegramWidget.request(d).then(function(a){apply(a)},function(e){say('出错了, 再点一次试试')})}
var tabs2=document.querySelectorAll('[data-tab]');
for(var q=0;q<tabs2.length;q++)tabs2[q].onclick=function(){req('pg:'+this.getAttribute('data-tab'))};
document.getElementById('bBrief').onclick=function(){say('早报在下面 👇');req('act:brief')};
document.getElementById('bMusic').onclick=function(){say('在下面直接发歌名就行 🎵');req('act:music')};
document.getElementById('bPersona').onclick=function(){req('pg:persona')};
document.getElementById('bNew').onclick=function(){say('记忆清空啦, 重新聊 🆕');req('act:new')};
document.getElementById('bBack').onclick=function(){req('pg:home')};
document.getElementById('tdadd').onclick=function(){var v=document.getElementById('tdin').value.replace(/^\s+|\s+$/g,'');if(!v){say('先输入待办内容');return}document.getElementById('tdin').value='';say('加上啦 ✅');req('tda:'+encodeURIComponent(v))};
document.getElementById('wsauto').onclick=function(){req('wsa')};
var wb=document.querySelectorAll('[data-wsb]');
for(var w=0;w<wb.length;w++)wb[w].onclick=function(){say('大脑切换中 🧠');req('wsb:'+this.getAttribute('data-wsb'))};
var wt=document.querySelectorAll('[data-wst]');
for(var w2=0;w2<wt.length;w2++)wt[w2].onclick=function(){req('wst:'+this.getAttribute('data-wst'))};
var wm=document.querySelectorAll('[data-wsm]');
for(var w3=0;w3<wm.length;w3++)wm[w3].onclick=function(){req('wsm:'+this.getAttribute('data-wsm'))};
var wg=document.querySelectorAll('[data-wsbg]');
for(var w4=0;w4<wg.length;w4++)wg[w4].onclick=function(){req('wsbg:'+this.getAttribute('data-wsbg'))};
if(TelegramWidget.onEvent)TelegramWidget.onEvent('chatDataChanged',function(){draw(true)});
draw(true);
setInterval(tick,1000);
TelegramWidget.request('refresh').then(function(a){apply(a)},function(e){});
if(TelegramWidget.ready)TelegramWidget.ready();
</script>`;

const PANEL_LITE = `<style>
body{margin:0;font-family:-apple-system,sans-serif}
.hd{background:linear-gradient(125deg,#0f3d2e,#1F6B52 55%,#37916f);border-radius:18px;padding:15px;color:#fff;position:relative;overflow:hidden}
.hd:after{content:'';position:absolute;right:-30px;top:-30px;width:110px;height:110px;border-radius:50%;background:rgba(255,255,255,.09)}
.logo{width:42px;height:42px;border-radius:13px;background:rgba(255,255,255,.16);display:flex;align-items:center;justify-content:center;font-size:21px;float:left;margin-right:11px}
.tt{font-size:17px;font-weight:700;letter-spacing:.5px;line-height:42px}
.sub{display:flex;gap:8px;clear:both;padding-top:11px;font-size:12px}
.sub span{background:rgba(255,255,255,.14);border-radius:999px;padding:4px 10px}
.bar{height:6px;border-radius:99px;background:var(--tg-theme-secondary-bg-color);margin:11px 1px 5px;overflow:hidden}
.fill{height:100%;border-radius:99px;background:linear-gradient(90deg,#1F6B52,#34a853)}
.barlb{display:flex;justify-content:space-between;font-size:11px;color:var(--tg-theme-hint-color);margin:0 1px 10px}
.cny{background:linear-gradient(125deg,#6d0f0f,#991b1b 50%,#c02626);border-radius:18px;padding:14px;color:#fff;margin-bottom:10px;position:relative;overflow:hidden}
.cny:after{content:'🧧';position:absolute;right:8px;top:2px;font-size:52px;opacity:.16}
.cny .lb{font-size:12px;letter-spacing:3px;opacity:.85}
.cny .row{display:flex;align-items:baseline;gap:6px;margin-top:3px}
.cny b{font-size:38px;color:#fcd34d;line-height:1}
.cny .hms{font-size:13px;opacity:.92;margin-top:5px;letter-spacing:1px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
button{border:0;border-radius:15px;padding:13px 6px;font-size:15px;font-weight:600;background:var(--tg-theme-secondary-bg-color);color:var(--tg-theme-text-color)}
button:active{opacity:.55}
.main{background:linear-gradient(125deg,#14532d,#1F6B52);color:#fff}
.wide{width:100%;margin-top:8px}
.msg{text-align:center;font-size:13px;color:var(--tg-theme-hint-color);min-height:18px;padding-top:8px}
</style>
<div class="hd"><div class="logo">✨</div><div class="tt">小多 · 高级面板</div>
<div class="sub"><span id="dt"></span><span id="wx"></span></div></div>
<div id="home">
<div class="bar"><div class="fill" id="fill"></div></div>
<div class="barlb"><span id="c2"></span><span id="c3"></span></div>
<div class="barlb"><span id="cB"></span></div>
<div class="cny"><div class="lb">距 离 过 年</div><div class="row"><b id="cny">--</b><span>天 · 大年初一</span></div><div class="hms" id="hms"></div></div>
<div class="grid">
<button class="main" id="bBrief">☀️ 今日早报</button>
<button id="bMusic">🎵 点歌</button>
<button id="bPersona">🎭 换人设</button>
<button id="bNew">🆕 新话题</button>
</div>
</div>
<div id="persona" style="display:none">
<div class="grid" id="plist"></div>
<button class="wide" id="bBack">↩️ 返回面板</button>
</div>
<div class="msg" id="msg"></div>
<script>
var S={};
var PS=[['default','😎 小多本人'],['coder','👨‍💻 代码助手'],['story','📖 故事编剧'],['translator','🌐 翻译官'],['roast','😏 毒舌损友']];
function parse(s){try{return JSON.parse(s||'{}')}catch(e){return{}}}
function pad(n){return (n<10?'0':'')+n}
function tick(){
 if(!S.cnts)return;
 var diff=Math.floor(S.cnts-Date.now()/1000);
 if(diff<0)diff=0;
 var d=Math.floor(diff/86400),h=Math.floor(diff%86400/3600),m=Math.floor(diff%3600/60),s=diff%60;
 document.getElementById('cny').textContent=d;
 document.getElementById('hms').textContent='还剩 '+h+' 小时 '+m+' 分 '+pad(s)+' 秒';
}
function draw(read){
 if(read)S=parse(TelegramWidget.chatData);
 document.getElementById('dt').textContent='🗓 '+(S.dt||'');
 var wx=document.getElementById('wx');
 if(S.wx){wx.textContent='🌤 '+S.wx;wx.style.display=''}else{wx.style.display='none'}
 document.getElementById('c2').textContent='🎭 当前人设 · '+(S.pn||'小多本人');
 document.getElementById('c3').textContent='今日额度 '+(S.use||0)+'/'+(S.mx||100);
 document.getElementById('cB').textContent='🧠 当前模型 · '+(S.br||'');
 var pct=Math.min(100,Math.round((S.use||0)/(S.mx||100)*100));
 document.getElementById('fill').style.width=pct+'%';
 document.getElementById('cny').textContent=(S.cny==null?'--':S.cny);
 tick();
 var per=(S.pg==='persona');
 document.getElementById('home').style.display=per?'none':'block';
 document.getElementById('persona').style.display=per?'block':'none';
 if(per){
  var htm='';
  for(var i=0;i<PS.length;i++)htm+='<button data-ps="'+PS[i][0]+'">'+PS[i][1]+'</button>';
  document.getElementById('plist').innerHTML=htm;
  var bs=document.querySelectorAll('[data-ps]');
  for(var j=0;j<bs.length;j++)bs[j].onclick=function(){say('换好啦 🎭');req('ps:'+this.getAttribute('data-ps'))};
 }
}
function say(t){document.getElementById('msg').textContent=t||''}
function apply(a){if(a&&a.result){var n=parse(a.result);if(n&&(n.pg||n.pn)){S=n;draw(false)}}}
function req(d){TelegramWidget.request(d).then(function(a){apply(a)},function(e){say('出错了, 再点一次试试')})}
document.getElementById('bBrief').onclick=function(){say('早报在下面 👇');req('act:brief')};
document.getElementById('bMusic').onclick=function(){say('在下面直接发歌名就行 🎵');req('act:music')};
document.getElementById('bPersona').onclick=function(){req('pg:persona')};
document.getElementById('bNew').onclick=function(){say('记忆清空啦, 重新聊 🆕');req('act:new')};
document.getElementById('bBack').onclick=function(){req('pg:home')};
if(TelegramWidget.onEvent)TelegramWidget.onEvent('chatDataChanged',function(){draw(true)});
draw(true);
setInterval(tick,1000);
TelegramWidget.request('refresh').then(function(a){apply(a)},function(e){});
if(TelegramWidget.ready)TelegramWidget.ready();
</script>`;

async function panelState(env, chatId, userId, pg) {
  const personaId = (await kvGet(env, `persona:${chatId}`)) || "default";
  const brainLabel = brainConfig(env, await getBrain(env, chatId)).label;
  const autoOn = (await kvGet(env, `auto:${chatId}`)) === "1";
  const day = new Date().toISOString().slice(0, 10);
  const use = parseInt((await kvGet(env, `cnt:${day}:u${userId}`)) || "0", 10);
  const bj = new Date(Date.now() + 8 * 3600 * 1000);
  const today = Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate());
  let cny = Math.round((Date.UTC(2027, 1, 6) - today) / 86400000);
  if (cny < 0) cny = Math.round((Date.UTC(2028, 0, 26) - today) / 86400000);
  const dt = new Date().toLocaleDateString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  let wx = (await kvGet(env, "wx:cache")) || "";
  if (!wx) {
    try {
      const wr = await fetch(
        "https://api.open-meteo.com/v1/forecast?latitude=26.08&longitude=119.28&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=Asia%2FShanghai&forecast_days=1"
      );
      if (wr.ok) {
        const wd = await wr.json();
        wx = `福州 ${weatherLabel(wd.daily.weather_code[0])} ${Math.round(wd.daily.temperature_2m_min[0])}~${Math.round(wd.daily.temperature_2m_max[0])}°C`;
        await kvPut(env, "wx:cache", wx, 1800);
      }
    } catch {}
  }
  const cnts = Math.floor((cny >= 0 ? Date.UTC(2027, 1, 6) : Date.UTC(2028, 0, 26)) / 1000) - 8 * 3600;
  const out = {
    pg: pg || "home",
    pn: (PERSONAS[personaId] || PERSONAS.default).label,
    br: brainLabel + (autoOn ? " · 智能选" : ""),
    cny,
    cnts,
    use,
    mx: PER_USER_DAILY,
    dt,
    wx,
  };
  if (pg === "bill") {
    try {
      const list = await getBills(env, chatId);
      const s = billSums(list, Date.now());
      const cats = Object.entries(s.cats).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const cmx = cats.length ? cats[0][1] : 1;
      out.bl = {
        d: s.d.toFixed(2), w: s.w.toFixed(2), m: s.m.toFixed(2), inc: s.inc.toFixed(2),
        cats: cats.map(([k, v]) => [k, v.toFixed(2), Math.max(4, Math.round((v / cmx) * 100))]),
        rec: list.slice(-5).reverse().map((b) => [b.note, (b.inc ? "+" : "-") + "¥" + b.amt]),
      };
      const u7 = [];
      for (let i = 6; i >= 0; i--) {
        const dkey = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
        const tk = await readTok(env, `tokd:${dkey}`);
        u7.push([dkey.slice(5), tk.i + tk.o]);
      }
      const umx = Math.max(1, ...u7.map((x) => x[1]));
      out.u7 = u7.map(([l, v]) => [l, v, v ? Math.max(4, Math.round((v / umx) * 100)) : 0]);
    } catch {}
  }
  if (pg === "todo") {
    try {
      const list = await getTodos(env, chatId);
      const open = list.filter((x) => !x.done).sort((a, b) => (a.due || 9e15) - (b.due || 9e15));
      out.td = open.slice(0, 8).map((x) => [x.id, x.text, x.due ? fmtTimeCst(x.due) : ""]);
      out.tdn = list.length - open.length;
      out.tdt = open.length;
    } catch {}
  }
  if (pg === "set") {
    try {
      const st2 = await getSettings(env, chatId);
      out.st = {
        brid: (await kvGet(env, `brain:${chatId}`)) || "",
        auto: (await kvGet(env, `auto:${chatId}`)) === "1" ? 1 : 0,
        temp: st2.temp, max: st2.max || 0, budget: st2.budget,
      };
    } catch {}
  }
  return JSON.stringify(out);
}

async function sendPanel(env, chatId, userId) {
  const st = await panelState(env, chatId, userId, "home");
  const r = await tg(env, "sendWidget", {
    chat_id: chatId,
    html: PANEL_HTML,
    chat_data: st,
    allow_queries: true,
    caption: "✨ 小多高级面板 · 卡片里的按钮都能点",
  });
  if (r && r.ok) return;
  console.log("sendWidget full failed", r && r.description);
  const r2 = await tg(env, "sendWidget", {
    chat_id: chatId,
    html: PANEL_LITE,
    chat_data: st,
    allow_queries: true,
    caption: "✨ 小多高级面板（简洁版）",
  });
  if (r2 && r2.ok) return;
  console.log("sendWidget lite failed", r2 && r2.description);
  await sendText(env, chatId, `高级面板没打开，TG 给的原因：${(r2 && r2.description) || (r && r.description) || "未知"}。先用经典菜单 👇`, undefined, MENU_KB);
}

async function handleWidgetQuery(env, wq) {
  const userId = wq.from?.id;
  const chatId = wq.chat?.id;
  const data = wq.data || "";
  const answer = (d) =>
    tg(env, "answerWidgetQuery", { widget_query_id: wq.id, ...(d ? { data: d } : {}) });
  if (userId == null || chatId == null || !(await isAllowed(env, userId))) {
    await answer();
    return;
  }
  try {
    if (data === "refresh") {
      await answer(await panelState(env, chatId, userId, "home"));
    } else if (data.startsWith("pg:")) {
      const want = data.slice(3);
      const pg = ["home", "persona", "bill", "todo", "set"].includes(want) ? want : "home";
      const st = await panelState(env, chatId, userId, pg);
      await tg(env, "editMessageWidgetData", { chat_id: chatId, message_id: wq.message_id, chat_data: st });
      await answer(st);
    } else if (data.startsWith("tda:")) {
      const txt = decodeURIComponent(data.slice(4)).trim();
      if (txt) {
        const p = parseDue(txt);
        const list = await getTodos(env, chatId);
        const it = { id: uid(), text: p.text || txt, due: p.due, done: false, ts: Date.now() };
        list.push(it);
        await setTodos(env, chatId, list);
        await pushUndo(env, chatId, { kind: "todo", id: it.id });
      }
      const st = await panelState(env, chatId, userId, "todo");
      await tg(env, "editMessageWidgetData", { chat_id: chatId, message_id: wq.message_id, chat_data: st });
      await answer(st);
    } else if (data.startsWith("tdd:") || data.startsWith("tdx:")) {
      const id = data.slice(4);
      const list = await getTodos(env, chatId);
      const it = list.find((x) => x.id === id);
      if (it) {
        if (data.startsWith("tdd:")) it.done = true;
        else list.splice(list.indexOf(it), 1);
        await setTodos(env, chatId, list);
      }
      const st = await panelState(env, chatId, userId, "todo");
      await tg(env, "editMessageWidgetData", { chat_id: chatId, message_id: wq.message_id, chat_data: st });
      await answer(st);
    } else if (data.startsWith("wsb:")) {
      const target = data.slice(4);
      if (BRAIN_IDS.includes(target) && brainConfig(env, target).key) {
        await kvPut(env, `brain:${chatId}`, target);
        if (env.BOT_KV) await env.BOT_KV.delete(`eco:${chatId}`);
      }
      const st = await panelState(env, chatId, userId, "set");
      await tg(env, "editMessageWidgetData", { chat_id: chatId, message_id: wq.message_id, chat_data: st });
      await answer(st);
    } else if (data === "wsa") {
      const cur = (await kvGet(env, `auto:${chatId}`)) === "1";
      await kvPut(env, `auto:${chatId}`, cur ? "0" : "1");
      const st = await panelState(env, chatId, userId, "set");
      await tg(env, "editMessageWidgetData", { chat_id: chatId, message_id: wq.message_id, chat_data: st });
      await answer(st);
    } else if (data.startsWith("wst:") || data.startsWith("wsm:") || data.startsWith("wsbg:")) {
      const st0 = await getSettings(env, chatId);
      if (data.startsWith("wst:")) st0.temp = parseFloat(data.slice(4));
      else if (data.startsWith("wsm:")) { const n = parseInt(data.slice(4), 10); st0.max = n > 0 ? n : null; }
      else st0.budget = parseInt(data.slice(5), 10) || 0;
      await saveSettings(env, chatId, st0);
      const st = await panelState(env, chatId, userId, "set");
      await tg(env, "editMessageWidgetData", { chat_id: chatId, message_id: wq.message_id, chat_data: st });
      await answer(st);
    } else if (data.startsWith("ps:")) {
      const pid = data.slice(3);
      if (PERSONAS[pid]) await kvPut(env, `persona:${chatId}`, pid);
      const st = await panelState(env, chatId, userId, "home");
      await tg(env, "editMessageWidgetData", { chat_id: chatId, message_id: wq.message_id, chat_data: st });
      await answer(st);
    } else if (data === "act:brief") {
      await answer();
      await sendText(env, chatId, await briefingText(env, chatId));
    } else if (data === "act:music") {
      await answer();
      await kvPut(env, `awaitmusic:${chatId}`, "1", 300);
      await sendText(env, chatId, "想听啥? 直接发歌名给我, 比如: 入戏太深");
    } else if (data === "act:new") {
      await answer();
      if (env.BOT_KV) await env.BOT_KV.delete(`mem:${chatId}`);
      if (env.BOT_KV) await env.BOT_KV.delete(`sum:${chatId}`);
    } else {
      await answer();
    }
  } catch (e) {
    console.log("widget query err", e);
    try { await answer(); } catch {}
  }
}

// ---------- Telegram ----------
async function tg(env, method, payload) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await r.json();
  } catch (e) {
    console.log(`tg ${method} failed`, e);
    return null;
  }
}

function splitChunks(body) {
  const chunks = [];
  let rest = body;
  while (rest.length > 4000) {
    let cut = rest.lastIndexOf(NL, 4000);
    if (cut < 500) cut = 4000;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
    while (rest.startsWith(NL)) rest = rest.slice(1);
  }
  chunks.push(rest);
  return chunks;
}

async function sendText(env, chatId, text, replyTo, replyMarkup, useMd, threadId) {
  const chunks = splitChunks(text || "(空回复)");
  for (let i = 0; i < chunks.length; i++) {
    const payload = { chat_id: chatId, text: chunks[i] };
    if (threadId && i === 0) payload.message_thread_id = threadId;
    if (replyTo && i === 0) payload.reply_to_message_id = replyTo;
    if (replyMarkup && i === chunks.length - 1) payload.reply_markup = replyMarkup;
    if (useMd) {
      const res = await tg(env, "sendMessage", { ...payload, parse_mode: "Markdown" });
      if (res && res.ok) continue;
    }
    await tg(env, "sendMessage", payload);
  }
}

async function sendPhoto(env, chatId, bytes, caption) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption.slice(0, 1000));
  form.append("photo", new Blob([bytes], { type: "image/jpeg" }), "draw.jpg");
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      body: form,
    });
    return await r.json();
  } catch (e) {
    console.log("sendPhoto failed", e);
    return null;
  }
}

async function sendDocument(env, chatId, content, filename, caption) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption.slice(0, 1000));
  form.append(
    "document",
    new Blob([content], { type: "text/plain; charset=utf-8" }),
    filename
  );
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendDocument`, {
      method: "POST",
      body: form,
    });
    return await r.json();
  } catch (e) {
    console.log("sendDocument failed", e);
    return null;
  }
}

// ---------- 思考气泡: 先占位, 再把占位编辑成正式回复 ----------
async function sendPlaceholder(env, chatId, text, replyTo, threadId) {
  const payload = { chat_id: chatId, text };
  if (threadId) payload.message_thread_id = threadId;
  if (replyTo) payload.reply_to_message_id = replyTo;
  const res = await tg(env, "sendMessage", payload);
  return res?.result?.message_id || null;
}

async function editOrSend(env, chatId, messageId, text, replyMarkup, useMd) {
  const body = text || "(空回复)";
  if (!messageId) {
    await sendText(env, chatId, body, undefined, replyMarkup, useMd);
    return;
  }
  const chunks = splitChunks(body);
  const first = { chat_id: chatId, message_id: messageId, text: chunks[0] };
  if (chunks.length === 1 && replyMarkup) first.reply_markup = replyMarkup;
  let edited = false;
  if (useMd) {
    const r1 = await tg(env, "editMessageText", { ...first, parse_mode: "Markdown" });
    if (r1 && r1.ok) edited = true;
  }
  if (!edited) {
    const r2 = await tg(env, "editMessageText", first);
    edited = !!(r2 && r2.ok);
  }
  if (!edited) {
    await sendText(env, chatId, body, undefined, replyMarkup, useMd);
    return;
  }
  if (chunks.length > 1) {
    await sendText(env, chatId, chunks.slice(1).join(NL), undefined, replyMarkup, useMd);
  }
}

// ---------- v6.0 富文本交付 / 反应表情 ----------
async function sendRich(env, chatId, markdown, replyMarkup, quoteOpts, threadId) {
  const body = String(markdown || "").slice(0, 32000);
  if (!body.trim()) return null;
  const payload = { chat_id: chatId, rich_message: { markdown: body } };
  if (threadId) payload.message_thread_id = threadId;
  if (replyMarkup) payload.reply_markup = replyMarkup;
  if (quoteOpts && quoteOpts.message_id) {
    payload.reply_parameters = { message_id: quoteOpts.message_id };
    if (quoteOpts.quote) {
      payload.reply_parameters.quote = quoteOpts.quote;
      if (quoteOpts.quote_entities) payload.reply_parameters.quote_entities = quoteOpts.quote_entities;
    }
  }
  const res = await tg(env, "sendRichMessage", payload);
  return res && res.ok ? res.result : null;
}

async function reactTo(env, chatId, messageId, emoji) {
  if (!messageId) return;
  try {
    await tg(env, "setMessageReaction", {
      chat_id: chatId,
      message_id: messageId,
      reaction: [{ type: "emoji", emoji }],
    });
  } catch {}
}

// 流式聊天的最终交付: 优先富文本气泡, 失败退回普通 Markdown 消息
async function deliverStreamReply(env, chatId, reply, userText, quoteOpts, threadId) {
  const blocks = extractBlocks(reply);
  if (blocks.length) await kvPut(env, `lastcode:${chatId}`, JSON.stringify(blocks), 60 * 60);
  const sent = await sendRich(env, chatId, reply, undefined, quoteOpts, threadId);
  if (!sent) await sendText(env, chatId, reply, undefined, undefined, true, threadId);
  const wantFile = (userText || "").includes("文件");
  const huge = blocks.some((b) => b.code.length > 3000);
  if (blocks.length && (wantFile || huge)) await sendBlocksAsFiles(env, chatId, blocks);
  await maybeFollowups(env, chatId, userText, reply, threadId);
}

// ---------- KV 小工具 (未绑定 KV 时全部降级) ----------
async function kvGet(env, key) {
  if (!env.BOT_KV) return null;
  try {
    return await env.BOT_KV.get(key);
  } catch {
    return null;
  }
}
async function kvPut(env, key, value, ttlSec) {
  if (!env.BOT_KV) return;
  try {
    const opts = ttlSec ? { expirationTtl: ttlSec } : undefined;
    await env.BOT_KV.put(key, value, opts);
  } catch (e) {
    console.log("kv put failed", e);
  }
}

// ---------- 权限与额度 ----------
function allowedIds(env) {
  return new Set(
    String(env.ALLOWED_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

async function isAllowed(env, userId) {
  const allow = allowedIds(env);
  if (allow.size > 0) return allow.has(String(userId));
  const owner = await kvGet(env, "owner");
  return owner === String(userId);
}

async function quotaTake(env, userId) {
  if (!env.BOT_KV) return true;
  const day = new Date().toISOString().slice(0, 10);
  const gKey = `cnt:${day}:total`;
  const uKey = `cnt:${day}:u${userId}`;
  const total = parseInt((await kvGet(env, gKey)) || "0", 10);
  const mine = parseInt((await kvGet(env, uKey)) || "0", 10);
  if (total >= GLOBAL_DAILY || mine >= PER_USER_DAILY) return false;
  await kvPut(env, gKey, String(total + 1), 60 * 60 * 26);
  await kvPut(env, uKey, String(mine + 1), 60 * 60 * 26);
  return true;
}

// ---------- 大脑 (四档可切换) ----------

// ---------- v6.8 大脑池: 统一调用层 (OpenAI 格式 / Workers AI 绑定) ----------
async function brainFetch(env, cfg, body) {
  if (cfg.provider === "cfai") {
    try {
      if (!env.AI) return { ok: false, status: 0 };
      const input = { messages: body.messages };
      if (typeof body.temperature === "number") input.temperature = body.temperature;
      if (typeof body.max_tokens === "number") input.max_tokens = body.max_tokens;
      const out = await env.AI.run(cfg.model, input);
      const text = (out && out.response) || "";
      if (!text) return { ok: false, status: 0 };
      const usage = out && out.usage ? { prompt_tokens: out.usage.prompt_tokens || 0, completion_tokens: out.usage.completion_tokens || 0 } : null;
      return { ok: true, data: { choices: [{ message: { content: text } }], usage } };
    } catch (e) {
      return { ok: false, status: 0 };
    }
  }
  try {
    const r = await fetch(`${cfg.base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) return { ok: false, status: r.status };
    return { ok: true, data: await r.json() };
  } catch (e) {
    return { ok: false, status: 0 };
  }
}

function brainConfig(env, brain) {
  const dsBase = (env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
  const gqBase = "https://api.groq.com/openai/v1";
  switch (brain) {
    case "deepseek":
      return {
        id: "deepseek",
        label: "DeepSeek 日常",
        base: dsBase,
        model: env.DEEPSEEK_MODEL || "deepseek-chat",
        key: env.DEEPSEEK_API_KEY || "",
      };
    case "deepseek-pro":
      return {
        id: "deepseek-pro",
        label: "DeepSeek 深度思考",
        base: dsBase,
        model: env.DEEPSEEK_PRO_MODEL || "deepseek-reasoner",
        key: env.DEEPSEEK_API_KEY || "",
      };
    case "gptoss20":
      return {
        id: "gptoss20",
        label: "GPT-OSS 20B (Groq 免费)",
        base: gqBase,
        model: "openai/gpt-oss-20b",
        key: env.GROQ_API_KEY || "",
      };
    case "cfai":
      return { id: "cfai", label: "Workers AI · Llama 3.3 (免费)", provider: "cfai", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", key: env.AI ? "binding" : "" };
    case "polli":
      return { id: "polli", label: "Pollinations 兜底 (免费)", base: "https://text.pollinations.ai/openai", model: "openai", key: "public" };
    case "openrouter":
      return { id: "openrouter", label: "OpenRouter 免费池", base: "https://openrouter.ai/api/v1", model: env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free", key: env.OPENROUTER_KEY || "" };
    case "mistral":
      return { id: "mistral", label: "Mistral (免费档)", base: "https://api.mistral.ai/v1", model: env.MISTRAL_MODEL || "mistral-small-latest", key: env.MISTRAL_KEY || "" };
    default:
      return {
        id: "gptoss",
        label: "GPT-OSS 120B (Groq 免费)",
        base: gqBase,
        model: env.GROQ_MODEL || env.AI_MODEL || "openai/gpt-oss-120b",
        key: env.GROQ_API_KEY || "",
      };
  }
}

async function getBrain(env, chatId) {
  const eco = await kvGet(env, `eco:${chatId}`);
  if (eco && eco === monthKey() && brainConfig(env, "gptoss20").key) return "gptoss20";
  const saved = await kvGet(env, `brain:${chatId}`);
  if (saved && BRAIN_IDS.includes(saved) && (await brainCooled(env, saved))) {
    const alt = ["gptoss", "gptoss20", "cfai", "openrouter", "mistral", "deepseek", "deepseek-pro", "polli"].find((id) => id !== saved && brainConfig(env, id).key);
    if (alt) return alt;
  }
  if (BRAIN_IDS.includes(saved) && brainConfig(env, saved).key) return saved;
  if (env.DEEPSEEK_API_KEY) return "deepseek";
  return "gptoss";
}

async function aiChat(env, chatId, userText, historyText, opts = {}) {
  const memKey = (opts && opts.memKey) || `mem:${chatId}`;
  const ghost = (await kvGet(env, `ghost:${chatId}`)) === "1";
  let brain = opts.brain || null;
  if (!brain) {
    const auto = (await kvGet(env, `auto:${chatId}`)) === "1";
    if (auto) brain = pickAutoBrain(env, userText);
  }
  if (!brain) brain = await getBrain(env, chatId);
  let cfg = brainConfig(env, brain);
  let fellBack = false;
  if (!cfg.key) {
    const order = ["deepseek", "gptoss", "cfai", "gptoss20", "openrouter", "mistral", "polli", "deepseek-pro"];
    const altId = order.find((id) => id !== brain && brainConfig(env, id).key);
    if (altId) {
      brain = altId;
      cfg = brainConfig(env, altId);
      fellBack = true;
    } else {
      throw new Error("no ai key configured");
    }
  }
  let history = [];
  if (!ghost) {
    const raw = await kvGet(env, memKey);
    if (raw) {
      try {
        history = JSON.parse(raw);
      } catch {
        history = [];
      }
    }
  }
  const digest = ghost ? "" : (await kvGet(env, `sum:${memKey}`)) || "";
  const messages = [
    { role: "system", content: await buildSystem(env, chatId, cfg.label) },
    ...(digest ? [{ role: "system", content: `你们早先聊过的内容摘要 (背景参考, 别主动复述): ${digest}` }] : []),
    ...history,
    { role: "user", content: userText },
  ];
  const t0 = Date.now();
  const res = await brainFetch(env, cfg, await chatBody(env, chatId, cfg, messages, false));
  let data = null;
  if (!res.ok) {
    if (res.status === 402 || res.status === 429) {
      try { await kvPut(env, `cool:${cfg.id}`, String(Date.now()), 3600); } catch {}
    }
    if (res.status !== 401 && res.status !== 402) {
      const altOrder = ["gptoss", "cfai", "deepseek", "gptoss20", "openrouter", "mistral", "deepseek-pro", "polli"];
      for (const altId of altOrder) {
        if (altId === cfg.id) continue;
        const alt = brainConfig(env, altId);
        if (!alt.key) continue;
        if (await brainCooled(env, altId)) continue;
        try {
          const res2 = await brainFetch(env, alt, await chatBody(env, chatId, alt, messages, false));
          if (res2.ok) { data = res2.data; cfg = alt; brain = altId; fellBack = true; break; }
          if (res2.status === 402 || res2.status === 429) { try { await kvPut(env, `cool:${altId}`, String(Date.now()), 3600); } catch {} }
        } catch {}
      }
    }
    if (!data) {
      const err = new Error(`AI HTTP ${res.status}`);
      err.status = res.status;
      err.brain = cfg.id;
      throw err;
    }
  } else {
    data = res.data;
  }
  if (data.usage) { try { await recordUsage(env, chatId, cfg.id, data.usage); } catch {} }
  let reply = (data.choices?.[0]?.message?.content || "").trim();
  const ms = Date.now() - t0;
  await kvPut(
    env,
    `last:${chatId}`,
    JSON.stringify({ brain: cfg.id, ms, at: Date.now() }),
    60 * 60 * 24 * 7
  );
  if (!ghost) {
    history.push(
      { role: "user", content: historyText || userText },
      { role: "assistant", content: reply }
    );
    history = await rollMem(env, chatId, memKey, history, cfg);
    await kvPut(env, memKey, JSON.stringify(history), 60 * 60 * 24 * 7);
  }
  if (opts.plain) {
    await kvPut(
      env,
      `lastq:${chatId}`,
      JSON.stringify({ text: historyText || userText, brain: cfg.id }),
      60 * 60 * 24
    );
  }
  if (fellBack) reply += `${NL}${NL}(先用 ${cfg.label} 回你, 你选的那个大脑还没接好)`;
  return reply;
}


// ---------- v5.9 流式聊天: SSE 逐字读, onPartial 回调推草稿 ----------
async function aiChatStream(env, chatId, userText, historyText, opts, onPartial) {
  const memKey = (opts && opts.memKey) || `mem:${chatId}`;
  const ghost = (await kvGet(env, `ghost:${chatId}`)) === "1";
  let brain = (opts && opts.brain) || null;
  if (!brain) {
    const auto = (await kvGet(env, `auto:${chatId}`)) === "1";
    if (auto) brain = pickAutoBrain(env, userText);
  }
  if (!brain) brain = await getBrain(env, chatId);
  let cfg = brainConfig(env, brain);
  let fellBack = false;
  if (!cfg.key) {
    const order = ["deepseek", "gptoss", "cfai", "gptoss20", "openrouter", "mistral", "polli", "deepseek-pro"];
    const altId = order.find((id) => id !== brain && brainConfig(env, id).key);
    if (altId) {
      brain = altId;
      cfg = brainConfig(env, altId);
      fellBack = true;
    } else {
      throw new Error("no ai key configured");
    }
  }
  let history = [];
  if (!ghost) {
    const raw = await kvGet(env, memKey);
    if (raw) {
      try { history = JSON.parse(raw); } catch { history = []; }
    }
  }
  const digest = ghost ? "" : (await kvGet(env, `sum:${memKey}`)) || "";
  const messages = [
    { role: "system", content: await buildSystem(env, chatId, cfg.label) },
    ...(digest ? [{ role: "system", content: `你们早先聊过的内容摘要 (背景参考, 别主动复述): ${digest}` }] : []),
    ...history,
    { role: "user", content: userText },
  ];
  if (cfg.provider === "cfai" || cfg.id === "polli") {
    const reply2 = await aiChat(env, chatId, userText, historyText, { ...(opts || {}), brain: cfg.id });
    if (onPartial) { try { await onPartial(reply2); } catch {} }
    return reply2;
  }
  const t0 = Date.now();
  const r = await fetch(`${cfg.base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify(await chatBody(env, chatId, cfg, messages, true)),
  });
  if (!r.ok || !r.body) {
    const altId = ["gptoss", "cfai", "deepseek", "gptoss20", "openrouter", "mistral", "polli"].find((id) => id !== cfg.id && brainConfig(env, id).key);
    if (altId && r.status !== 401 && r.status !== 402) {
      const reply2 = await aiChat(env, chatId, userText, historyText, { ...(opts || {}), brain: altId });
      if (onPartial) { try { await onPartial(reply2); } catch {} }
      return reply2;
    }
    const err = new Error(`AI HTTP ${r.status}`);
    err.status = r.status;
    err.brain = cfg.id;
    throw err;
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let reply = "";
  let lastPush = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split(NL);
    buf = lines.pop() || "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload);
        if (j.usage) { try { await recordUsage(env, chatId, cfg.id, j.usage); } catch {} }
        const piece = j.choices?.[0]?.delta?.content || "";
        if (piece) reply += piece;
      } catch {}
    }
    const now = Date.now();
    if (reply && onPartial && now - lastPush >= 800) {
      lastPush = now;
      if (opts && opts.stopCheck) {
        let stopNow = false;
        try { stopNow = await opts.stopCheck(); } catch {}
        if (stopNow) {
          try { await reader.cancel(); } catch {}
          break;
        }
      }
      try { await onPartial(reply); } catch {}
    }
  }
  reply = reply.trim();
  if (!reply) {
    const altId = ["gptoss", "cfai", "deepseek", "gptoss20", "openrouter", "mistral", "polli"].find((id) => id !== cfg.id && brainConfig(env, id).key);
    if (altId) {
      const reply2 = await aiChat(env, chatId, userText, historyText, { ...(opts || {}), brain: altId });
      if (onPartial) { try { await onPartial(reply2); } catch {} }
      return reply2;
    }
    throw new Error("empty stream reply");
  }
  const ms = Date.now() - t0;
  await kvPut(env, `last:${chatId}`, JSON.stringify({ brain: cfg.id, ms, at: Date.now() }), 60 * 60 * 24 * 7);
  if (!ghost) {
    history.push(
      { role: "user", content: historyText || userText },
      { role: "assistant", content: reply }
    );
    history = await rollMem(env, chatId, memKey, history, cfg);
    await kvPut(env, memKey, JSON.stringify(history), 60 * 60 * 24 * 7);
  }
  if (opts && opts.plain) {
    await kvPut(env, `lastq:${chatId}`, JSON.stringify({ text: historyText || userText, brain: cfg.id }), 60 * 60 * 24);
  }
  if (fellBack) reply += `${NL}${NL}(先用 ${cfg.label} 回你, 你选的那个大脑还没接好)`;
  return reply;
}

function bufToB64(buf) {
  let bin = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

async function aiVision(env, imageBuf, prompt) {
  // Groq 已关停 Llama 4 Scout (2026-07-17) / Maverick (2026-03-09); 现役多模态是 Qwen 3.8 27B
  const models = [];
  if (env.VISION_MODEL) models.push(env.VISION_MODEL);
  for (const m of ["qwen/qwen3.8-27b", "qwen/qwen3.6-27b", "meta-llama/llama-4-scout-17b-16e-instruct"]) {
    if (!models.includes(m)) models.push(m);
  }
  const b64 = bufToB64(imageBuf);
  let lastErr = null;
  for (const model of models) {
    try {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
              ],
            },
          ],
        }),
      });
      if (!r.ok) {
        lastErr = new Error(`vision HTTP ${r.status} @${model}`);
        continue;
      }
      const data = await r.json();
      const out = (data.choices?.[0]?.message?.content || "").trim();
      if (out) return out;
      lastErr = new Error(`vision empty @${model}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("vision failed");
}

// ---------- 语音转文字 (Groq Whisper) ----------
async function transcribeAudio(env, buf) {
  if (env.GROQ_API_KEY) {
    try {
      const form = new FormData();
      form.append("file", new Blob([buf], { type: "audio/ogg" }), "voice.ogg");
      form.append("model", env.WHISPER_MODEL || "whisper-large-v3-turbo");
      form.append("response_format", "json");
      form.append("language", "zh");
      const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
        body: form,
      });
      if (!r.ok) throw new Error(`whisper HTTP ${r.status}`);
      const data = await r.json();
      const t = (data.text || "").trim();
      if (t) return t;
    } catch (e) { console.log("groq whisper err, try cf", e); }
  }
  if (env.AI) {
    const out = await env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio: Array.from(new Uint8Array(buf)) });
    const t2 = ((out && out.text) || "").trim();
    if (t2) return t2;
  }
  throw new Error("whisper all failed");
}

// ---------- Word (.docx) 文本提取: docx 是 zip, 取出 document.xml 去标签 ----------
async function extractDocxText(buf) {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  let off = 0;
  let xmlBytes = null;
  while (off + 30 <= bytes.length) {
    if (view.getUint32(off, true) !== 0x04034b50) break;
    const method = view.getUint16(off + 8, true);
    const compSize = view.getUint32(off + 18, true);
    const fnLen = view.getUint16(off + 26, true);
    const exLen = view.getUint16(off + 28, true);
    const name = new TextDecoder().decode(bytes.slice(off + 30, off + 30 + fnLen));
    const dataStart = off + 30 + fnLen + exLen;
    if (name === "word/document.xml") {
      const comp = bytes.slice(dataStart, dataStart + compSize);
      if (method === 8) {
        const stream = new Blob([comp]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        xmlBytes = new Uint8Array(await new Response(stream).arrayBuffer());
      } else {
        xmlBytes = comp;
      }
      break;
    }
    off = dataStart + compSize;
  }
  if (!xmlBytes) throw new Error("docx: document.xml not found");
  const xml = new TextDecoder("utf-8").decode(xmlBytes);
  return xml
    .replace(/<\/w:p>/g, NL)
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

async function drawImage(env, prompt) {
  const q = encodeURIComponent(prompt);
  try {
    const r = await fetch(
      `https://image.pollinations.ai/prompt/${q}?width=1024&height=1024&nologo=true`,
      { headers: { "User-Agent": "dq686bot/5.0" } }
    );
    if (!r.ok) throw new Error(`draw HTTP ${r.status}`);
    return await r.arrayBuffer();
  } catch (e) {
    if (env && env.AI) {
      const out = await env.AI.run("@cf/black-forest-labs/flux-1-schnell", { prompt, steps: 6 });
      if (out && out.image) {
        const bin = atob(out.image);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes.buffer;
      }
    }
    throw e;
  }
}

async function doDraw(env, chatId, userId, prompt, replyTo) {
  if (!(await quotaTake(env, userId))) {
    await sendText(env, chatId, "今天的 AI 额度用完了, 明天再来。", replyTo);
    return;
  }
  await sendText(env, chatId, "收到, 正在画, 大概十几秒...", replyTo);
  try {
    const buf = await drawImage(env, prompt);
    const res = await sendPhoto(env, chatId, buf, `🎨 ${prompt}`);
    if (!res || res.ok === false) {
      const q = encodeURIComponent(prompt);
      await sendText(
        env,
        chatId,
        `图画好了但上传失败, 直接打开看: https://image.pollinations.ai/prompt/${q}?width=1024&height=1024&nologo=true`,
        replyTo
      );
    }
  } catch (e) {
    console.log("draw err", e);
    await sendText(env, chatId, "画图接口刚没接住, 换个描述再试一次。", replyTo);
  }
}

// ---------- 代码块 -> 文件 ----------
function extractBlocks(text) {
  const blocks = [];
  const lines = String(text).split(NL);
  let cur = null;
  for (const line of lines) {
    const t = line.trimStart();
    if (t.startsWith("```")) {
      if (cur) {
        blocks.push(cur);
        cur = null;
      } else {
        cur = { lang: t.slice(3).trim().toLowerCase(), lines: [] };
      }
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  if (cur) blocks.push(cur);
  return blocks
    .map((b) => ({ lang: b.lang, code: b.lines.join(NL).trim() }))
    .filter((b) => b.code.length > 0);
}

function filenameFor(block, idx, total) {
  const lang = (block.lang || "").replace(/[^a-z0-9]/g, "");
  const map = {
    html: ["index", "html"],
    python: ["main", "py"],
    py: ["main", "py"],
    javascript: ["script", "js"],
    js: ["script", "js"],
    css: ["style", "css"],
    json: ["data", "json"],
    typescript: ["main", "ts"],
    ts: ["main", "ts"],
    bash: ["script", "sh"],
    shell: ["script", "sh"],
    sh: ["script", "sh"],
  };
  const hit = map[lang];
  const base = hit ? hit[0] : "code";
  const ext = hit ? hit[1] : lang && lang.length <= 5 ? lang : "txt";
  return total > 1 ? `${base}${idx + 1}.${ext}` : `${base}.${ext}`;
}

async function sendBlocksAsFiles(env, chatId, blocks) {
  for (let i = 0; i < blocks.length; i++) {
    const name = filenameFor(blocks[i], i, blocks.length);
    await sendDocument(env, chatId, blocks[i].code, name, `📄 ${name}`);
  }
}

// AI 回复的统一交付: 有代码块就挂文件按钮; 说了"文件"或代码太长就直接发文件
async function deliverAiReply(env, chatId, phId, reply, userText) {
  const blocks = extractBlocks(reply);
  if (!blocks.length && reply.length > 3600) {
    await editOrSend(env, chatId, phId, reply.slice(0, 500) + `${NL}${NL}📄 (全文 ${reply.length} 字太长了, 存成文件发你, 点开看全文)`, undefined, true);
    await sendDocument(env, chatId, reply, "reply.md", "📄 全文");
    return;
  }
  if (blocks.length) {
    await kvPut(env, `lastcode:${chatId}`, JSON.stringify(blocks), 60 * 60);
    const wantFile = (userText || "").includes("文件");
    const huge = blocks.some((b) => b.code.length > 3000);
    if (wantFile || huge) {
      await editOrSend(env, chatId, phId, reply, undefined, true);
      await sendBlocksAsFiles(env, chatId, blocks);
      return;
    }
    await editOrSend(env, chatId, phId, reply, undefined, true);
    return;
  }
  await editOrSend(env, chatId, phId, reply, undefined, true);
  await maybeFollowups(env, chatId, userText, reply, undefined);
}

function chatErrorText(e) {
  if (e.status === 401) return "大脑的 key 验不过 (401), 找 Algo 查。";
  if (e.status === 402) return "DeepSeek 余额不足了。点 🧠 换模型 切到 Groq 免费版先用着。";
  if (e.status === 429) return "问太快被限流了, 等一分钟再试。";
  return "我刚走神了, 再说一遍试试。";
}

// ---------- 模型切换 ----------
async function sendModelPicker(env, chatId) {
  const brain = await getBrain(env, chatId);
  const label = brainConfig(env, brain).label;
  const st = (id) => (brainConfig(env, id).key ? "已接入" : "未接入");
  const text = [
    `当前大脑: ${label}`,
    "",
    `🧠 DeepSeek 日常 (${st("deepseek")}) - 中文强, 快问快答`,
    `🤔 DeepSeek 深度思考 (${st("deepseek-pro")}) - 难题慢慢想, 用同一份余额`,
    `⚡ GPT-OSS 120B (${st("gptoss")}) - Groq 免费, 均衡`,
    `🚀 GPT-OSS 20B (${st("gptoss20")}) - Groq 免费, 最快`,
    "",
    "切换不丢聊天记录, 点按钮立刻生效:",
  ].join(NL);
  await sendText(env, chatId, text, undefined, MODEL_KB);
}

async function setBrain(env, chatId, brain) {
  await kvPut(env, `brain:${chatId}`, brain);
  if (env.BOT_KV) await env.BOT_KV.delete(`eco:${chatId}`);
  const label = brainConfig(env, brain).label;
  await sendText(env, chatId, `好, 大脑切到 ${label} 了, 聊天记录照旧, 继续聊吧。`, undefined, MENU_KB);
}




// ---------- v6.6 小件: 卡号校验/每日一句/接口冷却 ----------
function luhnOk(s) {
  let sum = 0;
  let alt = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let n = s.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}
const DAILY_LINES = [
  "冷知识：章鱼有三颗心脏，两颗给鳃，一颗给全身。",
  "冷知识：蜂蜜放几千年都不会变质，考古挖出来的还能吃。",
  "一句话：把简单的事做到极致，就是不简单。",
  "冷知识：打喷嚏时眼睛会不自觉闭上，是身体的保护机制。",
  "一句话：今天多走的每一步，都是给明天的自己省力气。",
  "冷知识：香蕉和人的 DNA 有约 60% 相似。",
  "一句话：想做的事别等有空，空是挤出来的。",
  "冷知识：闪电的温度比太阳表面还高，约三万度。",
  "一句话：钱要花在能长本事和能省时间的地方。",
  "冷知识：考拉每天要睡 20 小时，是睡眠界的冠军。",
  "一句话：记录本身就是一种进步，账记得越细，心里越有数。",
  "冷知识：互联网一分钟大约有 5 亿条消息被发出去。",
  "一句话：不怕慢，就怕站。",
  "冷知识：金鱼的记忆不止 7 秒，能记三个月。",
];
function dailyLine() {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const doy = Math.floor((now.getTime() - start) / 86400000);
  return DAILY_LINES[doy % DAILY_LINES.length];
}
async function brainCooled(env, id) {
  const t = parseInt((await kvGet(env, `cool:${id}`)) || "0", 10);
  return t > 0 && Date.now() - t < 10 * 60 * 1000;
}


// ---------- v6.7: backup/habit/diary/quiet/follow/health/changelog ----------
const RELEASE_NOTE = "服务器2 试了一圈下线了（线路延迟 300 多，太慢），机场恢复服务器1 一台主力；问我「服务器状态」看它就行";
function cstDateStr(ts) {
  return new Date(ts + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function backupKeys(chatId) {
  return [`prefs:${chatId}`, `persona:${chatId}`, `brain:${chatId}`, `auto:${chatId}`, `set:${chatId}`, `pin:${chatId}`, `bill:${chatId}`, `todo:${chatId}`, `note:${chatId}`, `tpl:${chatId}`, `rem:${chatId}`, `habit:${chatId}`, `diary:${chatId}`, `stk:${chatId}`];
}
async function collectBackup(env, chatId) {
  const data = { app: "dq686bot", ver: VERSION, at: Date.now(), kv: {} };
  for (const k of backupKeys(chatId)) {
    const v = await kvGet(env, k);
    if (v != null) data.kv[k] = v;
  }
  return data;
}
async function dailySnapshot(env, chatId) {
  const data = await collectBackup(env, chatId);
  await kvPut(env, `snap:${cstDateStr(Date.now())}`, JSON.stringify(data), 60 * 60 * 24 * 8);
  const cst = new Date(Date.now() + 8 * 3600 * 1000);
  if (cst.getUTCDay() === 0) {
    await sendDocument(env, chatId, JSON.stringify(data, null, 2), `xiaoduo-weekly-backup-${cstDateStr(Date.now())}.json`, "📦 本周冷备份（机器人每周日自动发一份，存好别删）");
  }
}
async function getHabits(env, chatId) {
  const raw = await kvGet(env, `habit:${chatId}`);
  if (!raw) return {};
  try { const j = JSON.parse(raw); return j && typeof j === "object" ? j : {}; } catch { return {}; }
}
async function saveHabits(env, chatId, h) {
  await kvPut(env, `habit:${chatId}`, JSON.stringify(h), 60 * 60 * 24 * 365);
}
function streakOf(days) {
  let n = 0;
  let t = Date.now();
  if (!days[cstDateStr(t)]) t -= 86400000;
  while (days[cstDateStr(t)]) { n++; t -= 86400000; }
  return n;
}
async function habitText(env, chatId) {
const h = await getHabits(env, chatId);
const names = Object.keys(h);
if (!names.length) return "还没有习惯。用 /habit 喝水，运动，存钱 设置一组，每天聊天里说「打卡 喝水」就行。";
const today = cstDateStr(Date.now());
const lines = ["🔥 我的习惯打卡："];
for (const n of names) lines.push(`${h[n].days[today]? "✅": "⬜"} ${n} · 连续 ${streakOf(h[n].days)} 天 · 累计 ${(Object.keys(h[n].days) || []).length} 天`);
lines.push("", "打卡直接说「打卡 习惯名」，不带名字我把没打的列成按钮给你点。改习惯：/habit 新名单（逗号分隔）。");
return lines.join(NL);
}
async function doCheckin(env, chatId, name, threadId) {
const h = await getHabits(env, chatId);
const today = cstDateStr(Date.now());
if (name) {
if (!h[name]) h[name] = { days: {}};
if (h[name].days[today]) { await sendText(env, chatId, `「${name}」今天已经打过卡啦 ✅ 连续 ${streakOf(h[name].days)} 天`, undefined, undefined, false, threadId); return;}
h[name].days[today] = 1;
await saveHabits(env, chatId, h);
await sendText(env, chatId, `✅ 打卡成功：「${name}」连续 ${streakOf(h[name].days)} 天，累计 ${(Object.keys(h[name].days) || []).length} 天`, undefined, undefined, false, threadId);
return;
}
const names = Object.keys(h);
if (!names.length) { await sendText(env, chatId, await habitText(env, chatId), undefined, undefined, false, threadId); return;}
const pending = names.filter((n) =>!h[n].days[today]);
if (!pending.length) { await sendText(env, chatId, "今天的习惯全打完啦 🎉", undefined, undefined, false, threadId); return;}
const kb = { inline_keyboard: pending.map((n) => [{ text: `✅ 打卡：${n}`, callback_data: `hb:${encodeURIComponent(n)}`}])};
await sendText(env, chatId, "今天还没打的（点一下就打上）：", undefined, kb, false, threadId);
}
async function getDiary(env, chatId) {
const raw = await kvGet(env, `diary:${chatId}`);
if (!raw) return {};
try { const j = JSON.parse(raw); return j && typeof j === "object"? j: {};} catch { return {};}
}
async function sendDiaryPrompt(env, chatId) {
await kvPut(env, `diaryask:${chatId}`, cstDateStr(Date.now()), 60 * 60 * 3);
await sendText(env, chatId, "🌙 睡前日记时间：今天过得怎么样？回我几句（3 小时内第一条非命令消息），我帮你记进日记本。发 /diary 看以前的。");
}
async function saveDiaryEntry(env, chatId, text, threadId) {
const d = await getDiary(env, chatId);
const day = cstDateStr(Date.now());
if (!d[day]) d[day] = [];
let tidy = "";
try { tidy = await quickComplete(env, `把下面这段日记整理成通顺的一段话，保留原意、细节和语气，不要加评价：${NL}${text}`);} catch {}
d[day].push({ ts: Date.now(), raw: text, tidy: tidy || ""});
const days = Object.keys(d).sort().slice(-90);
const keep = {};
for (const k of days) keep[k] = d[k];
await kvPut(env, `diary:${chatId}`, JSON.stringify(keep), 60 * 60 * 24 * 365);
if (env.BOT_KV) await env.BOT_KV.delete(`diaryask:${chatId}`);
await sendText(env, chatId, `📔 记好啦（${day}）：${NL}${tidy || text}`, undefined, undefined, false, threadId);
}
async function diaryText(env, chatId, dayArg) {
const d = await getDiary(env, chatId);
const days = Object.keys(d).sort();
if (!days.length) return "日记本还是空的。每晚 10 点我会喊你写两句，也可以随时发 /diary 内容 直接记一段。";
if (dayArg && d[dayArg]) return [`📔 ${dayArg}`,...d[dayArg].map((e) => e.tidy || e.raw)].join(NL + NL);
const show = days.slice(-7);
const out = ["📔 最近的日记（发 /diary 2026-11-12 看某一天全文）："];
for (const day of show) out.push(`${NL}`,...d[day].map((e) => e.tidy || e.raw));
return out.join(NL);
}
function inQuietHours() {
const h = new Date(Date.now() + 8 * 3600 * 1000).getUTCHours();
return h >= 23 || h < 8;
}
async function deliverPush(env, chatId, text) {
try {
const st = await getSettings(env, chatId);
if (st.quiet && inQuietHours()) {
const q = await kvList(env, `quietq:${chatId}`);
q.push({ text, ts: Date.now()});
await kvPut(env, `quietq:${chatId}`, JSON.stringify(q.slice(-20)), 60 * 60 * 24 * 2);
return;
}
} catch {}
await sendText(env, chatId, text);
}
async function flushQuiet(env, chatId) {
const st = await getSettings(env, chatId);
if (st.quiet && inQuietHours()) return;
const q = await kvList(env, `quietq:${chatId}`);
if (!q.length) return;
if (env.BOT_KV) await env.BOT_KV.delete(`quietq:${chatId}`);
await sendText(env, chatId, ["🌙 夜间静音期间攒下的消息：",...q.map((x) => "· " + x.text)].join(NL));
}
async function maybeChangelog(env, chatId) {
const seen = await kvGet(env, "sys:ver");
if (seen === VERSION) return;
await kvPut(env, "sys:ver", VERSION);
await sendText(env, chatId, `🆕 小多升级到 ${VERSION} 啦：${RELEASE_NOTE}。`);
}
async function healthCheck(env, chatId) {
const probs = [];
try {
await kvPut(env, "sys:health", String(Date.now()), 120);
if (!(await kvGet(env, "sys:health"))) probs.push("KV 读写异常");
} catch { probs.push("KV 读写异常");}
for (const id of BRAIN_IDS) {
const cfg = brainConfig(env, id);
if (!cfg.key) continue;
try { await rawComplete(env, id, "ping");} catch (e) { if (!e || e.status!== 429) probs.push(`${cfg.label} 不通（${(e && e.status) || "网络"}）`);}
}
try {
const r = await fetch("https://music-api.gdstudio.xyz/api.php?types=search&source=netease&name=test&count=1");
if (!r.ok) probs.push(`点歌主源异常（${r.status}）`);
} catch { probs.push("点歌主源连不上");}
if (probs.length) await sendText(env, chatId, "🩺 小多每日自检发现问题：" + NL + probs.map((p) => "· " + p).join(NL));
}
async function maybeFollowups(env, chatId, userText, reply, threadId) {
try {
if (!reply || reply.length < 300) return;
const st = await getSettings(env, chatId);
if (!st.follow) return;
const sug = await quickComplete(env, `根据这轮对话，给用户三个能接着问的简短问题或请求，每个不超过 14 个字，只输出三行、一行一个、不要编号不要解释：${NL}用户：${String(userText || "").slice(0, 200)}${NL}AI：${reply.slice(0, 400)}`);
if (!sug) return;
const lines = sug.split(NL).map((s) => s.trim()).filter((s) => s.length >= 2 && s.length <= 22).slice(0, 3);
if (lines.length < 2) return;
const kb = { keyboard: [...lines.map((t) => [{ text: t}]), [{ text: "⌨️ 恢复键盘"}]], resize_keyboard: true};
await sendText(env, chatId, "💡 接着问（点一下就发出去）：", undefined, kb, false, threadId);
} catch {}
}

// ---------- v6.5 生活组: 记账/待办/备忘/模板 + 关键词直答 ----------
const STATUS_URL = "https://104.168.92.194.sslip.io:8444/duoqing/status-cd9b3ebfde.json";
function uid() { return Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); }
async function kvList(env, key) {
  const raw = await kvGet(env, key);
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return []; }
}
async function pushUndo(env, chatId, item) {
  const a = await kvList(env, `undo:${chatId}`);
  a.push(item);
  await kvPut(env, `undo:${chatId}`, JSON.stringify(a.slice(-5)), 60 * 60 * 24);
}
function cstDayStart(ts) {
  const c = new Date(ts + 8 * 3600 * 1000);
  return Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate()) - 8 * 3600 * 1000;
}

// --- 记账 ---
const BILL_CATS = [
  ["餐饮", /饭|餐|吃|面|粉|粥|外卖|奶茶|咖啡|茶|饮料|酒|烟|槟榔|零食|水果|买菜|冰红茶/],
  ["交通", /车|油|打车|地铁|公交|机票|高铁|停车/],
  ["购物", /买|购物|衣服|鞋|淘宝|拼多多|京东|超市/],
  ["通讯", /话费|流量|宽带/],
  ["娱乐", /游戏|电影|会员|充值|皮肤|ktv/i],
  ["居住", /房租|水电|物业|房贷/],
  ["学习", /书|课|教程|学费/],
  ["医疗", /药|医院|看病|体检/],
];
function billCat(note) { for (const [c, re] of BILL_CATS) if (re.test(note)) return c; return "其他"; }
async function getBills(env, chatId) { return kvList(env, `bill:${chatId}`); }
async function addBill(env, chatId, amt, note, income) {
  const list = await getBills(env, chatId);
  const it = { id: uid(), amt, note: note || "", cat: billCat(note || ""), inc: !!income, ts: Date.now() };
  list.push(it);
  await kvPut(env, `bill:${chatId}`, JSON.stringify(list.slice(-500)));
  await pushUndo(env, chatId, { kind: "bill", id: it.id });
  return it;
}
function billSums(list, now) {
  const ds = cstDayStart(now);
  const dm = new Date(now + 8 * 3600 * 1000);
  const ms = Date.UTC(dm.getUTCFullYear(), dm.getUTCMonth(), 1) - 8 * 3600 * 1000;
  const ws = ds - ((dm.getUTCDay() + 6) % 7) * 86400000;
  let d = 0, w = 0, m = 0, inc = 0;
  const cats = {};
  for (const b of list) {
    if (b.inc) { if (b.ts >= ms) inc += b.amt; continue; }
    if (b.ts >= ds) d += b.amt;
    if (b.ts >= ws) w += b.amt;
    if (b.ts >= ms) { m += b.amt; cats[b.cat] = (cats[b.cat] || 0) + b.amt; }
  }
  return { d, w, m, inc, cats };
}
async function billText(env, chatId) {
  const list = await getBills(env, chatId);
  const s = billSums(list, Date.now());
  const lines = ["🧾 账本", `今日支出 ¥${s.d.toFixed(2)} · 本周 ¥${s.w.toFixed(2)} · 本月 ¥${s.m.toFixed(2)}`];
  if (s.inc) lines.push(`本月收入 ¥${s.inc.toFixed(2)} · 净支出 ¥${(s.m - s.inc).toFixed(2)}`);
  const top = Object.entries(s.cats).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (top.length) { lines.push("本月分类:"); for (const [c, v] of top) lines.push(`· ${c} ¥${v.toFixed(2)}`); }
  const recent = list.slice(-5).reverse();
  if (recent.length) { lines.push("最近:"); for (const b of recent) lines.push(`· ${b.inc ? "+" : "-"}¥${b.amt} ${b.note} (${new Date(b.ts + 8 * 3600 * 1000).toISOString().slice(5, 10)})`); }
  return lines.join(NL);
}
function parseBillChat(text) {
  const t = String(text || "").trim();
  if (t.length > 24 || t.startsWith("/") || /听|唱|音乐|歌名/.test(t)) return null;
  let m = t.match(/^(收入|到账|工资|赚了|挣了)\s*(\d+(?:\.\d{1,2})?)\s*(元|块)?\s*(.*)$/);
  if (m) return { amt: parseFloat(m[2]), note: (m[4] || m[1]).trim(), income: true };
  m = t.match(/^(.{1,12}?)\s*(\d+(?:\.\d{1,2})?)\s*(元|块)\s*(.*)$/);
  if (m && !/^\d/.test(m[1])) return { amt: parseFloat(m[2]), note: (m[1] + " " + (m[4] || "")).trim(), income: false };
  m = t.match(/^(.{1,10}?)\s*(\d+(?:\.\d{1,2})?)$/);
  if (m && /[\u4e00-\u9fa5]/.test(m[1]) && !/^\d/.test(m[1])) return { amt: parseFloat(m[2]), note: m[1].trim(), income: false };
  return null;
}

// --- 待办 ---
async function getTodos(env, chatId) { return kvList(env, `todo:${chatId}`); }
async function setTodos(env, chatId, a) { await kvPut(env, `todo:${chatId}`, JSON.stringify(a.slice(-200))); }
function parseDue(text) {
  let s = String(text || "").trim();
  const now = Date.now();
  const dayMs = 86400000;
  const today0 = cstDayStart(now);
  let due = null;
  const wd = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
  const curWd = new Date(now + 8 * 3600 * 1000).getUTCDay();
  let m = s.match(/下周([一二三四五六日天])/);
  if (m) { let add = (wd[m[1]] - curWd + 7) % 7; if (add === 0) add = 7; due = today0 + (add + 7) * dayMs + 9 * 3600000; s = s.replace(m[0], " "); }
  else if ((m = s.match(/周([一二三四五六日天])/))) { const add = (wd[m[1]] - curWd + 7) % 7; due = today0 + add * dayMs + 9 * 3600000; s = s.replace(m[0], " "); }
  else if ((m = s.match(/今天|今晚|明天|明早|明晚|后天/))) { const off = m[0] === "明天" || m[0] === "明早" || m[0] === "明晚" ? 1 : m[0] === "后天" ? 2 : 0; due = today0 + off * dayMs + 9 * 3600000; s = s.replace(m[0], " "); }
  const tm = s.match(/(\d{1,2})[:：](\d{2})|(\d{1,2})点(半|\d{1,2}分?)?/);
  if (tm) {
    const hh = parseInt(tm[1] || tm[3], 10);
    const mm = tm[2] != null ? parseInt(tm[2], 10) : tm[4] === "半" ? 30 : tm[4] ? parseInt(tm[4], 10) : 0;
    let h2 = hh;
    if (/晚上|下午|今晚|明晚/.test(text) && h2 < 12) h2 += 12;
    if (due == null) { due = today0 + h2 * 3600000 + mm * 60000; if (due <= now) due += dayMs; }
    else due = due - 9 * 3600000 + h2 * 3600000 + mm * 60000;
    s = s.replace(tm[0], " ");
  }
  s = s.replace(/\s+/g, " ").replace(/^(前|之前|截止|记得|要)\s*/, "").replace(/前$/, "").trim();
  return { due, text: s };
}
function parseTodoChat(text) {
  const t = String(text || "").trim();
  if (t.length > 30 || t.startsWith("/") || /[吗？?]/.test(t)) return null;
  let body = null;
  if (/^待办[:：]?\s*/.test(t)) body = t.replace(/^待办[:：]?\s*/, "");
  else if (/(周[一二三四五六日天]|明天|后天|今晚|明早).{0,4}前/.test(t)) body = t;
  if (!body) return null;
  const p = parseDue(body);
  if (!p.text || p.text.length < 2) return null;
  return p;
}
async function sendTodos(env, chatId, editId) {
  const list = await getTodos(env, chatId);
  const open = list.filter((x) => !x.done);
  const doneN = list.length - open.length;
  if (!open.length) {
    const t = `✅ 待办全清了${doneN ? `（已完成 ${doneN} 件）` : ""}。发 /todo 内容就能加，比如 /todo 周五前交报告。`;
    if (editId) await editOrSend(env, chatId, editId, t);
    else await sendText(env, chatId, t, undefined, MENU_KB);
    return;
  }
  const sorted = [...open].sort((a, b) => (a.due || 9e15) - (b.due || 9e15));
  const lines = ["✅ 我的待办:", ...sorted.map((x, i) => `${i + 1}. ${x.text}${x.due ? `（${fmtTimeCst(x.due)}）` : ""}`)];
  if (doneN) lines.push(`已完成 ${doneN} 件`);
  const rows = sorted.map((x, i) => [{ text: `✅ 完成第 ${i + 1} 件`, callback_data: `td:done:${x.id}` }, { text: "❌", callback_data: `td:del:${x.id}` }]);
  if (editId) await editOrSend(env, chatId, editId, lines.join(NL), { inline_keyboard: rows });
  else await sendText(env, chatId, lines.join(NL), undefined, { inline_keyboard: rows });
}
async function fireDueTodos(env) {
  const allow = [...allowedIds(env)];
  const chatId = allow[0] || (await kvGet(env, "owner"));
  if (!chatId) return;
  const list = await getTodos(env, chatId);
  const now = Date.now();
  const due = list.filter((x) => !x.done && x.due && x.due <= now && !x.nf);
  if (!due.length) return;
  for (const x of list) if (!x.done && x.due && x.due <= now && !x.nf) x.nf = 1;
  await setTodos(env, chatId, list);
  for (const x of due) await deliverPush(env, chatId, `✅ 待办到时间了：${x.text}（发 /todos 标记完成）`);
}

// --- 备忘 ---
async function getNotes(env, chatId) { return kvList(env, `note:${chatId}`); }
async function addNote(env, chatId, text) {
  const list = await getNotes(env, chatId);
  const it = { id: uid(), text: String(text).slice(0, 500), ts: Date.now() };
  list.push(it);
  await kvPut(env, `note:${chatId}`, JSON.stringify(list.slice(-300)));
  await pushUndo(env, chatId, { kind: "note", id: it.id });
  return it;
}

// --- 模板 ---
async function getTpls(env, chatId) {
  const raw = await kvGet(env, `tpl:${chatId}`);
  if (!raw) return {};
  try { const o = JSON.parse(raw); return o && typeof o === "object" ? o : {}; } catch { return {}; }
}

// --- 快捷 AI (不带记忆) ---
async function quickComplete(env, sys, input) {
  for (const id of ["gptoss20", "gptoss", "deepseek"]) {
    const cfg = brainConfig(env, id);
    if (!cfg.key) continue;
    try {
      const r = await fetch(`${cfg.base}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
        body: JSON.stringify({ model: cfg.model, messages: [{ role: "system", content: sys }, { role: "user", content: input }], max_tokens: 2000 }),
      });
      if (!r.ok) continue;
      const data = await r.json();
      const out = (data.choices?.[0]?.message?.content || "").trim();
      if (out) return out;
    } catch {}
  }
  throw new Error("quick ai unavailable");
}

// --- 自然语言提醒 v2 (在 parseRemind 之上加日期词) ---
function parseRemind2(arg) {
  const s0 = String(arg || "").trim();
  const p = parseRemind(s0);
  if (p) return p;
  let m = s0.match(/^(今天|今晚|明天|明早|明晚|后天)\s*(?:晚上|早上|上午|下午|中午)?\s*(\d{1,2})[:：点](\d{2}|半)?\s*(.*)$/);
  if (m) {
    const off = m[1] === "明天" || m[1] === "明早" || m[1] === "明晚" ? 1 : m[1] === "后天" ? 2 : 0;
    let hh = parseInt(m[2], 10);
    const mm = m[3] === "半" ? 30 : parseInt(m[3] || "0", 10);
    if (/晚|下午/.test(s0) && hh < 12) hh += 12;
    if (/中午/.test(s0) && hh >= 1 && hh <= 2) hh += 12;
    const txt = m[4].replace(/(叫我|喊我|提醒我)+$/, "").trim();
    return { at: cstDayStart(Date.now()) + off * 86400000 + hh * 3600000 + mm * 60000, text: txt || "到点啦" };
  }
  m = s0.match(/^(明天|后天|明早)\s+(.+)$/);
  if (m) {
    const off = m[1] === "后天" ? 2 : 1;
    return { at: cstDayStart(Date.now()) + off * 86400000 + 9 * 3600000, text: m[2].trim() };
  }
  return null;
}

// --- 撤销 ---
async function doUndo(env, chatId) {
  const a = await kvList(env, `undo:${chatId}`);
  const last = a.pop();
  if (!last) { await sendText(env, chatId, "没啥可撤销的。"); return; }
  await kvPut(env, `undo:${chatId}`, JSON.stringify(a), 60 * 60 * 24);
  if (last.kind === "bill") {
    const l = await getBills(env, chatId);
    await kvPut(env, `bill:${chatId}`, JSON.stringify(l.filter((x) => x.id !== last.id)));
    await sendText(env, chatId, "↩️ 撤了刚才那笔账。");
  } else if (last.kind === "todo") {
    const l = await getTodos(env, chatId);
    await setTodos(env, chatId, l.filter((x) => x.id !== last.id));
    await sendText(env, chatId, "↩️ 撤了刚才那条待办。");
  } else if (last.kind === "note") {
    const l = await getNotes(env, chatId);
    await kvPut(env, `note:${chatId}`, JSON.stringify(l.filter((x) => x.id !== last.id)));
    await sendText(env, chatId, "↩️ 撤了刚才那条备忘。");
  } else if (last.kind === "remind") {
    const l = await getReminders(env, chatId);
    await setReminders(env, chatId, l.filter((x) => !(x.at === last.at && x.text === last.text)));
    await sendText(env, chatId, "↩️ 撤了刚才那个提醒。");
  } else if (last.kind === "tpl") {
    const t = await getTpls(env, chatId);
    delete t[last.name];
    await kvPut(env, `tpl:${chatId}`, JSON.stringify(t));
    await sendText(env, chatId, `↩️ 删了模板「${last.name}」。`);
  } else {
    await sendText(env, chatId, "↩️ 撤销了上一步。");
  }
}

// --- 关键词直答 ---
async function serverStatusText() {
  try {
    const r = await fetch(STATUS_URL);
    if (!r.ok) throw new Error("http " + r.status);
    const s = await r.json();
    const ok = (b) => (b ? "✅ 正常" : "🔴 异常");
    const age = Math.floor(Date.now() / 1000) - s.ts;
    return [
      "🖥️ 服务器状态（洛杉矶 · 你的机场）",
      `机场 sing-box：${ok(s.singbox)} · 去广告 DNS：${ok(s.adguard)} · 订阅服务：${ok(s.dqsub)}`,
      `本月流量：${s.total_gb} GB / 2000 GB（${(s.total_gb / 20).toFixed(1)}%）`,
      `磁盘 ${s.disk_pct}% · 内存 ${s.mem_pct}% · 负载 ${s.load1}`,
      `已连续运行 ${s.uptime_days} 天 · 数据 ${age < 90 ? "刚刚" : Math.floor(age / 60) + " 分钟前"}更新`,
    ].join(NL);
  } catch (e) {
    return "服务器状态我暂时读不到（状态接口没响应）。你喊 Algo 本人查，他能直接上服务器看。";
  }
}
function countdownText() {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const days = (y, m, d) => Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86400000);
  return [
    "⏳ 倒计时",
    `🎂 你的 17 岁生日（1月31日）：还有 ${days(2027, 1, 31)} 天`,
    `🧧 过年（2月6日大年初一）：还有 ${days(2027, 2, 6)} 天，除夕是 2月5日`,
    `📶 宝可梦机场到期（12月1日）：还有 ${days(2026, 12, 1)} 天`,
    `🖥️ VPS 到期（2027年11月8日）：还有 ${days(2027, 11, 8)} 天`,
  ].join(NL);
}
async function tryIntent(env, chatId, userId, text, threadId) {
  const t = String(text || "").trim();
  if (t.startsWith("/")) return false;
  if (t.length <= 20 && /过年|春节|除夕/.test(t)) {
    await sendText(env, chatId, countdownText(), undefined, undefined, false, threadId);
    return true;
  }
  if (t.length <= 16 && /倒计时|还有多久|还有多少天/.test(t)) {
    await sendText(env, chatId, countdownText(), undefined, undefined, false, threadId);
    return true;
  }
  if (t.length <= 20 && /(服务器|vps|机场|节点)/i.test(t) && /(状态|怎么样|如何|活着|流量|到期|正常)/.test(t)) {
    await sendText(env, chatId, await serverStatusText(), undefined, undefined, false, threadId);
    return true;
  }
  if (/^(用量|token用量|查用量)$/i.test(t)) {
    await sendText(env, chatId, await usageText(env, chatId), undefined, MENU_KB);
    return true;
  }
  if (t === "面板" || t === "高级面板") {
    await sendPanel(env, chatId, userId);
    return true;
  }
  return false;
}

// ---------- v6.4 设置面板 ----------
function settingsKb(auto, st) {
  return {
    inline_keyboard: [
      [
        { text: "🧠 DeepSeek", callback_data: "st:brain:deepseek" },
        { text: "🤔 深度思考", callback_data: "st:brain:deepseek-pro" },
      ],
      [
        { text: "⚡ GPT-OSS 120B", callback_data: "st:brain:gptoss" },
        { text: "🚀 GPT-OSS 20B", callback_data: "st:brain:gptoss20" },
      ],
      [
        { text: "🌩️ Workers AI", callback_data: "st:brain:cfai" },
        { text: "🌸 Pollinations", callback_data: "st:brain:polli" },
      ],
      [
        { text: "🔀 OpenRouter", callback_data: "st:brain:openrouter" },
        { text: "🇫🇷 Mistral", callback_data: "st:brain:mistral" },
      ],
      [{ text: `🤖 智能选模型：${auto ? "开" : "关"}`, callback_data: "st:auto" }],
      [
        { text: "🌡️ 温度 0.3", callback_data: "st:temp:0.3" },
        { text: "🌡️ 0.7", callback_data: "st:temp:0.7" },
        { text: "🌡️ 1.2", callback_data: "st:temp:1.2" },
      ],
      [
        { text: "📏 短 800", callback_data: "st:max:800" },
        { text: "📏 中 2000", callback_data: "st:max:2000" },
        { text: "📏 长 4000", callback_data: "st:max:4000" },
        { text: "📏 不限", callback_data: "st:max:0" },
      ],
      [
        { text: "💰 预算关", callback_data: "st:budget:0" },
        { text: "💰 10万", callback_data: "st:budget:100000" },
        { text: "💰 50万", callback_data: "st:budget:500000" },
        { text: "💰 100万", callback_data: "st:budget:1000000" },
      ],
      [{ text: `🌙 夜间静音：${st && st.quiet ? "开" : "关"}`, callback_data: "st:quiet" }],
      [{ text: `💡 追问建议：${st && st.follow ? "开" : "关"}`, callback_data: "st:follow" }],
      [{ text: "📈 查看用量", callback_data: "st:usage" }],
    ],
  };
}
async function settingsText(env, chatId) {
  const brain = await getBrain(env, chatId);
  const auto = (await kvGet(env, `auto:${chatId}`)) === "1";
  const eco = (await kvGet(env, `eco:${chatId}`)) === monthKey();
  const st = await getSettings(env, chatId);
  const m = await readTok(env, `tok:${monthKey()}`);
  return [
    "⚙️ 小多设置",
    `大脑：${brainConfig(env, brain).label}${auto ? "（智能选模型开）" : ""}${eco ? "（省钱模式中，手动选大脑可解除）" : ""}`,
    `温度：${st.temp == null ? "默认" : st.temp}（越高越放飞）`,
    `回复长度上限：${st.max ? st.max + " token" : "默认"}`,
    `月 token 预算：${st.budget ? st.budget + `（本月已用 ${m.i + m.o}）` : "未设置"}`,
    `夜间静音（23点-8点提醒先攒着）：${st.quiet ? "开" : "关"}`,
    `追问建议键盘：${st.follow ? "开" : "关"}`,
    "",
    "点按钮直接改，立刻生效。也可用命令：/temp 0.7、/max 2000、/usage。",
  ].join(NL);
}
async function sendSettings(env, chatId, editId) {
  const auto = (await kvGet(env, `auto:${chatId}`)) === "1";
  const text = await settingsText(env, chatId);
  const stForKb = await getSettings(env, chatId);
  const kb = settingsKb(auto, stForKb);
  if (editId) await editOrSend(env, chatId, editId, text, kb);
  else await sendText(env, chatId, text, undefined, kb);
}
async function handleSettingsCallback(env, cq, chatId) {
  const parts = (cq.data || "").split(":");
  const kind = parts[1];
  if (kind === "usage") {
    await sendText(env, chatId, await usageText(env, chatId), undefined, MENU_KB);
    return;
  }
  if (kind === "brain") {
    const target = parts[2];
    if (BRAIN_IDS.includes(target) && brainConfig(env, target).key) {
      await kvPut(env, `brain:${chatId}`, target);
      if (env.BOT_KV) await env.BOT_KV.delete(`eco:${chatId}`);
    }
  } else if (kind === "auto") {
    const cur = (await kvGet(env, `auto:${chatId}`)) === "1";
    await kvPut(env, `auto:${chatId}`, cur ? "0" : "1");
  } else if (kind === "temp") {
    const st = await getSettings(env, chatId);
    st.temp = parseFloat(parts[2]);
    await saveSettings(env, chatId, st);
  } else if (kind === "max") {
    const st = await getSettings(env, chatId);
    const n = parseInt(parts[2], 10);
    st.max = n > 0 ? n : null;
    await saveSettings(env, chatId, st);
  } else if (kind === "budget") {
    const st = await getSettings(env, chatId);
    st.budget = parseInt(parts[2], 10) || 0;
    await saveSettings(env, chatId, st);
  } else if (kind === "quiet") {
    const st = await getSettings(env, chatId);
    st.quiet = st.quiet ? 0 : 1;
    await saveSettings(env, chatId, st);
  } else if (kind === "follow") {
    const st = await getSettings(env, chatId);
    st.follow = st.follow ? 0 : 1;
    await saveSettings(env, chatId, st);
  }
  await sendSettings(env, chatId, cq.message?.message_id);
}

// ---------- 读链接 ----------
function extractFirstUrl(text) {
  const parts = String(text).split(/\s+/);
  for (const p of parts) {
    if (p.startsWith("http://") || p.startsWith("https://")) {
      return p.replace(/[)）】」』。,，、;；]+$/, "");
    }
  }
  return null;
}

async function fetchPageText(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 dq686bot/5.0" },
    redirect: "follow",
  });
  if (!r.ok) throw new Error(`page HTTP ${r.status}`);
  const ct = r.headers.get("content-type") || "";
  const raw = await r.text();
  if (!ct.includes("html") && !ct.includes("text")) return raw.slice(0, 12000);
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12000);
}

// ---------- 联网搜索 (Tavily) ----------
async function tavilySearch(env, query) {
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: env.TAVILY_API_KEY,
      query,
      search_depth: "basic",
      max_results: 5,
      include_answer: false,
    }),
  });
  if (!r.ok) throw new Error(`search HTTP ${r.status}`);
  const data = await r.json();
  const items = (data.results || []).map((it, i) =>
    [`${i + 1}. ${it.title || ""}`, (it.content || "").slice(0, 400), it.url || ""].join(NL)
  );
  return items.join(NL + NL);
}

async function doSearch(env, chatId, userId, q, replyTo) {
  if (!(await quotaTake(env, userId))) {
    await sendText(env, chatId, "今天的 AI 额度用完了, 明天再来。");
    return;
  }
  await tg(env, "sendChatAction", { chat_id: chatId, action: "typing" });
  const phId = await sendPlaceholder(env, chatId, "🔍 小多正在联网搜索…", replyTo);
  try {
    const results = await tavilySearch(env, q);
    if (!results) {
      await editOrSend(env, chatId, phId, "没搜到什么有用的结果, 换个关键词试试。", undefined, false);
      return;
    }
    const prompt = [
      "请根据下面的联网搜索结果, 回答我的问题。",
      `问题: ${q}`,
      "",
      "搜索结果:",
      results,
      "",
      "要求: 用中文回答, 关键事实后面附上来源链接。",
    ].join(NL);
    const reply = await aiChat(env, chatId, prompt, `（联网搜索: ${q}）`);
    await deliverAiReply(env, chatId, phId, reply, q);
  } catch (e) {
    console.log("search err", e);
    await editOrSend(env, chatId, phId, "搜索的时候出了点问题, 稍后再试。", undefined, false);
  }
}

// ---------- GitHub 仓库动态 ----------
async function ghInfo(arg) {
  let slug = String(arg || "").trim();
  slug = slug.replace(/^https?:\/\/github\.com\//, "").replace(/\/+$/, "");
  const parts = slug.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("bad slug");
  const repoPath = `${parts[0]}/${parts[1]}`;
  const headers = { "User-Agent": "dq686bot", Accept: "application/vnd.github+json" };
  const [repoR, commitsR, issuesR] = await Promise.all([
    fetch(`https://api.github.com/repos/${repoPath}`, { headers }),
    fetch(`https://api.github.com/repos/${repoPath}/commits?per_page=3`, { headers }),
    fetch(`https://api.github.com/repos/${repoPath}/issues?per_page=10&state=open`, { headers }),
  ]);
  if (!repoR.ok) throw new Error(`gh HTTP ${repoR.status}`);
  const repo = await repoR.json();
  const lines = [
    `🐙 ${repo.full_name}`,
    repo.description || "",
    `⭐ ${repo.stargazers_count} · 🍴 ${repo.forks_count} · 待处理 issue ${repo.open_issues_count}`,
    `最近推送: ${String(repo.pushed_at || "").slice(0, 10)}`,
  ];
  if (commitsR.ok) {
    const commits = await commitsR.json();
    if (Array.isArray(commits) && commits.length) {
      lines.push("", "最新提交:");
      for (const c of commits) {
        const first = String(c.commit?.message || "").split(NL)[0];
        lines.push(`· ${String(c.sha || "").slice(0, 7)} ${first} (${String(c.commit?.author?.date || "").slice(0, 10)})`);
      }
    }
  }
  if (issuesR.ok) {
    const issues = await issuesR.json();
    const real = (Array.isArray(issues) ? issues : []).filter((i) => !i.pull_request).slice(0, 3);
    if (real.length) {
      lines.push("", "待处理 issue:");
      for (const i of real) lines.push(`· #${i.number} ${i.title}`);
    }
  }
  return lines.filter((l) => l !== "").join(NL);
}

// ---------- 每日早报 ----------
function weatherLabel(code) {
  const map = {
    0: "晴", 1: "多云", 2: "多云", 3: "阴", 45: "雾", 48: "雾",
    51: "毛毛雨", 53: "毛毛雨", 55: "毛毛雨", 61: "小雨", 63: "中雨", 65: "大雨",
    66: "冻雨", 67: "冻雨", 71: "小雪", 73: "中雪", 75: "大雪", 77: "雪粒",
    80: "阵雨", 81: "阵雨", 82: "暴雨阵雨", 85: "阵雪", 86: "阵雪",
    95: "雷阵雨", 96: "雷阵雨伴冰雹", 99: "雷阵雨伴冰雹",
  };
  return map[code] || "多云";
}

// 过年倒计时 (春节 = 2027-02-06 大年初一); 返回一行文本, 过了春节返回 null
function cnyCountdownLine() {
  const DAY = 86400000;
  const bj = new Date(Date.now() + 8 * 3600 * 1000); // Worker 是 UTC, +8 = 北京时间
  const today = Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate());
  const cny = Date.UTC(2027, 1, 6);
  const days = Math.round((cny - today) / DAY);
  if (days > 1) return `🧧 距离过年（2月6日 · 大年初一）还有 ${days} 天。`;
  if (days === 1) return "🧧 明天就过年啦, 今天是除夕, 团圆饭吃起来!";
  if (days === 0) return "🧧 今天就是大年初一! 过年好, 新年快乐, 红包拿来!";
  return null;
}

async function composeBriefing() {
  const dateStr = new Date().toLocaleDateString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  const lines = [`☀️ 早上好, 多情。今天是 ${dateStr}。`];
  try {
    const api =
      "https://api.open-meteo.com/v1/forecast?latitude=26.08&longitude=119.28" +
      "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code" +
      "&timezone=Asia%2FShanghai&forecast_days=1";
    const r = await fetch(api);
    if (r.ok) {
      const d = await r.json();
      const max = Math.round(d.daily.temperature_2m_max[0]);
      const min = Math.round(d.daily.temperature_2m_min[0]);
      const pop = d.daily.precipitation_probability_max?.[0];
      const label = weatherLabel(d.daily.weather_code[0]);
      let w = `福州今天 ${label}, ${min}~${max}°C`;
      if (pop != null) w += `, 降雨概率 ${pop}%`;
      lines.push(w + "。");
      if (max >= 30) lines.push("穿短袖就行, 注意防晒多喝水。");
      else if (max >= 24) lines.push("短袖加件薄外套, 早晚温差大。");
      else if (max >= 17) lines.push("穿件薄外套正好。");
      else if (max >= 10) lines.push("有点凉, 外套穿厚点, 加条围巾更稳。");
      else lines.push("冷, 羽绒服围巾帽子都安排上。");
      if (pop != null && pop >= 50) lines.push("出门记得带伞。");
    }
  } catch (e) {
    console.log("weather err", e);
  }
  const cnyLine = cnyCountdownLine();
  if (cnyLine) lines.push(cnyLine);
  lines.push("", "—— 小多 · 每日早报");
  return lines.join(NL);
}

async function sendBriefing(env) {
  let target = null;
  const allow = [...allowedIds(env)];
  if (allow.length) target = allow[0];
  if (!target) target = await kvGet(env, "owner");
  if (!target) return;
  await sendText(env, target, await briefingText(env, target));
}

// ---------- v5: 智能选模型 ----------
function pickAutoBrain(env, text) {
  const t = String(text || "");
  const has = (id) => !!brainConfig(env, id).key;
  if (/代码|报错|bug|函数|脚本|程序|python|javascript|写个|帮我写/i.test(t) && has("deepseek")) {
    return "deepseek";
  }
  if (/为什么|推理|证明|数学题|逻辑|深度分析|仔细想想|复杂/.test(t) && has("deepseek-pro")) {
    return "deepseek-pro";
  }
  if (t.length <= 30 && has("gptoss20")) return "gptoss20";
  return null; // null = 用当前选定大脑
}

// ---------- v5: 单次调用 (不带记忆, 自检/擂台用) ----------
async function rawComplete(env, brainId, userText) {
  const cfg = brainConfig(env, brainId);
  if (!cfg.key) throw new Error("no key");
  const res = await brainFetch(env, cfg, {
    messages: [
      { role: "system", content: systemPrompt(cfg.label) },
      { role: "user", content: userText },
    ],
  });
  if (!res.ok) {
    const e = new Error(`HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return (res.data.choices?.[0]?.message?.content || "").trim();
}
async function rawCompleteLegacyUnused(env, brainId, userText) {
  const cfg = brainConfig(env, brainId);
  const r = await fetch(`${cfg.base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.key}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: systemPrompt(cfg.label) },
        { role: "user", content: userText },
      ],
    }),
  });
  if (!r.ok) {
    const e = new Error(`HTTP ${r.status}`);
    e.status = r.status;
    throw e;
  }
  const data = await r.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}

// ---------- v5: 四模型自检 ----------
async function doCheck(env, chatId, replyTo) {
  const phId = await sendPlaceholder(env, chatId, "🩺 小多正在自检各个大脑…", replyTo);
  const lines = ["🩺 大脑自检报告:"];
  for (const id of BRAIN_IDS) {
    const cfg = brainConfig(env, id);
    if (!cfg.key) {
      lines.push(`· ${cfg.label}: ⚪ 未接 key`);
      continue;
    }
    const t0 = Date.now();
    try {
      await rawComplete(env, id, "ping");
      lines.push(`· ${cfg.label}: ✅ 活着, 约 ${Date.now() - t0}ms`);
    } catch (e) {
      lines.push(`· ${cfg.label}: ❌ ${e.status ? `HTTP ${e.status}` : "连不上"}`);
    }
  }
  lines.push("", "延迟受当时网络影响, 仅供参考。");
  await editOrSend(env, chatId, phId, lines.join(NL), undefined, false);
}

// ---------- v5: 双模型擂台 ----------
async function doArena(env, chatId, userId, q, replyTo) {
  const ids = ["deepseek", "gptoss"].filter((id) => brainConfig(env, id).key);
  if (ids.length < 2) {
    await sendText(env, chatId, "擂台需要至少两个大脑接了 key, 现在不够, 等 Algo 把 key 配齐。", replyTo);
    return;
  }
  if (!(await quotaTake(env, userId))) {
    await sendText(env, chatId, "今天的 AI 额度用完了, 明天再来。", replyTo);
    return;
  }
  await tg(env, "sendChatAction", { chat_id: chatId, action: "typing" });
  const phId = await sendPlaceholder(env, chatId, "🥊 擂台开始, 两个大脑同答中…", replyTo);
  const results = await Promise.allSettled(ids.map((id) => rawComplete(env, id, q)));
  await editOrSend(
    env,
    chatId,
    phId,
    `🥊 同题擂台: ${q}${NL}两个大脑的答案分开发你, 你自己看谁强。`,
    undefined,
    false
  );
  for (let i = 0; i < ids.length; i++) {
    const cfg = brainConfig(env, ids[i]);
    const res = results[i];
    const body = res.status === "fulfilled" && res.value ? res.value : "(这个大脑没答上来)";
    await sendText(env, chatId, `【${cfg.label}】${NL}${body}`, undefined, undefined, true);
  }
}

// ---------- v5: 换个模型重答上一题 ----------
async function doRetry(env, chatId, userId, replyTo) {
  const raw = await kvGet(env, `lastq:${chatId}`);
  let last = null;
  if (raw) {
    try {
      last = JSON.parse(raw);
    } catch {
      last = null;
    }
  }
  if (!last || !last.text) {
    await sendText(env, chatId, "还没有上一题可以重答, 先跟我聊一句再试。", replyTo);
    return;
  }
  const order = BRAIN_IDS.filter((id) => brainConfig(env, id).key);
  if (!order.length) {
    await sendText(env, chatId, "没有可用的大脑。", replyTo);
    return;
  }
  const next = order[(order.indexOf(last.brain) + 1) % order.length];
  if (!(await quotaTake(env, userId))) {
    await sendText(env, chatId, "今天的 AI 额度用完了, 明天再来。", replyTo);
    return;
  }
  await tg(env, "sendChatAction", { chat_id: chatId, action: "typing" });
  const phId = await sendPlaceholder(
    env,
    chatId,
    `🔁 换 ${brainConfig(env, next).label} 重答中…`,
    replyTo
  );
  try {
    const reply = await aiChat(env, chatId, last.text, undefined, { plain: true, brain: next });
    await deliverAiReply(env, chatId, phId, reply, last.text);
  } catch (e) {
    console.log("retry err", e);
    await editOrSend(env, chatId, phId, chatErrorText(e), undefined, false);
  }
}

// ---------- v5: 定时提醒 ----------
async function getReminders(env, chatId) {
  const raw = await kvGet(env, `rem:${chatId}`);
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a.filter((r) => r && r.at && r.text) : [];
  } catch {
    return [];
  }
}

async function setReminders(env, chatId, arr) {
  await kvPut(env, `rem:${chatId}`, JSON.stringify(arr.slice(0, 30)));
}

function fmtTimeCst(at) {
  return new Date(at).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseRemind(arg) {
  const s = String(arg || "").trim();
  let m = s.match(/^(\d+)\s*(分钟|分|小时|天|h|d)\s+(.+)$/);
  if (m) {
    const n = parseInt(m[1], 10);
    const u = m[2];
    const mult = u === "分钟" || u === "分" ? 60000 : u === "小时" || u === "h" ? 3600000 : 86400000;
    return { at: Date.now() + n * mult, text: m[3].trim() };
  }
  m = s.match(/^(\d{1,2})[:：](\d{2})\s+(.+)$/);
  if (m) {
    const cst = new Date(Date.now() + 8 * 3600 * 1000);
    let at =
      Date.UTC(
        cst.getUTCFullYear(),
        cst.getUTCMonth(),
        cst.getUTCDate(),
        parseInt(m[1], 10),
        parseInt(m[2], 10)
      ) -
      8 * 3600 * 1000;
    if (at <= Date.now()) at += 86400000;
    return { at, text: m[3].trim() };
  }
  return null;
}

async function fireDueReminders(env) {
  const allow = [...allowedIds(env)];
  const chatId = allow[0] || (await kvGet(env, "owner"));
  if (!chatId) return;
  const list = await getReminders(env, chatId);
  if (!list.length) return;
  const now = Date.now();
  const due = list.filter((r) => r.at <= now);
  if (!due.length) return;
  await setReminders(env, chatId, list.filter((r) => r.at > now));
  for (const r of due) {
    await deliverPush(env, chatId, `⏰ 提醒到点啦: ${r.text}`);
  }
}

async function sendRemindersList(env, chatId) {
  const list = await getReminders(env, chatId);
  if (!list.length) {
    await sendText(env, chatId, "你现在没有提醒。发 /remind 30分钟后 喝水 就能加一个。");
    return;
  }
  const sorted = [...list].sort((a, b) => a.at - b.at);
  const lines = ["⏰ 我的提醒:", ...sorted.map((r, i) => `${i + 1}. ${fmtTimeCst(r.at)} - ${r.text}`)];
  const rows = sorted.map((r, i) => [
    { text: `❌ 删第 ${i + 1} 条提醒`, callback_data: `rdel:${list.indexOf(r)}` },
  ]);
  rows.push([{ text: "🏠 菜单", callback_data: "m:menu" }]);
  await sendText(env, chatId, lines.join(NL), undefined, { inline_keyboard: rows });
}

// ---------- v5: 网页盯梢 ----------
function hashText(s) {
  let h = 5381;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return String(h);
}

async function getWatch(env, chatId) {
  const raw = await kvGet(env, `watch:${chatId}`);
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a.filter((w) => w && w.url) : [];
  } catch {
    return [];
  }
}

async function setWatch(env, chatId, arr) {
  await kvPut(env, `watch:${chatId}`, JSON.stringify(arr.slice(0, 5)));
}

async function checkWatchLines(env, chatId) {
  const list = await getWatch(env, chatId);
  if (!list.length) return [];
  const lines = [];
  let changed = false;
  for (const w of list) {
    try {
      const t = await fetchPageText(w.url);
      const h = hashText(t || "");
      if (!w.hash) {
        w.hash = h;
        changed = true;
      } else if (w.hash !== h) {
        w.hash = h;
        changed = true;
        lines.push(`👀 你盯的页面有更新: ${w.url}`);
      }
    } catch {
      // 读不到就跳过, 不误报
    }
  }
  if (changed) await setWatch(env, chatId, list);
  return lines;
}

async function briefingText(env, chatId) {
  const base = await composeBriefing();
  if (!chatId) return base;
  const parts = [base];
  try {
    const todos = (await getTodos(env, chatId)).filter((x) => !x.done);
    const ds = cstDayStart(Date.now());
    const today = todos.filter((x) => x.due && x.due < ds + 86400000);
    if (today.length) parts.push("", "✅ 今日待办:", ...today.slice(0, 5).map((x) => `· ${x.text}`));
    else if (todos.length) parts.push("", `✅ 待办还有 ${todos.length} 件未完成（/todos 看）`);
  } catch {}
  try {
    const bills = await getBills(env, chatId);
    const ds = cstDayStart(Date.now());
    const y = bills.filter((b) => !b.inc && b.ts >= ds - 86400000 && b.ts < ds).reduce((a, b) => a + b.amt, 0);
    if (y > 0) parts.push(`💰 昨天花了 ¥${y.toFixed(2)}`);
  } catch {}
  try {
    const habits = await getHabits(env, chatId);
    const hNames = Object.keys(habits);
    if (hNames.length) {
      const today = cstDateStr(Date.now());
      parts.push(`🔥 今日打卡：${hNames.map((n) => `${n}${habits[n].days[today] ? " ✓" : ""}（连续${streakOf(habits[n].days)}天）`).join(" · ")}`);
    }
  } catch {}
  parts.push("", "💡 " + dailyLine());
  const wl = await checkWatchLines(env, chatId);
  if (wl.length) parts.push("", ...wl);
  return parts.join(NL);
}

// ---------- v5: 人设与记忆的展示 ----------
async function sendPersonaPicker(env, chatId) {
  const cur = (await kvGet(env, `persona:${chatId}`)) || "default";
  const name = (PERSONAS[cur] || PERSONAS.default).label;
  await sendText(
    env,
    chatId,
    `🎭 换人设 (当前: ${name})${NL}点一个立刻变身, 聊天记录和长期记忆都不丢。`,
    undefined,
    PERSONA_KB
  );
}

async function sendMemoryList(env, chatId) {
  const prefs = await getPrefs(env, chatId);
  if (!prefs.length) {
    await sendText(
      env,
      chatId,
      "我的长期记忆还是空的。你说一句「记一下 我喜欢吃辣」这种, 我就永久记住, 以后回答都会参考。"
    );
    return;
  }
  const lines = [
    "📝 我的长期记忆 (我就是靠这些更懂你):",
    ...prefs.map((p, i) => `${i + 1}. ${p}`),
    "",
    "点下面的按钮删单条:",
  ];
  const rows = prefs.map((p, i) => [{ text: `❌ 删第 ${i + 1} 条`, callback_data: `mdel:${i}` }]);
  rows.push([
    { text: "🧹 全部忘掉", callback_data: "mdall" },
    { text: "🏠 菜单", callback_data: "m:menu" },
  ]);
  await sendText(env, chatId, lines.join(NL), undefined, { inline_keyboard: rows });
}

// ---------- v5: 代码工坊 (专家提示词模式) ----------
const WRAPS = {
  audit: {
    name: "代码审计",
    hint: "把要审计的代码整段发我, 我按 语法问题 / 逻辑漏洞 / 安全隐患 / 修复补丁 四段出报告。",
    make: (t) =>
      [
        "请对下面这段内容做一次严格的代码审计, 输出四段: 1) 语法与运行错误; 2) 逻辑漏洞; 3) 安全隐患; 4) 修复方案 (带补丁代码)。没问题的部分一句带过, 有问题的说清位置和原因。如果这不是代码, 直接指出。",
        "---",
        t,
      ].join(NL),
  },
  explain: {
    name: "代码讲解",
    hint: "把代码整段发我, 我逐段讲解, 再给整体流程和测试用例。",
    make: (t) =>
      [
        "请讲解下面这段代码: 先一句话说它干什么, 然后逐段讲解关键部分, 再给一个整体流程小结, 最后给 2 个测试用例。",
        "---",
        t,
      ].join(NL),
  },
  refactor: {
    name: "代码重构",
    hint: "把要重构的代码整段发我, 我重构加注释, 并说明改了哪里。",
    make: (t) =>
      [
        "请重构下面这段代码: 保持功能不变, 结构拆分合理、命名清晰、补必要注释; 先给重构后的完整代码, 再用清单说明改动点。",
        "---",
        t,
      ].join(NL),
  },
  translate: {
    name: "翻译",
    hint: "把要翻译的内容发我 (中英互译, 技术词和代码不动)。",
    make: (t) =>
      [
        "请翻译下面内容: 中文译英文, 英文译中文; 保持原格式, 代码、命令、专有名词不译; 只输出译文, 最多末尾加一句注释。",
        "---",
        t,
      ].join(NL),
  },
};

// ---------- v5: 状态卡 ----------
async function statusText(env, chatId, userId) {
  const brain = await getBrain(env, chatId);
  const personaId = (await kvGet(env, `persona:${chatId}`)) || "default";
  const auto = (await kvGet(env, `auto:${chatId}`)) === "1";
  const ghost = (await kvGet(env, `ghost:${chatId}`)) === "1";
  const prefs = await getPrefs(env, chatId);
  const rems = await getReminders(env, chatId);
  const watch = await getWatch(env, chatId);
  const day = new Date().toISOString().slice(0, 10);
  const used = parseInt((await kvGet(env, `cnt:${day}:u${userId}`)) || "0", 10);
  let lastLine = "暂无";
  const lastRaw = await kvGet(env, `last:${chatId}`);
  if (lastRaw) {
    try {
      const L = JSON.parse(lastRaw);
      lastLine = `${brainConfig(env, L.brain).label}, 约 ${L.ms}ms`;
    } catch {
      // ignore
    }
  }
  return [
    `📊 小多状态卡 (${VERSION})`,
    `大脑: ${brainConfig(env, brain).label}${auto ? " (智能选模型: 开)" : ""}`,
    `人设: ${(PERSONAS[personaId] || PERSONAS.default).label}`,
    `假装失忆: ${ghost ? "开 (不读不存记忆)" : "关"}`,
    `长期记忆: ${prefs.length} 条`,
    `待响提醒: ${rems.length} 条 · 盯梢网页: ${watch.length} 个`,
    `今日已用额度: ${used}/${PER_USER_DAILY}`,
    `上次回答: ${lastLine}`,
  ].join(NL);
}


// ---------- 音乐点歌 (网易云搜索 + 源站音频直发) ----------
const MUSIC_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

function isBareMusicAsk(t) {
  const x = (t || "").trim().replace(/[\s。！!？?]+$/g, "");
  return /^(帮我|请|麻烦)?(放一?首|播放|放|来一首|点一?首|点歌|听一首|听歌|放歌|放音乐|听音乐|我想听歌?|我要听歌?|唱一首)(音乐|歌|一首歌)?$/.test(x);
}

function parseSongAsk(text) {
  const t = (text || "").trim();
  if (/听我说|听我讲|你听我|说说话/.test(t)) return null;
  const m = t.match(/^(?:帮我|请|麻烦)?(?:放一首|播放|放|来一首|点歌|点一首|听一首|我想听|我要听|唱一首|听歌|放歌|放音乐|听音乐)[\s:：]*(.*)$/);
  if (!m) return null;
  let q = (m[1] || "").trim();
  q = q.replace(/^(音乐|歌曲|歌|曲子)[\s:：]*/, "").replace(/[的了啊呀吧]+$/, "").trim();
  if (!q || q.length > 40) return null;
  if (/[吗呢？?]/.test(q) || q.includes("什么")) return null;
  return q;
}

async function musicSearch(query) {
  const url = "https://music.163.com/api/cloudsearch/pc?s=" + encodeURIComponent(query) + "&type=1&limit=10&offset=0";
  const r = await fetch(url, { headers: { "User-Agent": MUSIC_UA, Referer: "https://music.163.com" } });
  if (!r.ok) throw new Error("search http " + r.status);
  const d = await r.json();
  const songs = d?.result?.songs || [];
  return songs.map((s) => ({
    id: String(s.id),
    key: String(s.id),
    src: "ne",
    name: s.name || "",
    artist: (s.ar || []).map((a) => a.name).join("/"),
    dur: Math.round((s.dt || 0) / 1000),
  }));
}

async function kuwoSearchList(query) {
  const url = "https://search.kuwo.cn/r.s?client=kt&all=" + encodeURIComponent(query) + "&pn=0&rn=10&ft=music&encoding=utf8&rformat=json&vipver=1&mobi=1";
  const r = await fetch(url, { headers: { "User-Agent": MUSIC_UA } });
  if (!r.ok) throw new Error("kuwo search http " + r.status);
  const d = await r.json();
  const items = d?.abslist || [];
  const clean = (x) => String(x || "").replace(/&nbsp;/g, " ").replace(/<[^>]*>/g, "").trim();
  return items
    .filter((s) => s.DC_TARGETID)
    .map((s) => ({
      id: "kw" + s.DC_TARGETID,
      key: "kw" + s.DC_TARGETID,
      src: "kw",
      rid: String(s.DC_TARGETID),
      name: clean(s.SONGNAME),
      artist: clean(s.ARTIST),
      dur: parseInt(s.DURATION || "0", 10) || 0,
    }));
}

async function doMusicSearch(env, chatId, userId, query, replyTo, threadId) {
  await tg(env, "sendChatAction", {
    chat_id: chatId,
    action: "typing",
    ...(threadId ? { message_thread_id: threadId } : {}),
  });
  let list = [];
  let neErr = false;
  try {
    list = await musicSearch(query);
  } catch (e) {
    console.log("music search err", e);
    neErr = true;
  }
  if (!list.length) {
    try {
      list = await kuwoSearchList(query);
    } catch (e) {
      console.log("kuwo search err", e);
    }
  }
  if (!list.length) {
    await sendText(env, chatId, neErr ? "音乐源站这会儿连不上, 等下再试。" : `没搜到「${query}」, 换个名字试试。`, replyTo, undefined, false, threadId);
    return;
  }
  const cache = {};
  for (const s of list) cache[s.key] = s;
  await kvPut(env, `musq:${chatId}`, JSON.stringify(cache), 1800);
  await kvPut(env, `musord:${chatId}`, JSON.stringify(list.map((s) => s.key)), 1800);
  const lines = [`🎯 搜「${query}」找到这些, 点下面的数字按钮, 或者直接回我第几个, 歌以文件发给你:`];
  list.forEach((s, i) => {
    const mm = Math.floor(s.dur / 60);
    const ss = String(s.dur % 60).padStart(2, "0");
    lines.push(`${i + 1}. ${s.name} - ${s.artist} (${mm}:${ss})`);
  });
  const rows = [];
  for (let i = 0; i < list.length; i += 5) {
    rows.push(list.slice(i, i + 5).map((s, j) => ({ text: String(i + j + 1), callback_data: "mus:" + s.key })));
  }
  rows.push([{ text: "🏠 菜单", callback_data: "m:menu" }]);
  await sendText(env, chatId, lines.join(NL), replyTo, { inline_keyboard: rows }, false, threadId);
}

async function fetchAudioBytes(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": MUSIC_UA } });
    if (!r.ok) return null;
    const ctype = r.headers.get("content-type") || "";
    const buf = await r.arrayBuffer();
    if (buf.byteLength < 20000) return null;
    if (/audio|octet-stream/i.test(ctype)) return buf;
    const b = new Uint8Array(buf.slice(0, 3));
    if ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return buf;
    return null;
  } catch (e) {
    console.log("audio fetch err", e);
    return null;
  }
}

async function gdStudioUrl(songId, diag) {
  try {
    const u = "https://music-api.gdstudio.xyz/api.php?types=url&source=netease&id=" + encodeURIComponent(songId) + "&br=320";
    const r = await fetch(u, { headers: { "User-Agent": MUSIC_UA } });
    if (!r.ok) { diag.stage = "G0"; return null; }
    const j = await r.json();
    if (j && j.url) return j.url;
    diag.stage = "G1";
    return null;
  } catch (e) {
    console.log("gd err", e);
    diag.stage = "G0";
    return null;
  }
}

async function kuwoCandidates(name, artist, diag) {
  const firstArtist = (artist || "").split("/")[0].trim();
  const queries = [];
  const q1 = ((name || "") + " " + firstArtist).trim();
  if (q1) queries.push(q1);
  if (name && name !== q1) queries.push(name);
  const rids = [];
  for (const q of queries) {
    try {
      const su = "https://search.kuwo.cn/r.s?client=kt&all=" + encodeURIComponent(q) + "&pn=0&rn=5&ft=music&encoding=utf8&rformat=json&vipver=1&mobi=1";
      const sr = await fetch(su, { headers: { "User-Agent": MUSIC_UA } });
      if (!sr.ok) { diag.stage = "K0"; continue; }
      const sj = await sr.json();
      for (const it of sj.abslist || []) {
        const rid = it && it.DC_TARGETID;
        if (rid && !rids.includes(String(rid))) rids.push(String(rid));
      }
      if (rids.length) break;
      diag.stage = "K1";
    } catch (e) {
      console.log("kuwo search err", e);
      diag.stage = "K0";
    }
  }
  return rids.slice(0, 4);
}

async function kuwoUrlByRid(rid, diag) {
  try {
    const au = "https://antiserver.kuwo.cn/anti.s?type=convert_url3&rid=MUSIC_" + rid + "&format=mp3&response=url";
    const ar = await fetch(au, { headers: { "User-Agent": MUSIC_UA } });
    if (!ar.ok) { diag.stage = "K2"; return null; }
    const at = (await ar.text()).trim();
    if (at.startsWith("{")) {
      const aj = JSON.parse(at);
      if (aj.url) return aj.url;
      diag.stage = "K2";
      return null;
    }
    if (at.startsWith("http")) return at;
    diag.stage = "K2";
    return null;
  } catch (e) {
    console.log("kuwo anti err", e);
    diag.stage = "K2";
    return null;
  }
}

function estimateMp3Seconds(buf) {
  try {
    const b = new Uint8Array(buf);
    let off = 0;
    if (b.length > 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
      off = 10 + ((b[6] & 0x7f) << 21) + ((b[7] & 0x7f) << 14) + ((b[8] & 0x7f) << 7) + (b[9] & 0x7f);
    }
    const brV1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
    const brV2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
    const end = Math.min(b.length - 4, off + 65536);
    for (let i = off; i < end; i++) {
      if (b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0) {
        const ver = (b[i + 1] >> 3) & 0x3;
        const layer = (b[i + 1] >> 1) & 0x3;
        if (layer !== 1) continue;
        const bri = (b[i + 2] >> 4) & 0xf;
        const br = ver === 3 ? brV1[bri] : brV2[bri];
        if (!br) continue;
        return Math.round(((b.length - i) * 8) / (br * 1000));
      }
    }
    return 0;
  } catch (e) {
    return 0;
  }
}

function streamPlausible(buf, expectSec) {
  const est = estimateMp3Seconds(buf);
  if (!est) return true;
  if (expectSec && expectSec >= 60) return est >= expectSec * 0.5 && est <= expectSec * 2.5;
  return est >= 40;
}

async function fetchSongBuf(url, expectSec, diag) {
  const buf = await fetchAudioBytes(url);
  if (!buf) return null;
  if (!streamPlausible(buf, expectSec)) {
    diag.stage = "K5";
    return null;
  }
  return buf;
}

function keepTyping(env, chatId, action, threadId) {
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    tg(env, "sendChatAction", {
      chat_id: chatId,
      action: action || "typing",
      ...(threadId ? { message_thread_id: threadId } : {}),
    }).catch(() => {});
  };
  tick();
  const iv = setInterval(tick, 4000);
  const cap = setTimeout(() => { stopped = true; clearInterval(iv); }, 90000);
  return () => { stopped = true; clearInterval(iv); clearTimeout(cap); };
}

async function ensureBotCommands(env) {
  try {
    if (await kvGet(env, "sys:cmdset11")) return;
    await tg(env, "setMyCommands", {
      commands: [
        { command: "start", description: "🏠 打开菜单" },
        { command: "music", description: "🎵 点歌, 例: /music 入戏太深" },
        { command: "help", description: "❓ 帮助" },
        { command: "new", description: "🆕 新话题" },
        { command: "memory", description: "🧠 我的长期记忆" },
        { command: "remind", description: "⏰ 设个提醒" },
        { command: "status", description: "📊 机器人状态" },
        { command: "panel", description: "✨ 高级面板" },
        { command: "tool", description: "🧩 现做一个小工具" },
        { command: "topics", description: "🧵 话题工作台" },
        { command: "model", description: "🧠 当前模型 / 换模型" },
        { command: "persona", description: "🎭 换人设" },
        { command: "morning", description: "☀️ 今日早报" },
        { command: "draw", description: "🎨 画图" },
        { command: "auto", description: "🤖 智能选模型开关" },
        { command: "incognito", description: "🕶️ 假装失忆开关" },
        { command: "stickers", description: "🎴 我学会的贴纸" },
        { command: "addpack", description: "🎴 整包添加表情包" },
        { command: "export", description: "📦 导出我的记忆" },
        { command: "settings", description: "⚙️ 设置面板 (大脑/温度/长度/预算)" },
        { command: "usage", description: "📈 用量与费用" },
        { command: "temp", description: "🌡️ 创造性, 例: /temp 0.7" },
        { command: "bill", description: "🧾 账本 (发 午饭35 也能记)" },
        { command: "todo", description: "✅ 加待办, 例: /todo 周五前交报告" },
        { command: "todos", description: "📋 待办清单" },
        { command: "notes", description: "📝 我的备忘录" },
        { command: "undo", description: "↩️ 撤销上一步" },
        { command: "pin", description: "📌 钉住一条重要信息" },
        { command: "backup", description: "📦 导出全部数据备份" },
        { command: "habit", description: "🔥 习惯打卡" },
        { command: "diary", description: "📔 我的日记本" },
        { command: "myid", description: "🆔 我的数字 ID" },
      ],
    });
    await kvPut(env, "sys:cmdset11", "1", 604800);
  } catch (e) {
    console.log("cmdset err", e);
  }
}

async function doMusicPlay(env, chatId, songId, threadId) {
  let info = null;
  const raw = await kvGet(env, `musq:${chatId}`);
  if (raw) {
    try {
      info = JSON.parse(raw)[songId] || null;
    } catch {
      info = null;
    }
  }
  const name = info?.name || "未知歌曲";
  const artist = info?.artist || "";
  const stopUp = keepTyping(env, chatId, "upload_voice", threadId);
  const diag = { stage: "K0" };
  const expect = info?.dur || 0;
  let buf = null;
  let viaKuwo = false;
  if (info?.src === "kw" && info?.rid) {
    const u = await kuwoUrlByRid(info.rid, diag);
    if (u) buf = await fetchSongBuf(u, expect, diag);
    if (buf) viaKuwo = true;
  } else {
    const gu = await gdStudioUrl(songId, diag);
    if (gu) buf = await fetchSongBuf(gu, expect, diag);
    if (!buf) buf = await fetchSongBuf("https://music.163.com/song/media/outer/url?id=" + songId + ".mp3", expect, diag);
  }
  if (!buf) {
    const cands = await kuwoCandidates(name, artist, diag);
    for (const rid of cands) {
      if (info?.src === "kw" && String(info.rid) === rid) continue;
      const u = await kuwoUrlByRid(rid, diag);
      if (!u) continue;
      buf = await fetchSongBuf(u, expect, diag);
      if (buf) { viaKuwo = true; break; }
    }
  }
  if (!buf) {
    stopUp();
    await sendText(env, chatId, `《${name}》网易云和酷我这次都没拿到能放的完整版 (多半是版权限制), 换个版本试试。(诊断码 ${diag.stage}, 截图给 Algo 看)`, undefined, undefined, false, threadId);
    return;
  }
  const caption = `🎵 ${name}${artist ? " - " + artist : ""}${viaKuwo ? " (酷我源)" : ""}`;
  const estSec = estimateMp3Seconds(buf);
  // v6.3: 先按音乐文件发 (带歌名/歌手, 能存能转), 失败再退语音条
  let sent = false;
  try {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    if (threadId) form.append("message_thread_id", String(threadId));
    form.append("title", name.slice(0, 60));
    if (artist) form.append("performer", artist.slice(0, 60));
    if (estSec) form.append("duration", String(estSec));
    else if (info?.dur) form.append("duration", String(info.dur));
    form.append("caption", caption);
    form.append("audio", new Blob([buf], { type: "audio/mpeg" }), `${name} - ${artist}.mp3`.slice(0, 80));
    const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendAudio`, { method: "POST", body: form });
    const j = await r.json();
    if (!j.ok) throw new Error("tg sendAudio " + (j.description || r.status));
    sent = true;
  } catch (e) {
    console.log("sendAudio err", e);
  }
  if (!sent) {
    try {
      const vf = new FormData();
      vf.append("chat_id", String(chatId));
      if (threadId) vf.append("message_thread_id", String(threadId));
      if (estSec) vf.append("duration", String(estSec));
      else if (info?.dur) vf.append("duration", String(info.dur));
      vf.append("caption", caption);
      vf.append("voice", new Blob([buf], { type: "audio/mpeg" }), `${name}.mp3`.slice(0, 80));
      const vr = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendVoice`, { method: "POST", body: vf });
      const vj = await vr.json();
      sent = !!vj.ok;
      if (!sent) console.log("sendVoice not ok", vj.description || vr.status);
    } catch (e) {
      console.log("sendVoice err", e);
    }
  }
  if (!sent) {
    await sendText(env, chatId, `《${name}》传给你的时候出错了, 再点一次试试。`, undefined, undefined, false, threadId);
  }
  stopUp();
}

// ---------- 按钮回调 ----------
async function handleCallback(env, cq) {
  const chatId = cq.message?.chat?.id;
  const userId = cq.from?.id;
  const data = cq.data || "";
  if (chatId == null || userId == null) return;
  await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
  if (!(await isAllowed(env, userId))) return;

  if (data === "m:panel") {
    await sendPanel(env, chatId, userId);
  } else if (data === "m:menu") {
    await sendText(env, chatId, "菜单在这, 点按钮或者直接发消息都行 👇", undefined, MENU_KB);
  } else if (data === "m:help") {
    await sendText(env, chatId, HELP, undefined, MENU_KB);
  } else if (data === "m:new") {
    if (env.BOT_KV) await env.BOT_KV.delete(`mem:${chatId}`);
    if (env.BOT_KV) await env.BOT_KV.delete(`sum:${chatId}`);
    await sendText(env, chatId, "记忆清空了, 咱重新聊。", undefined, MENU_KB);
  } else if (data === "m:draw") {
    await kvPut(env, `awaitdraw:${chatId}`, "1", 300);
    await sendText(env, chatId, "想画啥? 直接发一句描述给我就行, 比如: 一只在海边看日落的橘猫");
  } else if (data === "m:model") {
    await sendModelPicker(env, chatId);
  } else if (data === "m:search") {
    if (!env.TAVILY_API_KEY) {
      await sendText(env, chatId, "联网搜索还没接入: 需要一把 Tavily 的免费 key (找 Algo 带你注册)。");
      return;
    }
    await kvPut(env, `awaitsearch:${chatId}`, "1", 300);
    await sendText(env, chatId, "想搜啥? 直接发关键词给我, 比如: 今天有什么 AI 新闻");
  } else if (data === "m:gh") {
    await kvPut(env, `awaitgh:${chatId}`, "1", 300);
    await sendText(env, chatId, "想查哪个仓库? 发我 用户名/仓库名, 比如 wwu077957-byte/dq686bot");
  } else if (data === "m:music") {
    await kvPut(env, `awaitmusic:${chatId}`, "1", 300);
    await sendText(env, chatId, "想听啥? 直接发歌名给我, 比如: 入戏太深", undefined, undefined, false, cq.message?.message_thread_id || undefined);
  } else if (data.startsWith("mus:")) {
    await doMusicPlay(env, chatId, data.slice(4), cq.message?.message_thread_id || undefined);
  } else if (data === "m:morning") {
    await sendText(env, chatId, await briefingText(env, chatId));
  } else if (data === "m:topics") {
    await setupTopics(env, chatId, userId);
  } else if (data === "m:myid") {
    await sendText(env, chatId, `你的 Telegram 数字 ID 是: ${userId}`);
  } else if (data === "f:file") {
    const raw = await kvGet(env, `lastcode:${chatId}`);
    let blocks = [];
    if (raw) {
      try {
        blocks = JSON.parse(raw);
      } catch {
        blocks = [];
      }
    }
    if (!blocks.length) {
      await sendText(env, chatId, "最近没有能存的代码, 先让我写一段再点这个按钮。");
      return;
    }
    await sendBlocksAsFiles(env, chatId, blocks);
  } else if (data === "m:persona") {
    await sendPersonaPicker(env, chatId);
  } else if (data === "m:memory") {
    await sendMemoryList(env, chatId);
  } else if (data.startsWith("p:")) {
    const pid = data.slice(2);
    if (!PERSONAS[pid]) return;
    await kvPut(env, `persona:${chatId}`, pid);
    await sendText(env, chatId, `好, 人设换成「${PERSONAS[pid].label}」了。继续聊吧。`, undefined, MENU_KB);
  } else if (data.startsWith("mdel:")) {
    const idx = parseInt(data.slice(5), 10);
    const prefs = await getPrefs(env, chatId);
    if (idx >= 0 && idx < prefs.length) {
      const [gone] = prefs.splice(idx, 1);
      await setPrefs(env, chatId, prefs);
      await sendText(env, chatId, `忘掉了: ${gone}`);
    }
    await sendMemoryList(env, chatId);
  } else if (data === "mdall") {
    await setPrefs(env, chatId, []);
    await sendText(env, chatId, "长期记忆全清了, 咱重新认识。", undefined, MENU_KB);
  } else if (data === "r:retry") {
    await doRetry(env, chatId, userId, cq.message?.message_id);
  } else if (data.startsWith("rdel:")) {
    const idx = parseInt(data.slice(5), 10);
    const list = await getReminders(env, chatId);
    if (idx >= 0 && idx < list.length) {
      const [gone] = list.splice(idx, 1);
      await setReminders(env, chatId, list);
      await sendText(env, chatId, `提醒删了: ${fmtTimeCst(gone.at)} - ${gone.text}`);
    }
    await sendRemindersList(env, chatId);
  } else if (data.startsWith("b:")) {
    const brain = data.slice(2);
    if (!BRAIN_IDS.includes(brain)) return;
    if (!brainConfig(env, brain).key) {
      await sendText(env, chatId, "这个大脑还没接入 (缺 key), 先用现在这个吧。");
      return;
    }
    await setBrain(env, chatId, brain);
  } else if (data.startsWith("hb:")) {
    const name = decodeURIComponent(data.slice(3));
    const h = await getHabits(env, chatId);
    if (!h[name]) h[name] = { days: {} };
    h[name].days[cstDateStr(Date.now())] = 1;
    await saveHabits(env, chatId, h);
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: `✅ 「${name}」打卡成功` });
    await sendText(env, chatId, await habitText(env, chatId));
  } else if (data.startsWith("td:")) {
    const parts = data.split(":");
    const act = parts[1];
    const id = parts[2];
    const list = await getTodos(env, chatId);
    const it = list.find((x) => x.id === id);
    if (it) {
      if (act === "done") it.done = true;
      if (act === "del") list.splice(list.indexOf(it), 1);
      await setTodos(env, chatId, list);
    }
    await sendTodos(env, chatId, cq.message?.message_id);
  } else if (data.startsWith("st:")) {
    await handleSettingsCallback(env, cq, chatId);
  }
}

// ---------- v6.2 贴纸: 跟用户学贴纸, 按心情回贴纸 ----------
const MOOD_STICKERS = [
  { keys: ["哈哈", "笑死", "乐死", "好笑", "太逗"], emojis: ["😂", "🤣", "😄", "😆", "😁"] },
  { keys: ["晚安", "睡觉", "睡了", "困了"], emojis: ["😴", "🥱", "🌙"] },
  { keys: ["谢谢", "感谢", "辛苦了"], emojis: ["🙏", "❤️", "😊", "🥰"] },
  { keys: ["喜欢", "爱你", "抱抱", "亲亲"], emojis: ["❤️", "😍", "🥰", "😘"] },
  { keys: ["难过", "伤心", "哭了", "呜呜", "委屈"], emojis: ["😢", "😭", "🥺", "😿"] },
  { keys: ["生气", "气死", "烦死", "无语"], emojis: ["😡", "😤", "🤬", "🙄"] },
  { keys: ["饿了", "吃饭", "干饭", "好吃"], emojis: ["😋", "🍔", "🍜", "🍗"] },
  { keys: ["累了", "好累", "困死"], emojis: ["😩", "🥱", "😪"] },
];

async function getStickerPool(env, chatId) {
  try {
    return JSON.parse((await kvGet(env, `stk:${chatId}`)) || "[]");
  } catch {
    return [];
  }
}

async function handleSticker(env, chatId, userId, msg, threadId) {
  const st = msg.sticker || {};
  const pool = await getStickerPool(env, chatId);
  if (st.file_id && !pool.some((x) => x.f === st.file_id)) {
    pool.push({ f: st.file_id, e: st.emoji || "" });
    while (pool.length > 300) pool.shift();
    await kvPut(env, `stk:${chatId}`, JSON.stringify(pool), 60 * 60 * 24 * 30);
  }
  const first = (await kvGet(env, `stkhi:${chatId}`)) !== "1";
  if (first) {
    await kvPut(env, `stkhi:${chatId}`, "1", 60 * 60 * 24 * 30);
    await sendText(env, chatId, "这张贴纸我学会啦 😎 你发我的贴纸我都会攒下来, 以后聊天对上心情, 我也会发贴纸陪你玩。", msg.message_id, undefined, false, threadId);
    return;
  }
  const others = pool.filter((x) => x.f !== st.file_id);
  const srcPool = others.length ? others : pool;
  if (srcPool.length && Math.random() < 0.75) {
    const pick = srcPool[Math.floor(Math.random() * srcPool.length)];
    await tg(env, "sendSticker", {
      chat_id: chatId,
      sticker: pick.f,
      ...(threadId ? { message_thread_id: threadId } : {}),
    });
  } else {
    await reactTo(env, chatId, msg.message_id, "😍");
  }
}

async function maybeMoodSticker(env, chatId, threadId, userText, replyText) {
  try {
    const pool = await getStickerPool(env, chatId);
    if (!pool.length) return;
    const last = parseInt((await kvGet(env, `stkcd:${chatId}`)) || "0", 10);
    if (Date.now() - last < 60000) return;
    const hay = `${userText || ""} ${replyText || ""}`;
    const hit = MOOD_STICKERS.find((m) => m.keys.some((k) => hay.includes(k)));
    let cands = hit ? pool.filter((x) => hit.emojis.includes(x.e)) : [];
    let chance;
    if (hit && cands.length) chance = 0.85; // 心情对上, 贴纸又对味: 基本必发
    else if (hit) {
      cands = pool;
      chance = 0.5; // 心情对上但没有同味贴纸: 随机一张陪一下
    } else {
      cands = pool;
      chance = 0.15; // 平时聊天: 偶尔自己冒一张, 图个活人感
    }
    if (Math.random() > chance) return;
    const pick = cands[Math.floor(Math.random() * cands.length)];
    await tg(env, "sendChatAction", {
      chat_id: chatId,
      action: "choose_sticker",
      ...(threadId ? { message_thread_id: threadId } : {}),
    }).catch(() => {});
    await tg(env, "sendSticker", {
      chat_id: chatId,
      sticker: pick.f,
      ...(threadId ? { message_thread_id: threadId } : {}),
    });
    await kvPut(env, `stkcd:${chatId}`, String(Date.now()), 300);
  } catch {}
}

async function addStickerPack(env, chatId, name) {
  const res = await tg(env, "getStickerSet", { name });
  const set = res?.result;
  if (!set || !Array.isArray(set.stickers)) return { ok: false };
  const pool = await getStickerPool(env, chatId);
  let added = 0;
  for (const st of set.stickers) {
    if (st.file_id && !pool.some((x) => x.f === st.file_id)) {
      pool.push({ f: st.file_id, e: st.emoji || "" });
      added++;
    }
  }
  while (pool.length > 300) pool.shift();
  await kvPut(env, `stk:${chatId}`, JSON.stringify(pool), 60 * 60 * 24 * 30);
  return { ok: true, title: set.title || name, added, total: pool.length };
}

// ---------- v6.1 话题工作台: 一键建预设话题 ----------
const PRESET_TOPICS = ["💼 工作", "💬 日常", "💡 灵感", "🧪 临时"];

async function setupTopics(env, chatId, userId) {
  const me = await tg(env, "getMe", {});
  if (!me || !me.ok || !me.result || !me.result.has_topics_enabled) {
    await sendText(env, chatId, "话题模式还没开: 去 @BotFather 小程序 → Bot Settings → Threads Settings, 把 Threaded Mode 打开, 再回来发 /topics。");
    return;
  }
  let saved = {};
  try {
    saved = JSON.parse((await kvGet(env, `topics:${chatId}`)) || "{}");
  } catch {
    saved = {};
  }
  const lines = ["🧵 你的话题工作台:"];
  let changed = false;
  for (const name of PRESET_TOPICS) {
    if (saved[name]) {
      lines.push(`· ${name} — https://t.me/dq686BOT/${saved[name]}`);
      continue;
    }
    const r = await tg(env, "createForumTopic", { chat_id: chatId, name });
    if (r && r.ok && r.result && r.result.message_thread_id) {
      saved[name] = r.result.message_thread_id;
      changed = true;
      lines.push(`· ${name} ✅ 刚建好 — https://t.me/dq686BOT/${saved[name]}`);
    } else {
      lines.push(`· ${name} ❌ 没建成 (${(r && r.description) || "未知错误"})`);
    }
  }
  if (changed) await kvPut(env, `topics:${chatId}`, JSON.stringify(saved));
  lines.push("", "点链接或聊天顶部的话题列表就能切换。每个话题的记忆互相独立: 在哪个话题聊, 就只记在哪个话题。主聊天 (全部消息) 的记忆跟话题也是分开的。");
  await sendText(env, chatId, lines.join(NL), undefined, MENU_KB);
}

// ---------- v6.0 /tool: AI 现场生成消息内小工具 (Widget) ----------
const TOOLGEN_SYS = [
  "你是一个 Telegram 消息内小组件(Widget)生成器。根据用户需求, 只输出一段完整的 HTML 代码, 不要任何解释, 不要 markdown 代码围栏。",
  "硬性规格: 单文件, CSS 和 JS 全部内联; 禁止任何外部资源与网络请求 (不能出现 http 外链, 不能 fetch)。",
  "体积: Telegram 要求压缩后小于 4KB, 所以代码必须短小精悍, 全文尽量控制在 9000 字符以内, 越短越好。",
  "环境: QuickJS 沙箱, 可用 localStorage; 背景色用 var(--tg-theme-bg-color, #ffffff), 文字色用 var(--tg-theme-text-color, #1a1814)。",
  "界面: 中文, 手机竖屏, 按钮和字都要大, 主色深松绿 #1F6B52, 圆角卡片风。",
  "直接输出 HTML 本身, 第一个字符必须是 < 。",
].join(NL);

async function doToolGen(env, chatId, userId, wish, replyTo) {
  if (!(await quotaTake(env, userId))) {
    await sendText(env, chatId, "今天的 AI 额度用完了, 明天再来。");
    return;
  }
  const stopTyping = keepTyping(env, chatId);
  const phId = await sendPlaceholder(env, chatId, "🧩 小多正在现做这个小工具…", replyTo);
  try {
    const prompt = [TOOLGEN_SYS, "", `用户需求: ${wish}`].join(NL);
    let html = await aiChat(env, chatId, prompt, `（做小工具: ${wish}）`, {});
    // 抹掉这次生成在短期记忆里留下的大块 HTML, 免得撑爆后续上下文
    try {
      const raw = await kvGet(env, `mem:${chatId}`);
      if (raw) {
        const h = JSON.parse(raw);
        const cut = h.filter((m) => !(typeof m.content === "string" && m.content.includes("小组件(Widget)生成器")));
        await kvPut(env, `mem:${chatId}`, JSON.stringify(cut), 60 * 60 * 24 * 7);
      }
    } catch {}
    html = String(html || "").trim();
    const fenceAt = html.indexOf("```");
    if (fenceAt >= 0) {
      const endAt = html.lastIndexOf("```");
      html = html.slice(fenceAt + 3, endAt > fenceAt ? endAt : undefined).replace(/^html/i, "").trim();
    }
    const ltAt = html.indexOf("<");
    if (ltAt > 0) html = html.slice(ltAt);
    const low = html.toLowerCase();
    if (!low.includes("<html") && !low.includes("<!doctype")) throw new Error("not html");
    if (html.length > 30000) throw new Error("tool html too big");
    const r = await tg(env, "sendWidget", { chat_id: chatId, html, caption: `🧩 ${wish.slice(0, 60)}` });
    if (r && r.ok) {
      await editOrSend(env, chatId, phId, "做好了 👇 点开就能用, 用完关掉就行, 不占地方。", undefined, false);
    } else {
      await sendDocument(env, chatId, html, "tool.html", `🧩 ${wish.slice(0, 60)}`);
      await editOrSend(env, chatId, phId, "卡片没塞进去 (可能太大了), 改成文件发你: tool.html, 点开一样能用。", undefined, false);
    }
  } catch (e) {
    console.log("toolgen err", e);
    await editOrSend(env, chatId, phId, "这个工具没做成, 换个说法再试试 (说得越具体越容易成)。", undefined, false);
  }
  stopTyping();
}

// ---------- 消息处理 ----------
async function handleUpdate(env, update) {
  if (update.update_id != null && env.BOT_KV) {
    const dk = `dup:${update.update_id}`;
    if (await kvGet(env, dk)) return;
    await kvPut(env, dk, "1", 120);
  }
  const uid0 = update.widget_query?.from?.id || update.callback_query?.from?.id || update.message?.from?.id || update.channel_post?.from?.id;
  if (uid0 != null && (await isAllowed(env, uid0))) await ensureBotCommands(env);
  if (update.stopped_message_generation) {
    const smg = update.stopped_message_generation;
    const cid = (smg.chat && smg.chat.id) || (smg.user && smg.user.id);
    if (cid != null) await kvPut(env, `stopgen:${cid}`, "1", 120);
    return;
  }
  if (update.widget_query) {
    await handleWidgetQuery(env, update.widget_query);
    return;
  }
  if (update.callback_query) {
    await handleCallback(env, update.callback_query);
    return;
  }
  const msg = update.message || update.channel_post;
  if (!msg) return;
  const chatId = msg.chat?.id;
  const chatType = msg.chat?.type || "private";
  const userId = msg.from?.id;
  if (chatId == null || userId == null) return;
  let text = (msg.text || "").trim();
  let caption = (msg.caption || "").trim();
  const photos = msg.photo || [];
  const doc = msg.document || null;
  const threadId = msg.is_topic_message && msg.message_thread_id ? msg.message_thread_id : null;
  const memKey = threadId ? `mem:${chatId}:t${threadId}` : `mem:${chatId}`;

  if (text.startsWith("/myid")) {
    await sendText(env, chatId, `你的 Telegram 数字 ID 是: ${userId}`);
    return;
  }

  if (!(await isAllowed(env, userId))) {
    if (allowedIds(env).size === 0 && text.startsWith("/start")) {
      const existing = await kvGet(env, "owner");
      if (!existing) {
        await kvPut(env, "owner", String(userId));
        await sendText(
          env,
          chatId,
          `你是第一个启动我的人, 先认你为主人 (ID: ${userId})。${NL}保险起见, 请把这个 ID 填进 Workers 设置的 ALLOWED_IDS, 正式锁定白名单。`
        );
        return;
      }
    }
    if (chatType === "private") {
      await sendText(
        env,
        chatId,
        `我是多情的私人机器人, 只听白名单里的人。你的 ID 是 ${userId}, 想要权限找多情本人。`
      );
    }
    return;
  }

  if (chatType === "group" || chatType === "supergroup") {
    const replyFrom = msg.reply_to_message?.from;
    const isReplyToBot = !!replyFrom?.is_bot;
    const mentioned =
      text.toLowerCase().includes("@dq686bot") || caption.toLowerCase().includes("@dq686bot");
    if (!(text.startsWith("/") || caption.startsWith("/") || isReplyToBot || mentioned || doc || msg.voice || msg.video || msg.video_note)) return;
    text = text.replace(/@dq686BOT/g, "").replace(/@dq686bot/g, "").trim();
    caption = caption.replace(/@dq686BOT/g, "").replace(/@dq686bot/g, "").trim();
  }

  // ----- 语音: 转成文字后当作普通消息继续走 -----
  if (msg.voice || msg.audio) {
    const media = msg.voice || msg.audio;
    if (!env.GROQ_API_KEY && !env.AI) {
      await sendText(env, chatId, "语音转文字还没接上 key, 找多情/Algo 处理。", msg.message_id);
      return;
    }
    if (media.duration && media.duration > 600) {
      await sendText(env, chatId, "这条语音太长了 (超过 10 分钟), 拆短一点发我。", msg.message_id);
      return;
    }
    if (media.file_size && media.file_size > 20 * 1024 * 1024) {
      await sendText(env, chatId, "这条语音文件太大了, 我听不了。", msg.message_id);
      return;
    }
    await tg(env, "sendChatAction", { chat_id: chatId, action: "typing" });
    const phId = await sendPlaceholder(env, chatId, "🎙️ 小多正在听你说话…", msg.message_id);
    try {
      const info = await tg(env, "getFile", { file_id: media.file_id });
      const filePath = info?.result?.file_path;
      const fr = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`);
      const buf = await fr.arrayBuffer();
      const heard = await transcribeAudio(env, buf);
      if (!heard) throw new Error("empty transcript");
      await editOrSend(env, chatId, phId, `🎙️ 你说的是:「${heard}」`, undefined, false);
      text = heard;
      // 不 return: 转成的文字继续走后面的普通消息流程 (聊天/画图等待/读链接)
    } catch (e) {
      console.log("voice err", e);
      await editOrSend(env, chatId, phId, "没听清这条语音, 再说一次, 或者打字发我。", undefined, false);
      return;
    }
  }

  // ----- 视频: 暂时处理不了, 老实说明 -----
  if (msg.video || msg.video_note || msg.animation) {
    await sendText(
      env,
      chatId,
      "视频我暂时还处理不了。你把里面的话单独发条语音给我, 或者截个图发我, 我都能接住。",
      msg.message_id
    );
    return;
  }

  // ----- 文件阅读 -----
  if (doc && (await kvGet(env, `awaitrestore:${chatId}`)) && (doc.file_name || "").toLowerCase().endsWith(".json")) {
    try {
      const info = await tg(env, "getFile", { file_id: doc.file_id });
      const fr = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${info?.result?.file_path}`);
      const raw = new TextDecoder("utf-8").decode(await fr.arrayBuffer());
      const data = JSON.parse(raw);
      if (!data || data.app !== "dq686bot" || !data.kv) throw new Error("bad backup");
      const allow = new Set(backupKeys(chatId));
      let n = 0;
      for (const [k, v] of Object.entries(data.kv)) {
        if (!allow.has(k) || typeof v !== "string") continue;
        await kvPut(env, k, v, 60 * 60 * 24 * 365);
        n++;
      }
      if (env.BOT_KV) await env.BOT_KV.delete(`awaitrestore:${chatId}`);
      await sendText(env, chatId, `✅ 恢复完成：写回了 ${n} 项数据（长期记忆、账本、待办、备忘、模板、提醒、习惯、日记、设置）。`);
      return;
    } catch (e) {
      await sendText(env, chatId, "这个备份文件读不了或格式不对，恢复取消，你现在的数据一点没动。");
      return;
    }
  }
  if (doc) {
    const name = doc.file_name || "file";
    const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
    const mime = (doc.mime_type || "").toLowerCase();
    const isDocx = ext === "docx";
    const isText = TEXT_EXTS.includes(ext) || mime.startsWith("text/");
    if (!isText && !isDocx) {
      await sendText(
        env,
        chatId,
        `这个文件 (${name}) 我暂时读不了。我现在能读的是 txt、md、代码、日志这类文本文件, 还有 Word 文档 (.docx); PDF、压缩包还不行。PDF 你可以把要看的那页截图发我, 或者把内容复制成文字发我。`,
        msg.message_id
      );
      return;
    }
    if (doc.file_size && doc.file_size > 2 * 1024 * 1024) {
      await sendText(env, chatId, "这个文件太大了 (超过 2MB), 我读不完。拆小一点再发我。", msg.message_id);
      return;
    }
    if (!(await quotaTake(env, userId))) {
      await sendText(env, chatId, "今天的 AI 额度用完了, 明天再来。");
      return;
    }
    await tg(env, "sendChatAction", { chat_id: chatId, action: "typing" });
    const phId = await sendPlaceholder(env, chatId, "📄 小多正在读文件…", msg.message_id);
    try {
      const info = await tg(env, "getFile", { file_id: doc.file_id });
      const filePath = info?.result?.file_path;
      const fr = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`);
      const buf = await fr.arrayBuffer();
      const content = isDocx
        ? (await extractDocxText(buf)).slice(0, 15000)
        : new TextDecoder("utf-8").decode(buf).slice(0, 15000);
      if (!content.trim()) throw new Error("empty doc");
      const ask = caption || "帮我总结这个文件的要点";
      const prompt = [
        `我给你发了一个文件「${name}」, 内容如下:`,
        "---",
        content,
        "---",
        `我的要求: ${ask}`,
      ].join(NL);
      const reply = await aiChat(env, chatId, prompt, `（发了文件 ${name}）`);
      await deliverAiReply(env, chatId, phId, reply, caption);
    } catch (e) {
      console.log("doc err", e);
      await editOrSend(env, chatId, phId, chatErrorText(e), e.status === 402 ? MODEL_KB : undefined, false);
    }
    return;
  }

  // ----- 图片理解 -----
  if (photos.length > 0) {
    if (!env.GROQ_API_KEY) {
      await sendText(env, chatId, "看图功能还没接上 key, 找多情/Algo 处理。");
      return;
    }
    if (!(await quotaTake(env, userId))) {
      await sendText(env, chatId, "今天的 AI 额度用完了, 明天再来。");
      return;
    }
    await tg(env, "sendChatAction", { chat_id: chatId, action: "typing" });
    const phId = await sendPlaceholder(env, chatId, "👀 小多正在看图…", msg.message_id, threadId);
    try {
      let pick = photos[photos.length - 1];
      for (let i = photos.length - 1; i >= 0; i--) {
        if (!photos[i].file_size || photos[i].file_size <= 1500000) {
          pick = photos[i];
          break;
        }
      }
      const fileId = pick.file_id;
      const info = await tg(env, "getFile", { file_id: fileId });
      const filePath = info?.result?.file_path;
      const fr = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`);
      const buf = await fr.arrayBuffer();
      const prompt = caption || "用中文详细描述并解释这张图片的内容。";
      const answer = await aiVision(env, buf, prompt);
      await editOrSend(env, chatId, phId, answer, undefined, true);
    } catch (e) {
      console.log("vision err", e);
      await editOrSend(env, chatId, phId, `看图时出了点问题 (${String(e.message || e).slice(0, 60)}), 稍后再发一次试试。`, undefined, false);
    }
    return;
  }

  // ----- 贴纸: 学下来并回应 (v6.2) -----
  if (msg.sticker) {
    await handleSticker(env, chatId, userId, msg, threadId);
    return;
  }

  if (!text) return;

  if (text.startsWith("/start")) {
    await ensureBotCommands(env);
    const param = text.slice("/start".length).trim().toLowerCase();
    if (param === "panel") {
      await sendPanel(env, chatId, userId);
      return;
    }
    if (param === "sum") {
      await kvPut(env, `awaitsum:${chatId}`, "1", 600);
      await sendText(env, chatId, "📚 总结模式开好了: 把长文或链接直接发我, 我给你提炼要点。发完自动退出这个模式。");
      return;
    }
    if (param === "tool") {
      await kvPut(env, `awaittool:${chatId}`, "1", 600);
      await sendText(env, chatId, "🧩 造工具模式开好了: 说你想要个什么小工具 (比如 AA 分账计算器、掷骰子、倒计时牌), 我现写一个能点的发你。");
      return;
    }
    await sendText(env, chatId, "在呢, 喊一声就应 👋 我是小多。直接发消息跟我聊; 输入框下面有一排常驻按钮, 点着用就行 👇", undefined, REPLY_KB);
    return;
  }
  if (text.startsWith("/addpack")) {
    const arg = text.slice("/addpack".length).trim();
    const m = arg.match(/addstickers\/([A-Za-z0-9_]+)/) || arg.match(/^([A-Za-z0-9_]+)$/);
    if (!m) {
      await sendText(env, chatId, "把表情包链接发我就行, 比如直接发 https://t.me/addstickers/xxx 到聊天里, 我自动整包装下。");
      return;
    }
    const r = await addStickerPack(env, chatId, m[1]);
    await sendText(
      env,
      chatId,
      r.ok
        ? `「${r.title}」装好了 🎴 新增 ${r.added} 张, 我现在一共会 ${r.total} 张贴纸。`
        : "这个包没拉下来, 链接或包名可能不对。"
    );
    return;
  }
  if (text.startsWith("/stickers")) {
    const pool = await getStickerPool(env, chatId);
    await sendText(
      env,
      chatId,
      pool.length
        ? `我已经跟你学会 ${pool.length} 张贴纸了 😎 聊天对上心情的时候我会自己发。再给我发贴纸, 我还能继续学 (最多记 300 张)。`
        : "我还没学会任何贴纸。你直接给我发一张贴纸, 我就学会了, 以后也会发贴纸陪你聊。"
    );
    return;
  }
  if (text.startsWith("/topics")) {
    await setupTopics(env, chatId, userId);
    return;
  }
  if (text.startsWith("/tool")) {
    const arg = text.slice("/tool".length).trim();
    if (!arg) {
      await kvPut(env, `awaittool:${chatId}`, "1", 600);
      await sendText(env, chatId, "🧩 说你想要个什么小工具, 比如「AA分账计算器」「掷骰子决定吃什么」「番茄钟」, 我现写一个能点的发你。");
      return;
    }
    await doToolGen(env, chatId, userId, arg, msg.message_id);
    return;
  }
  if (text.startsWith("/help")) {
    await sendText(env, chatId, HELP, undefined, MENU_KB);
    return;
  }
  if (text.startsWith("/new")) {
    if (env.BOT_KV) await env.BOT_KV.delete(memKey);
    if (env.BOT_KV) await env.BOT_KV.delete(`sum:${memKey}`);
    await sendText(env, chatId, threadId ? "这个话题的记忆清空了, 咱重新聊。" : "记忆清空了, 咱重新聊。", undefined, MENU_KB);
    return;
  }
  if (text.startsWith("/morning")) {
    await sendText(env, chatId, await briefingText(env, chatId));
    return;
  }
  if (text.startsWith("/model")) {
    const arg = text.slice("/model".length).trim().toLowerCase();
    const alias = { ds: "deepseek", pro: "deepseek-pro", reasoner: "deepseek-pro", groq: "gptoss", gpt: "gptoss", fast: "gptoss20" };
    const target = BRAIN_IDS.includes(arg) ? arg : alias[arg];
    if (target) {
      if (!brainConfig(env, target).key) {
        await sendText(env, chatId, "这个大脑还没接入 (缺 key), 先用现在这个吧。");
        return;
      }
      await setBrain(env, chatId, target);
      return;
    }
    await sendModelPicker(env, chatId);
    return;
  }
  if (text.startsWith("/gh")) {
    const arg = text.slice(3).trim();
    if (!arg) {
      await sendText(env, chatId, "格式: /gh 用户名/仓库名, 比如 /gh wwu077957-byte/dq686bot");
      return;
    }
    await tg(env, "sendChatAction", { chat_id: chatId, action: "typing" });
    try {
      await sendText(env, chatId, await ghInfo(arg), msg.message_id);
    } catch (e) {
      console.log("gh err", e);
      await sendText(env, chatId, "没查到这个仓库。格式是 /gh 用户名/仓库名, 仓库得是公开的。", msg.message_id);
    }
    return;
  }
  if (text === "/s" || text.startsWith("/s ")) {
    const q = text.slice(2).trim();
    if (!q) {
      await sendText(env, chatId, "格式: /s 你要搜的东西, 比如 /s 今天有什么 AI 新闻");
      return;
    }
    if (!env.TAVILY_API_KEY) {
      await sendText(env, chatId, "联网搜索还没接入: 需要一把 Tavily 的免费 key (找 Algo 带你注册)。先用着其他功能吧。");
      return;
    }
    await doSearch(env, chatId, userId, q, msg.message_id);
    return;
  }
  if (text.startsWith("/draw")) {
    const prompt = text.slice("/draw".length).trim();
    if (!prompt) {
      await sendText(env, chatId, "画啥? 格式: /draw 一只在海边看日落的橘猫");
      return;
    }
    await doDraw(env, chatId, userId, prompt, msg.message_id);
    return;
  }
  if (text === "/music" || text.startsWith("/music ")) {
    const q = text.slice(6).trim();
    if (!q) {
      await kvPut(env, `awaitmusic:${chatId}`, "1", 300);
      await sendText(env, chatId, "想听啥? 直接发歌名给我, 比如: 入戏太深", msg.message_id);
      return;
    }
    await doMusicSearch(env, chatId, userId, q, msg.message_id, threadId);
    return;
  }

  if (text.startsWith("/remember")) {
    const content = text.slice("/remember".length).trim();
    if (!content) {
      await sendText(env, chatId, "格式: /remember 要记的事, 比如 /remember 我喜欢吃辣");
      return;
    }
    const prefs = await getPrefs(env, chatId);
    prefs.push(content.slice(0, 200));
    await setPrefs(env, chatId, prefs);
    await sendText(env, chatId, `记住了 (第 ${prefs.length} 条): ${content.slice(0, 200)}${NL}发 /memory 能看全部、能删。`);
    return;
  }
  if (text.startsWith("/memory")) {
    await sendMemoryList(env, chatId);
    return;
  }
  if (text.startsWith("/forget")) {
    await setPrefs(env, chatId, []);
    await sendText(env, chatId, "长期记忆全清了, 咱重新认识。短期聊天记忆还在, /new 能一起清。");
    return;
  }
  if (text.startsWith("/persona")) {
    const arg = text.slice("/persona".length).trim().toLowerCase();
    const alias = { "小多": "default", "默认": "default", "代码": "coder", "故事": "story", "编剧": "story", "翻译": "translator", "毒舌": "roast", "损友": "roast" };
    const pid = PERSONAS[arg] ? arg : alias[arg];
    if (pid) {
      await kvPut(env, `persona:${chatId}`, pid);
      await sendText(env, chatId, `好, 人设换成「${PERSONAS[pid].label}」了。继续聊吧。`, undefined, MENU_KB);
      return;
    }
    await sendPersonaPicker(env, chatId);
    return;
  }
  if (text.startsWith("/auto")) {
    const cur = (await kvGet(env, `auto:${chatId}`)) === "1";
    await kvPut(env, `auto:${chatId}`, cur ? "0" : "1");
    await sendText(
      env,
      chatId,
      cur
        ? "智能选模型关了, 之后都用你选定的大脑。"
        : "智能选模型开了: 闲聊自动走快档, 代码和难题自动走 DeepSeek 强档。想手动锁死就 /model 选一个再把 /auto 关掉。"
    );
    return;
  }
  if (text.startsWith("/bill")) {
    const arg = text.slice("/bill".length).trim();
    const list = await getBills(env, chatId);
    if (!list.length) {
      await sendText(env, chatId, "🧾 还没记过账。直接在聊天里发「午饭35」我就记上了；收入发「收入100 备注」。");
      return;
    }
    let out = await billText(env, chatId);
    if (arg.includes("点评")) {
      const s = billSums(list, Date.now());
      try {
        const c = await quickComplete(env, "你是一个说话直接的记账点评员，用一两句口语点评主人的花钱情况，给一个具体的小建议，不说教、不啰嗦。", `本月支出 ¥${s.m.toFixed(2)}，本周 ¥${s.w.toFixed(2)}，今日 ¥${s.d.toFixed(2)}，本月收入 ¥${s.inc.toFixed(2)}，分类：${Object.entries(s.cats).map(([k, v]) => `${k} ¥${v.toFixed(2)}`).join("，")}`);
        out += NL + NL + "💬 " + c;
      } catch {}
    }
    await sendText(env, chatId, out, undefined, MENU_KB);
    return;
  }
  if (text.startsWith("/todos")) {
    await sendTodos(env, chatId);
    return;
  }
  if (text.startsWith("/todo")) {
    const arg = text.slice("/todo".length).trim();
    if (!arg) { await sendTodos(env, chatId); return; }
    const p = parseDue(arg);
    const list = await getTodos(env, chatId);
    const it = { id: uid(), text: p.text || arg, due: p.due, done: false, ts: Date.now() };
    list.push(it);
    await setTodos(env, chatId, list);
    await pushUndo(env, chatId, { kind: "todo", id: it.id });
    await sendText(env, chatId, `✅ 待办记上了：${it.text}${it.due ? `（${fmtTimeCst(it.due)}）` : ""}${NL}发 /todos 看全部，点按钮能标完成。`);
    return;
  }
  if (text.startsWith("/notes")) {
    const kw = text.slice("/notes".length).trim();
    const list = await getNotes(env, chatId);
    if (!list.length) {
      await sendText(env, chatId, "📝 备忘录是空的。发 /note 内容 就能记。");
      return;
    }
    const hits = (kw ? list.filter((n) => n.text.includes(kw)) : list).slice(-10).reverse();
    if (!hits.length) {
      await sendText(env, chatId, `没找到带「${kw}」的备忘。`);
      return;
    }
    await sendText(env, chatId, [`📝 备忘录${kw ? `（搜「${kw}」）` : ""}，共 ${list.length} 条:`, ...hits.map((n, i) => `${i + 1}. ${n.text}（${new Date(n.ts + 8 * 3600 * 1000).toISOString().slice(5, 10)}）`)].join(NL), undefined, MENU_KB);
    return;
  }
  if (text.startsWith("/note")) {
    const arg = text.slice("/note".length).trim();
    if (!arg) {
      await sendText(env, chatId, "格式：/note 要记的内容。看备忘发 /notes，搜备忘发 /notes 关键词。");
      return;
    }
    const it = await addNote(env, chatId, arg);
    await sendText(env, chatId, `📝 记下了：${it.text}${NL}发 /notes 随时翻，/undo 能撤销。`);
    return;
  }
  if (text.startsWith("/save")) {
    const arg = text.slice("/save".length).trim();
    const sp = arg.indexOf(" ");
    if (sp < 1) {
      await sendText(env, chatId, "格式：/save 名字 模板内容。比如 /save 夸我 用三句话夸夸我，要真诚");
      return;
    }
    const name = arg.slice(0, sp).slice(0, 12);
    const content = arg.slice(sp + 1).trim();
    const tpls = await getTpls(env, chatId);
    tpls[name] = content;
    await kvPut(env, `tpl:${chatId}`, JSON.stringify(tpls));
    await pushUndo(env, chatId, { kind: "tpl", name });
    await sendText(env, chatId, `💾 模板「${name}」存好了。发 /use ${name} 就能用，/tpls 看全部。`);
    return;
  }
  if (text.startsWith("/tpls")) {
    const tpls = await getTpls(env, chatId);
    const names = Object.keys(tpls);
    await sendText(env, chatId, names.length ? `💾 我的模板：${names.join("、")}${NL}发 /use 名字 调用。` : "还没有模板。发 /save 名字 内容 存一个。");
    return;
  }
  if (text === "/use" || text.startsWith("/use ")) {
    const arg = text.slice("/use".length).trim();
    const sp = arg.indexOf(" ");
    const name = sp < 0 ? arg : arg.slice(0, sp);
    const extra = sp < 0 ? "" : arg.slice(sp + 1).trim();
    const tpls = await getTpls(env, chatId);
    if (!name || !tpls[name]) {
      await sendText(env, chatId, `没找到这个模板。现有：${Object.keys(tpls).join("、") || "（空）"}。发 /tpls 看全部。`);
      return;
    }
    const phId = await sendPlaceholder(env, chatId, "💭 小多正在按模板干活…", msg.message_id, threadId);
    try {
      const prompt = tpls[name] + (extra ? `${NL}补充材料/要求：${extra}` : "");
      const reply = await aiChat(env, chatId, prompt, `（用了模板「${name}」）`, { memKey });
      await deliverAiReply(env, chatId, phId, reply, text);
    } catch (e) {
      await editOrSend(env, chatId, phId, chatErrorText(e), undefined, false);
    }
    return;
  }
  if (text.startsWith("/undo")) {
    await doUndo(env, chatId);
    return;
  }
  {
    const quickMap = [
      ["/tr", "你是翻译官：输入是中文就译成自然英文，是英文或其他语言就译成中文。只输出译文，不要任何解释。"],
      ["/sum", "把用户给的文本总结成 3 到 5 个要点，中文，简洁直接，只输出要点。"],
      ["/fix", "修正下面文本的错别字、标点和明显语病，只输出修正后的全文，不要解释，保持原意和语气。"],
      ["/en", "把用户给的中文翻译成自然地道的英文，只输出英文译文。"],
    ];
    let quickHit = null;
    for (const [cmd, sys] of quickMap) {
      if (text === cmd || text.startsWith(cmd + " ")) { quickHit = { cmd, sys }; break; }
    }
    if (quickHit) {
      let input = text.slice(quickHit.cmd.length).trim();
      if (!input && msg.reply_to_message && msg.reply_to_message.text) input = msg.reply_to_message.text;
      if (!input) {
        if (quickHit.cmd !== "/tr") {
          await sendText(env, chatId, `格式：${quickHit.cmd} 要处理的内容，或者引用一条消息再发 ${quickHit.cmd}。`);
          return;
        }
        // 裸 /tr 落回原有翻译模式 (后面的处理器)
      } else {
        const phId = await sendPlaceholder(env, chatId, "✍️ 小多处理中…", msg.message_id, threadId);
        try {
          const out = await quickComplete(env, quickHit.sys, input.slice(0, 4000));
          await editOrSend(env, chatId, phId, out, undefined, false);
        } catch (e) {
          await editOrSend(env, chatId, phId, "处理失败了，再试一次。", undefined, false);
        }
        return;
      }
    }
  }
  if (text.startsWith("/pin")) {
    const arg = text.slice("/pin".length).trim();
    if (!arg) {
      const cur = await kvGet(env, `pin:${chatId}`);
      await sendText(env, chatId, cur ? `📌 当前钉住的：${cur}${NL}发 /unpin 取消，/pin 新内容 覆盖。` : "还没有钉住的信息。发 /pin 内容 就能钉一条，比如 /pin 我在福州，喜欢吃辣");
      return;
    }
    await kvPut(env, `pin:${chatId}`, arg.slice(0, 300));
    await sendText(env, chatId, `📌 钉好了，以后每轮聊天我都记着：${arg.slice(0, 300)}`);
    return;
  }
  if (text.startsWith("/unpin")) {
    if (env.BOT_KV) await env.BOT_KV.delete(`pin:${chatId}`);
    await sendText(env, chatId, "📌 取消钉住了。");
    return;
  }
  if (text.startsWith("/backup")) {
    const data = await collectBackup(env, chatId);
    await sendDocument(env, chatId, JSON.stringify(data, null, 2), `xiaoduo-backup-${cstDateStr(Date.now())}.json`, "📦 这是你的全部数据备份（记忆/账本/待办/备忘/模板/提醒/习惯/日记/设置）。另外我每天自动存一份快照保留 7 天，周日还会自动发你一份冷备份。");
    return;
  }
  if (text.startsWith("/restore")) {
    await kvPut(env, `awaitrestore:${chatId}`, "1", 600);
    await sendText(env, chatId, "把之前 /backup 导出的那个 json 文件直接发我，我就恢复（10 分钟内有效）。注意：恢复会用备份覆盖现在的数据。");
    return;
  }
  if (text.startsWith("/habit")) {
    const arg = text.slice("/habit".length).trim();
    if (!arg) { await sendText(env, chatId, await habitText(env, chatId)); return; }
    const names = arg.split(/[,，、]/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
    const old = await getHabits(env, chatId);
    const h = {};
    for (const n of names) h[n] = old[n] || { days: {} };
    await saveHabits(env, chatId, h);
    await sendText(env, chatId, `🔥 习惯定好啦：${names.join("、")}。每天说「打卡 习惯名」就行，比如「打卡 ${names[0]}」。`);
    return;
  }
  if (text.startsWith("/diary")) {
    const arg = text.slice("/diary".length).trim();
    if (!arg) { await sendText(env, chatId, await diaryText(env, chatId)); return; }
    if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) { await sendText(env, chatId, await diaryText(env, chatId, arg)); return; }
    const d = await getDiary(env, chatId);
    const day = cstDateStr(Date.now());
    if (!d[day]) d[day] = [];
    d[day].push({ ts: Date.now(), raw: arg, tidy: "" });
    await kvPut(env, `diary:${chatId}`, JSON.stringify(d), 60 * 60 * 24 * 365);
    await sendText(env, chatId, "📔 记进今天的日记啦。发 /diary 能看最近 7 天。");
    return;
  }
  if (text.startsWith("/settings")) {
    await sendSettings(env, chatId);
    return;
  }
  if (text.startsWith("/usage")) {
    await sendText(env, chatId, await usageText(env, chatId), undefined, MENU_KB);
    return;
  }
  if (text.startsWith("/temp")) {
    const arg = text.slice("/temp".length).trim();
    const st = await getSettings(env, chatId);
    if (arg) {
      const v = parseFloat(arg);
      if (isNaN(v) || v < 0 || v > 2) {
        await sendText(env, chatId, "温度范围 0 到 2：0 最严谨，0.7 日常，1.2 以上开始放飞。格式：/temp 0.7");
        return;
      }
      st.temp = v;
      await saveSettings(env, chatId, st);
      await sendText(env, chatId, `好，温度设成 ${v} 了。`);
      return;
    }
    await sendText(env, chatId, `当前温度：${st.temp == null ? "默认" : st.temp}。改它发 /temp 数字（0~2）。`);
    return;
  }
  if (text.startsWith("/maxtokens") || text.startsWith("/max")) {
    const arg = text.replace(/^\/(maxtokens|max)/, "").trim();
    const st = await getSettings(env, chatId);
    if (arg) {
      const v = parseInt(arg, 10);
      if (isNaN(v) || v < 0 || v > 8000) {
        await sendText(env, chatId, "长度上限 0 到 8000 token，0 = 不限。格式：/max 2000");
        return;
      }
      st.max = v > 0 ? v : null;
      await saveSettings(env, chatId, st);
      await sendText(env, chatId, v > 0 ? `好，回复长度上限设成 ${v} token 了。` : "好，回复长度不限了。");
      return;
    }
    await sendText(env, chatId, `当前长度上限：${st.max ? st.max + " token" : "默认（不限）"}。改它发 /max 数字。`);
    return;
  }
  if (text.startsWith("/panel")) {
    await sendPanel(env, chatId, userId);
    return;
  }
  if (text.startsWith("/status")) {
    await sendText(env, chatId, await statusText(env, chatId, userId), undefined, MENU_KB);
    return;
  }
  if (text.startsWith("/check")) {
    await doCheck(env, chatId, msg.message_id);
    return;
  }
  if (text === "/arena" || text.startsWith("/arena ")) {
    const q = text.slice("/arena".length).trim();
    if (!q) {
      await sendText(env, chatId, "格式: /arena 你的问题, 比如 /arena 用一句话解释什么是黑洞");
      return;
    }
    await doArena(env, chatId, userId, q, msg.message_id);
    return;
  }
  if (text.startsWith("/retry")) {
    await doRetry(env, chatId, userId, msg.message_id);
    return;
  }
  if (text === "/remind" || text.startsWith("/remind ")) {
    const arg = text.slice("/remind".length).trim();
    const parsed = parseRemind2(arg);
    if (!parsed) {
      await sendText(env, chatId, `格式: /remind 30分钟后 喝水, 或者 /remind 20:30 交作业${NL}支持 分钟后、几点几分、明天9点这种写法, 内容跟在后面; 聊天里直接说「提醒我…」也行。`);
      return;
    }
    const list = await getReminders(env, chatId);
    list.push(parsed);
    await setReminders(env, chatId, list);
    await pushUndo(env, chatId, { kind: "remind", at: parsed.at, text: parsed.text });
    await sendText(env, chatId, `好, ${fmtTimeCst(parsed.at)} 我提醒你: ${parsed.text}${NL}(我每 15 分钟看一眼表, 可能晚几分钟, 别拿它卡秒。)`);
    return;
  }
  if (text.startsWith("/reminders")) {
    await sendRemindersList(env, chatId);
    return;
  }
  if (text === "/watch" || text.startsWith("/watch ")) {
    const arg = text.slice("/watch".length).trim();
    const list = await getWatch(env, chatId);
    if (!arg || arg === "list") {
      await sendText(
        env,
        chatId,
        list.length
          ? [`👀 我在盯的网页:`, ...list.map((w, i) => `${i + 1}. ${w.url}`), "", "每天早报时帮你看一遍, 变了会标出来。/watch clear 全部取消。"].join(NL)
          : "还没盯任何网页。发 /watch 网址 就能加一个 (最多 5 个)。"
      );
      return;
    }
    if (arg === "clear") {
      await setWatch(env, chatId, []);
      await sendText(env, chatId, "盯梢全取消了。");
      return;
    }
    const url = extractFirstUrl(arg);
    if (!url) {
      await sendText(env, chatId, "格式: /watch https://example.com 这样发完整网址。");
      return;
    }
    if (list.some((w) => w.url === url)) {
      await sendText(env, chatId, "这个网页已经在盯了。");
      return;
    }
    if (list.length >= 5) {
      await sendText(env, chatId, "最多盯 5 个, 先 /watch clear 清掉旧的再加。");
      return;
    }
    let hash = "";
    try {
      hash = hashText((await fetchPageText(url)) || "");
    } catch {
      hash = "";
    }
    list.push({ url, hash });
    await setWatch(env, chatId, list);
    await sendText(env, chatId, `盯上了: ${url}${NL}以后每天早报时帮你看它变没变。`);
    return;
  }
  if (text.startsWith("/export")) {
    const prefs = await getPrefs(env, chatId);
    const rawMem = await kvGet(env, `mem:${chatId}`);
    let hist = [];
    if (rawMem) {
      try {
        hist = JSON.parse(rawMem);
      } catch {
        hist = [];
      }
    }
    const rems = await getReminders(env, chatId);
    const watch = await getWatch(env, chatId);
    const personaId = (await kvGet(env, `persona:${chatId}`)) || "default";
    const parts = [
      "=== 小多数据导出 ===",
      `导出时间: ${fmtTimeCst(Date.now())}`,
      `当前人设: ${(PERSONAS[personaId] || PERSONAS.default).label}`,
      `当前大脑: ${brainConfig(env, await getBrain(env, chatId)).label}`,
      "",
      "--- 长期记忆 ---",
      ...(prefs.length ? prefs.map((p, i) => `${i + 1}. ${p}`) : ["(空)"]),
      "",
      "--- 待响提醒 ---",
      ...(rems.length ? rems.map((r) => `${fmtTimeCst(r.at)} - ${r.text}`) : ["(无)"]),
      "",
      "--- 盯梢网页 ---",
      ...(watch.length ? watch.map((w) => w.url) : ["(无)"]),
      "",
      "--- 最近聊天记录 ---",
      ...(hist.length ? hist.map((h) => `${h.role === "user" ? "我" : "小多"}: ${h.content}`) : ["(空)"]),
    ];
    await sendDocument(env, chatId, parts.join(NL), "xiaoduo-export.txt", "📦 你的记忆和记录都在这了");
    return;
  }
  if (text.startsWith("/incognito")) {
    const cur = (await kvGet(env, `ghost:${chatId}`)) === "1";
    await kvPut(env, `ghost:${chatId}`, cur ? "0" : "1");
    await sendText(
      env,
      chatId,
      cur ? "假装失忆关了, 我又开始记事了。" : "假装失忆开了: 接下来我不读也不存任何记忆, 纯一次性聊天。再发一次 /incognito 关掉。"
    );
    return;
  }
  if (text.startsWith("/audit") || text.startsWith("/explain") || text.startsWith("/refactor") || text.startsWith("/tr")) {
    const id = text.startsWith("/audit")
      ? "audit"
      : text.startsWith("/explain")
        ? "explain"
        : text.startsWith("/refactor")
          ? "refactor"
          : "translate";
    const rest = text.replace(/^\/(audit|explain|refactor|tr)\s*/, "").trim();
    if (rest) {
      if (!(await quotaTake(env, userId))) {
        await sendText(env, chatId, "今天的 AI 额度用完了, 明天再来。");
        return;
      }
      await tg(env, "sendChatAction", { chat_id: chatId, action: "typing" });
      const phId = await sendPlaceholder(env, chatId, `🛠️ 小多正在用「${WRAPS[id].name}」处理…`, msg.message_id);
      try {
        const reply = await aiChat(env, chatId, WRAPS[id].make(rest), `（${WRAPS[id].name}了一段内容）`);
        await deliverAiReply(env, chatId, phId, reply, rest);
      } catch (e) {
        await editOrSend(env, chatId, phId, chatErrorText(e), undefined, false);
      }
      return;
    }
    await kvPut(env, `wrap:${chatId}`, id, 600);
    await sendText(env, chatId, `好, 「${WRAPS[id].name}」模式开了。${WRAPS[id].hint}`);
    return;
  }
  if (text.startsWith("/")) {
    await sendText(env, chatId, "这个命令我不认识, /help 看看我会啥。");
    return;
  }

  // 自然语言记一下: 永久进长期记忆
  if (text.startsWith("记一下")) {
    const content = text.slice(3).replace(/^[:：,，、\s]+/, "").trim();
    if (content) {
      const prefs = await getPrefs(env, chatId);
      prefs.push(content.slice(0, 200));
      await setPrefs(env, chatId, prefs);
      await sendText(env, chatId, `记住了 (第 ${prefs.length} 条): ${content.slice(0, 200)}${NL}发 /memory 能看全部、能删。`, msg.message_id);
      return;
    }
  }

  // 代码工坊的后续: 等内容中
  const wrapId = await kvGet(env, `wrap:${chatId}`);
  if (wrapId && WRAPS[wrapId]) {
    if (env.BOT_KV) await env.BOT_KV.delete(`wrap:${chatId}`);
    if (!(await quotaTake(env, userId))) {
      await sendText(env, chatId, "今天的 AI 额度用完了, 明天再来。");
      return;
    }
    await tg(env, "sendChatAction", { chat_id: chatId, action: "typing" });
    const phId = await sendPlaceholder(env, chatId, `🛠️ 小多正在用「${WRAPS[wrapId].name}」处理…`, msg.message_id);
    try {
      const reply = await aiChat(env, chatId, WRAPS[wrapId].make(text), `（${WRAPS[wrapId].name}了一段内容）`);
      await deliverAiReply(env, chatId, phId, reply, text);
    } catch (e) {
      console.log("wrap err", e);
      await editOrSend(env, chatId, phId, chatErrorText(e), undefined, false);
    }
    return;
  }

  // 画图按钮的后续: 等描述中
  const awaiting = await kvGet(env, `awaitdraw:${chatId}`);
  if (awaiting) {
    if (env.BOT_KV) await env.BOT_KV.delete(`awaitdraw:${chatId}`);
    await doDraw(env, chatId, userId, text, msg.message_id);
    return;
  }

  // 搜索按钮的后续: 等关键词中
  const awaitSearch = await kvGet(env, `awaitsearch:${chatId}`);
  if (awaitSearch) {
    if (env.BOT_KV) await env.BOT_KV.delete(`awaitsearch:${chatId}`);
    if (!env.TAVILY_API_KEY) {
      await sendText(env, chatId, "联网搜索还没接入: 需要一把 Tavily 的免费 key (找 Algo 带你注册)。");
      return;
    }
    await doSearch(env, chatId, userId, text, msg.message_id);
    return;
  }

  // 查仓库按钮的后续: 等仓库名中
  const awaitGh = await kvGet(env, `awaitgh:${chatId}`);
  if (awaitGh) {
    if (env.BOT_KV) await env.BOT_KV.delete(`awaitgh:${chatId}`);
    await tg(env, "sendChatAction", { chat_id: chatId, action: "typing" });
    try {
      await sendText(env, chatId, await ghInfo(text), msg.message_id);
    } catch (e) {
      console.log("gh err", e);
      await sendText(env, chatId, "没查到这个仓库。格式是 用户名/仓库名, 仓库得是公开的。", msg.message_id);
    }
    return;
  }

  // 聊天里直接发 addstickers 链接: 整包自动装下 (v6.3)
  if (chatType === "private") {
    const packNames = [...new Set([...text.matchAll(/addstickers\/([A-Za-z0-9_]+)/g)].map((x) => x[1]))];
    if (packNames.length) {
      for (const name of packNames) {
        const r = await addStickerPack(env, chatId, name);
        await sendText(
          env,
          chatId,
          r.ok
            ? `「${r.title}」整包装下了 🎴 新增 ${r.added} 张, 我现在一共会 ${r.total} 张贴纸。`
            : `「${name}」这个包没拉下来, 链接可能不对。`
        );
      }
      return;
    }
  }

  // ----- 输入框下方常驻按钮 (回复键盘): 文本按钮路由 (v6.2) -----
  if (chatType === "private" && !text.startsWith("/")) {
    const kbAct = {
      "✨ 高级面板": "panel",
      "🎵 点歌": "music",
      "🧠 当前模型": "model",
      "☀️ 今日早报": "morning",
      "🧵 话题": "topics",
      "🎨 画图": "draw",
      "🆕 新话题": "new",
      "❓ 帮助": "help",
    }[text];
    if (kbAct === "panel") {
      await sendPanel(env, chatId, userId);
      return;
    }
    if (kbAct === "music") {
      await kvPut(env, `awaitmusic:${chatId}`, "1", 300);
      await sendText(env, chatId, "想听啥? 直接发歌名给我, 比如: 入戏太深", undefined, undefined, false, threadId);
      return;
    }
    if (kbAct === "model") {
      await sendModelPicker(env, chatId);
      return;
    }
    if (kbAct === "morning") {
      await sendText(env, chatId, await briefingText(env, chatId));
      return;
    }
    if (kbAct === "topics") {
      await setupTopics(env, chatId, userId);
      return;
    }
    if (kbAct === "draw") {
      await kvPut(env, `awaitdraw:${chatId}`, "1", 300);
      await sendText(env, chatId, "想画啥? 直接发一句描述给我就行, 比如: 一只在海边看日落的橘猫");
      return;
    }
    if (kbAct === "new") {
      if (env.BOT_KV) await env.BOT_KV.delete(memKey);
      await sendText(env, chatId, threadId ? "这个话题的记忆清空了, 咱重新聊。" : "记忆清空了, 咱重新聊。");
      return;
    }
    if (kbAct === "help") {
      await sendText(env, chatId, HELP, undefined, MENU_KB);
      return;
    }
  }

  // 深链接模式: 等总结材料中 -> 把下一条内容改写成总结任务, 继续走正常流程
  const awaitSum = await kvGet(env, `awaitsum:${chatId}`);
  if (awaitSum && !text.startsWith("/")) {
    if (env.BOT_KV) {
      try { await env.BOT_KV.delete(`awaitsum:${chatId}`); } catch {}
    }
    text = ["请总结下面这段内容: 先用一句话说清核心, 再用要点列出关键信息, 最后给一句结论。", "", text].join(NL);
  }

  // 造工具模式: 等需求描述中
  const awaitTool = await kvGet(env, `awaittool:${chatId}`);
  if (awaitTool && !text.startsWith("/")) {
    if (env.BOT_KV) {
      try { await env.BOT_KV.delete(`awaittool:${chatId}`); } catch {}
    }
    await doToolGen(env, chatId, userId, text, msg.message_id);
    return;
  }

  // 音乐按钮的后续: 等歌名中
  const awaitMusic = await kvGet(env, `awaitmusic:${chatId}`);
  if (awaitMusic) {
    if (env.BOT_KV) await env.BOT_KV.delete(`awaitmusic:${chatId}`);
    await doMusicSearch(env, chatId, userId, text, msg.message_id, threadId);
    return;
  }

  // 点歌列表出来后, 打字回第几个也行: 数字/中文数字/带尾巴都认 (v6.3.2)
  let pickNo = null;
  const pmA = text.match(/^第?\s*(\d{1,2})\s*个?$/);
  const pmB = text.length <= 8 ? text.match(/第\s*([一二两三四五六七八九十])\s*个/) : null;
  if (pmA) pickNo = parseInt(pmA[1], 10);
  else if (pmB) pickNo = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }[pmB[1]];
  if (pickNo != null) {
    let ord = null;
    try {
      ord = JSON.parse((await kvGet(env, `musord:${chatId}`)) || "null");
    } catch {
      ord = null;
    }
    if (Array.isArray(ord) && ord.length) {
      const idx = pickNo - 1;
      if (idx >= 0 && idx < ord.length) {
        await doMusicPlay(env, chatId, ord[idx], threadId);
      } else {
        await sendText(env, chatId, `刚才那份列表里只有 ${ord.length} 首, 没有第 ${pickNo} 个。`, undefined, undefined, false, threadId);
      }
      return;
    }
  }

  // 只说放音乐/听歌没给歌名: 先问歌名 (v6.3)
  if (isBareMusicAsk(text)) {
    await kvPut(env, `awaitmusic:${chatId}`, "1", 300);
    await sendText(env, chatId, "想听歌是吧 🎵 直接发歌名给我, 我搜出来你挑第几个。");
    return;
  }

  // 自然语言点歌: 放/来一首/听 + 歌名
  const songAsk = parseSongAsk(text);
  if (songAsk) {
    await doMusicSearch(env, chatId, userId, songAsk, msg.message_id, threadId);
    return;
  }

  // v6.5 关键词直答 + 聊天记账/提醒/待办 (不烧 AI 额度)
  if (text === "⌨️ 恢复键盘") {
    await sendText(env, chatId, "键盘恢复啦 👇", undefined, REPLY_KB, false, threadId);
    return;
  }
  if (await tryIntent(env, chatId, userId, text, threadId)) return;
  {
    const remMatch = text.match(/^提醒我\s*(.+)$/);
    let remP = remMatch ? parseRemind2(remMatch[1]) : null;
    if (!remP && text.length <= 30 && /(叫我|喊我)/.test(text) && /(明天|今天|今晚|明早|明晚|后天|点|[:：]|分钟后|小时后)/.test(text)) {
      const cand = text.replace(/提醒我/g, "").replace(/叫我/g, "").replace(/喊我/g, "").trim();
      if (cand && cand !== text) remP = parseRemind2(cand);
    }
    if (remP) {
      const p = remP;
      if (p) {
        const list = await getReminders(env, chatId);
        list.push(p);
        await setReminders(env, chatId, list);
        await pushUndo(env, chatId, { kind: "remind", at: p.at, text: p.text });
        await sendText(env, chatId, `好，${fmtTimeCst(p.at)} 我提醒你：${p.text}`, undefined, undefined, false, threadId);
        return;
      }
    }
    const ck = text.match(/^打卡\s*(.*)$/);
    if (ck) { await doCheckin(env, chatId, ck[1].trim(), threadId); return; }
    const dask = await kvGet(env, `diaryask:${chatId}`);
    if (dask && dask === cstDateStr(Date.now()) && !text.startsWith("/")) {
      await saveDiaryEntry(env, chatId, text, threadId);
      return;
    }
    const cardDigits = text.replace(/[\s-]/g, "");
    if (/^\d{15,19}$/.test(cardDigits) && luhnOk(cardDigits)) {
      await sendText(env, chatId, "⚠️ 停一下：这串数字看着像银行卡号。别在聊天里发明文卡号，不安全，我也不会存它。真怕忘，就记个提示（比如「卡在手机备忘录里」），别记号码本身。", undefined, undefined, false, threadId);
      return;
    }
    const billHit = parseBillChat(text);
    if (billHit) {
      const it = await addBill(env, chatId, billHit.amt, billHit.note, billHit.income);
      const s = billSums(await getBills(env, chatId), Date.now());
      await sendText(env, chatId, `🧾 记上了：${billHit.income ? "收入" : it.cat} ${billHit.note} ¥${billHit.amt}${NL}今日支出 ¥${s.d.toFixed(2)} · 本月支出 ¥${s.m.toFixed(2)}${NL}发 /bill 看账本，/undo 撤销这笔。`, undefined, undefined, false, threadId);
      return;
    }
    const todoHit = parseTodoChat(text);
    if (todoHit) {
      const list = await getTodos(env, chatId);
      const it = { id: uid(), text: todoHit.text, due: todoHit.due, done: false, ts: Date.now() };
      list.push(it);
      await setTodos(env, chatId, list);
      await pushUndo(env, chatId, { kind: "todo", id: it.id });
      await sendText(env, chatId, `✅ 待办记上了：${it.text}${it.due ? `（${fmtTimeCst(it.due)}）` : ""}。发 /todos 看全部。`, undefined, undefined, false, threadId);
      return;
    }
  }

  if (!(await quotaTake(env, userId))) {
    await sendText(env, chatId, "今天的 AI 额度用完了, 明天再来。");
    return;
  }
  const stopTyping = keepTyping(env, chatId, undefined, threadId);

  // ----- 读链接 -----
  const pageUrl = extractFirstUrl(text);
  if (pageUrl) {
    const phId = await sendPlaceholder(env, chatId, "🔗 小多正在读这篇文章…", msg.message_id, threadId);
    try {
      const pageText = await fetchPageText(pageUrl);
      if (!pageText || pageText.length < 30) throw new Error("empty page");
      const ask = text.replace(pageUrl, "").trim() || "请总结这篇文章的要点, 说清它讲了什么、重点在哪";
      const prompt = [
        `我分享了一篇文章链接: ${pageUrl}`,
        "正文如下:",
        "---",
        pageText,
        "---",
        `我的要求: ${ask}`,
      ].join(NL);
      const reply = await aiChat(env, chatId, prompt, `（分享了链接 ${pageUrl}）`, { memKey });
      await deliverAiReply(env, chatId, phId, reply, text);
    } catch (e) {
      console.log("page err", e);
      await editOrSend(
        env,
        chatId,
        phId,
        "这个链接我没读进去 (可能被网站挡了, 或者要登录才能看)。你把正文复制发我, 我一样能帮你总结。",
        undefined,
        false
      );
    }
    stopTyping();
    return;
  }

  // ----- 普通聊天 (v6.0: 富文本草稿流式 + 可停止 + 富文本气泡落盘) -----
  const draftId = msg.message_id || Date.now() % 1000000000;
  if (env.BOT_KV) {
    try { await env.BOT_KV.delete(`stopgen:${chatId}`); } catch {}
  }
  await reactTo(env, chatId, msg.message_id, "🤔");
  let streamed = false;
  try {
    await tg(env, "sendRichMessageDraft", {
      chat_id: chatId,
      ...(threadId ? { message_thread_id: threadId } : {}),
      draft_id: draftId,
      rich_message: { markdown: "💭 思考中…" },
      can_stop: true,
      keep_on_stop: true,
    });
    const reply = await aiChatStream(
      env,
      chatId,
      text,
      undefined,
      { plain: true, memKey, stopCheck: async () => (await kvGet(env, `stopgen:${chatId}`)) === "1" },
      async (partial) => {
        await tg(env, "sendRichMessageDraft", {
          chat_id: chatId,
          ...(threadId ? { message_thread_id: threadId } : {}),
          draft_id: draftId,
          rich_message: { markdown: partial.slice(0, 30000) },
          can_stop: true,
          keep_on_stop: true,
        });
      }
    );
    streamed = true;
    const wasStopped = (await kvGet(env, `stopgen:${chatId}`)) === "1";
    const finalText = wasStopped ? reply + NL + NL + "⏹️ (你按了停止, 先到这)" : reply;
    const quoteOpts =
      msg.quote && msg.reply_to_message
        ? {
            message_id: msg.reply_to_message.message_id,
            quote: String(msg.quote.text || "").slice(0, 1024),
            quote_entities: msg.quote.entities,
          }
        : null;
    await deliverStreamReply(env, chatId, finalText, text, quoteOpts, threadId);
    await reactTo(env, chatId, msg.message_id, wasStopped ? "👌" : "👍");
    if (!wasStopped) await maybeMoodSticker(env, chatId, threadId, text, finalText);
  } catch (e) {
    console.log("stream chat err, fallback", e);
    if (!streamed) {
      const phId = await sendPlaceholder(env, chatId, "💭 小多正在思考…", msg.message_id, threadId);
      try {
        const reply = await aiChat(env, chatId, text, undefined, { plain: true, memKey });
        await deliverAiReply(env, chatId, phId, reply, text);
        await reactTo(env, chatId, msg.message_id, "👍");
        await maybeMoodSticker(env, chatId, threadId, text, reply);
      } catch (e2) {
        console.log("chat err", e2);
        await editOrSend(env, chatId, phId, chatErrorText(e2), e2.status === 402 ? MODEL_KB : undefined, false);
      }
    }
  }
  stopTyping();
}
