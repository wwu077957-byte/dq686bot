// dq686BOT v4 - Cloudflare Workers 版
// 大脑 (可切换, 共用同一份聊天记录):
//   DeepSeek 日常 (deepseek-chat) / DeepSeek 深度思考 (deepseek-reasoner)
//   GPT-OSS 120B (Groq 免费) / GPT-OSS 20B (Groq 免费, 更快)
// 看图: Groq 视觉模型 (GROQ_API_KEY); 作图: Pollinations 免费接口
// 代码交付: 回复带按钮, 一点把代码块存成文件发送; 说"文件"或代码太长时自动发文件
// 读链接: 发网址自动抓正文总结; 读文件: txt/md/代码/日志等文本文件发来就能读
// 联网搜索: /s 关键词 (需 TAVILY_API_KEY, 没接时会老实说未接入)
// GitHub: /gh 用户名/仓库名 查仓库动态
// 每日早报: 控制台给 Worker 加 Cron 触发器 "0 0 * * *" (UTC) = 每天北京时间 08:00
// 存储: KV (绑定名 BOT_KV) 存会话记忆/白名单主人/每日计数/模型选择/最近代码
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

直接发消息 = 跟我聊天 (记得最近 10 轮, 换模型也不丢)
发网址给我 = 我读完帮你总结
发文件给我 = txt、代码、日志这类文件我能读懂再回答
/new - 清空记忆, 开新话题
/draw 描述 - 画图, 例: /draw 一只在海边看日落的橘猫
发图片给我 = 我帮你看图
/model - 切换大脑 (DeepSeek 两个档 / GPT-OSS 两个档)
/s 关键词 - 联网搜索 (要先接入搜索 key)
/gh 用户名/仓库名 - 查 GitHub 仓库动态
/morning - 看今天的早报
/myid - 查看你的 Telegram 数字 ID
/help - 这份说明

写代码时, 点回复下面的按钮, 我能把代码存成文件发你。
也可以点菜单按钮, 不用打命令。`;

const MENU_KB = {
  inline_keyboard: [
    [
      { text: "🎨 画图", callback_data: "m:draw" },
      { text: "🆕 新话题", callback_data: "m:new" },
    ],
    [
      { text: "🧠 换模型", callback_data: "m:model" },
      { text: "❓ 帮助", callback_data: "m:help" },
    ],
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
  inline_keyboard: [[{ text: "📄 把代码存成文件发我", callback_data: "f:file" }]],
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const secret = env.WEBHOOK_SECRET || "dq686hook";
    const path = url.pathname.replace(/^\/+/, "");

    if (request.method === "GET" && (path === "" || path === "health")) {
      return new Response("dq686bot is alive (cloudflare worker v4)", {
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
    ctx.waitUntil(sendBriefing(env).catch((e) => console.log("briefing err", e)));
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

async function aiChat(env, chatId, userText, historyText) {
  let brain = await getBrain(env, chatId);
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
  const raw = await kvGet(env, `mem:${chatId}`);
  if (raw) {
    try {
      history = JSON.parse(raw);
    } catch {
      history = [];
    }
  }
  const messages = [
    { role: "system", content: systemPrompt(cfg.label) },
    ...history,
    { role: "user", content: userText },
  ];
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
  history.push(
    { role: "user", content: historyText || userText },
    { role: "assistant", content: reply }
  );
  while (history.length > MEM_ROUNDS * 2) history.shift();
  await kvPut(env, `mem:${chatId}`, JSON.stringify(history), 60 * 60 * 24 * 7);
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

async function drawImage(prompt) {
  const q = encodeURIComponent(prompt);
  const r = await fetch(
    `https://image.pollinations.ai/prompt/${q}?width=1024&height=1024&nologo=true`,
    { headers: { "User-Agent": "dq686bot/4.0" } }
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
    await editOrSend(env, chatId, phId, reply, FILE_KB, true);
    return;
  }
  await editOrSend(env, chatId, phId, reply, undefined, true);
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
    headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 dq686bot/4.0" },
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
  await sendText(env, target, await composeBriefing());
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
    if (!(text.startsWith("/") || caption.startsWith("/") || isReplyToBot || mentioned || doc)) return;
    text = text.replace(/@dq686BOT/g, "").replace(/@dq686bot/g, "").trim();
    caption = caption.replace(/@dq686BOT/g, "").replace(/@dq686bot/g, "").trim();
  }

  // ----- 文件阅读 -----
  if (doc) {
    const name = doc.file_name || "file";
    const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
    const mime = (doc.mime_type || "").toLowerCase();
    const isText = TEXT_EXTS.includes(ext) || mime.startsWith("text/");
    if (!isText) {
      await sendText(
        env,
        chatId,
        `这个文件 (${name}) 我暂时读不了。我现在能读的是 txt、md、代码、日志这类文本文件; PDF、Word、压缩包还不行。你可以把内容复制成文字发我, 一样能聊。`,
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
      const content = new TextDecoder("utf-8").decode(buf).slice(0, 15000);
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
    await sendText(env, chatId, "在的, 我是小多。直接发消息跟我聊, 或者点下面的按钮 👇", undefined, MENU_KB);
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
    await sendText(env, chatId, await composeBriefing());
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
    if (!(await quotaTake(env, userId))) {
      await sendText(env, chatId, "今天的 AI 额度用完了, 明天再来。");
      return;
    }
    await tg(env, "sendChatAction", { chat_id: chatId, action: "typing" });
    const phId = await sendPlaceholder(env, chatId, "🔍 小多正在联网搜索…", msg.message_id);
    try {
      const results = await tavilySearch(env, q);
      if (!results) {
        await editOrSend(env, chatId, phId, "没搜到什么有用的结果, 换个关键词试试。", undefined, false);
        return;
      }
      const prompt = [
        `请根据下面的联网搜索结果, 回答我的问题。`,
        `问题: ${q}`,
        "",
        "搜索结果:",
        results,
        "",
        "要求: 用中文回答, 关键事实后面附上来源链接。",
      ].join(NL);
      const reply = await aiChat(env, chatId, prompt, `（联网搜索: ${q}）`);
      await deliverAiReply(env, chatId, phId, reply, text);
    } catch (e) {
      console.log("search err", e);
      await editOrSend(env, chatId, phId, "搜索的时候出了点问题, 稍后再试。", undefined, false);
    }
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
  if (text.startsWith("/")) {
    await sendText(env, chatId, "这个命令我不认识, /help 看看我会啥。");
    return;
  }

  // 画图按钮的后续: 等描述中
  const awaiting = await kvGet(env, `awaitdraw:${chatId}`);
  if (awaiting) {
    if (env.BOT_KV) await env.BOT_KV.delete(`awaitdraw:${chatId}`);
    await doDraw(env, chatId, userId, text, msg.message_id);
    return;
  }

  if (!(await quotaTake(env, userId))) {
    await sendText(env, chatId, "今天的 AI 额度用完了, 明天再来。");
    return;
  }
  await tg(env, "sendChatAction", { chat_id: chatId, action: "typing" });

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
    return;
  }

  // ----- 普通聊天 -----
  const phId = await sendPlaceholder(env, chatId, "💭 小多正在思考…", msg.message_id);
  try {
    const reply = await aiChat(env, chatId, text);
    await deliverAiReply(env, chatId, phId, reply, text);
  } catch (e) {
    console.log("chat err", e);
    await editOrSend(env, chatId, phId, chatErrorText(e), e.status === 402 ? MODEL_KB : undefined, false);
  }
}
