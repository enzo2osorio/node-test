// Script para verificar configuración de WhatsApp Meta
const { default: fetch } = require('node-fetch');
require('dotenv').config();

async function verifyMetaConfig() {
  console.log('🔍 Verificando configuración de Meta WhatsApp...\n');
  
  console.log('📋 Variables de entorno:');
  console.log('- META_ACCESS_TOKEN:', process.env.META_ACCESS_TOKEN ? '✅ Configurada' : '❌ No configurada');
  console.log('- META_PHONE_ID:', process.env.META_PHONE_ID ? '✅ Configurada' : '❌ No configurada');
  console.log('- VERIFY_TOKEN:', process.env.VERIFY_TOKEN ? '✅ Configurada' : '❌ No configurada');
  
  if (!process.env.META_ACCESS_TOKEN || !process.env.META_PHONE_ID) {
    console.log('❌ Faltan variables de entorno críticas');
    return;
  }
  
  try {
    // Verificar el número de teléfono
    console.log('\n📞 Verificando número de teléfono...');
    const phoneResponse = await fetch(
      `https://graph.facebook.com/v15.0/${process.env.META_PHONE_ID}`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.META_ACCESS_TOKEN}`
        }
      }
    );
    
    const phoneData = await phoneResponse.json();
    console.log('📱 Datos del teléfono:', JSON.stringify(phoneData, null, 2));
    
    // Verificar webhook subscriptions
    console.log('\n🔗 Verificando subscripciones...');
    const subsResponse = await fetch(
      `https://graph.facebook.com/v15.0/${process.env.META_PHONE_ID}/subscribed_apps`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.META_ACCESS_TOKEN}`
        }
      }
    );
    
    const subsData = await subsResponse.json();
    console.log('📡 Subscripciones:', JSON.stringify(subsData, null, 2));
    
  } catch (error) {
    console.error('❌ Error verificando configuración:', error.message);
  }
}

verifyMetaConfig();
