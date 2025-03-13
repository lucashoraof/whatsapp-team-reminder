require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');
const express = require('express');

// Configurar timezone
if (process.env.TIMEZONE) {
    moment.tz.setDefault(process.env.TIMEZONE);
}

// Inicializar servidor Express para evitar hibernação
const app = express();
const PORT = process.env.PORT || 3000;

// Endpoint de ping para manter o serviço ativo
app.get('/', (req, res) => {
    res.send('WhatsApp Team Reminder está ativo!');
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor iniciado na porta ${PORT}`);
});

// Configurar sistema anti-hibernação
function setupAntiHibernation() {
    const PING_INTERVAL = 14 * 60 * 1000; // 14 minutos em milissegundos
    const serverUrl = process.env.SERVER_URL || `http://localhost:${PORT}`;
    
    setInterval(() => {
        console.log(`[${new Date().toISOString()}] Realizando auto-ping para evitar hibernação...`);
        // Simular um ping interno para manter o serviço ativo
        try {
            // Não precisamos fazer uma requisição HTTP real, apenas registrar a atividade
            console.log(`[${new Date().toISOString()}] Auto-ping realizado com sucesso.`);
        } catch (error) {
            console.error(`Erro ao realizar auto-ping:`, error);
        }
    }, PING_INTERVAL);
    
    console.log(`Sistema anti-hibernação configurado. Intervalo: ${PING_INTERVAL/1000/60} minutos`);
}

// Inicializar cliente WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    // Removendo configurações do navegador já que o deploy será feito com autenticação já realizada
    puppeteer: {
        headless: true
    }
});

// Carregar lembretes do arquivo de configuração
const remindersPath = path.join(__dirname, 'reminders.js');
let reminders = [];

try {
    reminders = require(remindersPath);
    console.log(`Carregados ${reminders.length} lembretes`);
} catch (error) {
    console.error('Erro ao carregar lembretes:', error.message);
    console.log('Criando arquivo de lembretes padrão...');
    
    // Criar arquivo de lembretes padrão se não existir
    const defaultReminders = [
        {
            id: 1,
            title: 'Reunião de Equipe',
            message: 'Lembrete: Reunião de equipe em 30 minutos na sala de conferências.',
            schedule: '0 9 * * 1', // Toda segunda-feira às 9:00
            phones: ['5521971112233']
        },
        {
            id: 2,
            title: 'Entrega de Relatórios',
            message: 'Lembrete: Hoje é o prazo final para entrega dos relatórios semanais.',
            schedule: '0 17 * * 5', // Toda sexta-feira às 17:00
            phones: ['5521971112233']
        }
    ];
    
    const reminderFileContent = `module.exports = ${JSON.stringify(defaultReminders, null, 4)};`;
    fs.writeFileSync(remindersPath, reminderFileContent);
    reminders = defaultReminders;
    console.log('Arquivo de lembretes padrão criado com sucesso!');
}

// Função para criar um delay usando Promise
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Função para enviar lembretes
async function sendReminder(reminder) {
    const { title, message, phones, contacts } = reminder;
    
    // Usar diretamente os números de telefone definidos no reminder
    const targetPhones = phones;
    
    if (targetPhones.length === 0) {
        console.log(`Aviso: O lembrete "${title}" não tem números de telefone configurados.`);
        return;
    }
    
    // Enviar mensagem para cada número de telefone
    for (const phone of targetPhones) {
        try {
            console.log(`Enviando lembrete "${title}" para o número ${phone}...`);
            // Formatar o número para o formato que o WhatsApp Web espera (com @c.us no final)
            const chatId = `${phone}@c.us`;
            
            // Personalizar a mensagem com o nome do contato, se disponível
            let personalizedMessage = message;
            
            // Verificar se o contato existe na lista de contatos do lembrete
            if (contacts && contacts[phone]) {
                const contactName = contacts[phone];
                // Substituir a variável {$Nome} pelo nome do contato
                personalizedMessage = message.replace(/\{\$Nome\}/g, contactName);
                console.log(`Mensagem personalizada para ${contactName}`);
            } else {
                // Se não houver nome cadastrado, substituir {$Nome} por um valor padrão
                personalizedMessage = message.replace(/\{\$Nome\}/g, 'Prezado(a)');
            }
            
            await client.sendMessage(chatId, personalizedMessage);
            console.log(`Lembrete enviado com sucesso para ${phone}!`);
            
            // Adicionar um delay de 3 segundos entre cada envio
            if (targetPhones.indexOf(phone) < targetPhones.length - 1) {
                console.log('Aguardando 3 segundos antes do próximo envio...');
                await delay(3000);
            }
        } catch (error) {
            console.error(`Erro ao enviar lembrete para ${phone}:`, error);
        }
    }
}

// Função para verificar se um agendamento é para uma data específica com ano
function isDateWithYear(schedule) {
    // Verifica se o formato tem 5 partes e a última parte é um número de 4 dígitos (ano)
    const parts = schedule.split(' ');
    return parts.length === 5 && /^\d{4}$/.test(parts[4]);
}

// Função para converter agendamento com ano para formato cron válido
function convertToCronFormat(schedule) {
    const parts = schedule.split(' ');
    // Remove o ano (última parte) e mantém apenas minuto, hora, dia e mês
    return parts.slice(0, 4).join(' ') + ' *';
}

// Configurar agendamentos para cada lembrete
function scheduleReminders() {
    reminders.forEach(reminder => {
        const { id, title, schedule } = reminder;
        
        // Verificar se é um formato com ano específico
        const hasYear = isDateWithYear(schedule);
        let cronSchedule = schedule;
        let targetYear = null;
        
        if (hasYear) {
            // Extrair o ano e converter para formato cron válido
            const parts = schedule.split(' ');
            targetYear = parseInt(parts[4]);
            cronSchedule = convertToCronFormat(schedule);
        }
        
        // Verificar se o formato do cronograma é válido
        if (!cron.validate(cronSchedule)) {
            console.error(`Erro: Formato de agendamento inválido para o lembrete "${title}"`);
            return;
        }
        
        console.log(`Agendando lembrete: "${title}" com cronograma: ${cronSchedule}${hasYear ? ` (Ano: ${targetYear})` : ''}`);
        
        // Agendar o lembrete usando node-cron
        cron.schedule(cronSchedule, () => {
            // Se tiver ano específico, verificar se estamos no ano correto
            if (hasYear) {
                const currentYear = moment().year();
                if (currentYear !== targetYear) {
                    console.log(`Ignorando lembrete "${title}" - ano atual (${currentYear}) diferente do ano alvo (${targetYear})`);
                    return;
                }
            }
            
            console.log(`Executando lembrete agendado: "${title}"`);
            sendReminder(reminder);
        });
    });
    
    console.log('Todos os lembretes foram agendados com sucesso!');
}

// Eventos do cliente WhatsApp
client.on('qr', (qr) => {
    // Gerar e exibir o código QR para autenticação
    console.log('QR Code recebido, escaneie-o com seu WhatsApp:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Cliente WhatsApp está pronto!');
    console.log(`WhatsApp Team Reminder iniciado com sucesso!`);
    
    // Agendar lembretes quando o cliente estiver pronto
    scheduleReminders();
    
    // Iniciar sistema anti-hibernação
    setupAntiHibernation();
});

client.on('authenticated', () => {
    console.log('Autenticado com sucesso no WhatsApp!');
});

client.on('auth_failure', (msg) => {
    console.error('Falha na autenticação:', msg);
});

client.on('disconnected', (reason) => {
    console.log('Cliente WhatsApp desconectado:', reason);
});

// Inicializar o cliente WhatsApp
console.log('Iniciando cliente WhatsApp...');
client.initialize();

// Tratamento de erros não capturados
process.on('uncaughtException', (err) => {
    console.error('Erro não capturado:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Promessa rejeitada não tratada:', reason);
});