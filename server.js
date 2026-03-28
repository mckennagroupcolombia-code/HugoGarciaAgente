const express = require("express");
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const bodyParser = require("body-parser");
const fs = require("fs");

const app = express();
const port = 3000;

app.use(bodyParser.json());

let client; // Declarar client fuera de la función para que sea accesible globalmente

function initializeWhatsAppClient() {
  client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--single-process", // <- this one doesn't work on Windows
        "--disable-gpu",
      ],
    },
  });

  client.on("qr", (qr) => {
    qrcode.generate(qr, { small: true });
    console.log("Recibido QR, escanéalo con tu teléfono.");
  });

  client.on("ready", () => {
    console.log("Cliente de WhatsApp listo y conectado!");
  });

  client.on("authenticated", () => {
    console.log("Autenticado en WhatsApp!");
  });

  client.on("auth_failure", (msg) => {
    console.error("Fallo de autenticación en WhatsApp", msg);
  });

  client.on("disconnected", (reason) => {
    console.log("Cliente de WhatsApp desconectado", reason);
  });

  client.initialize();
}

// Ruta para enviar mensajes
app.post("/enviar", async (req, res) => {
  const { numero, mensaje } = req.body;

  if (!numero || !mensaje) {
    return res.status(400).send({ status: "error", error: "Número y mensaje son requeridos." });
  }

  if (!client) {
    console.error("Cliente de WhatsApp no inicializado.");
    return res.status(500).send({ status: "error", error: "Cliente de WhatsApp no inicializado." });
  }

  // Esperar hasta que el cliente esté listo, con un timeout
  const timeoutPromise = new Promise((resolve, reject) => {
    setTimeout(() => {
      reject(new Error("Timeout: Cliente de WhatsApp no listo a tiempo."));
    }, 30000); // 30 segundos de timeout
  });

  const readyPromise = new Promise(async (resolve) => {
    while (!client.isReady) {
      console.log("Esperando a que el cliente de WhatsApp esté listo...");
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    resolve();
  });

  try {
    await Promise.race([readyPromise, timeoutPromise]);
  } catch (err) {
    console.error(err.message);
    return res.status(500).send({ status: "error", error: err.message });
  }

  try {
    // El número debe incluir el código del país, ejemplo: 573101234567@c.us
    const chatId = numero.includes("@g.us") ? numero : `${numero}@c.us`;
    await client.sendMessage(chatId, mensaje);
    res.status(200).send({ status: "ok", message: "Mensaje enviado." });
  } catch (error) {
    console.error("Error enviando mensaje por WhatsApp:", error);
    res.status(500).send({ status: "error", error: error.message });
  }
});

// Ruta para enviar archivos (PDF, Imágenes, etc.)
app.post("/enviar-archivo", async (req, res) => {
  const { numero, mensaje, filePath, fileName } = req.body;

  if (!numero || !filePath) {
    return res.status(400).send({ status: "error", error: "Número y filePath son requeridos." });
  }

  if (!client || !client.isReady) {
    return res.status(500).send({ status: "error", error: "Cliente de WhatsApp no listo." });
  }

  try {
    const chatId = numero.includes("@g.us") ? numero : `${numero}@c.us`;
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).send({ status: "error", error: "Archivo no encontrado en el servidor." });
    }

    const media = MessageMedia.fromFilePath(filePath);
    if (fileName) {
      media.filename = fileName;
    }

    await client.sendMessage(chatId, media, { caption: mensaje || "" });
    res.status(200).send({ status: "ok", message: "Archivo enviado con éxito." });
  } catch (error) {
    console.error("Error enviando archivo por WhatsApp:", error);
    res.status(500).send({ status: "error", error: error.message });
  }
});

// Ruta para verificar el estado del servidor
app.get("/status", (req, res) => {
  if (client && client.isReady) {
    res.status(200).send({ status: "ok", message: "Cliente de WhatsApp listo y conectado." });
  } else if (client) {
    res.status(200).send({ status: "warning", message: "Cliente de WhatsApp inicializado pero no listo." });
  } else {
    res.status(500).send({ status: "error", message: "Cliente de WhatsApp no inicializado." });
  }
});

app.listen(port, () => {
  console.log(`Servidor escuchando en http://localhost:${port}`);
  initializeWhatsAppClient(); // Inicializar el cliente de WhatsApp cuando el servidor Express inicie
});
