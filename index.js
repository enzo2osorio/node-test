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

console.log('🚀 Iniciando aplicación...');
console.log('📍 Variables de entorno detectadas:');
console.log('- PORT:', process.env.PORT || '3000 (default)');
console.log('- SUPABASE_URL:', process.env.SUPABASE_URL ? '✅ Configurada' : '❌ No configurada');
console.log('- OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✅ Configurada' : '❌ No configurada');
console.log('- META_ACCESS_TOKEN:', process.env.META_ACCESS_TOKEN ? '✅ Configurada' : '❌ No configurada');
console.log('- GOOGLE_APPLICATION_CREDENTIALS:', process.env.GOOGLE_APPLICATION_CREDENTIALS ? '✅ Configurada' : '❌ No configurada');
console.log('- GOOGLE_APPLICATION_CREDENTIALS_JSON:', process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ? '✅ Configurada' : '❌ No configurada');

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
  } else {
    console.log(`✅ ${envVar}: Configurada correctamente`);
  }
}

// Configurar Google Cloud Vision
console.log('🔧 Configurando Google Cloud Vision...');
let gcvClient;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  console.log('📄 Usando credenciales JSON desde variable de entorno');
  try {
    const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    gcvClient = new vision.ImageAnnotatorClient({
      credentials: credentials,
      projectId: credentials.project_id
    });
    console.log('✅ Google Cloud Vision configurado exitosamente (JSON)');
  } catch (error) {
    console.error('❌ Error parseando credenciales JSON:', error.message);
    gcvClient = null;
  }
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.log('📁 Usando archivo de credenciales local');
  try {
    gcvClient = new vision.ImageAnnotatorClient();
    console.log('✅ Google Cloud Vision configurado exitosamente (archivo)');
  } catch (error) {
    console.error('❌ Error configurando desde archivo:', error.message);
    gcvClient = null;
  }
} else {
  console.warn('⚠️  Google Cloud Vision no configurado - OCR no funcionará');
  gcvClient = null;
}
console.log('🤖 Configurando OpenAI...');
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
console.log('✅ OpenAI configurado exitosamente');

console.log('🌐 Configurando Express...');
const app = express();
app.use(bodyParser.json());
app.use(express.json());
console.log('✅ Express configurado exitosamente');

// Set port and verify_token
const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;

// Route for GET requests
app.get('/', (req, res) => {
  console.log('📥 GET request recibido en /');
  console.log('Query params:', req.query);
  
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;
  
  console.log('🔍 Verificando webhook...');
  console.log('- Mode:', mode);
  console.log('- Challenge:', challenge);
  console.log('- Token recibido:', token);
  console.log('- Token esperado:', verifyToken);

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('✅ WEBHOOK VERIFIED - Enviando challenge');
    res.status(200).send(challenge);
  } else {
    console.log('❌ WEBHOOK VERIFICATION FAILED');
    console.log(`Mode: ${mode}, Token match: ${token === verifyToken}`);
    res.status(403).end();
  }
});

// Route for POST requests
app.post('/webhook', async (req, res) => {
  console.log('📨 POST request recibido en /webhook');
  console.log('Headers:', req.headers);
  console.log('Body size:', JSON.stringify(req.body).length, 'bytes');
  
  try {
    const body = req.body;
    console.log('📋 Body completo:', JSON.stringify(body, null, 2));
    
    // Confirmar que es un mensaje de WhatsApp
    if (body.object === 'whatsapp_business_account') {
      console.log('✅ Mensaje de WhatsApp Business confirmado');
      console.log('📊 Procesando', body.entry?.length || 0, 'entries');
      
      for (const entry of body.entry) {
        console.log('🔄 Procesando entry:', entry.id);
        console.log('Changes count:', entry.changes?.length || 0);
        
        for (const change of entry.changes) {
          console.log('📝 Procesando change:', change.field);
          console.log('Change value:', JSON.stringify(change.value, null, 2));
          
          const msgObj = change.value.messages && change.value.messages[0];
          console.log('💬 Mensaje encontrado:', !!msgObj);
          
          if (msgObj) {
            console.log(`📨 Mensaje completo: ${JSON.stringify(msgObj, null, 2)}`);
          }
          
          if (!msgObj) {
            console.log('⏭️  Saltando - no hay mensaje');
            continue;
          }

          console.log('🔍 Extrayendo datos del mensaje...');
          // Extraer datos
          const from = msgObj.from;
          const msgId = msgObj.id;
          const type = msgObj.type;
          let caption = msgObj.text?.body || msgObj.image?.caption;
          
          console.log('📋 Datos extraídos:');
          console.log('- From:', from);
          console.log('- Message ID:', msgId);
          console.log('- Type:', type);
          console.log('- Caption/Text:', caption);
          
          let imageUrl;
          
          if (type === 'image') {
            console.log('🖼️  Procesando imagen...');
            try {
              // Obtener media URL de Meta
              const mediaId = msgObj.image.id;
              console.log('📷 Media ID:', mediaId);
              
              console.log('🔗 Obteniendo URL de imagen desde Meta...');
              const mediaRes = await fetch(
                `https://graph.facebook.com/v15.0/${mediaId}`,
                { headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` } }
              );
              
              console.log('📡 Response status:', mediaRes.status);
              const mediaJson = await mediaRes.json();
              console.log('📄 Media response:', JSON.stringify(mediaJson, null, 2));
              
              if (!mediaJson.url) {
                throw new Error('No se pudo obtener la URL de la imagen');
              }
              
              console.log('⬇️  Descargando imagen desde:', mediaJson.url);
              // Descargar la imagen
              const urlRes = await fetch(mediaJson.url, {
                headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` }
              });
              
              console.log('📡 Download status:', urlRes.status);
              console.log('📐 Content-Type:', urlRes.headers.get('content-type'));
              console.log('📏 Content-Length:', urlRes.headers.get('content-length'));
              
              const buffer = await urlRes.arrayBuffer();
              imageUrl = Buffer.from(buffer);
              console.log('✅ Imagen descargada exitosamente, tamaño:', imageUrl.length, 'bytes');
            } catch (error) {
              console.error('❌ Error procesando imagen:', error.message);
              console.error('Stack trace:', error.stack);
              continue;
            }
          }

          console.log('🔍 Iniciando procesamiento OCR...');
          // 3) Procesar OCR si es imagen
          let ocrText = caption || '';
          console.log('📝 Texto inicial (caption):', ocrText);
          
          if (type === 'image' && imageUrl && gcvClient) {
            console.log('🤖 Ejecutando OCR con Google Cloud Vision...');
            try {
              const [result] = await gcvClient.documentTextDetection(imageUrl);
              console.log('📄 OCR result object keys:', Object.keys(result));
              console.log('📋 Full text annotation:', !!result.fullTextAnnotation);
              
              ocrText = result.fullTextAnnotation?.text || '';
              console.log('✅ OCR completado exitosamente');
              console.log('📝 Texto extraído (', ocrText.length, 'caracteres):', ocrText.substring(0, 200) + (ocrText.length > 200 ? '...' : ''));
            } catch (error) {
              console.error('❌ Error en OCR:', error.message);
              console.error('Stack trace:', error.stack);
              ocrText = 'Error procesando imagen';
            }
          } else {
            console.log('⏭️  Saltando OCR:');
            console.log('- Es imagen:', type === 'image');
            console.log('- Tiene imageUrl:', !!imageUrl);
            console.log('- GCV Client disponible:', !!gcvClient);
          }

          console.log('🤖 Iniciando análisis con OpenAI...');
          // 4) Analizar con OpenAI (por ejemplo extraer campos)
          let parsed = '';
          try {
            const aiPrompt = `Extrae monto, fecha, proveedor de este texto: ${ocrText}`;
            console.log('💭 Prompt enviado a OpenAI:', aiPrompt.substring(0, 150) + '...');
            
            const aiRes = await openai.completions.create({
              model: 'gpt-3.5-turbo-instruct', 
              prompt: aiPrompt, 
              max_tokens: 200
            });
            
            console.log('📥 Respuesta de OpenAI recibida');
            console.log('🔢 Choices count:', aiRes.choices?.length || 0);
            
            parsed = aiRes.choices[0].text.trim();
            console.log('✅ Análisis de OpenAI completado');
            console.log('📝 Texto parseado:', parsed);
          } catch (error) {
            console.error('❌ Error con OpenAI:', error.message);
            console.error('Stack trace:', error.stack);
            parsed = 'Error analizando texto';
          }

          console.log('🔍 Iniciando matching de proveedores...');
          // 5) Matching proveedor con fuzzball
          let match = { score: 0, item: null };
          try {
            console.log('📊 Consultando proveedores en Supabase...');
            const { data: proveedores, error } = await supabase.from('proveedores').select('id,nombre');
            
            if (error) {
              console.error('❌ Error en consulta Supabase:', error);
              throw error;
            }
            
            console.log('📋 Proveedores encontrados:', proveedores?.length || 0);
            if (proveedores) {
              console.log('👥 Lista de proveedores:', proveedores.map(p => p.nombre));
            }
            
            if (proveedores && proveedores.length > 0) {
              console.log('🔎 Ejecutando fuzzy matching...');
              for (const prov of proveedores) {
                const score = fuzz.ratio(parsed, prov.nombre);
                console.log(`📊 Score para "${prov.nombre}": ${score}%`);
                if (score > match.score) {
                  match = { score, item: prov };
                  console.log(`🎯 Nuevo mejor match: ${prov.nombre} (${score}%)`);
                }
              }
            } else {
              console.log('📭 No hay proveedores en la base de datos');
            }
            
            console.log('🏆 Match final:', match.item ? `${match.item.nombre} (${match.score}%)` : 'Sin match');
          } catch (error) {
            console.error('❌ Error consultando proveedores:', error.message);
            console.error('Stack trace:', error.stack);
          }

          console.log('💾 Guardando en Supabase...');
          // 6) Guardar en Supabase
          try {
            const recordData = {
              id: uuidv4(),
              from,            
              raw_text: ocrText,
              parsed_text: parsed,
              proveedor_id: match.item?.id || null,
              score: match.score,
              timestamp: new Date()
            };
            
            console.log('📝 Datos a guardar:', JSON.stringify(recordData, null, 2));
            
            const { error } = await supabase.from('comprobantes').insert(recordData);
            
            if (error) {
              console.error('❌ Error específico de Supabase:', error);
              throw error;
            }
            
            console.log('✅ Registro guardado exitosamente en Supabase');
          } catch (error) {
            console.error('❌ Error guardando en Supabase:', error.message);
            console.error('Stack trace:', error.stack);
          }

          console.log('📱 Enviando respuesta a WhatsApp...');
          // 7) Enviar respuesta al cliente
          try {
            const replyText = match.item
              ? `Registrado: ${match.item.nombre} (${match.score}% coincidencia)`
              : `No encontré proveedor. Guardé el comprobante para revisión.`;
            
            console.log('💬 Mensaje a enviar:', replyText);
            console.log('📞 Enviando a:', from);
            console.log('📱 Phone ID:', process.env.META_PHONE_ID);
            
            const messagePayload = {
              messaging_product: 'whatsapp',
              to: from,
              text: { body: replyText }
            };
            
            console.log('📦 Payload completo:', JSON.stringify(messagePayload, null, 2));
            
            const response = await fetch(
              `https://graph.facebook.com/v15.0/${process.env.META_PHONE_ID}/messages`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`
                },
                body: JSON.stringify(messagePayload)
              }
            );
            
            console.log('📡 Response status:', response.status);
            const responseText = await response.text();
            console.log('📄 Response body:', responseText);
            
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${responseText}`);
            }
            
            console.log('✅ Respuesta enviada exitosamente');
          } catch (error) {
            console.error('❌ Error enviando respuesta:', error.message);
            console.error('Stack trace:', error.stack);
          }
          
          console.log('🔄 Finalizando procesamiento del mensaje');
        }
        console.log('✅ Entry procesado completamente');
      }
      console.log('✅ Todos los entries procesados');
      res.sendStatus(200);
    } else {
      console.log('❌ No es un mensaje de WhatsApp Business');
      console.log('Object type recibido:', body.object);
      res.sendStatus(404);
    }
  } catch (error) {
    console.error('💥 Error general en webhook:', error.message);
    console.error('Stack trace completo:', error.stack);
    res.sendStatus(500);
  }
});

// Start the server
app.listen(port, () => {  
  console.log(`\n🚀 Servidor iniciado exitosamente!`);
  console.log(`📍 Puerto: ${port}`);
  console.log(`🌐 URL local: http://localhost:${port}`);
  console.log(`📋 Endpoints disponibles:`);
  console.log(`   GET  / - Verificación de webhook`);
  console.log(`   POST /webhook - Recepción de mensajes`);
  console.log(`🔧 Configuración:`);
  console.log(`   - Supabase: ${process.env.SUPABASE_URL ? '✅' : '❌'}`);
  console.log(`   - OpenAI: ${process.env.OPENAI_API_KEY ? '✅' : '❌'}`);
  console.log(`   - Google Vision: ${gcvClient ? '✅' : '❌'}`);
  console.log(`   - Meta WhatsApp: ${process.env.META_ACCESS_TOKEN ? '✅' : '❌'}`);
  console.log(`\n🎉 ¡Listo para recibir mensajes de WhatsApp!\n`);
});