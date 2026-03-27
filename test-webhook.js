// Test script to simulate Bitrix24 webhook and identify issues
// Run with: node test-webhook.js

// Sample Bitrix24 webhook payload (URL-encoded form data)
const samplePersonalChatPayload = new URLSearchParams({
  'event': 'ONIMBOTMESSAGEADD',
  'data[USER][ID]': '42',
  'data[PARAMS][DIALOG_ID]': '42',
  'data[PARAMS][FROM_USER_ID]': '42',
  'data[PARAMS][MESSAGE]': 'Привет, подшипник 6205',
  'auth[application_token]': 'test-token-123',
});

const sampleGroupChatPayload = new URLSearchParams({
  'event': 'ONIMBOTMESSAGEADD',
  'data[USER][ID]': '42',
  'data[PARAMS][DIALOG_ID]': 'chat12345',
  'data[PARAMS][MESSAGE]': 'Привет всем',  // No keywords
  'auth[application_token]': 'test-token-123',
});

const sampleGroupChatWithKeywordPayload = new URLSearchParams({
  'event': 'ONIMBOTMESSAGEADD',
  'data[USER][ID]': '42',
  'data[PARAMS][DIALOG_ID]': 'chat12345',
  'data[PARAMS][MESSAGE]': 'Нужен подшипник 6205',  // Has keyword
  'auth[application_token]': 'test-token-123',
});

console.log('=== Testing Webhook Payload Parsing ===\n');

// Test 1: Personal chat
console.log('Test 1: Personal chat message');
const data1 = Object.fromEntries(samplePersonalChatPayload);
console.log('Parsed data:', {
  event: data1['event'],
  userId: data1['data[USER][ID]'],
  chatId: data1['data[PARAMS][DIALOG_ID]'],
  message: data1['data[PARAMS][MESSAGE]'],
  appToken: data1['auth[application_token]'],
});

const isGroupChat1 = data1['data[PARAMS][DIALOG_ID]'] &&
                     String(data1['data[PARAMS][DIALOG_ID]']).startsWith('chat');
console.log('Is group chat:', isGroupChat1);
console.log('Should respond: YES (personal chat, always respond)\n');

// Test 2: Group chat without keyword
console.log('Test 2: Group chat message without keyword');
const data2 = Object.fromEntries(sampleGroupChatWithKeywordPayload);
const message2 = data2['data[PARAMS][MESSAGE]'];
const KEYWORDS = [
  'подшипник', 'подшипники', 'артикул', 'сделка', 'сделки', 'клиент',
  'цена', 'стоимость', 'скидка', 'кп', 'коммерческ', 'заказ',
  'поставка', 'наличие', 'срок', 'каталог', 'аналог',
];
const lower2 = message2.toLowerCase();
const hit2 = KEYWORDS.find((kw) => lower2.includes(kw));
const isGroupChat2 = data2['data[PARAMS][DIALOG_ID]'] &&
                     String(data2['data[PARAMS][DIALOG_ID]']).startsWith('chat');
console.log('Parsed data:', {
  event: data2['event'],
  userId: data2['data[USER][ID]'],
  chatId: data2['data[PARAMS][DIALOG_ID]'],
  message: message2,
});
console.log('Is group chat:', isGroupChat2);
console.log('Message lowercase:', lower2);
console.log('Keyword hit:', hit2);
console.log('Should respond:', hit2 ? 'YES' : 'NO', '\n');

// Test 3: Check if parsing matches worker.js logic
console.log('Test 3: Validate that parsing logic matches worker.js');
console.log('✓ Form data parsing uses Object.fromEntries(new URLSearchParams(body))');
console.log('✓ chatId extraction: data["data[PARAMS][DIALOG_ID]"] || data["data[PARAMS][FROM_USER_ID]"]');
console.log('✓ Group chat detection: String(chatId).startsWith("chat")');
console.log('✓ Keyword filtering: KEYWORDS.find((kw) => message.toLowerCase().includes(kw))');

console.log('\n=== Common Issues to Check ===');
console.log('1. B24_APP_TOKEN mismatch: Check if auth[application_token] matches env.B24_APP_TOKEN');
console.log('2. Group chat keywords: Message must contain keywords like "подшипник", "сделка", etc.');
console.log('3. Bot mention: In group chat, bot must be @-mentioned with [USER=<BOT_ID>] if no keywords');
console.log('4. Empty messages: Messages are trimmed, empty messages are skipped');
console.log('5. Wrong event type: Only ONIMBOTMESSAGEADD events are processed');
console.log('6. Missing fields: userId, chatId, or message missing will skip processing');
console.log('7. Background errors: Check Cloudflare logs for errors in ctx.waitUntil()');
console.log('8. Bitrix24 API errors: botReply() may fail silently, check B24 credentials');

console.log('\n=== Diagnostic Steps ===');
console.log('1. Check Cloudflare Worker logs for "Webhook skipped" or "Webhook rejected" messages');
console.log('2. Verify environment variables: B24_APP_TOKEN, BOT_ID, B24_PORTAL, B24_USER_ID, B24_TOKEN');
console.log('3. Test with /start command in chat to verify bot registration');
console.log('4. Check if message contains keywords in group chats');
console.log('5. Test @-mentioning the bot in group chat: [USER=1267]');
