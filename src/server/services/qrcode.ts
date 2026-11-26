import type { Request } from 'express';
import QRCode from 'qrcode';
import type { AppConfig } from '../config.js';

export async function generateQrPngBuffer(content: string, width = 420): Promise<Buffer> {
  return QRCode.toBuffer(content, {
    type: 'png',
    width,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#0F172A',
      light: '#FFFFFF',
    },
  });
}

export async function generateQrDataUrl(content: string, width = 420): Promise<string> {
  return QRCode.toDataURL(content, {
    type: 'image/png',
    width,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#0F172A',
      light: '#FFFFFF',
    },
  });
}

export async function generateQrSvg(content: string, width = 320): Promise<string> {
  return QRCode.toString(content, {
    type: 'svg',
    width,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#0F172A',
      light: '#FFFFFF',
    },
  });
}

export function resolveShareOrigin(req: Request, config: AppConfig): string {
  if (config.publicUrl) {
    return config.publicUrl.replace(/\/+$/, '');
  }
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim();
  const proto = forwardedProto || req.protocol || 'https';
  const host = String(req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3000')
    .split(',')[0]
    .trim();
  return `${proto}://${host}`.replace(/\/+$/, '');
}
