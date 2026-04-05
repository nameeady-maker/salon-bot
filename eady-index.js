const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const Airtable = require('airtable');

const app = express();
app.use(bodyParser.json());

// ==========================================
// 1. إعدادات البيانات (استبدلها ببياناتك)
// ==========================================
const AIRTABLE_API_KEY = 'patnAZKxLwxXh9GBY.39ed029743e491551e14ce56b74c4ac7fb8ba643aa2fb7a2cf37d5373fde6e6c';
const BASE_ID = 'appZj3cIIjuvbyvzJ; // الـ ID الخاص بك
const WHATSAPP_TOKEN = '991214003557444';
const PHONE_NUMBER_ID = 979210805285658';
const SALON_OWNER_PHONE = '966562117936'; // رقم صاحبة الصالون للإشعارات

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(BASE_ID);

// ==========================================
// 2. استقبال الرسائل (Webhook)
// ==========================================
// التحقق من الـ Webhook (مطلوب من Meta مرة واحدة فقط عند الربط)
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token === 'salon123') { // تأكد أن الكلمة هنا تطابق ما وضعته في Meta
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});


app.post('/webhook', async (req, res) => {
    const body = req.body;

    // التحقق من صحة الرسالة القادمة من واتساب
    if (body.object === 'whatsapp_business_account') {
        if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
            const message = body.entry[0].changes[0].value.messages[0];
            const from = message.from; // رقم الزبونة
            
            // معالجة الرسائل النصية (مثل "مرحبا")
            if (message.type === 'text') {
                const text = message.text.body.toLowerCase();
                if (text.includes("مرحبا") || text.includes("حجز")) {
                    await sendServicesList(from);
                }
            }

            // معالجة الضغط على الأزرار (اختيار الخدمة/العاملة/الوقت)
            if (message.type === 'interactive') {
                const selectionId = message.interactive.button_reply.id;
                const selectionTitle = message.interactive.button_reply.title;

                if (selectionId.startsWith('srv_')) {
                    // الزبونة اختارت خدمة -> اعرض لها العاملات
                    await sendStaffList(from, selectionId.replace('srv_', ''));
                } else if (selectionId.startsWith('stf_')) {
                    // الزبونة اختارت عاملة -> اعرض لها الأوقات المتاحة
                    await sendAvailableSlots(from, selectionId.replace('stf_', ''));
                } else if (selectionId.startsWith('slot_')) {
                    // الزبونة اختارت وقت -> أكد الحجز
                    await confirmBooking(from, selectionId.replace('slot_', ''), selectionTitle);
                }
            }
        }
        res.sendStatus(200);
    } else {
        res.sendStatus(404);
    }
});

// ==========================================
// 3. وظائف البوت (Logic)
// ==========================================

// أ. إرسال قائمة الخدمات
async function sendServicesList(to) {
    const records = await base('جدول الخدمات').select().firstPage();
    const buttons = records.slice(0, 3).map(record => ({
        type: "reply",
        reply: { id: `srv_${record.id}`, title: record.get('اسم الخدمة') }
    }));
    await sendWhatsAppInteractive(to, "أهلاً بكِ في صالوننا ✨ يرجى اختيار الخدمة:", buttons);
}

// ب. إرسال قائمة العاملات بناءً على الخدمة
async function sendStaffList(to, serviceId) {
    const records = await base('جدول العاملات').select().firstPage();
    // فلترة العاملات اللواتي يقدمن هذه الخدمة
    const buttons = records.filter(r => {
        const services = r.get('جدول الخدمات') || [];
        return services.includes(serviceId);
    }).slice(0, 3).map(record => ({
        type: "reply",
        reply: { id: `stf_${record.id}`, title: record.get('اسم العاملة') }
    }));
    await sendWhatsAppInteractive(to, "ممتاز، من هي العاملة المفضلة لديكِ؟", buttons);
}

// ج. إرسال الأوقات المتاحة للعاملة المختارة
async function sendAvailableSlots(to, staffId) {
    const records = await base('جدول المواعيد').select({
        filterByFormula: `AND({العاملة} = '${staffId}', {الحالة} = 'متاح')`
    }).firstPage();

    const buttons = records.slice(0, 3).map(record => ({
        type: "reply",
        reply: { id: `slot_${record.id}`, title: record.get('الوقت') }
    }));

    if (buttons.length === 0) {
        await sendWhatsAppText(to, "نعتذر، لا توجد مواعيد متاحة لهذه العاملة حالياً.");
    } else {
        await sendWhatsAppInteractive(to, "اختاري الوقت المناسب لكِ اليوم:", buttons);
    }
}

// د. تأكيد الحجز وتحديث Airtable
async function confirmBooking(to, slotId, timeTitle) {
    await base('جدول المواعيد').update(slotId, {
        "الحالة": "محجوز",
        "رقم جوال الزبونة": to
    });

    await sendWhatsAppText(to, `تم حجز موعدك بنجاح في تمام الساعة ${timeTitle} 🎉 بانتظارك!`);
    
    // إشعار صاحبة الصالون (الميزة التي طلبتها)
    await sendWhatsAppText(SALON_OWNER_PHONE, `🔔 حجز جديد!\nالرقم: ${to}\nالوقت: ${timeTitle}`);
}

// ==========================================
// 4. وظائف الإرسال (WhatsApp API)
// ==========================================

async function sendWhatsAppText(to, text) {
    await axios.post(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
        messaging_product: "whatsapp", to, type: "text", text: { body: text }
    }, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } } );
}

async function sendWhatsAppInteractive(to, text, buttons) {
    await axios.post(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
        messaging_product: "whatsapp", to, type: "interactive",
        interactive: { type: "button", body: { text }, action: { buttons } }
    }, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } } );
}

app.listen(3000, () => console.log('Server is running on port 3000'));
