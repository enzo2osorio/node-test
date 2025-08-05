// Import Express.js
const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const supabase = require('./supabase');      
const vision = require('@google-cloud/vision');
const OpenAI = require('openai');
const fuzz = require('fuzzball');

require('dotenv').config();

// Validar variables de entorno críticas
const requiredEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENAI_API_KEY',
  'VERIFY_TOKEN',
  'META_ACCESS_TOKEN',
  'META_PHONE_ID'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Error: Variable de entorno ${envVar} no está configurada`);
    process.exit(1);
  }
}

// Configurar Google Cloud Vision
let gcvClient;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  // En producción: usar JSON desde variable de entorno
  const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  gcvClient = new vision.ImageAnnotatorClient({
    credentials: credentials,
    projectId: credentials.project_id
  });
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  // En desarrollo: usar archivo de credenciales
  gcvClient = new vision.ImageAnnotatorClient();
} else {
  console.warn('⚠️  Google Cloud Vision no configurado - OCR no funcionará');
  gcvClient = null;
}
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
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
  try {
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
            try {
              // Obtener media URL de Meta
              const mediaId = msgObj.image.id;
              const mediaRes = await fetch(
                `https://graph.facebook.com/v15.0/${mediaId}`,
                { headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` } }
              );
              const mediaJson = await mediaRes.json();
              
              if (!mediaJson.url) {
                throw new Error('No se pudo obtener la URL de la imagen');
              }
              
              // Descargar la imagen
              const urlRes = await fetch(mediaJson.url, {
                headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` }
              });
              const buffer = await urlRes.arrayBuffer();
              imageUrl = Buffer.from(buffer);
            } catch (error) {
              console.error('Error procesando imagen:', error);
              continue;
            }
          }

          // 3) Procesar OCR si es imagen
          let ocrText = caption || '';
          if (type === 'image' && imageUrl && gcvClient) {
            try {
              const [result] = await gcvClient.documentTextDetection(imageUrl);
              ocrText = result.fullTextAnnotation?.text || '';
            } catch (error) {
              console.error('Error en OCR:', error);
              ocrText = 'Error procesando imagen';
            }
          }

          // 4) Analizar con OpenAI (por ejemplo extraer campos)
          let parsed = '';
          try {
            const aiPrompt = `Extrae monto, fecha, proveedor de este texto: ${ocrText}`;
            const aiRes = await openai.completions.create({
              model: 'gpt-3.5-turbo-instruct', 
              prompt: aiPrompt, 
              max_tokens: 200
            });
            parsed = aiRes.choices[0].text.trim();
          } catch (error) {
            console.error('Error con OpenAI:', error);
            parsed = 'Error analizando texto';
          }

          // 5) Matching proveedor con fuzzball
          let match = { score: 0, item: null };
          try {
            const { data: proveedores, error } = await supabase.from('proveedores').select('id,nombre');
            if (error) throw error;
            
            if (proveedores && proveedores.length > 0) {
              for (const prov of proveedores) {
                const score = fuzz.ratio(parsed, prov.nombre);
                if (score > match.score) match = { score, item: prov };
              }
            }
          } catch (error) {
            console.error('Error consultando proveedores:', error);
          }

          // 6) Guardar en Supabase
          try {
            const { error } = await supabase.from('comprobantes').insert({
              id: uuidv4(),
              from,            
              raw_text: ocrText,
              parsed_text: parsed,
              proveedor_id: match.item?.id || null,
              score: match.score,
              timestamp: new Date()
            });
            if (error) throw error;
          } catch (error) {
            console.error('Error guardando en Supabase:', error);
          }

          // 7) Enviar respuesta al cliente
          try {
            const replyText = match.item
              ? `Registrado: ${match.item.nombre} (${match.score}% coincidencia)`
              : `No encontré proveedor. Guardé el comprobante para revisión.`;
            
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
          } catch (error) {
            console.error('Error enviando respuesta:', error);
          }
        }
      }
      res.sendStatus(200);
    } else {
      res.sendStatus(404);
    }
  } catch (error) {
    console.error('Error en webhook:', error);
    res.sendStatus(500);
  }
});

// Start the server
app.listen(port, () => {  
  console.log(`\nListening on port ${port}\n`);
});