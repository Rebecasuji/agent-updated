import cron from 'node-cron';
import express from 'express';
import cors from 'cors';
import { runDailyExport } from './exporter.js';

const app = express();
app.use(cors());
app.use(express.json());

// Schedule task to run at 9:00 AM every day
cron.schedule('0 9 * * *', async () => {
  console.log('Running scheduled daily export...');
  await runDailyExport();
});

// Manual trigger endpoints
app.post('/api/export/yesterday', async (req, res) => {
  try {
    const result = await runDailyExport();
    if (result.success) {
      res.json({ success: true, url: result.archiveUrl });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/export/specific-date', async (req, res) => {
  const { date } = req.body;
  if (!date) return res.status(400).json({ error: 'Date is required (YYYY-MM-DD)' });
  
  try {
    const result = await runDailyExport(date);
    if (result.success) {
      res.json({ success: true, url: result.archiveUrl });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'timeguard-backend-archiver' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend archiver service running on port ${PORT}`);
  console.log('Cron scheduled for 9:00 AM daily.');
});
