// dq686BOT - Cloudflare Workers 版
// 大脑: Groq 免费 API (OpenAI 兼容; 地址/模型可改, 也可换 DeepSeek 等)
// 看图: Groq 视觉模型 (同一把 key)
// 作图: Pollinations 免费接口
// 存储: KV (绑定名 BOT_KV) 存会话记忆/白名单主人/每日计数; 未绑定时降级为无记忆模式
//
// 环境变量 (在 Workers 设置里填, 不要写进代码):
//   BOT_TOKEN     必需, BotFather 的新 token
//   GROQ_API_KEY  必需, Groq 的 key
//   ALLOWED_IDS   可选, 逗号分隔的 Telegram 数字 ID; 空 = 第一个 /start 的人临时认主
//   AI_BASE_URL   可选, 默认 https://api.groq.com/openai/v1
//   AI_MODEL      可选, 默认 llama-3.3-70b-versatile
//   WEBHOOK_SECRET 可选, 默认 dq686hook (webhook 路径)
// 部署后打开 https://<你的worker地址>/<WEBHOOK_SECRET>/setwebhook 注册 webhook

const SYSTEM_PROMPT =
  "你是「多情」的私人 AI 助手, 运行在 Telegram 上, 名字叫小多。" +
  "用中文回答, 口语化, 直接, 温暖, 简洁实用, 不说废话套话。" +
  "你擅长聊天答疑, 写作, 翻译和写代码; 给代码时用代码块, 给完整可运行的版本。" +
  "不知道的事情就直说不知道, 不要编造。";

const PER_USER_DAILY = 100;
const GLOBAL_DAILY = 2000;
const MEM_ROUNDS = 10;
const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

const HELP =
  "我是小多, 多情的私人 AI 助手。\n\n" +
  "直接发消息 = 跟我聊天 (我记得最近 10 轮)\n" +
  "/new - 清空记忆, 开新话题\n" +
  "/draw 描述 - 让我画图, 例: /draw 一只在海边看日落的橘猫\n" +
  "发图片给我 = 我帮你看图\n" +
  "/myid - 查看你的 Telegram 数字 ID\n" +
  "/help - 这份说明";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const secret = env.WEBHOOK_SECRET || "dq686hook";
    const path = url.pathname.replace(/^\/+/, "");

    if (request.method === "GET" && (path === "" || path === "health")) {
      return new Response("dq686bot is alive (cloudflare worker)", {
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

async function sendText(env, chatId, text, replyTo) {
  const body = text || "(空回复)";
  const chunks = [];
  let rest = body;
  while (rest.length > 4000) {
    let cut = rest.lastIndexOf("\n", 4000);
    if (cut < 500) cut = 4000;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  chunks.push(rest);
  for (let i = 0; i < chunks.length; i++) {
    const payload = { chat_id: chatId, text: chunks[i] };
    if (replyTo && i === 0) payload.reply_to_message_id = replyTo;
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
  if (!env.BOT_KV) return true; // 无 KV 时不计数, 不拦截
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

// ---------- AI ----------
async function aiChat(env, chatId, userText) {
  const base = (env.AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/+$/, "");
  const model = env.AI_MODEL || "llama-3.3-70b-versatile";
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
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: userText },
  ];
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({ model, messages }),
  });
  if (!r.ok) {
    const err = new Error(`AI HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  const data = await r.json();
  const reply = (data.choices?.[0]?.message?.content || "").trim();
  history.push({ role: "user", content: userText }, { role: "assistant", content: reply });
  while (history.length > MEM_ROUNDS * 2) history.shift();
  await kvPut(env, `mem:${chatId}`, JSON.stringify(history), 60 * 60 * 24 * 7);
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
  const base = "https://api.groq.com/openai/v1";
  const b64 = bufToB64(imageBuf);
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: VISION_MODEL,
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
    { headers: { "User-Agent": "dq686bot/1.0" } }
  );
  if (!r.ok) throw new Error(`draw HTTP ${r.status}`);
  return await r.arrayBuffer();
}

// ---------- 消息处理 ----------
async function handleUpdate(env, update) {
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
          `你是第一个启动我的人, 先认你为主人 (ID: ${userId})。\n` +
            "保险起见, 请把这个 ID 填进 Workers 设置的 ALLOWED_IDS, 正式锁定白名单。"
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
    try {
      const fileId = photos[photos.length - 1].file_id;
      const info = await tg(env, "getFile", { file_id: fileId });
      const filePath = info?.result?.file_path;
      const fr = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`);
      const buf = await fr.arrayBuffer();
      const prompt = caption || "用中文详细描述并解释这张图片的内容。";
      const answer = await aiVision(env, buf, prompt);
      await sendText(env, chatId, answer, msg.message_id);
    } catch (e) {
      console.log("vision err", e);
      await sendText(env, chatId, "看图时出了点问题, 稍后再发一次试试。");
    }
    return;
  }

  if (!text) return;

  if (text.startsWith("/start")) {
    await sendText(env, chatId, "在的在的, 我是小多。直接发消息跟我聊, /help 看我会啥。");
    return;
  }
  if (text.startsWith("/help")) {
    await sendText(env, chatId, HELP);
    return;
  }
  if (text.startsWith("/new")) {
    if (env.BOT_KV) await env.BOT_KV.delete(`mem:${chatId}`);
    await sendText(env, chatId, "记忆清空了, 咱重新聊。");
    return;
  }
  if (text.startsWith("/draw")) {
    const prompt = text.slice("/draw".length).trim();
    if (!prompt) {
      await sendText(env, chatId, "画啥? 格式: /draw 一只在海边看日落的橘猫");
      return;
    }
    if (!(await quotaTake(env, userId))) {
      await sendText(env, chatId, "今天的 AI 额度用完了, 明天再来。");
      return;
    }
    await sendText(env, chatId, "收到, 正在画, 大概十几秒...");
    try {
      const buf = await drawImage(prompt);
      const res = await sendPhoto(env, chatId, buf, `🎨 ${prompt}`);
      if (!res || res.ok === false) {
        const q = encodeURIComponent(prompt);
        await sendText(
          env,
          chatId,
          `图画好了但上传失败, 直接打开看: https://image.pollinations.ai/prompt/${q}?width=1024&height=1024&nologo=true`
        );
      }
    } catch (e) {
      console.log("draw err", e);
      await sendText(env, chatId, "画图接口刚没接住, 换个描述再试一次。");
    }
    return;
  }
  if (text.startsWith("/")) {
    await sendText(env, chatId, "这个命令我不认识, /help 看看我会啥。");
    return;
  }

  if (!env.GROQ_API_KEY) {
    await sendText(env, chatId, "我的大脑还没接上 (缺 GROQ_API_KEY), 找多情/Algo 处理。");
    return;
  }
  if (!(await quotaTake(env, userId))) {
    await sendText(env, chatId, "今天的 AI 额度用完了, 明天再来。");
    return;
  }
  await tg(env, "sendChatAction", { chat_id: chatId, action: "typing" });
  try {
    const reply = await aiChat(env, chatId, text);
    await sendText(env, chatId, reply, chatType !== "private" ? msg.message_id : undefined);
  } catch (e) {
    console.log("chat err", e);
    if (e.status === 401) {
      await sendText(env, chatId, "大脑的 key 验不过 (401), 找 Algo 查。");
    } else if (e.status === 429) {
      await sendText(env, chatId, "问太快被限流了, 等一分钟再试。");
    } else {
      await sendText(env, chatId, "我刚走神了, 再说一遍试试。");
    }
  }
}
