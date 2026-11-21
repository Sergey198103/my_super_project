import { webcrypto } from "crypto";
if (!globalThis.crypto) {
  (globalThis as any).crypto = webcrypto;
}
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from "@modelcontextprotocol/sdk/types.js";
import * as dotenv from "dotenv";
import { ImapFlow } from "imapflow";

dotenv.config();

const EMAIL = process.env.MAIL_USER;
const APP_PASSWORD = process.env.MAIL_PASSWORD;
const IMAP_SERVER = process.env.IMAP_SERVER;

console.error(`[DEBUG] Загрузка конфига: ${EMAIL}, ${IMAP_SERVER}`);

const server = new Server(
  { name: "petrovich-assistant", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

const tools: Tool[] = [
  {
    name: "ping_petrovich",
    description: "Проверяет, что сервер Петрович на связи",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_recent_emails",
    description: "Показывает последние N писем из входящих",
    inputSchema: {
      type: "object",
      properties: {
        count: { type: "number", description: "Количество писем (по умолчанию 5)" },
      },
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "ping_petrovich") {
    return { content: [{ type: "text", text: "Петрович на связи! Система работает нормально." }] };
  }

  if (name === "list_recent_emails") {
    console.error("[DEBUG] Запуск инструмента list_recent_emails");
    try {
      if (!EMAIL || !APP_PASSWORD || !IMAP_SERVER) {
        throw new Error("Не настроены переменные окружения для почты (MAIL_USER, MAIL_PASSWORD, IMAP_SERVER)");
      }

      const count = (args?.count as number) || 5;
      
      const client = new ImapFlow({
        host: IMAP_SERVER,
        port: 993,
        secure: true,
        auth: {
          user: EMAIL,
          pass: APP_PASSWORD,
        },
      });

      console.error("[DEBUG] Подключение к IMAP...");
      await client.connect();
      console.error("[DEBUG] Подключено успешно. Блокируем INBOX...");
      
      const lock = await client.getMailboxLock("INBOX");
      try {
        console.error(`[DEBUG] Ищем UID последних ${count} писем...`);
        // Получаем все UID и берем последние N
        const allUids = await client.search({ all: true });
        const targetUids = allUids ? allUids.slice(-count) : [];

        const messages: string[] = [];
        if (targetUids.length > 0) {
          console.error(`[DEBUG] Запрашиваем данные для ${targetUids.length} писем...`);
          for await (const message of client.fetch(targetUids.join(","), { envelope: true })) {
            const env = message.envelope;
            const from = env?.from?.[0]?.name || env?.from?.[0]?.address || "Неизвестно";
            const subject = env?.subject || "Без темы";
            const date = env?.date ? new Date(env.date).toLocaleString("ru-RU") : "Нет даты";
            
            messages.push(`От: ${from}\nТема: ${subject}\nДата: ${date}\n---`);
          }
        }

        lock.release();
        console.error("[DEBUG] Успешно получены письма. Отключаемся...");
        await client.logout();

        return {
          content: [{ type: "text", text: `Последние ${messages.length} писем:\n\n${messages.join("\n\n")}` }],
        };
      } catch (err) {
        lock.release();
        throw err;
      }
    } catch (error: any) {
      console.error("[DEBUG] Ошибка IMAP:", error.message);
      return {
        content: [{ type: "text", text: `Ошибка при чтении почты: ${error.message}` }],
        isError: true,
      };
    }
  }

  throw new Error(`Неизвестный инструмент: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP сервер запущен и слушает stdio...");
}

main().catch((error) => {
  console.error("Фатальная ошибка сервера:", error);
  process.exit(1);
});
