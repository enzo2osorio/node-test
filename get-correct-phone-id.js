// Script para obtener Phone ID usando el WABA ID correcto
const { default: fetch } = require('node-fetch');
require('dotenv').config();

async function getCorrectPhoneId() {
  console.log('🔍 Obteniendo Phone ID usando WABA ID: 755516033596735\n');
  
  try {
    // Usar el WABA ID que encontramos en el token debug
    const wabaId = '755516033596735';
    
    console.log('📞 Obteniendo números de teléfono...');
    const phonesResponse = await fetch(
      `https://graph.facebook.com/v18.0/${wabaId}/phone_numbers`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.META_ACCESS_TOKEN}`
        }
      }
    );
    
    const phonesData = await phonesResponse.json();
    console.log('📱 Phone numbers response:', JSON.stringify(phonesData, null, 2));
    
    if (phonesData.data && phonesData.data.length > 0) {
      const phoneNumber = phonesData.data[0];
      console.log('\n✅ PHONE ID CORRECTO:', phoneNumber.id);
      console.log('📞 Número:', phoneNumber.display_phone_number);
      console.log('🔧 Actualiza tu .env con:');
      console.log(`META_PHONE_ID=${phoneNumber.id}`);
      
      // También verificar webhook
      console.log('\n🔗 Verificando webhook...');
      const webhookResponse = await fetch(
        `https://graph.facebook.com/v18.0/${wabaId}/subscribed_apps`,
        {
          headers: {
            'Authorization': `Bearer ${process.env.META_ACCESS_TOKEN}`
          }
        }
      );
      
      const webhookData = await webhookResponse.json();
      console.log('🌐 Webhook subscriptions:', JSON.stringify(webhookData, null, 2));
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

getCorrectPhoneId();
