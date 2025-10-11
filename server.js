const express = require("express");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const cors = require("cors");

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

let whatsappClient;
let isWhatsAppReady = false;
let isLoggedIn = false;

// ⬇️ INICIALIZAR WHATSAPP-WEB.JS
whatsappClient = new Client({
  authStrategy: new LocalAuth(), // ⬅️ Salva sessão automaticamente
  puppeteer: {
    executablePath:
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
    headless: false, // ⬅️ Mostra o navegador
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
  isLoggedIn = true;
  console.log("✅ WhatsApp conectado e pronto!");
  console.log("🚀 Pronto para enviar mensagens!");
});

// ⬇️ QUANDO DESCONECTADO
whatsappClient.on("disconnected", (reason) => {
  isWhatsAppReady = false;
  isLoggedIn = false;
  console.log("❌ WhatsApp desconectado:", reason);
});

// ⬇️ ESCUTAR MENSAGENS RECEBIDAS
whatsappClient.on("message", async (message) => {
  if (message.from === "status@broadcast") return; // Ignorar status

  console.log(`📩 Mensagem recebida de ${message.from}: ${message.body}`);

  // ⬇️ ENVIAR PARA n8n (webhook)
  try {
    // await fetch("http://localhost:5678/webhook/receive-message", {
    //   method: "POST",
    //   headers: { "Content-Type": "application/json" },
    //   body: JSON.stringify({
    //     from: message.from,
    //     body: message.body,
    //     timestamp: message.timestamp
    //   }),
    // });
    console.log("📨 Mensagem encaminhada para n8n (simulado)");
  } catch (error) {
    console.log("❌ Erro ao enviar para n8n:", error);
  }
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

  if (!isWhatsAppReady || !isLoggedIn) {
    throw new Error("WhatsApp não está pronto. Aguarde a conexão...");
  }

  try {
    // Formatar número (remove tudo que não é dígito e adiciona @c.us)
    const formattedPhone = phone.replace(/\D/g, "") + "@c.us";
    console.log(`📤 Enviando para ${formattedPhone}: ${message}`);

    // ⬇️ ENVIAR MENSAGEM - MÉTODO CORRETO PARA whatsapp-web.js
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
    loggedIn: isLoggedIn,
    message:
      isWhatsAppReady && isLoggedIn
        ? "✅ Pronto para enviar mensagens"
        : "⏳ Aguardando conexão do WhatsApp...",
  });
});

// ⬇️ ROTA PARA TESTE
app.post("/test-message", async (req, res) => {
  try {
    const { phone } = req.body;
    const testPhone = phone || "5562992767536"; // ⬅️ Use seu número
    const testMessage =
      "🚀 Teste do sistema de alertas - Mensagem de confirmação";

    console.log(`🧪 Enviando mensagem de teste para: ${testPhone}`);

    const result = await enviarMensagemSegura(testPhone, testMessage);

    res.json({
      success: true,
      message: "Mensagem de teste enviada com sucesso!",
      messageId: result.id._serialized,
      phone: testPhone,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Falha no teste: " + error.message,
    });
  }
});

// ⬇️ ROTA PARA OBTER INFORMAÇÕES DO CLIENTE
app.get("/client-info", async (req, res) => {
  try {
    if (!whatsappClient) {
      return res.json({ error: "Cliente não inicializado" });
    }

    const info = await whatsappClient.getInfo();

    res.json({
      wid: info.wid._serialized,
      platform: info.platform,
      phone: info.wid.user,
      name: info.pushname,
      connected: isWhatsAppReady,
    });
  } catch (error) {
    res.json({ error: error.message });
  }
});

// ⬇️ HEALTH CHECK
app.get("/health", (req, res) => {
  res.json({
    status: "online",
    timestamp: new Date().toISOString(),
    service: "WhatsApp Web.js API",
    whatsAppReady: isWhatsAppReady,
    loggedIn: isLoggedIn,
  });
});

// ⬇️ INICIAR SERVIDOR
app.listen(port, () => {
  console.log(`✅ API WhatsApp Web.js rodando na porta ${port}`);
  console.log(`🌐 Health check: http://localhost:${port}/health`);
  console.log(`📊 Status: http://localhost:${port}/status`);
  console.log(`🧪 Teste: POST http://localhost:${port}/test-message`);
  console.log(`📱 Aguardando QR Code...`);
});

// ⬇️ ENCERRAMENTO GRACIOSO
process.on("SIGINT", async () => {
  console.log("🔄 Encerrando WhatsApp client...");
  if (whatsappClient) {
    await whatsappClient.destroy();
  }
  process.exit(0);
});
