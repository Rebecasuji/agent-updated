import { ZipArchive } from 'archiver';
import fs from 'fs';
import path from 'path';
import { supabase } from './db.js';

export async function createZip(excelPath, dateStr) {
  const zipPath = excelPath.replace('.xlsx', '.zip');
  const output = fs.createWriteStream(zipPath);
  const archive = new ZipArchive({ zlib: { level: 9 } });

  return new Promise((resolve, reject) => {
    output.on('close', () => resolve(zipPath));
    output.on('error', err => {
      output.close();
      reject(err);
    });
    archive.on('error', err => {
      output.close();
      reject(err);
    });
    
    archive.pipe(output);
    archive.file(excelPath, { name: `monitoring_report.xlsx` });
    archive.finalize();
  });
}

export async function uploadToStorage(zipPath, dateStr) {
  // monitoring_archives/YYYY/MM/DD/monitoring_report.zip
  const dateObj = new Date(dateStr);
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  
  const destPath = `${year}/${month}/${day}/monitoring_report.zip`;
  const fileBuffer = fs.readFileSync(zipPath);
  
  const { data, error } = await supabase.storage
    .from('monitoring_archives')
    .upload(destPath, fileBuffer, {
      contentType: 'application/zip',
      upsert: true
    });
    
  if (error) throw error;
  
  const { data: signedData, error: signedError } = await supabase.storage
    .from('monitoring_archives')
    .createSignedUrl(destPath, 60 * 60 * 24 * 365 * 10); // 10 years validity
    
  if (signedError) throw signedError;
  return signedData.signedUrl;
}
