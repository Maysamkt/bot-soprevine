const express = require("express");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const port = process.env.SERVER_PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "50mb" })); // Aumentar o tamanho para receber audio
app.use(express.urlencoded({ limit: "50mb", extended: true }));

let whatsappClient;
let isWhatsAppReady = false;

// ⬇️ VARIÁVEIS PROTEGIDAS - vêm do .env
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const TEST_PHONE = process.env.TEST_PHONE;

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

// ⬇️ EVENT LISTENER COMPLETO PARA ÁUDIO + TEXTO (BASE64)
whatsappClient.on("message", async (message) => {
  // ⬇️ IGNORAR GRUPOS E STATUS
  if (message.from.includes("@g.us") || message.from === "status@broadcast") {
    console.log(`🚫 Ignorando mensagem de grupo/status: ${message.from}`);
    return;
  }

  console.log(`\n=== 📩 NOVA MENSAGEM RECEBIDA ===`);
  console.log(`De: ${message.from}`);
  console.log(`Tipo: ${message.type}`);
  console.log(`Tem mídia: ${message.hasMedia}`);
  console.log(`Duração: ${message.duration || "N/A"}s`);
  console.log(`Corpo: ${message.body || "[SEM TEXTO]"}`);

  let payload = {
    from: message.from,
    type: message.type,
    hasMedia: message.hasMedia,
    timestamp: new Date().toISOString(),
    messageType: "message_received",
  };

  // ⬇️ DETECTAR E PROCESSAR MÍDIA
  if (message.hasMedia) {
    console.log(`🎯 DETECTADA MÍDIA - Tipo: ${message.type}`);

    // ⬇️ DETECTAR QUALQUER TIPO DE ÁUDIO
    const isAudio = message.type === "audio" || message.type === "ptt";

    if (isAudio) {
      console.log(`🎤 PROCESSANDO ÁUDIO/PTT...`);

      try {
        console.log(`⬇️ Baixando áudio...`);
        const media = await message.downloadMedia();
        console.log(
          `✅ Áudio baixado - Tipo: ${media.mimetype}, Tamanho: ${media.data.length} bytes`
        );

        // ⬇️ ENVIA O BASE64 COMPLETO! 🎯
        payload.body = "[ÁUDIO_BASE64]";
        payload.audioData = {
          base64: media.data,
          mimeType: media.mimetype,
          duration: message.duration,
          fileSize: media.data.length,
          filename: `audio_${Date.now()}.ogg`, // WhatsApp áudios são geralmente .ogg
        };

        console.log(
          `📤 Base64 preparado - Primeiros 100 chars: ${media.data.substring(
            0,
            100
          )}...`
        );
      } catch (error) {
        console.log("❌ ERRO ao baixar áudio:", error.message);
        payload.body = "[ERRO AO BAIXAR ÁUDIO]";
        payload.audioError = error.message;
      }
    } else {
      // Outros tipos de mídia
      payload.body = `[${message.type.toUpperCase()}]`;
      console.log(`📎 Outro tipo de mídia: ${message.type}`);
    }
  } else {
    // Texto normal
    payload.body = message.body;
    console.log(`💬 Texto normal: ${message.body}`);
  }

  console.log(`🚀 Enviando para n8n...`);
  // ⬇️ ENVIAR PARA n8n CLOUD
  await enviarParaN8N(payload);
  console.log(`=== FIM DO PROCESSAMENTO ===\n`);
});

// ⬇️ FUNÇÃO PARA ENVIAR MENSAGENS PARA n8n
async function enviarParaN8N(mensagemData) {
  try {
    console.log(`\n📨 [ENVIAR_PARA_N8N] Iniciando envio...`);
    console.log(`   Tipo: ${mensagemData.type}`);
    console.log(`   Tem áudio: ${!!mensagemData.audioData}`);
    console.log(
      `   Tamanho base64: ${mensagemData.audioData?.base64?.length || 0} chars`
    );
    console.log(`   URL n8n: ${N8N_WEBHOOK_URL}`);

    // ⬇️ ENVIA O PAYLOAD COMPLETO (INCLUINDO audioData SE EXISTIR)
    const dadosParaEnvio = { ...mensagemData };

    console.log(
      `   📤 Enviando dados com ${
        dadosParaEnvio.audioData ? "ÁUDIO BASE64" : "sem áudio"
      }`
    );

    const response = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "WhatsApp-Bot/1.0",
      },
      body: JSON.stringify(dadosParaEnvio),
    });

    console.log(`   📡 Resposta do n8n - Status: ${response.status}`);

    if (response.ok) {
      console.log("   ✅ Mensagem enviada para n8n cloud com SUCESSO!");

      // Log resumido do que foi enviado
      if (dadosParaEnvio.audioData) {
        console.log(
          `   🎯 Áudio enviado: ${dadosParaEnvio.audioData.fileSize} bytes, ${dadosParaEnvio.audioData.duration}s`
        );
      }
    } else {
      console.log("   ❌ ERRO n8n - Status:", response.status);

      // ⬇️ Tenta ler o erro
      try {
        const errorBody = await response.text();
        console.log(`   🔍 Corpo do erro: ${errorBody.substring(0, 200)}`);
      } catch (e) {
        console.log(`   🔍 Sem corpo de erro disponível`);
      }
    }
  } catch (error) {
    console.log("   💥 ERRO FATAL ao conectar com n8n:", error.message);
  }

  console.log(`📨 [ENVIAR_PARA_N8N] Concluído\n`);
}

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
    const { phone, message, audioBase64, mimeType = "audio/mp3" } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: "Phone é obrigatório",
      });
    }

    console.log(`📝 Recebida requisição do n8n para: ${phone}`);
    console.log(`📦 Tipo: ${audioBase64 ? "ÁUDIO" : "TEXTO"}`);
    console.log(`📊 Tamanho base64: ${audioBase64?.length || 0} chars`);

    const formattedPhone = phone.replace(/\D/g, "") + "@c.us";
    let result;
    let audioTentado = false;
    let audioSucesso = false;

    if (audioBase64 && audioBase64.length > 100) {
      // ⬇️ ESTRATÉGIA MULTI-CAMADA PARA ÁUDIO
      console.log(`🎤 INICIANDO ESTRATÉGIA DE ÁUDIO...`);
      audioTentado = true;

      // ⬇️ ESTRATÉGIA 1: Áudio como voz (padrão)
      try {
        console.log(`🔄 Tentativa 1: Áudio como voz...`);
        let cleanBase64 = audioBase64.replace(/^data:audio\/\w+;base64,/, "");

        const media = new MessageMedia(mimeType, cleanBase64);
        result = await whatsappClient.sendMessage(formattedPhone, media, {
          sendAudioAsVoice: true,
        });
        audioSucesso = true;
        console.log("✅ Áudio enviado como voz!");
      } catch (error1) {
        console.log(`❌ Estratégia 1 falhou:`, error1.message);

        // ⬇️ ESTRATÉGIA 2: Áudio como documento (sem sendAudioAsVoice)
        try {
          console.log(`🔄 Tentativa 2: Áudio como documento...`);
          let cleanBase64 = audioBase64.replace(/^data:audio\/\w+;base64,/, "");

          const media = new MessageMedia(mimeType, cleanBase64);
          result = await whatsappClient.sendMessage(formattedPhone, media);
          audioSucesso = true;
          console.log("✅ Áudio enviado como documento!");
        } catch (error2) {
          console.log(`❌ Estratégia 2 falhou:`, error2.message);

          // ⬇️ ESTRATÉGIA 3: Tentar com mimeType diferente
          try {
            console.log(`🔄 Tentativa 3: Tentando com mimeType 'audio/ogg'...`);
            let cleanBase64 = audioBase64.replace(
              /^data:audio\/\w+;base64,/,
              ""
            );

            const media = new MessageMedia("audio/ogg", cleanBase64);
            result = await whatsappClient.sendMessage(formattedPhone, media, {
              sendAudioAsVoice: true,
            });
            audioSucesso = true;
            console.log("✅ Áudio enviado com mimeType OGG!");
          } catch (error3) {
            console.log(`❌ Estratégia 3 falhou:`, error3.message);

            // ⬇️ ESTRATÉGIA 4: Tentar sem nenhuma opção especial
            try {
              console.log(`🔄 Tentativa 4: Envio simples sem opções...`);
              let cleanBase64 = audioBase64.replace(
                /^data:audio\/\w+;base64,/,
                ""
              );

              const media = new MessageMedia(mimeType, cleanBase64);
              result = await whatsappClient.sendMessage(formattedPhone, media);
              audioSucesso = true;
              console.log("✅ Áudio enviado (simples)!");
            } catch (error4) {
              console.log(`❌ Estratégia 4 falhou:`, error4.message);
              console.log(`💥 TODAS as estratégias de áudio falharam`);
            }
          }
        }
      }
    }

    // ⬇️ SE ÁUDIO FALHOU OU É TEXTO, ENVIAR MENSAGEM
    if (!audioTentado || !audioSucesso) {
      let mensagemFinal = message;

      if (audioTentado && !audioSucesso) {
        // ⬇️ MENSAGEM INTELIGENTE - Explica o fallback
        mensagemFinal = `🔊 ${
          message || "Sua mensagem de áudio foi recebida!"
        }\n\n💡 *Observação:* Tivemos uma instabilidade momentânea no envio de áudio. Estou respondendo em texto para não atrasar seu atendimento.`;
        console.log(`📝 Usando fallback de texto para áudio falho`);
      }

      if (mensagemFinal) {
        result = await whatsappClient.sendMessage(
          formattedPhone,
          mensagemFinal
        );
        console.log("✅ Mensagem de texto enviada!");
      }
    }

    res.json({
      success: true,
      messageId: result?.id?._serialized || "unknown",
      status: audioSucesso ? "audio_enviado" : "texto_enviado",
      audioTentado: audioTentado,
      audioSucesso: audioSucesso,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Erro CRÍTICO em /send-message:", error.message);
    res.status(500).json({
      success: false,
      error: "Falha crítica ao enviar mensagem",
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
    const testPhone = phone || TEST_PHONE;

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
