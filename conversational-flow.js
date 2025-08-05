// 🔄 SISTEMA DE FLUJOS CONVERSACIONALES MIGRADO DESDE BAILEYS
const { 
  STATES, 
  setUserState, 
  getUserState, 
  clearUserState, 
  sendMessage, 
  matchDestinatario,
  getMetodosPago 
} = require('./bot-core');
const supabase = require('./supabase');
const { v4: uuidv4 } = require('uuid');

// ============================================================================
// 🎯 MANEJADORES DE FLUJO POR ESTADO
// ============================================================================

const handleDestinatarioConfirmation = async (phoneNumber, userInput, messageId) => {
  const userState = getUserState(phoneNumber);
  const { structuredData, destinatarioMatch } = userState.data;

  switch (userInput.trim()) {
    case '1': // Sí, confirmar destinatario
      console.log('✅ Usuario confirmó destinatario');
      
      // Continuar con verificación de método de pago
      await handleMetodoPagoFlow(phoneNumber, structuredData, messageId);
      break;
      
    case '2': // No, cambiar destinatario
      console.log('❌ Usuario rechazó destinatario');
      
      setUserState(phoneNumber, STATES.AWAITING_DESTINATARIO_SECOND_TRY, {
        structuredData,
        originalData: structuredData
      });
      
      await sendMessage(
        phoneNumber,
        "❓ ¿Cuál es el nombre correcto del destinatario?\n\nEscribe el nombre o 'cancelar' para terminar.",
        messageId
      );
      break;
      
    case '3': // Cancelar
      console.log('🚫 Usuario canceló el flujo');
      clearUserState(phoneNumber);
      await sendMessage(phoneNumber, "🚫 Flujo cancelado.", messageId);
      break;
      
    default:
      await sendMessage(
        phoneNumber,
        "❓ Por favor responde con:\n1. Sí\n2. No\n3. Cancelar",
        messageId
      );
  }
};

const handleDestinatarioSecondTry = async (phoneNumber, userInput, messageId) => {
  if (userInput.toLowerCase().trim() === 'cancelar') {
    clearUserState(phoneNumber);
    await sendMessage(phoneNumber, "🚫 Flujo cancelado.", messageId);
    return;
  }

  const userState = getUserState(phoneNumber);
  const { structuredData } = userState.data;

  // Buscar nuevamente con el input del usuario
  const destinatarioMatch = await matchDestinatario(userInput);

  if (destinatarioMatch.clave) {
    console.log('✅ Destinatario encontrado en segundo intento');
    
    setUserState(phoneNumber, STATES.AWAITING_DESTINATARIO_CONFIRMATION, {
      structuredData,
      destinatarioMatch,
      originalData: structuredData
    });

    await sendMessage(
      phoneNumber,
      `✅ ¿Te refieres a *${destinatarioMatch.clave}*?\n\n1. Sí\n2. No\n3. Cancelar\n\nEscribe el número:`,
      messageId
    );
  } else {
    // No se encontró, ofrecer crear nuevo o elegir de lista
    await showDestinatarioOptions(phoneNumber, userInput, structuredData, messageId);
  }
};

const showDestinatarioOptions = async (phoneNumber, searchTerm, structuredData, messageId) => {
  try {
    // Obtener lista de destinatarios existentes
    const { data: destinatarios, error } = await supabase
      .from('destinatarios')
      .select('id, name')
      .order('name')
      .limit(10);

    if (error) throw error;

    let messageText = `❓ No encontré "${searchTerm}" exactamente.\n\n`;
    messageText += `¿Qué quieres hacer?\n\n`;
    messageText += `1. Crear nuevo destinatario: "${searchTerm}"\n`;
    messageText += `2. Elegir de la lista:\n`;

    if (destinatarios && destinatarios.length > 0) {
      destinatarios.forEach((dest, index) => {
        messageText += `   ${index + 3}. ${dest.name}\n`;
      });
    }

    messageText += `\n${destinatarios.length + 3}. Cancelar`;

    setUserState(phoneNumber, STATES.AWAITING_DESTINATARIO_CHOOSING_IN_LIST_OR_ADDING_NEW, {
      structuredData,
      searchTerm,
      destinatarios,
      originalData: structuredData
    });

    await sendMessage(phoneNumber, messageText, messageId);

  } catch (error) {
    console.error('❌ Error mostrando opciones de destinatario:', error);
    await sendMessage(phoneNumber, "❌ Error obteniendo destinatarios. Intenta nuevamente.", messageId);
  }
};

const handleDestinatarioSelection = async (phoneNumber, userInput, messageId) => {
  const userState = getUserState(phoneNumber);
  const { structuredData, searchTerm, destinatarios } = userState.data;
  const option = parseInt(userInput.trim());

  if (option === 1) {
    // Crear nuevo destinatario
    setUserState(phoneNumber, STATES.AWAITING_NEW_DESTINATARIO_NAME, {
      structuredData,
      newDestinatarioName: searchTerm,
      originalData: structuredData
    });

    await sendMessage(
      phoneNumber,
      `✏️ Confirma el nombre del nuevo destinatario:\n\n"${searchTerm}"\n\n1. Confirmar\n2. Escribir otro nombre\n3. Cancelar`,
      messageId
    );
  } else if (option >= 3 && option < destinatarios.length + 3) {
    // Seleccionar de la lista
    const selectedDestinatario = destinatarios[option - 3];
    
    const destinatarioMatch = {
      clave: selectedDestinatario.name,
      scoreClave: 1.0,
      scoreVariante: 1.0,
      metodo: "seleccion_manual"
    };

    setUserState(phoneNumber, STATES.AWAITING_DESTINATARIO_CONFIRMATION, {
      structuredData,
      destinatarioMatch,
      originalData: structuredData
    });

    await sendMessage(
      phoneNumber,
      `✅ Seleccionaste: *${selectedDestinatario.name}*\n\n¿Es correcto?\n\n1. Sí\n2. No\n3. Cancelar`,
      messageId
    );
  } else if (option === destinatarios.length + 3) {
    // Cancelar
    clearUserState(phoneNumber);
    await sendMessage(phoneNumber, "🚫 Flujo cancelado.", messageId);
  } else {
    await sendMessage(
      phoneNumber,
      "❓ Opción no válida. Por favor elige un número de la lista.",
      messageId
    );
  }
};

const handleNewDestinatarioName = async (phoneNumber, userInput, messageId) => {
  const userState = getUserState(phoneNumber);
  const { structuredData, newDestinatarioName } = userState.data;
  const option = userInput.trim();

  if (option === '1') {
    // Confirmar nombre actual
    await saveNewDestinatario(phoneNumber, newDestinatarioName, structuredData, messageId);
  } else if (option === '2') {
    // Solicitar nuevo nombre
    setUserState(phoneNumber, STATES.AWAITING_NEW_DESTINATARIO_NAME, {
      structuredData,
      isWritingNewName: true,
      originalData: structuredData
    });

    await sendMessage(
      phoneNumber,
      "✏️ Escribe el nombre del destinatario:",
      messageId
    );
  } else if (option === '3') {
    // Cancelar
    clearUserState(phoneNumber);
    await sendMessage(phoneNumber, "🚫 Flujo cancelado.", messageId);
  } else if (userState.data.isWritingNewName) {
    // Usuario está escribiendo nuevo nombre
    await saveNewDestinatario(phoneNumber, option, structuredData, messageId);
  } else {
    await sendMessage(
      phoneNumber,
      "❓ Por favor responde:\n1. Confirmar\n2. Escribir otro nombre\n3. Cancelar",
      messageId
    );
  }
};

const saveNewDestinatario = async (phoneNumber, destinatarioName, structuredData, messageId) => {
  try {
    console.log('💾 Guardando nuevo destinatario:', destinatarioName);

    // Guardar en Supabase
    const { data, error } = await supabase
      .from('destinatarios')
      .insert([{ name: destinatarioName }])
      .select()
      .single();

    if (error) throw error;

    // Crear match object para continuar el flujo
    const destinatarioMatch = {
      clave: destinatarioName,
      scoreClave: 1.0,
      scoreVariante: 1.0,
      metodo: "nuevo_destinatario"
    };

    // Continuar con método de pago
    await handleMetodoPagoFlow(phoneNumber, structuredData, messageId, destinatarioMatch);

  } catch (error) {
    console.error('❌ Error guardando destinatario:', error);
    await sendMessage(phoneNumber, "❌ Error guardando el destinatario. Intenta nuevamente.", messageId);
  }
};

const handleMetodoPagoFlow = async (phoneNumber, structuredData, messageId, destinatarioMatchOverride = null) => {
  try {
    const userState = getUserState(phoneNumber);
    const destinatarioMatch = destinatarioMatchOverride || userState.data.destinatarioMatch;

    console.log('💳 Iniciando flujo de método de pago');

    // Obtener métodos de pago disponibles
    const metodosPago = await getMetodosPago();
    
    if (!metodosPago || metodosPago.length === 0) {
      await sendMessage(phoneNumber, "❌ No hay métodos de pago configurados.", messageId);
      return;
    }

    // Verificar si el método de pago ya fue detectado
    const medioPagoDetectado = structuredData.medio_pago;
    
    if (medioPagoDetectado) {
      // Buscar coincidencia en métodos existentes
      const metodoMatch = metodosPago.find(m => 
        m.nombre.toLowerCase().includes(medioPagoDetectado.toLowerCase()) ||
        medioPagoDetectado.toLowerCase().includes(m.nombre.toLowerCase())
      );

      if (metodoMatch) {
        setUserState(phoneNumber, STATES.AWAITING_MEDIO_PAGO_CONFIRMATION, {
          structuredData,
          destinatarioMatch,
          metodoMatch,
          originalData: structuredData
        });

        await sendMessage(
          phoneNumber,
          `💳 El método de pago es *${metodoMatch.nombre}*\n\n¿Es correcto?\n\n1. Sí\n2. No\n3. Cancelar`,
          messageId
        );
        return;
      }
    }

    // Mostrar lista de métodos de pago
    let messageText = "💳 Selecciona el método de pago:\n\n";
    metodosPago.forEach((metodo, index) => {
      messageText += `${index + 1}. ${metodo.nombre}\n`;
    });
    messageText += `\n${metodosPago.length + 1}. Otro (especificar)\n`;
    messageText += `${metodosPago.length + 2}. Cancelar`;

    setUserState(phoneNumber, STATES.AWAITING_MEDIO_PAGO_SELECTION, {
      structuredData,
      destinatarioMatch,
      metodosPago,
      originalData: structuredData
    });

    await sendMessage(phoneNumber, messageText, messageId);

  } catch (error) {
    console.error('❌ Error en flujo de método de pago:', error);
    await sendMessage(phoneNumber, "❌ Error procesando método de pago.", messageId);
  }
};

const handleMetodoPagoConfirmation = async (phoneNumber, userInput, messageId) => {
  const userState = getUserState(phoneNumber);
  const { structuredData, destinatarioMatch, metodoMatch } = userState.data;

  switch (userInput.trim()) {
    case '1': // Sí, confirmar método de pago
      console.log('✅ Usuario confirmó método de pago');
      await showFinalSummary(phoneNumber, structuredData, destinatarioMatch, metodoMatch, messageId);
      break;
      
    case '2': // No, cambiar método de pago
      console.log('❌ Usuario rechazó método de pago');
      await handleMetodoPagoFlow(phoneNumber, structuredData, messageId);
      break;
      
    case '3': // Cancelar
      clearUserState(phoneNumber);
      await sendMessage(phoneNumber, "🚫 Flujo cancelado.", messageId);
      break;
      
    default:
      await sendMessage(
        phoneNumber,
        "❓ Por favor responde con:\n1. Sí\n2. No\n3. Cancelar",
        messageId
      );
  }
};

const handleMetodoPagoSelection = async (phoneNumber, userInput, messageId) => {
  const userState = getUserState(phoneNumber);
  const { structuredData, destinatarioMatch, metodosPago } = userState.data;
  const option = parseInt(userInput.trim());

  if (option >= 1 && option <= metodosPago.length) {
    // Seleccionar método existente
    const selectedMetodo = metodosPago[option - 1];
    
    await showFinalSummary(phoneNumber, structuredData, destinatarioMatch, selectedMetodo, messageId);
  } else if (option === metodosPago.length + 1) {
    // Especificar otro método
    setUserState(phoneNumber, STATES.AWAITING_NEW_METODO_PAGO_NAME, {
      structuredData,
      destinatarioMatch,
      originalData: structuredData
    });

    await sendMessage(
      phoneNumber,
      "✏️ Escribe el nombre del método de pago:",
      messageId
    );
  } else if (option === metodosPago.length + 2) {
    // Cancelar
    clearUserState(phoneNumber);
    await sendMessage(phoneNumber, "🚫 Flujo cancelado.", messageId);
  } else {
    await sendMessage(
      phoneNumber,
      "❓ Opción no válida. Por favor elige un número de la lista.",
      messageId
    );
  }
};

const handleNewMetodoPagoName = async (phoneNumber, userInput, messageId) => {
  const userState = getUserState(phoneNumber);
  const { structuredData, destinatarioMatch } = userState.data;

  if (userInput.toLowerCase().trim() === 'cancelar') {
    clearUserState(phoneNumber);
    await sendMessage(phoneNumber, "🚫 Flujo cancelado.", messageId);
    return;
  }

  try {
    // Guardar nuevo método de pago
    const { data, error } = await supabase
      .from('metodos_pago')
      .insert([{ nombre: userInput.trim() }])
      .select()
      .single();

    if (error) throw error;

    console.log('💾 Nuevo método de pago guardado:', data.nombre);

    await showFinalSummary(phoneNumber, structuredData, destinatarioMatch, data, messageId);

  } catch (error) {
    console.error('❌ Error guardando método de pago:', error);
    await sendMessage(phoneNumber, "❌ Error guardando el método de pago. Intenta nuevamente.", messageId);
  }
};

const showFinalSummary = async (phoneNumber, structuredData, destinatarioMatch, metodoMatch, messageId) => {
  try {
    const summary = `📋 *RESUMEN DEL COMPROBANTE*\n\n` +
      `👤 Destinatario: ${destinatarioMatch.clave}\n` +
      `💰 Monto: $${structuredData.monto || 'No especificado'}\n` +
      `📅 Fecha: ${structuredData.fecha || 'No especificada'}\n` +
      `🕐 Hora: ${structuredData.hora || 'No especificada'}\n` +
      `📊 Tipo: ${structuredData.tipo_movimiento || 'No especificado'}\n` +
      `💳 Método: ${metodoMatch.nombre}\n` +
      `📝 Observación: ${structuredData.observacion || 'Ninguna'}\n\n` +
      `¿Qué quieres hacer?\n\n` +
      `1. Guardar así\n` +
      `2. Modificar datos\n` +
      `3. Cancelar`;

    setUserState(phoneNumber, STATES.AWAITING_SAVE_CONFIRMATION, {
      structuredData,
      destinatarioMatch,
      metodoMatch,
      originalData: structuredData
    });

    await sendMessage(phoneNumber, summary, messageId);

  } catch (error) {
    console.error('❌ Error mostrando resumen:', error);
    await sendMessage(phoneNumber, "❌ Error generando resumen.", messageId);
  }
};

const handleSaveConfirmation = async (phoneNumber, userInput, messageId) => {
  const userState = getUserState(phoneNumber);
  const { structuredData, destinatarioMatch, metodoMatch } = userState.data;

  switch (userInput.trim()) {
    case '1': // Guardar
      await saveComprobante(phoneNumber, structuredData, destinatarioMatch, metodoMatch, messageId);
      break;
      
    case '2': // Modificar
      await showModificationOptions(phoneNumber, structuredData, destinatarioMatch, metodoMatch, messageId);
      break;
      
    case '3': // Cancelar
      clearUserState(phoneNumber);
      await sendMessage(phoneNumber, "🚫 Flujo cancelado.", messageId);
      break;
      
    default:
      await sendMessage(
        phoneNumber,
        "❓ Por favor responde con:\n1. Guardar así\n2. Modificar datos\n3. Cancelar",
        messageId
      );
  }
};

const saveComprobante = async (phoneNumber, structuredData, destinatarioMatch, metodoMatch, messageId) => {
  try {
    console.log('💾 Guardando comprobante final...');

    // Obtener ID del destinatario
    const { data: destinatarioData, error: destError } = await supabase
      .from('destinatarios')
      .select('id')
      .eq('name', destinatarioMatch.clave)
      .single();

    if (destError) throw destError;

    // Preparar datos para guardar
    const comprobanteData = {
      id: uuidv4(),
      from: phoneNumber,
      destinatario_id: destinatarioData.id,
      monto: structuredData.monto,
      fecha: structuredData.fecha,
      hora: structuredData.hora,
      tipo_movimiento: structuredData.tipo_movimiento,
      metodo_pago_id: metodoMatch.id,
      referencia: structuredData.referencia,
      numero_operacion: structuredData.numero_operacion,
      observacion: structuredData.observacion,
      raw_text: JSON.stringify(structuredData),
      score: destinatarioMatch.scoreClave,
      timestamp: new Date()
    };

    // Guardar en Supabase
    const { error: saveError } = await supabase
      .from('comprobantes')
      .insert([comprobanteData]);

    if (saveError) throw saveError;

    // Limpiar estado
    clearUserState(phoneNumber);

    await sendMessage(
      phoneNumber,
      `✅ *COMPROBANTE GUARDADO EXITOSAMENTE*\n\n📋 ID: ${comprobanteData.id.substring(0, 8)}\n👤 Destinatario: ${destinatarioMatch.clave}\n💰 Monto: $${structuredData.monto}\n\n¡Gracias! Puedes enviar otro comprobante cuando quieras.`,
      messageId
    );

    console.log('✅ Comprobante guardado exitosamente:', comprobanteData.id);

  } catch (error) {
    console.error('❌ Error guardando comprobante:', error);
    await sendMessage(phoneNumber, "❌ Error guardando el comprobante. Intenta nuevamente.", messageId);
  }
};

const showModificationOptions = async (phoneNumber, structuredData, destinatarioMatch, metodoMatch, messageId) => {
  const modificationText = `✏️ ¿Qué quieres modificar?\n\n` +
    `1. Destinatario (${destinatarioMatch.clave})\n` +
    `2. Monto ($${structuredData.monto})\n` +
    `3. Fecha (${structuredData.fecha})\n` +
    `4. Tipo movimiento (${structuredData.tipo_movimiento})\n` +
    `5. Método pago (${metodoMatch.nombre})\n` +
    `6. Volver al resumen\n` +
    `7. Cancelar`;

  setUserState(phoneNumber, STATES.AWAITING_MODIFICATION_SELECTION, {
    structuredData,
    destinatarioMatch,
    metodoMatch,
    originalData: structuredData
  });

  await sendMessage(phoneNumber, modificationText, messageId);
};

// ============================================================================
// 🎯 FUNCIÓN PRINCIPAL DEL MANEJADOR DE FLUJO
// ============================================================================

const handleConversationalFlow = async (phoneNumber, userInput, messageId) => {
  const userState = getUserState(phoneNumber);
  
  console.log(`🔄 Manejando flujo para ${phoneNumber}, estado: ${userState.state}`);

  switch (userState.state) {
    case STATES.AWAITING_DESTINATARIO_CONFIRMATION:
      await handleDestinatarioConfirmation(phoneNumber, userInput, messageId);
      break;
      
    case STATES.AWAITING_DESTINATARIO_SECOND_TRY:
      await handleDestinatarioSecondTry(phoneNumber, userInput, messageId);
      break;
      
    case STATES.AWAITING_DESTINATARIO_CHOOSING_IN_LIST_OR_ADDING_NEW:
      await handleDestinatarioSelection(phoneNumber, userInput, messageId);
      break;
      
    case STATES.AWAITING_NEW_DESTINATARIO_NAME:
      await handleNewDestinatarioName(phoneNumber, userInput, messageId);
      break;
      
    case STATES.AWAITING_MEDIO_PAGO_CONFIRMATION:
      await handleMetodoPagoConfirmation(phoneNumber, userInput, messageId);
      break;
      
    case STATES.AWAITING_MEDIO_PAGO_SELECTION:
      await handleMetodoPagoSelection(phoneNumber, userInput, messageId);
      break;
      
    case STATES.AWAITING_NEW_METODO_PAGO_NAME:
      await handleNewMetodoPagoName(phoneNumber, userInput, messageId);
      break;
      
    case STATES.AWAITING_SAVE_CONFIRMATION:
      await handleSaveConfirmation(phoneNumber, userInput, messageId);
      break;
      
    case STATES.AWAITING_MODIFICATION_SELECTION:
      // TODO: Implementar modificaciones
      await sendMessage(phoneNumber, "🚧 Funcionalidad de modificación en desarrollo.", messageId);
      break;
      
    default:
      console.log(`⚠️ Estado no manejado: ${userState.state}`);
      await sendMessage(phoneNumber, "❓ Estado del flujo no reconocido. Intenta enviar un nuevo comprobante.", messageId);
  }
};

module.exports = {
  handleConversationalFlow,
  showFinalSummary,
  saveComprobante
};
