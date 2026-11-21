// @ts-nocheck
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";

const AnyObjectSchema = z.object({}).passthrough();

async function main() {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["build/index.js"],
  });

  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log("Клиент подключен к серверу\n");

  console.log("Тестируем список инструментов...");
  // @ts-ignore - обходим строгую типизацию для тестов
  const toolsResp = await client.request({ method: "tools/list" }, AnyObjectSchema);
  console.log("Доступные инструменты:", (toolsResp as any).tools.map((t: any) => t.name));
  console.log();

  console.log("Тестируем ping_petrovich...");
  // @ts-ignore
  const pingResp = await client.request(
    { method: "tools/call", params: { name: "ping_petrovich", arguments: {} } },
    AnyObjectSchema
  );
  console.log("Результат:", (pingResp as any).content[0].text);
  console.log();

  console.log("Тестируем list_recent_emails (5 писем)...");
  // @ts-ignore
  const emailsResp = await client.request(
    { method: "tools/call", params: { name: "list_recent_emails", arguments: { count: 5 } } },
    AnyObjectSchema
  );
  console.log("Результат:\n", (emailsResp as any).content[0].text);

  await client.close();
  console.log("\nТест завершен.");
}

main().catch(console.error);
