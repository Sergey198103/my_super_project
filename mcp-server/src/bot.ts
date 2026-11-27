import { webcrypto } from "crypto";
import { SocksProxyAgent } from 'socks-proxy-agent';

if (!globalThis.crypto) {
  (globalThis as any).crypto = webcrypto;
}

import * as dotenv from "dotenv";
import { Telegraf } from "telegraf";

dotenv.config();

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

// 1. Обычная проверка почты
bot.hears(/проверь почту/i, async (ctx: any) => {
  if (String(ctx.chat.id) !== TELEGRAM_CHAT_ID) {
    ctx.reply("⛔ Доступ запрещен.");
    return;
  }

  await ctx.reply("📬 Читаю последние 5 писем...");

  try {
    const response = await fetch('http://127.0.0.1:3000/check-mail', {
      method: 'POST',
      signal: AbortSignal.timeout(60000) // Таймаут 60 секунд
    });
    const result = await response.json();

    if (result.status === 'success') {
      await ctx.reply(`📩 ${result.result}`);
    } else {
      await ctx.reply(`❌ Ошибка: ${result.message}`);
    }
  } catch (error: any) {
    await ctx.reply(`❌ Не удалось связаться с оркестратором (возможно, Казанов недоступен): ${error.message}`);
  }
});

// 2. Умная проверка на спам
bot.hears(/умная проверка|проверь на спам/i, async (ctx: any) => {
  if (String(ctx.chat.id) !== TELEGRAM_CHAT_ID) {
    ctx.reply("⛔ Доступ запрещен.");
    return;
  }

  await ctx.reply("🧠 Анализирую почту и ищу спам... Это займет около 10-15 секунд.");

  try {
    const response = await fetch('http://127.0.0.1:3000/analyze-mail', { 
      method: 'POST',
      signal: AbortSignal.timeout(60000) // Таймаут 60 секунд
    });
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
    await ctx.reply(`❌ Ошибка при анализе (проверьте, запущена ли Ollama на Казанове): ${error.message}`);
  }
});

// 3. Обработка кнопки "Удалить спам"
bot.action(/delete_spam:(.*)/, async (ctx: any) => {
  if (String(ctx.chat.id) !== TELEGRAM_CHAT_ID) return;

  const uidsString = ctx.match[1];
  const uids = uidsString.split(',').map(Number);

  await ctx.answerCbQuery("⏳ Удаляю...");

  try {
    const response = await fetch('http://127.0.0.1:3000/delete-mails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uids }),
      signal: AbortSignal.timeout(30000) // Таймаут 30 секунд (удаление быстрое)
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

// Очистка корзины
bot.hears(/очисти.*корзин/i, async (ctx: any) => {
  if (String(ctx.chat.id) !== TELEGRAM_CHAT_ID) {
    ctx.reply("⛔ Доступ запрещен.");
    return;
  }

  await ctx.reply("🗑️ Очищаю корзину...");

  try {
    const response = await fetch('http://127.0.0.1:3000/empty-trash', {
      method: 'POST',
      signal: AbortSignal.timeout(30000)
    });
    const result = await response.json();

    if (result.status === 'success') {
      await ctx.reply(`✅ ${result.message}`);
    } else {
      await ctx.reply(`❌ Ошибка: ${result.message}`);
    }
  } catch (error: any) {
    await ctx.reply(`❌ Не удалось очистить корзину: ${error.message}`);
  }
});

// Проверка папки спам
bot.hears(/проверь спам|проверь папку спам/i, async (ctx: any) => {
  if (String(ctx.chat.id) !== TELEGRAM_CHAT_ID) {
    ctx.reply("⛔ Доступ запрещен.");
    return;
  }

  await ctx.reply("🔍 Проверяю папку спам... Это займет 10-15 секунд.");

  try {
    const response = await fetch('http://127.0.0.1:3000/check-spam-folder', {
      method: 'POST',
      signal: AbortSignal.timeout(60000)
    });
    const result = await response.json();

    if (result.status === 'error') {
      throw new Error(result.message);
    }

    const { summary, spam } = result.data;
    let message = `📊 *Папка спам:*\n${summary}\n`;

    if (spam && spam.length > 0) {
      message += `\n🗑 *Писем в спаме (${spam.length} шт.):*\n`;
      spam.forEach((item: any, idx: number) => {
        message += `\n${idx + 1}. *От:* ${item.from || 'Неизвестно'}\n   *Тема:* ${item.subject || 'Без темы'}\n   *Описание:* ${item.reason || 'Спам'}\n`;
      });

      const spamUids = spam.map((item: any) => item.uid).filter(Boolean);

      if (spamUids.length > 0) {
        message += `\nХотите очистить папку спам?`;
        const keyboard = {
          inline_keyboard: [
            [{ text: `🗑 Очистить папку спам`, callback_data: `empty_spam_folder` }]
          ]
        };
        await ctx.replyWithMarkdown(message, { reply_markup: keyboard });
      }
    } else {
      message += `\n✅ Папка спам пуста!`;
      await ctx.replyWithMarkdown(message);
    }
  } catch (error: any) {
    await ctx.reply(`❌ Ошибка: ${error.message}`);
  }
});

// Обработка кнопки "Очистить папку спам" (без передачи длинного списка UID)
bot.action('empty_spam_folder', async (ctx: any) => {
  if (String(ctx.chat.id) !== TELEGRAM_CHAT_ID) return;

  await ctx.answerCbQuery("⏳ Очищаю всю папку спам...");

  try {
    const response = await fetch('http://127.0.0.1:3000/empty-spam', {
      method: 'POST',
      signal: AbortSignal.timeout(30000)
    });
    const result = await response.json();

    if (result.status === 'success') {
      await ctx.editMessageText(`✅ ${result.message}`);
    } else {
      throw new Error(result.message);
    }
  } catch (error: any) {
    await ctx.editMessageText(`❌ Не удалось очистить: ${error.message}`);
  }
});

console.log("🤖 Telegram-бот запущен и ждет команд...");

bot.launch().catch((err: any) => {
  console.error("❌ Не удалось запустить бота:", err.message);
  process.exit(1);
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
