// Script para encontrar el Phone ID usando debug de token
const { default: fetch } = require('node-fetch');
require('dotenv').config();

async function debugToken() {
  console.log('🔍 Analizando token de acceso...\n');
  
  try {
    // Debug del token para ver qué permisos tiene
    const debugResponse = await fetch(
      `https://graph.facebook.com/debug_token?input_token=${process.env.META_ACCESS_TOKEN}&access_token=${process.env.META_ACCESS_TOKEN}`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.META_ACCESS_TOKEN}`
        }
      }
    );
    
    const debugData = await debugResponse.json();
    console.log('🔑 Token debug:', JSON.stringify(debugData, null, 2));
    
    // Intentar obtener WhatsApp Business Account directamente
    const wabaResponse = await fetch(
      `https://graph.facebook.com/v18.0/24346578258305958/whatsapp_business_accounts`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.META_ACCESS_TOKEN}`
        }
      }
    );
    
    const wabaData = await wabaResponse.json();
    console.log('📱 WhatsApp Business Accounts:', JSON.stringify(wabaData, null, 2));
    
    if (wabaData.data && wabaData.data.length > 0) {
      const wabaId = wabaData.data[0].id;
      console.log('🎯 WABA ID encontrado:', wabaId);
      
      // Ahora obtener los números de teléfono
      const phonesResponse = await fetch(
        `https://graph.facebook.com/v18.0/${wabaId}/phone_numbers`,
        {
          headers: {
            'Authorization': `Bearer ${process.env.META_ACCESS_TOKEN}`
          }
        }
      );
      
      const phonesData = await phonesResponse.json();
      console.log('📞 Phone numbers:', JSON.stringify(phonesData, null, 2));
      
      if (phonesData.data && phonesData.data.length > 0) {
        const phoneId = phonesData.data[0].id;
        console.log('\n✅ PHONE ID CORRECTO:', phoneId);
        console.log('🔧 Actualiza tu .env con:');
        console.log(`META_PHONE_ID=${phoneId}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

debugToken();
