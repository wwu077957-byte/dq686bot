#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
dq686BOT - 多情的私人 AI 机器人（Telegram）
大脑: DeepSeek API (OpenAI 兼容接口, 地址/模型可通过环境变量改)
看图: Groq 视觉模型 (可选, 设了 GROQ_API_KEY 才启用)
作图: Pollinations 免费接口 (无需 key)

纯 Python 标准库实现, 无第三方依赖。
必需环境变量: BOT_TOKEN, DEEPSEEK_API_KEY
可选环境变量: DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, GROQ_API_KEY,
              ALLOWED_IDS (逗号分隔的 Telegram 数字 ID),
              WEBHOOK_SECRET, PORT, RENDER_EXTERNAL_URL
"""
import base64
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict, deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ---------------- 配置 ----------------
BOT_TOKEN = os.environ.get("BOT_TOKEN", "").strip()
DEEPSEEK_KEY = os.environ.get("DEEPSEEK_API_KEY", "").strip()
DEEPSEEK_BASE = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat").strip()
GROQ_KEY = os.environ.get("GROQ_API_KEY", "").strip()
GROQ_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"
ALLOWED = {x.strip() for x in os.environ.get("ALLOWED_IDS", "").split(",") if x.strip()}
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "dq686hook").strip()
PORT = int(os.environ.get("PORT", "8080"))
EXTERNAL_URL = os.environ.get("RENDER_EXTERNAL_URL", "").rstrip("/")

PER_USER_DAILY = 100      # 每人每天最多调用 AI 的次数
GLOBAL_DAILY = 2000       # 全机器人每天总上限
MEM_ROUNDS = 10           # 每个会话保留最近 10 轮记忆

SYSTEM_PROMPT = (
    "你是「多情」的私人 AI 助手, 运行在 Telegram 上, 名字叫小多。"
    "用中文回答, 口语化, 直接, 温暖, 简洁实用, 不说废话套话。"
    "你擅长聊天答疑, 写作, 翻译和写代码; 给代码时用代码块, 给完整可运行的版本。"
    "不知道的事情就直说不知道, 不要编造。"
)

TG_API = f"https://api.telegram.org/bot{BOT_TOKEN}"
TG_FILE = f"https://api.telegram.org/file/bot{BOT_TOKEN}"

# ---------------- 运行时状态 (内存, 重启清空) ----------------
_memory = defaultdict(lambda: deque(maxlen=MEM_ROUNDS * 2))
_bootstrap_owner = {"id": None}   # ALLOWED_IDS 为空时, 第一个 /start 的人临时成为主人
_counter_lock = threading.Lock()
_counter = {"date": "", "per_user": defaultdict(int), "total": 0}


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def quota_take(user_id: int) -> bool:
    """占用一个今日额度, 超限返回 False。"""
    with _counter_lock:
        today = _today()
        if _counter["date"] != today:
            _counter["date"] = today
            _counter["per_user"] = defaultdict(int)
            _counter["total"] = 0
        if _counter["total"] >= GLOBAL_DAILY:
            return False
        if _counter["per_user"][user_id] >= PER_USER_DAILY:
            return False
        _counter["per_user"][user_id] += 1
        _counter["total"] += 1
        return True


def is_allowed(user_id: int) -> bool:
    uid = str(user_id)
    if ALLOWED:
        return uid in ALLOWED
    return _bootstrap_owner["id"] == uid


# ---------------- 基础 HTTP ----------------
def http_json(url: str, payload: dict | None = None, headers: dict | None = None,
              timeout: int = 60):
    data = None
    hdrs = {"Content-Type": "application/json", "User-Agent": "dq686bot/1.0"}
    if headers:
        hdrs.update(headers)
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=hdrs)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def tg(method: str, payload: dict):
    try:
        return http_json(f"{TG_API}/{method}", payload, timeout=30)
    except Exception as e:  # Telegram 侧错误不许打崩主流程
        print(f"[tg:{method}] {type(e).__name__}: {e}", flush=True)
        return None


def send_text(chat_id: int, text: str, reply_to: int | None = None):
    """长消息自动分段发送 (Telegram 单条上限 4096)。"""
    text = text or "(空回复)"
    chunks = []
    rest = text
    while len(rest) > 4000:
        cut = rest.rfind("\n", 0, 4000)
        if cut < 500:
            cut = 4000
        chunks.append(rest[:cut])
        rest = rest[cut:].lstrip("\n")
    chunks.append(rest)
    for i, chunk in enumerate(chunks):
        payload = {"chat_id": chat_id, "text": chunk}
        if reply_to and i == 0:
            payload["reply_to_message_id"] = reply_to
        tg("sendMessage", payload)


def send_typing(chat_id: int):
    tg("sendChatAction", {"chat_id": chat_id, "action": "typing"})


def send_photo_bytes(chat_id: int, img: bytes, caption: str = ""):
    """multipart 上传图片 (标准库手写)。"""
    boundary = f"----dq686bot{int(time.time() * 1000)}"
    parts = []

    def field(name: str, value: str):
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode("utf-8")
        )

    field("chat_id", str(chat_id))
    if caption:
        field("caption", caption[:1000])
    parts.append(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"draw.jpg\"\r\n"
        "Content-Type: image/jpeg\r\n\r\n".encode("utf-8") + img + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(parts)
    req = urllib.request.Request(
        f"{TG_API}/sendPhoto", data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}",
                 "User-Agent": "dq686bot/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"[sendPhoto] {type(e).__name__}: {e}", flush=True)
        return None


# ---------------- AI 能力 ----------------
def deepseek_chat(chat_id: int, user_text: str) -> str:
    msgs = [{"role": "system", "content": SYSTEM_PROMPT}]
    msgs.extend(list(_memory[chat_id]))
    msgs.append({"role": "user", "content": user_text})
    data = http_json(
        f"{DEEPSEEK_BASE}/chat/completions",
        {"model": DEEPSEEK_MODEL, "messages": msgs, "stream": False},
        headers={"Authorization": f"Bearer {DEEPSEEK_KEY}"},
        timeout=120,
    )
    reply = data["choices"][0]["message"]["content"].strip()
    _memory[chat_id].append({"role": "user", "content": user_text})
    _memory[chat_id].append({"role": "assistant", "content": reply})
    return reply


def groq_vision(image_bytes: bytes, prompt: str) -> str:
    b64 = base64.b64encode(image_bytes).decode()
    data = http_json(
        "https://api.groq.com/openai/v1/chat/completions",
        {
            "model": GROQ_MODEL,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url",
                     "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                ],
            }],
        },
        headers={"Authorization": f"Bearer {GROQ_KEY}"},
        timeout=120,
    )
    return data["choices"][0]["message"]["content"].strip()


def pollinations_image(prompt: str) -> bytes:
    q = urllib.parse.quote(prompt)
    url = f"https://image.pollinations.ai/prompt/{q}?width=1024&height=1024&nologo=true"
    req = urllib.request.Request(url, headers={"User-Agent": "dq686bot/1.0"})
    with urllib.request.urlopen(req, timeout=180) as resp:
        return resp.read()


# ---------------- 消息处理 ----------------
HELP = (
    "我是小多, 多情的私人 AI 助手。\n\n"
    "直接发消息 = 跟我聊天 (我记得最近 10 轮)\n"
    "/new - 清空记忆, 开新话题\n"
    "/draw 描述 - 让我画图, 例: /draw 一只在海边看日落的橘猫\n"
    "发图片给我 = 我帮你看图 (需开通看图功能)\n"
    "/myid - 查看你的 Telegram 数字 ID\n"
    "/help - 这份说明"
)


def handle_message(msg: dict):
    chat = msg.get("chat", {})
    chat_id = chat.get("id")
    chat_type = chat.get("type", "private")
    user = msg.get("from", {})
    user_id = user.get("id")
    if chat_id is None or user_id is None:
        return
    text = (msg.get("text") or "").strip()
    caption = (msg.get("caption") or "").strip()
    photos = msg.get("photo") or []

    # /myid 任何人可用 (方便主人拿 ID 填白名单)
    if text.startswith("/myid"):
        send_text(chat_id, f"你的 Telegram 数字 ID 是: {user_id}")
        return

    # 权限
    if not is_allowed(user_id):
        if not ALLOWED and _bootstrap_owner["id"] is None and text.startswith("/start"):
            _bootstrap_owner["id"] = str(user_id)
            send_text(
                chat_id,
                f"你是第一个启动我的人, 临时认你为主人 (ID: {user_id})。\n"
                "注意: 这是临时状态, 机器人重启后会失效。\n"
                f"请尽快把 {user_id} 填进 Render 的环境变量 ALLOWED_IDS 并重启服务, 正式锁定白名单。",
            )
            return
        if chat_type == "private":
            send_text(chat_id, f"我是多情的私人机器人, 只听白名单里的人。你的 ID 是 {user_id}, 想要权限找多情本人。")
        return

    # 群聊里只回应命令 / @我 / 回复我的消息
    if chat_type in ("group", "supergroup"):
        reply_to_msg = msg.get("reply_to_message") or {}
        is_reply_to_bot = (reply_to_msg.get("from") or {}).get("is_bot", False)
        mentioned = "@dq686bot" in text.lower() or "@dq686bot" in caption.lower()
        if not (text.startswith("/") or caption.startswith("/") or is_reply_to_bot or mentioned):
            return
        text = text.replace("@dq686BOT", "").replace("@dq686bot", "").strip()
        caption = caption.replace("@dq686BOT", "").replace("@dq686bot", "").strip()

    # 图片 -> 看图
    if photos:
        if not GROQ_KEY:
            send_text(chat_id, "看图功能还没开通: 需要一把 Groq 的免费 key 填进 GROQ_API_KEY, 找多情/Algo 弄。文字聊天和 /draw 画图不受影响。")
            return
        if not quota_take(user_id):
            send_text(chat_id, "今天的 AI 额度用完了, 明天再来。")
            return
        send_typing(chat_id)
        try:
            file_id = photos[-1]["file_id"]
            info = tg("getFile", {"file_id": file_id})
            file_path = info["result"]["file_path"]
            req = urllib.request.Request(f"{TG_FILE}/{file_path}",
                                         headers={"User-Agent": "dq686bot/1.0"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                img = resp.read()
            prompt = caption or "用中文详细描述并解释这张图片的内容。"
            answer = groq_vision(img, prompt)
            send_text(chat_id, answer, reply_to=msg.get("message_id"))
        except Exception as e:
            print(f"[vision] {type(e).__name__}: {e}", flush=True)
            send_text(chat_id, "看图时出了点问题, 稍后再发一次试试。")
        return

    if not text:
        return

    # 命令
    if text.startswith("/start"):
        send_text(chat_id, "在的在的, 我是小多。直接发消息跟我聊, /help 看我会啥。")
        return
    if text.startswith("/help"):
        send_text(chat_id, HELP)
        return
    if text.startswith("/new"):
        _memory[chat_id].clear()
        send_text(chat_id, "记忆清空了, 咱重新聊。")
        return
    if text.startswith("/draw"):
        prompt = text[len("/draw"):].strip()
        if not prompt:
            send_text(chat_id, "画啥? 格式: /draw 一只在海边看日落的橘猫")
            return
        if not quota_take(user_id):
            send_text(chat_id, "今天的 AI 额度用完了, 明天再来。")
            return
        send_text(chat_id, "收到, 正在画, 大概十几秒...")
        tg("sendChatAction", {"chat_id": chat_id, "action": "upload_photo"})
        try:
            img = pollinations_image(prompt)
            if not send_photo_bytes(chat_id, img, caption=f"🎨 {prompt}"):
                q = urllib.parse.quote(prompt)
                send_text(chat_id, f"图画好了但上传失败, 直接打开看: https://image.pollinations.ai/prompt/{q}?width=1024&height=1024&nologo=true")
        except Exception as e:
            print(f"[draw] {type(e).__name__}: {e}", flush=True)
            send_text(chat_id, "画图接口刚没接住, 换个描述再试一次。")
        return
    if text.startswith("/"):
        send_text(chat_id, "这个命令我不认识, /help 看看我会啥。")
        return

    # 普通聊天
    if not DEEPSEEK_KEY:
        send_text(chat_id, "我的大脑还没接上 (缺 DEEPSEEK_API_KEY), 找多情/Algo 处理。")
        return
    if not quota_take(user_id):
        send_text(chat_id, "今天的 AI 额度用完了, 明天再来。")
        return
    send_typing(chat_id)
    try:
        reply = deepseek_chat(chat_id, text)
        send_text(chat_id, reply, reply_to=msg.get("message_id") if chat_type != "private" else None)
    except urllib.error.HTTPError as e:
        print(f"[chat] HTTPError {e.code}", flush=True)
        if e.code == 401:
            send_text(chat_id, "大脑的 key 验不过 (401), 可能是 key 失效或接口地址不对, 找 Algo 查。")
        elif e.code == 402:
            send_text(chat_id, "大脑账户余额不足了, 找多情充值。")
        else:
            send_text(chat_id, f"大脑那边回了个 {e.code}, 稍后再试。")
    except Exception as e:
        print(f"[chat] {type(e).__name__}: {e}", flush=True)
        send_text(chat_id, "我刚走神了, 再说一遍试试。")


def handle_update(update: dict):
    msg = update.get("message") or update.get("channel_post")
    if not msg:
        return
    try:
        handle_message(msg)
    except Exception as e:
        print(f"[update] {type(e).__name__}: {e}", flush=True)


# ---------------- HTTP 服务 (Webhook) ----------------
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # 静音访问日志
        pass

    def do_GET(self):
        body = b"dq686bot is alive"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path.strip("/") != WEBHOOK_SECRET:
            self.send_response(404)
            self.end_headers()
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length) if length > 0 else b"{}"
            update = json.loads(raw.decode("utf-8"))
        except Exception:
            self.send_response(400)
            self.end_headers()
            return
        self.send_response(200)
        self.end_headers()
        threading.Thread(target=handle_update, args=(update,), daemon=True).start()


def setup_webhook():
    if not (BOT_TOKEN and EXTERNAL_URL):
        print("[boot] 未设 RENDER_EXTERNAL_URL 或 BOT_TOKEN, 跳过 setWebhook", flush=True)
        return
    url = f"{EXTERNAL_URL}/{WEBHOOK_SECRET}"
    try:
        res = tg("setWebhook", {"url": url, "drop_pending_updates": True})
        print(f"[boot] setWebhook -> {res}", flush=True)
    except Exception as e:
        print(f"[boot] setWebhook 失败: {type(e).__name__}: {e}", flush=True)


def main():
    if not BOT_TOKEN:
        print("[boot] 缺 BOT_TOKEN 环境变量! 服务仍会启动 (健康检查), 但机器人不工作。", flush=True)
    threading.Thread(target=setup_webhook, daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"[boot] listening on :{PORT}, webhook path /{WEBHOOK_SECRET}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
