// dq686BOT v3.1 - Cloudflare Workers 版
// 大脑 (可切换, 共用同一份聊天记录):
//   DeepSeek 日常 (deepseek-chat) / DeepSeek 深度思考 (deepseek-reasoner)
//   GPT-OSS 120B (Groq 免费) / GPT-OSS 20B (Groq 免费, 更快)
// 看图: Groq 视觉模型 (GROQ_API_KEY)
// 作图: Pollinations 免费接口
// 代码交付: 回复带按钮, 一点把代码块存成文件发送; 用户说"文件"或代码太长时自动发文件
// 存储: KV (绑定名 BOT_KV) 存会话记忆/白名单主人/每日计数/模型选择/最近代码
//
// 环境变量 (在 Workers 设置里填, 不要写进代码):
//   BOT_TOKEN        必需, BotFather 的 token (密钥)
//   DEEPSEEK_API_KEY DeepSeek 官方 key (密钥); 有它默认大脑就是 DeepSeek
//   GROQ_API_KEY     Groq 的 key (密钥); Groq 聊天 + 看图用
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
/new - 清空记忆, 开新话题
/draw 描述 - 画图, 例: /draw 一只在海边看日落的橘猫
发图片给我 = 我帮你看图
/model - 切换大脑 (DeepSeek 日常 / 深度思考 / GPT-OSS 两个档)
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
      return new Response("dq686bot is alive (cloudflare worker v3.1)", {
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
      // Markdown 解析失败就用纯文本重发这一段
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

async function aiChat(env, chatId, userText) {
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
  history.push({ role: "user", content: userText }, { role: "assistant", content: reply });
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
    { headers: { "User-Agent": "dq686bot/3.1" } }
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
    if (!(text.startsWith("/") || caption.startsWith("/") || isReplyToBot || mentioned)) return;
    text = text.replace(/@dq686BOT/g, "").replace(/@dq686bot/g, "").trim();
    caption = caption.replace(/@dq686BOT/g, "").replace(/@dq686bot/g, "").trim();
  }

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
  const phId = await sendPlaceholder(env, chatId, "💭 小多正在思考…", msg.message_id);
  try {
    const reply = await aiChat(env, chatId, text);
    const blocks = extractBlocks(reply);
    if (blocks.length) {
      await kvPut(env, `lastcode:${chatId}`, JSON.stringify(blocks), 60 * 60);
      const wantFile = text.includes("文件");
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
  } catch (e) {
    console.log("chat err", e);
    if (e.status === 401) {
      await editOrSend(env, chatId, phId, "大脑的 key 验不过 (401), 找 Algo 查。", undefined, false);
    } else if (e.status === 402) {
      await editOrSend(env, chatId, phId, "DeepSeek 余额不足了。点 🧠 换模型 切到 Groq 免费版先用着。", MODEL_KB, false);
    } else if (e.status === 429) {
      await editOrSend(env, chatId, phId, "问太快被限流了, 等一分钟再试。", undefined, false);
    } else {
      await editOrSend(env, chatId, phId, "我刚走神了, 再说一遍试试。", undefined, false);
    }
  }
}
