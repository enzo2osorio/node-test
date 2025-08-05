// Script para actualizar la configuración del webhook
const { default: fetch } = require('node-fetch');
require('dotenv').config();

async function updateWebhook() {
  console.log('🔧 Actualizando configuración del webhook...\n');
  
  const wabaId = '755516033596735';
  const webhookUrl = 'https://node-test-ng4n.onrender.com/webhook';
  const verifyToken = process.env.VERIFY_TOKEN;
  
  try {
    console.log('🌐 Webhook URL:', webhookUrl);
    console.log('🔑 Verify Token:', verifyToken);
    
    // Actualizar webhook configuration
    const updateResponse = await fetch(
      `https://graph.facebook.com/v18.0/${wabaId}/subscribed_apps`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.META_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          subscribed_fields: ['messages']
        })
      }
    );
    
    const updateData = await updateResponse.json();
    console.log('📡 Update response:', JSON.stringify(updateData, null, 2));
    
    // Verificar la configuración actualizada
    console.log('\n🔍 Verificando configuración...');
    const verifyResponse = await fetch(
      `https://graph.facebook.com/v18.0/${wabaId}/subscribed_apps`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.META_ACCESS_TOKEN}`
        }
      }
    );
    
    const verifyData = await verifyResponse.json();
    console.log('✅ Configuración actual:', JSON.stringify(verifyData, null, 2));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

updateWebhook();
