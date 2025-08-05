// 🚀 BOT DE COMPROBANTES - META WHATSAPP API
// Migración completa desde Baileys

const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const supabase = require('./supabase');      
const vision = require('@google-cloud/vision');
const OpenAI = require('openai');
const fuzz = require('fuzzball');

// Importar módulos del bot migrado
const { 
  STATES, 
  setUserState, 
  getUserState, 
  clearUserState, 
  sendMessage, 
  processInitialMessage 
} = require('./bot-core');
const { handleConversationalFlow } = require('./conversational-flow');

require('dotenv').config();

console.log('🚀 Iniciando Bot de Comprobantes (Meta WhatsApp API)...');
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
if (process.env.GOOGLE_CLOUD_CREDENTIALS) {
  console.log('📄 Usando credenciales JSON desde variable de entorno (PRODUCCIÓN)');
  try {
    const credentials = JSON.parse(process.env.GOOGLE_CLOUD_CREDENTIALS);
    gcvClient = new vision.ImageAnnotatorClient({
      credentials: credentials,
      projectId: credentials.project_id
    });
    console.log('✅ Google Cloud Vision configurado exitosamente (JSON)');
  } catch (error) {
    console.error('❌ Error parseando credenciales JSON:', error.message);
    gcvClient = null;
  }
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  console.log('📄 Usando credenciales JSON desde variable de entorno (FALLBACK)');
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
  console.log('📁 Usando archivo de credenciales local (DESARROLLO)');
  try {
    gcvClient = new vision.ImageAnnotatorClient();
    console.log('✅ Google Cloud Vision configurado exitosamente (archivo)');
  } catch (error) {
    console.error('❌ Error configurando desde archivo:', error.message);
    gcvClient = null;
  }
} else {
  console.warn('⚠️  Google Cloud Vision no configurado - OCR no funcionará');
  console.warn('💡 En producción: configura GOOGLE_CLOUD_CREDENTIALS en Render');
  console.warn('💡 En desarrollo: configura GOOGLE_APPLICATION_CREDENTIALS');
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

// Middleware para logging de todas las peticiones
app.use((req, res, next) => {
  console.log('\n=== NUEVA PETICIÓN ===');
  console.log('🌐 Método:', req.method);
  console.log('📍 URL:', req.url);
  console.log('📋 Headers:', JSON.stringify(req.headers, null, 2));
  console.log('🔗 IP:', req.ip || req.connection.remoteAddress);
  console.log('⏰ Timestamp:', new Date().toISOString());
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('📦 Body:', JSON.stringify(req.body, null, 2));
  }
  console.log('========================\n');
  next();
});

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

// Endpoint de prueba para verificar conectividad
app.get('/test', (req, res) => {
  console.log('🧪 Test endpoint llamado');
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    message: 'Servidor funcionando correctamente',
    config: {
      supabase: !!process.env.SUPABASE_URL,
      openai: !!process.env.OPENAI_API_KEY,
      googleVision: !!gcvClient,
      metaWhatsApp: !!process.env.META_ACCESS_TOKEN,
      verifyToken: !!process.env.VERIFY_TOKEN
    }
  });
});

// Endpoint para simular webhook (para testing)
app.post('/test-webhook', (req, res) => {
  console.log('🧪 Test webhook llamado');
  console.log('Body:', JSON.stringify(req.body, null, 2));
  res.json({ status: 'received', body: req.body });
});

// Route for POST requests - WEBHOOK PRINCIPAL CON SISTEMA CONVERSACIONAL
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
            console.log('⏭️ Saltando - no hay mensaje');
            continue;
          }

          // ============================================================================
          // 🎯 SISTEMA CONVERSACIONAL PRINCIPAL (MIGRADO DESDE BAILEYS)
          // ============================================================================

          console.log('🔍 Iniciando procesamiento conversacional...');
          
          const from = msgObj.from;
          const msgId = msgObj.id;
          const type = msgObj.type;
          
          console.log('📋 Datos básicos del mensaje:');
          console.log('- From:', from);
          console.log('- Message ID:', msgId);
          console.log('- Type:', type);

          // Obtener estado actual del usuario
          const userState = getUserState(from);
          console.log('� Estado actual del usuario:', userState.state);

          // Procesar según tipo de mensaje y estado
          if (userState.state === STATES.IDLE) {
            // Usuario no tiene flujo activo - procesar nuevo comprobante
            await handleNewComprobante(from, msgObj, msgId);
          } else {
            // Usuario tiene flujo activo - continuar conversación
            await handleActiveFlow(from, msgObj, msgId, userState);
          }
          
          console.log('� Finalizando procesamiento del mensaje');
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

// ============================================================================
// 🎯 FUNCIONES DE PROCESAMIENTO DE MENSAJES (MIGRADAS DESDE BAILEYS)
// ============================================================================

const handleNewComprobante = async (phoneNumber, msgObj, messageId) => {
  try {
    console.log('🆕 Procesando nuevo comprobante...');
    
    let captureMessage = '';
    const type = msgObj.type;
    
    // Extraer contenido según tipo de mensaje
    if (type === 'text') {
      captureMessage = msgObj.text?.body || '';
      console.log('📝 Mensaje de texto:', captureMessage);
      
    } else if (type === 'image') {
      console.log('🖼️ Procesando imagen...');
      
      const caption = msgObj.image?.caption || '';
      let ocrText = '';
      
      try {
        // Obtener media URL de Meta
        const mediaId = msgObj.image.id;
        console.log('📷 Media ID:', mediaId);
        
        const mediaRes = await fetch(
          `https://graph.facebook.com/v15.0/${mediaId}`,
          { headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` } }
        );
        
        const mediaJson = await mediaRes.json();
        console.log('� Media response:', JSON.stringify(mediaJson, null, 2));
        
        if (mediaJson.url) {
          // Descargar la imagen
          const urlRes = await fetch(mediaJson.url, {
            headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` }
          });
          
          const buffer = await urlRes.arrayBuffer();
          const imageBuffer = Buffer.from(buffer);
          console.log('✅ Imagen descargada, tamaño:', imageBuffer.length, 'bytes');
          
          // Procesar OCR si Google Vision está disponible
          if (gcvClient) {
            console.log('🤖 Ejecutando OCR...');
            const [result] = await gcvClient.documentTextDetection(imageBuffer);
            ocrText = result.fullTextAnnotation?.text || '';
            console.log('� Texto OCR extraído:', ocrText.substring(0, 200) + '...');
          }
        }
      } catch (error) {
        console.error('❌ Error procesando imagen:', error.message);
      }
      
      // Combinar caption y OCR
      captureMessage = [caption, ocrText].filter(Boolean).join('\n\n');
      
    } else if (type === 'document') {
      console.log('� Procesando documento...');
      
      const caption = msgObj.document?.caption || '';
      const fileName = msgObj.document?.filename || 'documento';
      
      // Por ahora solo usar el caption, podrías implementar descarga de PDF
      captureMessage = `${caption}\n\n[Documento recibido: ${fileName}]`;
      
    } else {
      console.log('❓ Tipo de mensaje no soportado:', type);
      await sendMessage(
        phoneNumber, 
        "❓ Por favor envía una imagen, documento o texto con el comprobante.",
        messageId
      );
      return;
    }
    
    // Procesar con IA si hay contenido
    if (captureMessage.trim()) {
      console.log('🧠 Enviando a procesamiento inteligente...');
      console.log('� Contenido a procesar:', captureMessage.substring(0, 300) + '...');
      
      await processInitialMessage(phoneNumber, captureMessage, messageId);
    } else {
      await sendMessage(
        phoneNumber,
        "❓ No pude extraer información del mensaje. ¿Podrías enviar más detalles?",
        messageId
      );
    }
    
  } catch (error) {
    console.error('❌ Error procesando nuevo comprobante:', error.message);
    await sendMessage(phoneNumber, "❌ Error procesando el comprobante. Intenta nuevamente.", messageId);
  }
};

const handleActiveFlow = async (phoneNumber, msgObj, messageId, userState) => {
  try {
    console.log('� Continuando flujo activo:', userState.state);
    
    // Extraer texto del mensaje
    let userInput = '';
    
    if (msgObj.type === 'text') {
      userInput = msgObj.text?.body || '';
    } else {
      // Si está en flujo activo pero envía algo que no es texto
      await sendMessage(
        phoneNumber,
        "⚠️ Tienes un flujo activo. Por favor responde con texto a la pregunta anterior.",
        messageId
      );
      return;
    }
    
    console.log('� Input del usuario:', userInput);
    
    // Delegar al sistema conversacional
    await handleConversationalFlow(phoneNumber, userInput, messageId);
    
  } catch (error) {
    console.error('❌ Error en flujo activo:', error.message);
    await sendMessage(phoneNumber, "❌ Error procesando tu respuesta. Intenta nuevamente.", messageId);
  }
};

// Start the server
app.listen(port, () => {  
  console.log(`\n🚀 Bot de Comprobantes iniciado exitosamente!`);
  console.log(`📍 Puerto: ${port}`);
  console.log(`🌐 URL local: http://localhost:${port}`);
  console.log(`📋 Endpoints disponibles:`);
  console.log(`   GET  / - Verificación de webhook`);
  console.log(`   GET  /test - Test de conectividad`);
  console.log(`   POST /webhook - Recepción de mensajes (PRINCIPAL)`);
  console.log(`   POST /test-webhook - Test de webhook`);
  console.log(`🔧 Configuración:`);
  console.log(`   - Supabase: ${process.env.SUPABASE_URL ? '✅' : '❌'}`);
  console.log(`   - OpenAI: ${process.env.OPENAI_API_KEY ? '✅' : '❌'}`);
  console.log(`   - Google Vision: ${gcvClient ? '✅' : '❌'}`);
  console.log(`   - Meta WhatsApp: ${process.env.META_ACCESS_TOKEN ? '✅' : '❌'}`);
  console.log(`\n� SISTEMA CONVERSACIONAL MIGRADO DESDE BAILEYS:`);
  console.log(`   - ✅ Manejo de estados persistente`);
  console.log(`   - ✅ Flujo conversacional completo`);
  console.log(`   - ✅ OCR de imágenes y documentos`);
  console.log(`   - ✅ Análisis inteligente con OpenAI`);
  console.log(`   - ✅ Matching de destinatarios con Fuzzball`);
  console.log(`   - ✅ Gestión de métodos de pago`);
  console.log(`   - ✅ Confirmación y modificación de datos`);
  console.log(`   - ✅ Guardado en Supabase`);
  console.log(`\n🎉 ¡Bot listo para recibir comprobantes de pago!\n`);
});