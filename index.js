// Import Express.js
const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const supabase = require('./supabase');      
const vision = require('@google-cloud/vision');
const { Configuration, OpenAIApi } = require('openai');
const fuzz = require('fuzzball');

require('dotenv').config();

const gcvClient = new vision.ImageAnnotatorClient();
const openai = new OpenAIApi(new Configuration({ apiKey: process.env.OPENAI_API_KEY }));
const app = express();
app.use(bodyParser.json());
app.use(express.json());

// Set port and verify_token
const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;

// Route for GET requests
app.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WEBHOOK VERIFIED');
    res.status(200).send(challenge);
  } else {
    res.status(403).end();
  }
});

// Route for POST requests
app.post('/webhook', async (req, res) => {
  const body = req.body;
  // Confirmar que es un mensaje de WhatsApp
  if (body.object === 'whatsapp_business_account') {
    for (const entry of body.entry) {
      for (const change of entry.changes) {
        const msgObj = change.value.messages && change.value.messages[0];
        console.log(`Received message: ${JSON.stringify(msgObj)}`);
        if (!msgObj) continue;

        // Extraer datos
        const from = msgObj.from;            // número del cliente
        const msgId = msgObj.id;
        const type = msgObj.type;            // 'image' o 'text'
        let caption = msgObj.text?.body || msgObj.image?.caption;
        let imageUrl;
        if (type === 'image') {
          // Obtener media URL de Meta
          const mediaId = msgObj.image.id;
          const mediaRes = await fetch(
            `https://graph.facebook.com/v15.0/${mediaId}`,
            { headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` } }
          );
          const mediaJson = await mediaRes.json();
          // Descargar la imagen
          const urlRes = await fetch(mediaJson.url, {
            headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` }
          });
          const buffer = await urlRes.buffer();
          imageUrl = buffer;
        }

        // 3) Procesar OCR si es imagen
        let ocrText = caption;
        if (type === 'image' && imageUrl) {
          const [result] = await gcvClient.documentTextDetection(imageUrl);
          ocrText = result.fullTextAnnotation.text;
        }

        // 4) Analizar con OpenAI (por ejemplo extraer campos)
        const aiPrompt = `Extrae monto, fecha, proveedor de este texto: ${ocrText}`;
        const aiRes = await openai.createCompletion({
          model: 'text-davinci-003', prompt: aiPrompt, max_tokens: 200
        });
        const parsed = aiRes.data.choices[0].text.trim();

        // 5) Matching proveedor con fuzzball
        // Supongamos que tienes lista de proveedores
        const proveedores = await supabase.from('proveedores').select('id,nombre');
        let match = { score: 0, item: null };
        for (const prov of proveedores.data) {
          const score = fuzz.ratio(parsed, prov.nombre);
          if (score > match.score) match = { score, item: prov };
        }

        // 6) Guardar en Supabase
        await supabase.from('comprobantes').insert({
          id: uuidv4(),
          from,            
          raw_text: ocrText,
          parsed_text: parsed,
          proveedor_id: match.item?.id || null,
          score: match.score,
          timestamp: new Date()
        });

        // 7) Enviar respuesta al cliente
        const replyText = match.item
          ? `Registrado: ${match.item.nombre} (${match.score}% coincidencia)`
          : `No encontré proveedor. Guardeé el comprobante para revisión.`;
        await fetch(
          `https://graph.facebook.com/v15.0/${process.env.META_PHONE_ID}/messages`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              to: from,
              text: { body: replyText }
            })
          }
        );

      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

// Start the server
app.listen(port, () => {  
  console.log(`\nListening on port ${port}\n`);
});