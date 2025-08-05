// 🚀 BOT DE COMPROBANTES MIGRADO A META WHATSAPP API
// Migración completa desde Baileys

const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const supabase = require('./supabase');      
const vision = require('@google-cloud/vision');
const OpenAI = require('openai');
const fuzz = require('fuzzball');

require('dotenv').config();

// ============================================================================
// 📊 SISTEMA DE ESTADOS PERSISTENTE (migrado desde Baileys)
// ============================================================================

// Estados del flujo conversacional
const STATES = {
  IDLE: "idle",
  AWAITING_DESTINATARIO_CONFIRMATION: "awaiting_destinatario_confirmation",
  AWAITING_DESTINATARIO_SECOND_TRY: "awaiting_destinatario_second_try",
  AWAITING_DESTINATARIO_CHOOSING_IN_LIST_OR_ADDING_NEW: "awaiting_destinatario_choosing_in_list_or_adding_new", 
  AWAITING_NEW_DESTINATARIO_NAME: "awaiting_new_destinatario_name",
  AWAITING_CATEGORY_SELECTION: "awaiting_category_selection",
  AWAITING_SUBCATEGORY_SELECTION: "awaiting_subcategory_selection",
  AWAITING_MEDIO_PAGO_CONFIRMATION: "awaiting_medio_pago_confirmation",
  AWAITING_MEDIO_PAGO_SELECTION: "awaiting_medio_pago_selection",
  AWAITING_NEW_METODO_PAGO_NAME: "awaiting_new_metodo_pago_name",
  AWAITING_SAVE_CONFIRMATION: "awaiting_save_confirmation",
  AWAITING_MODIFICATION_SELECTION: "awaiting_modification_selection",
  AWAITING_DESTINATARIO_MODIFICATION: "awaiting_destinatario_modification",
  AWAITING_MONTO_MODIFICATION: "awaiting_monto_modification",
  AWAITING_FECHA_MODIFICATION: "awaiting_fecha_modification",
  AWAITING_TIPO_MOVIMIENTO_MODIFICATION: "awaiting_tipo_movimiento_modification",
  AWAITING_MEDIO_PAGO_MODIFICATION: "awaiting_medio_pago_modification"
};

// Almacén de estados en memoria (en producción podrías usar Redis)
const stateMap = new Map();
const TIMEOUT_DURATION = 3 * 60 * 1000; // 3 minutos

// ============================================================================
// 🔧 CONFIGURACIÓN INICIAL
// ============================================================================

console.log('🚀 Iniciando Bot de Comprobantes (Meta WhatsApp API)...');

// Validar variables de entorno
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

// Configurar servicios
let gcvClient;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  gcvClient = new vision.ImageAnnotatorClient({
    credentials: credentials,
    projectId: credentials.project_id
  });
  console.log('✅ Google Cloud Vision configurado');
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  gcvClient = new vision.ImageAnnotatorClient();
  console.log('✅ Google Cloud Vision configurado (archivo local)');
} else {
  console.warn('⚠️ Google Cloud Vision no configurado');
  gcvClient = null;
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
console.log('✅ OpenAI configurado');

// ============================================================================
// 🔄 FUNCIONES DE MANEJO DE ESTADO (migradas desde Baileys)
// ============================================================================

const setUserState = (phoneNumber, state, data = {}) => {
  // Limpiar timeout anterior si existe
  const currentState = stateMap.get(phoneNumber);
  if (currentState?.timeout) {
    clearTimeout(currentState.timeout);
  }

  // Crear nuevo timeout
  const timeout = setTimeout(() => {
    clearUserState(phoneNumber);
    sendMessage(phoneNumber, "⏰ El flujo se ha cancelado por inactividad (3 minutos). Envía un nuevo comprobante para comenzar nuevamente.");
  }, TIMEOUT_DURATION);

  stateMap.set(phoneNumber, {
    state,
    data,
    timestamp: Date.now(),
    timeout
  });

  console.log(`🔄 Estado de ${phoneNumber} cambiado a: ${state}`);
};

const getUserState = (phoneNumber) => {
  return stateMap.get(phoneNumber) || { state: STATES.IDLE, data: {}, timestamp: null, timeout: null };
};

const clearUserState = (phoneNumber) => {
  const currentState = stateMap.get(phoneNumber);
  if (currentState?.timeout) {
    clearTimeout(currentState.timeout);
  }
  stateMap.delete(phoneNumber);
  console.log(`🧹 Estado de ${phoneNumber} limpiado`);
};

// ============================================================================
// 💬 FUNCIONES DE MENSAJERÍA (adaptadas para Meta API)
// ============================================================================

const sendMessage = async (to, text, replyToMessageId = null) => {
  try {
    const messagePayload = {
      messaging_product: 'whatsapp',
      to: to,
      text: { body: text }
    };

    if (replyToMessageId) {
      messagePayload.context = {
        message_id: replyToMessageId
      };
    }

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

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    console.log(`✅ Mensaje enviado a ${to}`);
    return true;
  } catch (error) {
    console.error('❌ Error enviando mensaje:', error.message);
    return false;
  }
};

// ============================================================================
// 🧠 FUNCIONES DE PROCESAMIENTO INTELIGENTE (migradas desde Baileys)
// ============================================================================

// Función para buscar coincidencias de destinatarios usando fuzzball
const matchDestinatario = async (input, umbralClave = 0.65, umbralVariante = 0.9) => {
  if (!input || typeof input !== "string") {
    return { clave: null, scoreClave: 0, scoreVariante: 0, metodo: null };
  }

  const normalizado = input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

  try {
    // Obtener destinatarios desde Supabase
    const { data: destRows, error: destErr } = await supabase
      .from("destinatarios")
      .select("id, name");
    
    if (destErr) throw destErr;

    if (!destRows || destRows.length === 0) {
      return { clave: null, scoreClave: 0, scoreVariante: 0, metodo: null };
    }

    // Crear lista para fuzzy matching
    const textos = destRows.map(dest => dest.name);
    
    // Búsqueda fuzzy
    const resultados = fuzz.extract(normalizado, textos, {
      scorer: fuzz.ratio,
      returnObjects: true,
    });

    // Filtrar por umbral
    const candidatos = resultados
      .filter((r) => r.score / 100 >= umbralClave)
      .map((r) => ({
        ...r,
        score: r.score / 100,
      }))
      .sort((a, b) => b.score - a.score);

    if (candidatos.length === 0) {
      return { clave: null, scoreClave: 0, scoreVariante: 0, metodo: null };
    }

    const mejor = candidatos[0];
    return {
      clave: mejor.choice,
      scoreClave: mejor.score,
      scoreVariante: mejor.score,
      metodo: "clave",
    };

  } catch (error) {
    console.error('❌ Error en matchDestinatario:', error);
    return { clave: null, scoreClave: 0, scoreVariante: 0, metodo: null };
  }
};

// Función para obtener métodos de pago
const getMetodosPago = async () => {
  try {
    const { data, error } = await supabase
      .from('metodos_pago')
      .select('id, nombre')
      .order('nombre');
    
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('❌ Error obteniendo métodos de pago:', error);
    return [];
  }
};

// Función para procesar mensaje inicial con OpenAI (migrada desde Baileys)
const processInitialMessage = async (phoneNumber, captureMessage, messageId) => {
  try {
    console.log('🧠 Procesando mensaje con OpenAI...');

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `
Eres un asistente que interpreta comprobantes de pago, documentos financieros y mensajes breves para extraer información contable en formato estructurado.

### 🎯 Tu objetivo:
Analizar el texto recibido y construir un objeto JSON con los siguientes campos:

{
  "nombre": string | null,          // Nombre de la persona o entidad involucrada
  "monto": number | null,           // Monto en pesos argentinos, sin símbolos
  "fecha": string | null,           // Formato: "dd/mm/yyyy"
  "hora": string | null,            // Formato: "hh:mm" (24 horas)
  "tipo_movimiento": string | null, // Solo "ingreso" o "egreso"
  "medio_pago": string | null,      // Ej: "Mercado Pago", "Transferencia", "Efectivo"
  "referencia": string | null,      // Código de referencia si existe
  "numero_operacion": string | null,// Número de operación o comprobante
  "observacion": string | null      // Notas o contexto adicional
}

### 🎯 REGLAS CRÍTICAS PARA DETERMINAR EL DESTINATARIO CONTABLE:

El campo **"nombre"** debe contener el **destinatario contable**, que se determina según estas reglas:

#### Para INGRESOS (dinero que recibimos):
- **Si Erica Romina Davila o Nicolas Olave RECIBEN dinero** → Es un INGRESO
- **Destinatario contable** = La persona/entidad que nos envía el dinero

#### Para EGRESOS (dinero que enviamos):
- **Si Erica Romina Davila o Nicolas Olave ENVÍAN dinero** → Es un EGRESO
- **Destinatario contable** = La persona/entidad que recibe el dinero

### 📋 Criterios para identificar tipo de movimiento:
1. **Si el RECEPTOR es "Erica Romina Davila" o "Nicolas Olave"** → INGRESO
2. **Si el EMISOR es "Erica Romina Davila" o "Nicolas Olave"** → EGRESO
3. **Palabras clave para EGRESOS**: "pago", "pagaste a", "transferencia enviada"
4. **Palabras clave para INGRESOS**: "recibiste", "te enviaron", "devolucion", "reembolso"

Responde únicamente con el JSON, sin texto adicional.
`
        },
        {
          role: "user",
          content: captureMessage
        }
      ]
    });

    const jsonString = response.choices[0].message.content.trim();
    console.log("🤖 Respuesta OpenAI:", jsonString);

    let data;
    try {
      data = JSON.parse(jsonString);
    } catch (err) {
      console.error("❌ Error parseando JSON de OpenAI:", err);
      throw new Error("No se pudo interpretar la respuesta de OpenAI");
    }

    const destinatarioName = data.nombre || "Desconocido";
    console.log('🔍 Buscando destinatario:', destinatarioName);

    // Buscar coincidencia de destinatario
    const destinatarioMatch = await matchDestinatario(destinatarioName);
        
    if (destinatarioMatch.clave) {
      console.log("✅ Destinatario encontrado:", destinatarioMatch);
      
      // Guardar estado y datos
      setUserState(phoneNumber, STATES.AWAITING_DESTINATARIO_CONFIRMATION, {
        structuredData: data,
        destinatarioMatch,
        originalData: data
      });

      // Enviar pregunta de confirmación
      await sendMessage(
        phoneNumber, 
        `✅ El destinatario es *${destinatarioMatch.clave}*\n\n¿Es correcto?\n\n1. Sí\n2. No\n3. Cancelar\n\nEscribe el número de tu opción:`,
        messageId
      );

    } else {
      console.log("❌ No se encontró destinatario, solicitando aclaración...");
      
      // Guardar estado para solicitar destinatario
      setUserState(phoneNumber, STATES.AWAITING_DESTINATARIO_SECOND_TRY, {
        structuredData: data,
        originalData: data
      });

      await sendMessage(
        phoneNumber,
        `❓ No pude identificar el destinatario claramente.\n\n¿Podrías especificar el nombre del destinatario?\n\nEscribe el nombre o "cancelar" para terminar.`,
        messageId
      );
    }

  } catch (error) {
    console.error("❌ Error procesando mensaje inicial:", error.message);
    await sendMessage(phoneNumber, "❌ Ocurrió un error interpretando el mensaje. Intenta nuevamente.", messageId);
  }
};

module.exports = {
  STATES,
  setUserState,
  getUserState,
  clearUserState,
  sendMessage,
  matchDestinatario,
  getMetodosPago,
  processInitialMessage
};
