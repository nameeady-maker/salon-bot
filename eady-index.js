const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const Airtable = require('airtable');

const app = express();
app.use(bodyParser.json());

// جلب البيانات من إعدادات Render (Environment Variables)
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID = process.env.BASE_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const SALON_OWNER_PHONE = process.env.SALON_OWNER_PHONE;

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(BASE_ID);

// التحقق من الـ Webhook
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode && token === 'salon123') {
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// استقبال الرسائل
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'whatsapp_business_account') {
        if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
            const message = body.entry[0].changes[0].value.messages[0];
            const from = message.from;
            if (message.type === 'text') {
                const text = message.text.body.toLowerCase();
                if (text.includes("مرحبا") || text.includes("حجز")) {
                    await sendServicesList(from);
                }
            }
            if (message.type === 'interactive') {
                const selectionId = message.interactive.button_reply.id;
                if (selectionId.startsWith('srv_')) {
                    await sendStaffList(from, selectionId.replace('srv_', ''));
                } else if (selectionId.startsWith('stf_')) {
                    await sendAvailableSlots(from, selectionId.replace('stf_', ''));
                } else if (selectionId.startsWith('slot_')) {
                    await confirmBooking(from, selectionId.replace('slot_', ''), message.interactive.button_reply.title);
                }
            }
        }
        res.sendStatus(200);
    } else {
        res.sendStatus(404);
    }
});

// وظائف الإرسال والمنطق (نفس الوظائف السابقة)
async function sendServicesList(to) {
    try {
        const records = await base('جدول الخدمات').select().firstPage();
        const buttons = records.slice(0, 3).map(record => ({
            type: "reply",
            reply: { id: `srv_${record.id}`, title: record.get('اسم الخدمة') }
        }));
        await sendWhatsAppInteractive(to, "أهلاً بكِ في صالوننا ✨ يرجى اختيار الخدمة:", buttons);
    } catch (e) { console.error(e); }
}

async function sendStaffList(to, serviceId) {
    try {
        const records = await base('جدول العاملات').select().firstPage();
        const buttons = records.filter(r => (r.get('جدول الخدمات') || []).includes(serviceId)).slice(0, 3).map(record => ({
            type: "reply",
            reply: { id: `stf_${record.id}`, title: record.get('اسم العاملة') }
        }));
        await sendWhatsAppInteractive(to, "ممتاز، من هي العاملة المفضلة لديكِ؟", buttons);
    } catch (e) { console.error(e); }
}

async function sendAvailableSlots(to, staffId) {
    try {
        const records = await base('جدول المواعيد').select({ filterByFormula: `AND({العاملة} = '${staffId}', {الحالة} = 'متاح')` }).firstPage();
        const buttons = records.slice(0, 3).map(record => ({ type: "reply", reply: { id: `slot_${record.id}`, title: record.get('الوقت') } }));
        if (buttons.length === 0) await sendWhatsAppText(to, "نعتذر، لا توجد مواعيد متاحة حالياً.");
        else await sendWhatsAppInteractive(to, "اختاري الوقت المناسب لكِ اليوم:", buttons);
    } catch (e) { console.error(e); }
}

async function confirmBooking(to, slotId, timeTitle) {
    try {
        await base('جدول المواعيد').update(slotId, { "الحالة": "محجوز", "رقم جوال الزبونة": to });
        await sendWhatsAppText(to, `تم حجز موعدك بنجاح في تمام الساعة ${timeTitle} 🎉 بانتظارك!`);
        if (SALON_OWNER_PHONE) await sendWhatsAppText(SALON_OWNER_PHONE, `🔔 حجز جديد!\nالرقم: ${to}\nالوقت: ${timeTitle}`);
    } catch (e) { console.error(e); }
}

async function sendWhatsAppText(to, text) {
    try { await axios.post(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, { messaging_product: "whatsapp", to, type: "text", text: { body: text } }, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } } ); } catch (e) { console.error(e); }
}

async function sendWhatsAppInteractive(to, text, buttons) {
    try { await axios.post(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, { messaging_product: "whatsapp", to, type: "interactive", interactive: { type: "button", body: { text }, action: { buttons } } }, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } } ); } catch (e) { console.error(e); }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
