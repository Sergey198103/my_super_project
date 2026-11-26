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

bot.hears(/умная проверка|проверь на спам/i, async (ctx: any) => {
  if (String(ctx.chat.id) !== TELEGRAM_CHAT_ID) {
    ctx.reply("⛔ Доступ запрещен.");
    return;
  }

  await ctx.reply("🧠 Анализирую почту и ищу спам... Это займет около 10-15 секунд.");

  try {
    const response = await fetch('http://127.0.0.1:3000/analyze-mail', { method: 'POST' });
    const result = await response.json();

    if (result.status === 'error') {
      throw new Error(result.message);
    }

    const { summary, spam } = result.data;
    
    let message = `📊 *Сводка по входящим:*\n${summary}\n`;
    
    if (spam && spam.length > 0) {
      message += `\n🗑 *Обнаружен спам (${spam.length} шт.):*\n`;
      
      spam.forEach((item: any, idx: number) => {
        message += `\n${idx + 1}. *От:* ${item.from || 'Неизвестно'}\n   *Тема:* ${item.subject || 'Без темы'}\n   *Причина:* ${item.reason || 'Реклама/мусор'}\n`;
      });
      
      const spamUids = spam.map((item: any) => item.uid).filter(Boolean);
      
      if (spamUids.length > 0) {
        message += `\nХотите удалить этот спам?`;
        const keyboard = {
          inline_keyboard: [
            [{ text: `🗑 Удалить спам (${spamUids.length})`, callback_data: `delete_spam:${spamUids.join(',')}` }]
          ]
        };
        await ctx.replyWithMarkdown(message, { reply_markup: keyboard });
      } else {
        message += `\n⚠️ Не удалось получить UID писем для удаления.`;
        await ctx.replyWithMarkdown(message);
      }
    } else {
      message += `\n✅ Спам не обнаружен. Ящик чист!`;
      await ctx.replyWithMarkdown(message);
    }
  } catch (error: any) {
    console.error("[DEBUG] Ошибка умной проверки:", error.message);
    await ctx.reply(`❌ Ошибка при анализе: ${error.message}`);
  }
});

// Запуск с обработкой ошибок сети
bot.launch().catch((err: any) => {
  console.error("❌ Не удалось запустить бота (возможна блокировка сети):", err.message);
  process.exit(1);
});

console.log("🤖 Telegram-бот запущен и ждет команд...");

// Умная проверка почты с анализом и кнопкой удаления

bot.hears(/умная проверка|проверь на спам/i, async (ctx: any) => {
  if (String(ctx.chat.id) !== TELEGRAM_CHAT_ID) {
    ctx.reply("⛔ Доступ запрещен.");
    return;
  }

  await ctx.reply("🧠 Анализирую почту и ищу спам... Это займет около 10-15 секунд.");

  try {
    const response = await fetch('http://127.0.0.1:3000/analyze-mail', { method: 'POST' });
    const result = await response.json();

    if (result.status === 'error') {
      throw new Error(result.message);
    }

    const { summary, spam } = result.data;
    
    let message = `📊 *Сводка по входящим:*\n${summary}\n`;
    
    if (spam && spam.length > 0) {
      message += `\n🗑 *Обнаружен спам (${spam.length} шт.):*\n`;
      
      spam.forEach((item: any, idx: number) => {
        message += `\n${idx + 1}. *От:* ${item.from || 'Неизвестно'}\n   *Тема:* ${item.subject || 'Без темы'}\n   *Причина:* ${item.reason || 'Реклама/мусор'}\n`;
      });
      
      const spamUids = spam.map((item: any) => item.uid).filter(Boolean);
      
      if (spamUids.length > 0) {
        message += `\nХотите удалить этот спам?`;
        const keyboard = {
          inline_keyboard: [
            [{ text: `🗑 Удалить спам (${spamUids.length})`, callback_data: `delete_spam:${spamUids.join(',')}` }]
          ]
        };
        await ctx.replyWithMarkdown(message, { reply_markup: keyboard });
      } else {
        message += `\n⚠️ Не удалось получить UID писем для удаления.`;
        await ctx.replyWithMarkdown(message);
      }
    } else {
      message += `\n✅ Спам не обнаружен. Ящик чист!`;
      await ctx.replyWithMarkdown(message);
    }
  } catch (error: any) {
    console.error("[DEBUG] Ошибка умной проверки:", error.message);
    await ctx.reply(`❌ Ошибка при анализе: ${error.message}`);
  }
});

// Обработка нажатия на кнопку "Удалить спам"
bot.action(/delete_spam:(.*)/, async (ctx: any) => {
  if (String(ctx.chat.id) !== TELEGRAM_CHAT_ID) return;

  const uidsString = ctx.match[1];
  const uids = uidsString.split(',').map(Number);

  await ctx.answerCbQuery("⏳ Удаляю...");

  try {
    const response = await fetch('http://127.0.0.1:3000/delete-mails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uids })
    });
    const result = await response.json();

    if (result.status === 'success') {
      await ctx.editMessageText(`✅ Успешно удалено писем: ${uids.length}. Ящик очищен от мусора!`);
    } else {
      throw new Error(result.message);
    }
  } catch (error: any) {
    await ctx.editMessageText(`❌ Не удалось удалить: ${error.message}`);
  }
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
