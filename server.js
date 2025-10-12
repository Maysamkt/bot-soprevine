const express = require("express");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const port = process.env.SERVER_PORT || 3000;

app.use(cors());
app.use(express.json());

let whatsappClient;
let isWhatsAppReady = false;

// ⬇️ VARIÁVEIS PROTEGIDAS - vêm do .env
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const TEST_PHONE = process.env.TEST_PHONE;
// const ADMIN_PHONE = process.env.ADMIN_PHONE;

// ⬇️ VALIDA SE AS VARIÁVEIS EXISTEM
if (!N8N_WEBHOOK_URL) {
  console.warn("⚠️  N8N_WEBHOOK_URL não configurada no .env");
}

// ⬇️ INICIALIZAR WHATSAPP-WEB.JS
whatsappClient = new Client({
  authStrategy: new LocalAuth({
    clientId: process.env.WHATSAPP_SESSION_NAME || "soprevine-demo",
  }),
  puppeteer: {
    executablePath:
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
    headless: false,
  },
  webVersionCache: {
    type: "remote",
    remotePath:
      "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html",
  },
});

// ⬇️ GERAR QR CODE
whatsappClient.on("qr", (qr) => {
  console.log("📱 Escaneie o QR Code abaixo com seu WhatsApp:");
  qrcode.generate(qr, { small: true });
  console.log("⏳ Aguardando escaneamento...");
});

// ⬇️ QUANDO CONECTADO
whatsappClient.on("ready", () => {
  isWhatsAppReady = true;
  console.log("✅ WhatsApp conectado e pronto!");
  console.log("🚀 Pronto para enviar mensagens!");
});

// ⬇️ QUANDO DESCONECTADO
whatsappClient.on("disconnected", (reason) => {
  isWhatsAppReady = false;
  console.log("❌ WhatsApp desconectado:", reason);
});

whatsappClient.on("message", async (message) => {
  // ⬇️ IGNORAR GRUPOS E STATUS
  if (message.from.includes("@g.us") || message.from === "status@broadcast") {
    console.log(`🚫 Ignorando mensagem de grupo/status: ${message.from}`);
    return;
  }

  console.log(`📩 Mensagem recebida de ${message.from}: ${message.body}`);

  // ⬇️ ENVIAR PARA n8n CLOUD
  await enviarParaN8N({
    from: message.from,
    body: message.body,
  });
});

// ⬇️ FUNÇÃO PARA ENVIAR MENSAGENS PARA n8n
async function enviarParaN8N(mensagemData) {
  try {
    console.log(`📨 Enviando mensagem para n8n...`);

    const response = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "WhatsApp-Bot/1.0",
      },
      body: JSON.stringify({
        from: mensagemData.from,
        body: mensagemData.body,
        timestamp: new Date().toISOString(),
        type: "message_received",
      }),
    });

    if (response.ok) {
      console.log("✅ Mensagem enviada para n8n cloud");
    } else {
      console.log("❌ Erro n8n - Status:", response.status);
    }
  } catch (error) {
    console.log("❌ Falha ao conectar com n8n:", error.message);
  }
}

// ⬇️ ESCUTAR MENSAGENS RECEBIDAS
whatsappClient.on("message", async (message) => {
  if (message.from === "status@broadcast") return;

  console.log(`📩 Mensagem recebida de ${message.from}: ${message.body}`);

  // ⬇️ ENVIAR PARA n8n CLOUD
  await enviarParaN8N({
    from: message.from,
    body: message.body,
  });
});

// ⬇️ INICIALIZAR CLIENTE
whatsappClient.initialize().catch((error) => {
  console.log("❌ Erro ao inicializar WhatsApp:", error);
});

// ⬇️ FUNÇÃO PARA ENVIAR MENSAGENS
async function enviarMensagemSegura(phone, message) {
  if (!whatsappClient) {
    throw new Error("WhatsApp client não está inicializado");
  }

  if (!isWhatsAppReady) {
    throw new Error("WhatsApp não está pronto. Aguarde a conexão...");
  }

  try {
    const formattedPhone = phone.replace(/\D/g, "") + "@c.us";
    console.log(`📤 Enviando para ${formattedPhone}`);

    const result = await whatsappClient.sendMessage(formattedPhone, message);
    console.log("✅ Mensagem enviada com sucesso!");

    return result;
  } catch (error) {
    console.error("❌ Erro ao enviar mensagem:", error.message);
    throw error;
  }
}

// ⬇️ ROTA PARA ENVIAR MENSAGEM
app.post("/send-message", async (req, res) => {
  try {
    const { phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({
        success: false,
        error: "Phone e message são obrigatórios",
      });
    }

    console.log(`📝 Recebida requisição para: ${phone}`);

    const result = await enviarMensagemSegura(phone, message);

    res.json({
      success: true,
      messageId: result.id._serialized,
      status: "enviada",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Erro em /send-message:", error);
    res.status(500).json({
      success: false,
      error: "Falha ao enviar mensagem",
      details: error.message,
    });
  }
});

// ⬇️ ROTA DE STATUS
app.get("/status", (req, res) => {
  res.json({
    status: whatsappClient ? "inicializado" : "não inicializado",
    ready: isWhatsAppReady,
    message: isWhatsAppReady
      ? "✅ Pronto para enviar mensagens"
      : "⏳ Aguardando conexão do WhatsApp...",
  });
});

// ⬇️ ROTA PARA TESTE
app.post("/test-message", async (req, res) => {
  try {
    const { phone } = req.body;
    const testPhone = phone || TEST_PHONE; // Coloque um número real na variável de ambiente

    if (!testPhone) {
      return res.status(400).json({
        success: false,
        error: "Número de teste não configurado",
        message: "Configure TEST_PHONE no arquivo .env",
      });
    }

    const testMessage = "🚀 Sistema Soprevine - Teste de funcionamento";

    console.log(`🧪 Enviando mensagem de teste para: ${testPhone}`);

    const result = await enviarMensagemSegura(testPhone, testMessage);

    res.json({
      success: true,
      message: "Mensagem de teste enviada com sucesso!",
      messageId: result.id._serialized,
      phone: "***" + testPhone.slice(-4),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Falha no teste: " + error.message,
    });
  }
});

// ⬇️ HEALTH CHECK
app.get("/health", (req, res) => {
  res.json({
    status: "online",
    timestamp: new Date().toISOString(),
    service: "WhatsApp Web.js API",
    whatsAppReady: isWhatsAppReady,
  });
});

// ⬇️ INICIAR SERVIDOR
app.listen(port, () => {
  console.log(`✅ API WhatsApp Web.js rodando na porta ${port}`);
  console.log(`🌐 Health check: http://localhost:${port}/health`);
  console.log(`📊 Status: http://localhost:${port}/status`);
  console.log(`📱 Aguardando QR Code...`);
});

process.on("SIGINT", async () => {
  console.log("🔄 Encerrando WhatsApp client...");
  if (whatsappClient) {
    await whatsappClient.destroy();
  }
  process.exit(0);
});

// ⬇️ VERIFICAÇÃO DE SEGURANÇA
app.use((req, res, next) => {
  // Remove headers sensíveis
  res.removeHeader("X-Powered-By");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

// ⬇️ ROTA 404 PERSONALIZADA
app.use((req, res) => {
  res.status(404).json({
    error: "Endpoint não encontrado",
    service: "Sistema Soprevine",
  });
});
