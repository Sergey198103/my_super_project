import { webcrypto } from "crypto";
import { SocksProxyAgent } from 'socks-proxy-agent';

if (!globalThis.crypto) {
  (globalThis as any).crypto = webcrypto;
}

import * as dotenv from "dotenv";
import { Telegraf } from "telegraf";
import { ImapFlow } from "imapflow";

dotenv.config();

const EMAIL = process.env.MAIL_USER;
const APP_PASSWORD = process.env.MAIL_PASSWORD;
const IMAP_SERVER = process.env.IMAP_SERVER;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN) {
  console.error("❌ ОШИБКА: Нет TELEGRAM_BOT_TOKEN в .env");
  process.exit(1);
}

const proxyAgent = new SocksProxyAgent('socks5://127.0.0.1:1080');

const bot = new Telegraf(TELEGRAM_BOT_TOKEN, {
  telegram: {
    agent: proxyAgent
  }
});

bot.start((ctx: any) => {
  if (String(ctx.chat.id) === TELEGRAM_CHAT_ID) {
    ctx.reply("✅ Петрович на связи. Напиши 'проверь почту', чтобы я посмотрел входящие.");
  } else {
    ctx.reply("⛔ Доступ запрещен.");
  }
});

bot.hears(/проверь почту/i, async (ctx: any) => {
  if (String(ctx.chat.id) !== TELEGRAM_CHAT_ID) {
    ctx.reply("⛔ Доступ запрещен.");
    return;
  }

  await ctx.reply("🔍 Проверяю почту...");

  try {
    if (!EMAIL || !APP_PASSWORD || !IMAP_SERVER) {
      throw new Error("Не настроены переменные окружения для почты");
    }

    const client = new ImapFlow({
      host: IMAP_SERVER,
      port: 993,
      secure: true,
      auth: { user: EMAIL, pass: APP_PASSWORD },
    });

    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const allUids = await client.search({ all: true });
      const targetUids = allUids ? allUids.slice(-5) : []; // Берем последние 5

      const messages: string[] = [];
      if (targetUids.length > 0) {
        for await (const message of client.fetch(targetUids.join(","), { envelope: true })) {
          const env = message.envelope;
          const from = env?.from?.[0]?.name || env?.from?.[0]?.address || "Неизвестно";
          const subject = env?.subject || "Без темы";
          const date = env?.date ? new Date(env.date).toLocaleString("ru-RU") : "Нет даты";
          messages.push(`📩 От: ${from}\nТема: ${subject}\nДата: ${date}`);
        }
      }

      if (messages.length === 0) {
        await ctx.reply("Почтовый ящик пуст.");
      } else {
        await ctx.reply(`✅ Найдено писем: ${messages.length}\n\n${messages.join("\n\n")}`);
      }
    } finally {
      lock.release();
      await client.logout();
    }
  } catch (error: any) {
    console.error("[DEBUG] Ошибка IMAP:", error.message);
    await ctx.reply(`❌ Ошибка при чтении почты: ${error.message}`);
  }
});

// Запуск с обработкой ошибок сети
bot.launch().catch((err: any) => {
  console.error("❌ Не удалось запустить бота (возможна блокировка сети):", err.message);
  process.exit(1);
});

console.log("🤖 Telegram-бот запущен и ждет команд...");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
