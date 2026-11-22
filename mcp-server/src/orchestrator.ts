import { Ollama } from 'ollama';
import { ImapFlow } from 'imapflow';
import express, { Request, Response } from 'express';
import * as dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const OLLAMA_HOST = "http://100.89.188.65:11434";
const ollama = new Ollama({ host: OLLAMA_HOST });

const EMAIL_USER = process.env.EMAIL_USER || "";
const EMAIL_PASS = process.env.EMAIL_PASS || "";
const EMAIL_HOST = process.env.EMAIL_HOST || "imap.mail.ru";

async function checkRecentEmails(count: number) {
    console.log(`[DEBUG] Запуск инструмента list_recent_emails (count: ${count})`);
    const client = new ImapFlow({
        host: EMAIL_HOST,
        port: 993,
        secure: true,
        auth: { user: EMAIL_USER, pass: EMAIL_PASS }
    });

    await client.connect();
    console.log(`[DEBUG] Подключено успешно.`);
    
    const lock = await client.getMailboxLock('INBOX');
    try {
        const status: any = await client.status('INBOX', { messages: true });
        const total = status?.messages || 0;
        const start = Math.max(1, total - count + 1);
        const sequence = `${start}:*`;
        
        const messages = [];
        for await (const message of client.fetch(sequence, { envelope: true })) {
            messages.push({
                from: message.envelope?.from?.[0]?.address || 'Неизвестно',
                subject: message.envelope?.subject || 'Без темы',
                date: message.envelope?.date ? new Date(message.envelope.date).toLocaleString('ru-RU') : 'Неизвестно'
            });
        }
        return messages.reverse();
    } finally {
        lock.release();
        await client.logout();
        console.log(`[DEBUG] Отключено.`);
    }
}

const tools = [{
    type: 'function',
    function: {
        name: 'list_recent_emails',
        description: 'Получить список последних писем из почты',
        parameters: {
            type: 'object',
            properties: { count: { type: 'number', description: 'Количество писем' } },
            required: ['count']
        }
    }
}];

async function runOrchestrator() {
    console.log("🧠 Отправляем запрос в Ollama...");
    const response: any = await ollama.chat({
        model: 'qwen-local:latest',
        messages: [{ 
            role: 'user', 
            content: 'Проверь последние 3 письма на почте и кратко перескажи их темы и отправителей. Не выдумывай данные.' 
        }],
        tools: tools
    });

    console.log("📩 Сырой ответ от модели:", response.message.content || "tool_calls");

    let toolCall = response.message.tool_calls?.[0];
    
    // АБСОЛЮТНО ПУЛЕНЕПРОБИВАЕМЫЙ ПАРСИНГ: ищем конкретные ключевые слова, игнорируя весь мусор вокруг
    if (!toolCall && response.message.content) {
        const match = response.message.content.match(/"name"\s*:\s*"list_recent_emails"[\s\S]*?"count"\s*:\s*(\d+)/);
        if (match) {
            const count = parseInt(match[1], 10) || 3;
            toolCall = { function: { name: 'list_recent_emails', arguments: JSON.stringify({ count }) } };
            console.log(`🔧 Распознан вызов инструмента через RegEx! Извлечено count=${count}`);
        } else {
            console.log("⚠️ RegEx не нашел 'list_recent_emails' в ответе");
        }
    }

    if (toolCall && toolCall.function.name === 'list_recent_emails') {
        const args = typeof toolCall.function.arguments === 'string' 
            ? JSON.parse(toolCall.function.arguments) 
            : toolCall.function.arguments;
        
        console.log(`🔧 Выполняем инструмент: ${toolCall.function.name}, аргументы:`, args);
        
        const emails: any[] = await checkRecentEmails(args.count || 3);
        const emailText = emails.map((e) => `От: ${e.from}\nТема: ${e.subject}\nДата: ${e.date}\n---`).join('\n');
        
        console.log("🔄 Отправляем данные обратно в модель для финального ответа...");
        
        const finalResponse: any = await ollama.chat({
            model: 'qwen-local:latest',
            messages: [
                { role: 'user', content: 'Проверь последние 3 письма на почте и кратко перескажи их темы и отправителей.' },
                { role: 'assistant', tool_calls: response.message.tool_calls || undefined, content: response.message.content },
                { role: 'tool', content: emailText, tool_call_id: toolCall.function.name }
            ] as any
        });
        return finalResponse.message.content;
    }

    return response.message.content || "Не удалось получить данные.";
}

app.post('/check-mail', async (req: Request, res: Response) => {
    try {
        console.log("📩 Получен HTTP-запрос на проверку почты");
        const result = await runOrchestrator();
        res.json({ status: 'success', result: result });
    } catch (error: any) {
        console.error("❌ Ошибка:", error.message);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Оркестратор запущен и слушает порт ${PORT}. Жду команд.`);
});
