// @ts-nocheck
import { Ollama } from 'ollama';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";

const AnyObjectSchema = z.object({}).passthrough();

async function main() {
  const MODEL_NAME = "qwen-local:latest";
  const OLLAMA_HOST = "http://192.168.0.104:11434";

  const ollama = new Ollama({ host: OLLAMA_HOST });

  const transport = new StdioClientTransport({
    command: "node",
    args: ["build/index.js"],
  });

  const client = new Client({ name: "orchestrator", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  console.log("✅ MCP-сервер подключен");

  const toolsResp = await client.request({ method: "tools/list" }, AnyObjectSchema);
  const mcpTools = toolsResp.tools;

  const toolsDescription = mcpTools.map((t: any) => 
    `- ${t.name}: ${t.description}. Параметры: ${JSON.stringify(t.inputSchema)}`
  ).join('\n');

  const messages = [
    { 
      role: 'system', 
      content: `Ты — Петрович, ассистент, который работает с реальными данными. У тебя есть доступ к инструментам:
${toolsDescription}

ПРАВИЛА РАБОТЫ:
1. Когда пользователю нужна информация, вызывай инструмент через JSON: {"name": "имя_инструмента", "arguments": {параметры}}
2. После получения данных от инструмента, СТРОГО пересказывай ТОЛЬКО то, что пришло в результате.
3. ЗАПРЕЩЕНО выдумывать, додумывать или изменять данные. Если в результате написано "Chesnok.cards", пиши именно "Chesnok.cards", а не "GitHub" или что-то другое.
4. Отвечай на русском языке, кратко и по делу.`
    },
    { role: 'user', content: 'Проверь последние 3 письма на моей почте и кратко скажи, от кого они и какая тема.' }
  ];

  console.log(`\n🧠 Отправляем запрос в Ollama (модель: ${MODEL_NAME})...`);
  
  const response = await ollama.chat({
    model: MODEL_NAME,
    messages: messages,
  });

  const responseText = response.message.content;
  console.log("📩 Сырой ответ от модели:", responseText);

  // Пытаемся извлечь JSON из ответа
  let toolCall = null;
  try {
    // Удаляем markdown-обёртку
    let cleanText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    // Ищем JSON в очищенном тексте
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      toolCall = JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.log("⚠️ Не удалось распарсить JSON из ответа:", e.message);
  }
  if (toolCall && toolCall.name && mcpTools.find((t: any) => t.name === toolCall.name)) {
    console.log(`\n🔧 Модель запросила инструмент: ${toolCall.name}`);
    console.log(`⚙️ Аргументы:`, toolCall.arguments);
    
    const toolResult = await client.request(
      { method: "tools/call", params: { name: toolCall.name, arguments: toolCall.arguments } },
      AnyObjectSchema
    );
    
    const resultText = toolResult.content[0].text;
    console.log("📦 СЫРЫЕ ДАННЫЕ ОТ MCP ДЛЯ ИИ:\n", resultText);
    
    messages.push({ role: 'assistant', content: responseText });
    messages.push({ role: 'user', content: `Вот РЕАЛЬНЫЕ данные от инструмента:\n\n${resultText}\n\nСТРОГО перескажи эти данные пользователю. НЕ выдумывай ничего от себя. Используй ТОЛЬКО информацию из этого текста. Ответь кратко на русском языке.` });
    
console.log("\n🔄 Отправляем данные обратно в модель для формирования ответа...");
    const finalResponse = await ollama.chat({
      model: MODEL_NAME,
      messages: messages,
    });
    
    console.log("\n=== 🎯 ФИНАЛЬНЫЙ ОТВЕТ ИИ ===\n");
    console.log(finalResponse.message.content);
  } else {
    console.log("\n=== 🎯 ОТВЕТ ИИ (без вызова инструментов) ===\n");
    console.log(responseText);
  }

  await client.close();
  console.log("\n✅ Работа завершена.");
}

main().catch((err) => {
  console.error("❌ Ошибка:", err.message);
  process.exit(1);
});
