import { Ollama } from 'ollama';
import { ImapFlow } from 'imapflow';
import express, { Request, Response } from 'express';
import * as dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const OLLAMA_HOST = "http://100.89.188.65:11434";
const ollama = new Ollama({ host: OLLAMA_HOST });

const EMAIL_USER = process.env.MAIL_USER || process.env.EMAIL_USER || "";
const EMAIL_PASS = process.env.MAIL_PASSWORD || process.env.EMAIL_PASS || "";
const EMAIL_HOST = process.env.IMAP_SERVER || process.env.EMAIL_HOST || "imap.mail.ru";

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
        console.log(`[DEBUG] Fetching sequence: ${sequence}`);
        for await (const message of client.fetch(sequence, { envelope: true, uid: true })) {
            console.log(`[DEBUG] Получено письмо UID: ${message.uid}`);
            messages.push({
                uid: message.uid,
                from: message.envelope?.from?.[0]?.address || 'Неизвестно',
                subject: message.envelope?.subject || 'Без темы',
                date: message.envelope?.date ? new Date(message.envelope.date).toLocaleString('ru-RU') : 'Неизвестно'
            });
        }
        console.log(`[DEBUG] Всего получено писем: ${messages.length}`);
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
    messages: [
        {
            role: 'system',
            content: 'Ты строгий технический ассистент. Ты никогда не выдумываешь код, факты или данные. Для получения информации о почте ты обязан использовать только предоставленный инструмент list_recent_emails. Отвечай максимально кратко и только по делу.'
        },
        {
            role: 'user',
            content: 'Проверь последние 5 писем на почте и кратко перескажи их темы и отправителей. Не выдумывай данные.'
        }
    ],
    tools: tools
});
    console.log("📩 Сырой ответ от модели:", response.message.content || "tool_calls");

    let toolCall = response.message.tool_calls?.[0];
    
    // АБСОЛЮТНО ПУЛЕНЕПРОБИВАЕМЫЙ ПАРСИНГ: ищем конкретные ключевые слова, игнорируя весь мусор вокруг
    if (!toolCall && response.message.content) {
        const match = response.message.content.match(/"name"\s*:\s*"list_recent_emails"[\s\S]*?"count"\s*:\s*(\d+)/);
        if (match) {
            const count = parseInt(match[1], 10) || 5;
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
        
        const emails: any[] = await checkRecentEmails(args.count || 5);
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

app.post('/analyze-mail', async (req: Request, res: Response) => {
    try {
        const emails = await checkRecentEmails(10);
        const emailText = emails.map((e) => `UID: ${e.uid}\nОт: ${e.from}\nТема: ${e.subject}\nДата: ${e.date}`).join('\n---\n');

        const response: any = await ollama.chat({
            model: 'qwen-local:latest',
            messages: [
                {
                    role: 'system',
                    content: 'Ты строгий помощник. Проанализируй список писем. Раздели их на "Полезные" и "Спам/Реклама". Верни ответ СТРОГО в формате JSON с полями: "summary" (краткая сводка полезных дел, 2-3 предложения), "spam" (массив объектов вида {"uid": число, "from": "отправитель", "subject": "тема", "reason": "кратко почему это спам, 1 предложение"}). Не выдумывай UID, бери только из списка.'
                },
                {
                    role: 'user',
                    content: `Вот список писем:\n${emailText}`
                }
            ]
        });

        let result;
        try {
            const jsonMatch = response.message.content.match(/\{[\s\S]*\}/);
            const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
            result = parsed || { summary: response.message.content, spam: [] };
            if (!result.summary) result.summary = "Сводка не сформирована.";
            if (!Array.isArray(result.spam)) result.spam = [];
        } catch (e) {
            result = { summary: "Не удалось распарсить ответ модели.", spam: [] };
        }

        res.json({ status: 'success', data: result });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.post('/delete-mails', async (req: Request, res: Response) => {
    try {
        const { uids } = req.body;
        if (!uids || !Array.isArray(uids) || uids.length === 0) {
            return res.status(400).json({ status: 'error', message: 'Не переданы UID для удаления' });
        }

        const client = new ImapFlow({
            host: process.env.IMAP_SERVER || process.env.EMAIL_HOST || 'imap.mail.ru',
            port: 993,
            secure: true,
            auth: { 
                user: (process.env.MAIL_USER || process.env.EMAIL_USER || ""), 
                pass: (process.env.MAIL_PASSWORD || process.env.EMAIL_PASS || "")
            }
        });

        await client.connect();
        const lock = await client.getMailboxLock('INBOX');
        try {
            for (const uid of uids) {
                await client.messageDelete({ uid: uid });
            }
            res.json({ status: 'success', message: `Удалено писем: ${uids.length}` });
        } finally {
            lock.release();
            await client.logout();
        }
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Очистка корзины (без ИИ, просто удаляем всё)
app.post('/empty-trash', async (req: Request, res: Response) => {
    try {
        const client = new ImapFlow({
            host: process.env.IMAP_SERVER || process.env.EMAIL_HOST || 'imap.mail.ru',
            port: 993,
            secure: true,
            auth: { 
                user: (process.env.MAIL_USER || process.env.EMAIL_USER || ""), 
                pass: (process.env.MAIL_PASSWORD || process.env.EMAIL_PASS || "")
            }
        });

        await client.connect();
        
        // Пробуем разные названия папки корзины
        let trashFolder = null;
        let deletedCount = 0;
        const possibleNames = ['Trash', 'Корзина', 'Deleted Items', '[Gmail]/Trash'];
        
        for (const name of possibleNames) {
            try {
                const lock = await client.getMailboxLock(name);
                trashFolder = name;
                console.log(`[DEBUG] Найдена папка корзины: ${name}`);
                
                // Получаем все UID писем
                const status: any = await client.status(name, { messages: true });
                const total = status?.messages || 0;
                
                if (total > 0) {
                    // Собираем все UID
                    const uids: number[] = [];
                    for await (const message of client.fetch('1:*', { uid: true })) {
                        uids.push(message.uid);
                    }
                    
                    // Удаляем каждое письмо по UID
                    for (const uid of uids) {
                        await client.messageDelete({ uid: uid });
                        deletedCount++;
                    }
                    console.log(`[DEBUG] Удалено ${deletedCount} писем из корзины`);
                }
                
                lock.release();
                break;
            } catch (e) {
                continue;
            }
        }
        
        await client.logout();
        
        if (trashFolder) {
            res.json({ status: 'success', message: `Корзина очищена (папка: ${trashFolder}, удалено: ${deletedCount})` });
        } else {
            res.status(404).json({ status: 'error', message: 'Папка корзины не найдена' });
        }
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Проверка папки спам с анализом
app.post('/check-spam-folder', async (req: Request, res: Response) => {
    try {
        console.log("[DEBUG] /check-spam-folder: Начинаем подключение к IMAP...");
        const client = new ImapFlow({
            host: process.env.IMAP_SERVER || process.env.EMAIL_HOST || 'imap.mail.ru',
            port: 993,
            secure: true,
            auth: { 
                user: (process.env.MAIL_USER || process.env.EMAIL_USER || ""), 
                pass: (process.env.MAIL_PASSWORD || process.env.EMAIL_PASS || "")
            }
        });

        await client.connect();
        console.log("[DEBUG] /check-spam-folder: Подключено к IMAP.");
        
        // Ставим 'Спам' первым, так как это Mail.ru
        let spamFolder = null;
        const possibleNames = ['Спам', 'Spam', 'Junk', '[Gmail]/Spam'];
        
        for (const name of possibleNames) {
            try {
                console.log(`[DEBUG] Пробуем открыть папку: ${name}`);
                const lock = await client.getMailboxLock(name);
                spamFolder = name;
                console.log(`[DEBUG] Успешно открыли папку: ${name}`);
                
                console.log(`[DEBUG] Запрашиваем статус папки...`);
                const status: any = await client.status(name, { messages: true });
                const total = status?.messages || 0;
                console.log(`[DEBUG] Всего писем в папке: ${total}`);
                
                let emails: any[] = [];
                if (total > 0) {
                    const countToFetch = Math.min(10, total);
                    const start = total - countToFetch + 1;
                    const sequence = `${start}:*`;
                    console.log(`[DEBUG] Запрашиваем письма по последовательности: ${sequence}`);
                    
                    for await (const message of client.fetch(sequence, { envelope: true, uid: true })) {
                        emails.push({
                            uid: message.uid,
                            from: message.envelope?.from?.[0]?.address || 'Неизвестно',
                            subject: message.envelope?.subject || 'Без темы',
                            date: message.envelope?.date ? new Date(message.envelope.date).toLocaleString('ru-RU') : 'Неизвестно'
                        });
                    }
                    console.log(`[DEBUG] Получено писем для анализа: ${emails.length}`);
                    emails = emails.reverse();
                }
                
                console.log(`[DEBUG] Освобождаем lock и закрываем IMAP...`);
                lock.release();
                await client.logout();
                console.log("[DEBUG] IMAP соединение закрыто.");
                
                if (emails.length === 0) {
                    return res.json({ status: 'success', data: { summary: 'Папка спама пуста.', spam: [] } });
                }
                
                console.log(`[DEBUG] Формируем текст для Ollama...`);
                const emailText = emails.map((e) => `UID: ${e.uid}\nОт: ${e.from}\nТема: ${e.subject}\nДата: ${e.date}`).join('\n---\n');
                
                console.log(`[DEBUG] Отправляем запрос в Ollama (модель: qwen-local:latest)...`);
                const response: any = await ollama.chat({
                    model: 'qwen-local:latest',
                    messages: [
                        {
                            role: 'system',
                            content: 'Ты строгий помощник. Проанализируй письма из папки спама. Сделай краткую сводку: кто пишет и о чем. Верни ответ СТРОГО в формате JSON с полями: "summary" (краткая сводка, 2-3 предложения), "spam" (массив объектов вида {"uid": число, "from": "отправитель", "subject": "тема", "reason": "кратко о чем письмо, 1 предложение"}). Не выдумывай UID.'
                        },
                        {
                            role: 'user',
                            content: `Вот письма из папки спама:\n${emailText}`
                        }
                    ]
                });
                console.log(`[DEBUG] Получен ответ от Ollama!`);
                
                let result;
                try {
                    const jsonMatch = response.message.content.match(/\{[\s\S]*\}/);
                    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
                    result = parsed || { summary: response.message.content, spam: [] };
                    if (!result.summary) result.summary = "Сводка не сформирована.";
                    if (!Array.isArray(result.spam)) result.spam = [];
                } catch (e) {
                    console.error("[DEBUG] Ошибка парсинга JSON от Ollama:", e);
                    result = { summary: "Не удалось распарсить ответ модели.", spam: [] };
                }
                
                return res.json({ status: 'success', data: result });
                
            } catch (e) {
                console.log(`[DEBUG] Не удалось открыть папку ${name}, пробуем следующую. Ошибка:`, (e as Error).message);
                continue;
            }
        }
        
        await client.logout();
        res.status(404).json({ status: 'error', message: 'Папка спама не найдена' });
        
    } catch (error: any) {
        console.error("[DEBUG] Критическая ошибка /check-spam-folder:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Полная очистка папки спам (без передачи UID, чтобы не превышать лимит Telegram в 64 байта)
app.post('/empty-spam', async (req: Request, res: Response) => {
    try {
        const client = new ImapFlow({
            host: process.env.IMAP_SERVER || process.env.EMAIL_HOST || 'imap.mail.ru',
            port: 993,
            secure: true,
            auth: { 
                user: (process.env.MAIL_USER || process.env.EMAIL_USER || ""), 
                pass: (process.env.MAIL_PASSWORD || process.env.EMAIL_PASS || "")
            }
        });

        await client.connect();
        
        let spamFolder = null;
        let deletedCount = 0;
        const possibleNames = ['Спам', 'Spam', 'Junk', '[Gmail]/Spam'];
        
        for (const name of possibleNames) {
            try {
                const lock = await client.getMailboxLock(name);
                spamFolder = name;
                
                const status: any = await client.status(name, { messages: true });
                const total = status?.messages || 0;
                
                if (total > 0) {
                    const uids: number[] = [];
                    for await (const message of client.fetch('1:*', { uid: true })) {
                        uids.push(message.uid);
                    }
                    for (const uid of uids) {
                        await client.messageDelete({ uid: uid });
                        deletedCount++;
                    }
                }
                
                lock.release();
                break;
            } catch (e) {
                continue;
            }
        }
        
        await client.logout();
        
        if (spamFolder) {
            res.json({ status: 'success', message: `Папка спам очищена (удалено писем: ${deletedCount})` });
        } else {
            res.status(404).json({ status: 'error', message: 'Папка спама не найдена' });
        }
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🚀 Оркестратор запущен и слушает порт ${PORT}. Жду команд.`);
});
