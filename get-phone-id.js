// Script para obtener el Phone ID correcto
const { default: fetch } = require('node-fetch');
require('dotenv').config();

async function getPhoneId() {
  console.log('🔍 Obteniendo Phone ID correcto...\n');
  
  try {
    // Obtener información de la app para encontrar el WhatsApp Business Account ID
    console.log('📱 Consultando WhatsApp Business Accounts...');
    
    // Primero necesitamos el WABA ID - vamos a probar diferentes endpoints
    const wabaResponse = await fetch(
      `https://graph.facebook.com/v18.0/me/accounts`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.META_ACCESS_TOKEN}`
        }
      }
    );
    
    const wabaData = await wabaResponse.json();
    console.log('🏢 Accounts data:', JSON.stringify(wabaData, null, 2));
    
    // También intentemos obtener los business accounts directamente
    const businessResponse = await fetch(
      `https://graph.facebook.com/v18.0/me?fields=name,id`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.META_ACCESS_TOKEN}`
        }
      }
    );
    
    const businessData = await businessResponse.json();
    console.log('👤 Business data:', JSON.stringify(businessData, null, 2));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

getPhoneId();
