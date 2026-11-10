// dq686BOT v5 - Cloudflare Workers 版
// 大脑 (可切换, 共用同一份聊天记录):
//   DeepSeek 日常 (deepseek-chat) / DeepSeek 深度思考 (deepseek-reasoner)
//   GPT-OSS 120B (Groq 免费) / GPT-OSS 20B (Groq 免费, 更快)
// v5 新增: 长期记忆库 (/remember /memory /forget)、人设切换 (/persona)、智能选模型 (/auto)
//   四模型自检 (/check)、双模型擂台 (/arena)、换模型重答 (/retry)、定时提醒 (/remind)
//   网页盯梢 (/watch, 并入每日早报)、代码工坊 (/audit /explain /refactor /tr)
//   导出 (/export)、假装失忆 (/incognito)、状态卡 (/status)
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
//   VISION_MODEL     可选, 默认 meta-llama/llama-4-scout-17b-16e-instruct
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
/retry - 换个模型重答上一题 (回复下面也有按钮)

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
/music 歌名 - 搜歌点歌 (点结果里的数字就发歌; 也可直接说 放+歌名)
/morning - 今日早报
/myid - 我的 Telegram 数字 ID

点菜单按钮也能办大部分事, 不用记命令。`;

const MENU_KB = {
  inline_keyboard: [
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
    [{ text: "🆔 我的ID", callback_data: "m:myid" }],
  ],
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

const BRAIN_IDS = ["deepseek", "deepseek-pro", "gptoss", "gptoss20"];
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
  lines.push("你自带点歌功能: 主人想听歌时, 他点菜单里的「🎵 音乐」按钮或发 /music 歌名, 你就能把歌以语音形式发给他听。不要说你放不了音乐、只能发文字, 那是错的。");
  const ghost = (await kvGet(env, `ghost:${chatId}`)) === "1";
  if (!ghost) {
    const prefs = await getPrefs(env, chatId);
    if (prefs.length) {
      lines.push("关于主人的长期记忆 (回答时自然参考, 不要主动复述, 除非正好相关):");
      prefs.slice(0, 30).forEach((p, i) => lines.push(`${i + 1}. ${p}`));
    }
  }
  return lines.join(NL);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const secret = env.WEBHOOK_SECRET || "dq686hook";
    const path = url.pathname.replace(/^\/+/, "");

    if (request.method === "GET" && (path === "" || path === "health")) {
      return new Response("dq686bot is alive (cloudflare worker v5.6)", {
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
        if (!event.cron || event.cron === "0 0 * * *") {
          await sendBriefing(env).catch((e) => console.log("briefing err", e));
        }
      })()
    );
  },
};

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

async function sendText(env, chatId, text, replyTo, replyMarkup, useMd) {
  const chunks = splitChunks(text || "(空回复)");
  for (let i = 0; i < chunks.length; i++) {
    const payload = { chat_id: chatId, text: chunks[i] };
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
async function sendPlaceholder(env, chatId, text, replyTo) {
  const payload = { chat_id: chatId, text };
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
  const saved = await kvGet(env, `brain:${chatId}`);
  if (BRAIN_IDS.includes(saved) && brainConfig(env, saved).key) return saved;
  if (env.DEEPSEEK_API_KEY) return "deepseek";
  return "gptoss";
}

async function aiChat(env, chatId, userText, historyText, opts = {}) {
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
    const order = ["deepseek", "gptoss", "gptoss20", "deepseek-pro"];
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
    const raw = await kvGet(env, `mem:${chatId}`);
    if (raw) {
      try {
        history = JSON.parse(raw);
      } catch {
        history = [];
      }
    }
  }
  const messages = [
    { role: "system", content: await buildSystem(env, chatId, cfg.label) },
    ...history,
    { role: "user", content: userText },
  ];
  const t0 = Date.now();
  const r = await fetch(`${cfg.base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.key}`,
    },
    body: JSON.stringify({ model: cfg.model, messages }),
  });
  if (!r.ok) {
    const err = new Error(`AI HTTP ${r.status}`);
    err.status = r.status;
    err.brain = cfg.id;
    throw err;
  }
  const data = await r.json();
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
    while (history.length > MEM_ROUNDS * 2) history.shift();
    await kvPut(env, `mem:${chatId}`, JSON.stringify(history), 60 * 60 * 24 * 7);
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
  const model = env.VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";
  const b64 = bufToB64(imageBuf);
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model,
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
  if (!r.ok) throw new Error(`vision HTTP ${r.status}`);
  const data = await r.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}

// ---------- 语音转文字 (Groq Whisper) ----------
async function transcribeAudio(env, buf) {
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
  return (data.text || "").trim();
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

async function drawImage(prompt) {
  const q = encodeURIComponent(prompt);
  const r = await fetch(
    `https://image.pollinations.ai/prompt/${q}?width=1024&height=1024&nologo=true`,
    { headers: { "User-Agent": "dq686bot/5.0" } }
  );
  if (!r.ok) throw new Error(`draw HTTP ${r.status}`);
  return await r.arrayBuffer();
}

async function doDraw(env, chatId, userId, prompt, replyTo) {
  if (!(await quotaTake(env, userId))) {
    await sendText(env, chatId, "今天的 AI 额度用完了, 明天再来。", replyTo);
    return;
  }
  await sendText(env, chatId, "收到, 正在画, 大概十几秒...", replyTo);
  try {
    const buf = await drawImage(prompt);
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
  if (blocks.length) {
    await kvPut(env, `lastcode:${chatId}`, JSON.stringify(blocks), 60 * 60);
    const wantFile = (userText || "").includes("文件");
    const huge = blocks.some((b) => b.code.length > 3000);
    if (wantFile || huge) {
      await editOrSend(env, chatId, phId, reply, undefined, true);
      await sendBlocksAsFiles(env, chatId, blocks);
      return;
    }
    await editOrSend(env, chatId, phId, reply, replyKb(true), true);
    return;
  }
  await editOrSend(env, chatId, phId, reply, replyKb(false), true);
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
  const label = brainConfig(env, brain).label;
  await sendText(env, chatId, `好, 大脑切到 ${label} 了, 聊天记录照旧, 继续聊吧。`, undefined, MENU_KB);
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
  const phId = await sendPlaceholder(env, chatId, "🩺 小多正在自检四个大脑…", replyTo);
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
    await sendText(env, chatId, `⏰ 提醒到点啦: ${r.text}`);
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
  const wl = await checkWatchLines(env, chatId);
  return wl.length ? [base, "", ...wl].join(NL) : base;
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
    "📊 小多状态卡",
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

async function doMusicSearch(env, chatId, userId, query, replyTo) {
  await tg(env, "sendChatAction", { chat_id: chatId, action: "typing" });
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
    await sendText(env, chatId, neErr ? "音乐源站这会儿连不上, 等下再试。" : `没搜到「${query}」, 换个名字试试。`, replyTo);
    return;
  }
  const cache = {};
  for (const s of list) cache[s.key] = s;
  await kvPut(env, `musq:${chatId}`, JSON.stringify(cache), 1800);
  const lines = [`🎯 搜「${query}」找到这些, 点下面的数字按钮, 就发歌给你听:`];
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
  await sendText(env, chatId, lines.join(NL), replyTo, { inline_keyboard: rows });
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

function keepTyping(env, chatId, action) {
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    tg(env, "sendChatAction", { chat_id: chatId, action: action || "typing" }).catch(() => {});
  };
  tick();
  const iv = setInterval(tick, 4000);
  const cap = setTimeout(() => { stopped = true; clearInterval(iv); }, 90000);
  return () => { stopped = true; clearInterval(iv); clearTimeout(cap); };
}

async function ensureBotCommands(env) {
  try {
    if (await kvGet(env, "sys:cmdset")) return;
    await tg(env, "setMyCommands", {
      commands: [
        { command: "start", description: "🏠 打开菜单" },
        { command: "music", description: "🎵 点歌, 例: /music 入戏太深" },
        { command: "help", description: "❓ 帮助" },
        { command: "new", description: "🆕 新话题" },
        { command: "memory", description: "🧠 我的长期记忆" },
        { command: "remind", description: "⏰ 设个提醒" },
        { command: "status", description: "📊 机器人状态" },
      ],
    });
    await kvPut(env, "sys:cmdset", "1", 604800);
  } catch (e) {
    console.log("cmdset err", e);
  }
}

async function doMusicPlay(env, chatId, songId) {
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
  const stopUp = keepTyping(env, chatId, "upload_voice");
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
    await sendText(env, chatId, `《${name}》网易云和酷我这次都没拿到能放的完整版 (多半是版权限制), 换个版本试试。(诊断码 ${diag.stage}, 截图给 Algo 看)`);
    return;
  }
  const caption = `🎵 ${name}${artist ? " - " + artist : ""}${viaKuwo ? " (酷我源)" : ""}`;
  let sent = false;
  try {
    const vf = new FormData();
    vf.append("chat_id", String(chatId));
    const estSec = estimateMp3Seconds(buf);
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
  if (!sent) {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("title", name.slice(0, 60));
    if (artist) form.append("performer", artist.slice(0, 60));
    if (info?.dur) form.append("duration", String(info.dur));
    form.append("caption", caption);
    form.append("audio", new Blob([buf], { type: "audio/mpeg" }), `${name} - ${artist}.mp3`.slice(0, 80));
    try {
      const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendAudio`, { method: "POST", body: form });
      const j = await r.json();
      if (!j.ok) throw new Error("tg sendAudio " + (j.description || r.status));
      sent = true;
    } catch (e) {
      console.log("sendAudio err", e);
    }
  }
  if (!sent) {
    await sendText(env, chatId, `《${name}》传给你的时候出错了, 再点一次试试。`);
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

  if (data === "m:menu") {
    await sendText(env, chatId, "菜单在这, 点按钮或者直接发消息都行 👇", undefined, MENU_KB);
  } else if (data === "m:help") {
    await sendText(env, chatId, HELP, undefined, MENU_KB);
  } else if (data === "m:new") {
    if (env.BOT_KV) await env.BOT_KV.delete(`mem:${chatId}`);
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
    await sendText(env, chatId, "想听啥? 直接发歌名给我, 比如: 入戏太深");
  } else if (data.startsWith("mus:")) {
    await doMusicPlay(env, chatId, data.slice(4));
  } else if (data === "m:morning") {
    await sendText(env, chatId, await briefingText(env, chatId));
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
  }
}

// ---------- 消息处理 ----------
async function handleUpdate(env, update) {
  const uid0 = update.callback_query?.from?.id || update.message?.from?.id || update.channel_post?.from?.id;
  if (uid0 != null && (await isAllowed(env, uid0))) await ensureBotCommands(env);
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
    if (!env.GROQ_API_KEY) {
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
    const phId = await sendPlaceholder(env, chatId, "👀 小多正在看图…", msg.message_id);
    try {
      const fileId = photos[photos.length - 1].file_id;
      const info = await tg(env, "getFile", { file_id: fileId });
      const filePath = info?.result?.file_path;
      const fr = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`);
      const buf = await fr.arrayBuffer();
      const prompt = caption || "用中文详细描述并解释这张图片的内容。";
      const answer = await aiVision(env, buf, prompt);
      await editOrSend(env, chatId, phId, answer, undefined, true);
    } catch (e) {
      console.log("vision err", e);
      await editOrSend(env, chatId, phId, "看图时出了点问题, 稍后再发一次试试。", undefined, false);
    }
    return;
  }

  if (!text) return;

  if (text.startsWith("/start")) {
    await ensureBotCommands(env);
    await sendText(env, chatId, "在呢, 喊一声就应 👋 我是小多。直接发消息跟我聊, 或者点下面的按钮 👇", undefined, MENU_KB);
    return;
  }
  if (text.startsWith("/help")) {
    await sendText(env, chatId, HELP, undefined, MENU_KB);
    return;
  }
  if (text.startsWith("/new")) {
    if (env.BOT_KV) await env.BOT_KV.delete(`mem:${chatId}`);
    await sendText(env, chatId, "记忆清空了, 咱重新聊。", undefined, MENU_KB);
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
    await doMusicSearch(env, chatId, userId, q, msg.message_id);
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
    const parsed = parseRemind(arg);
    if (!parsed) {
      await sendText(env, chatId, `格式: /remind 30分钟后 喝水, 或者 /remind 20:30 交作业${NL}支持 分钟/小时/天 和 几点几分 两种写法, 内容跟在后面。`);
      return;
    }
    const list = await getReminders(env, chatId);
    list.push(parsed);
    await setReminders(env, chatId, list);
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

  // 音乐按钮的后续: 等歌名中
  const awaitMusic = await kvGet(env, `awaitmusic:${chatId}`);
  if (awaitMusic) {
    if (env.BOT_KV) await env.BOT_KV.delete(`awaitmusic:${chatId}`);
    await doMusicSearch(env, chatId, userId, text, msg.message_id);
    return;
  }

  // 自然语言点歌: 放/来一首/听 + 歌名
  const songAsk = parseSongAsk(text);
  if (songAsk) {
    await doMusicSearch(env, chatId, userId, songAsk, msg.message_id);
    return;
  }

  if (!(await quotaTake(env, userId))) {
    await sendText(env, chatId, "今天的 AI 额度用完了, 明天再来。");
    return;
  }
  const stopTyping = keepTyping(env, chatId);

  // ----- 读链接 -----
  const pageUrl = extractFirstUrl(text);
  if (pageUrl) {
    const phId = await sendPlaceholder(env, chatId, "🔗 小多正在读这篇文章…", msg.message_id);
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
      const reply = await aiChat(env, chatId, prompt, `（分享了链接 ${pageUrl}）`);
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

  // ----- 普通聊天 -----
  const phId = await sendPlaceholder(env, chatId, "💭 小多正在思考…", msg.message_id);
  try {
    const reply = await aiChat(env, chatId, text, undefined, { plain: true });
    await deliverAiReply(env, chatId, phId, reply, text);
  } catch (e) {
    console.log("chat err", e);
    await editOrSend(env, chatId, phId, chatErrorText(e), e.status === 402 ? MODEL_KB : undefined, false);
  }
  stopTyping();
}
