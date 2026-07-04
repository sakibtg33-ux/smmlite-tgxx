import 'dotenv/config';
import express from 'express';
import checkHandler from './api/check.js';
import telegramHandler from './api/telegram.js';

const app = express();
app.use(express.json());

app.post('/api/check', (req, res) => checkHandler(req, res));
app.post('/api/telegram', (req, res) => telegramHandler(req, res));

// হেলথ চেক
app.get('/', (req, res) => res.send('SMMLite Checker is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
