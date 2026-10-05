import { PDFDocument, StandardFonts, rgb, type PDFPage } from 'pdf-lib';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type IdCardRenderSnapshot = {
  templateId: string;
  school: {
    name: string;
    initials?: string | null;
    logoUrl?: string | null;
    primaryColor?: string | null;
    address?: string | null;
    phone?: string | null;
    slug?: string | null;
  };
  students: Array<{
    id: string;
    firstName: string;
    middleName?: string | null;
    lastName: string;
    admissionNo?: string | null;
    photoUrl?: string | null;
    className?: string | null;
  }>;
};

const CARD_WIDTH = 243.4;
const CARD_HEIGHT = 153.5;
const UPLOADS_ROOT = path.resolve(process.cwd(), 'uploads');

function parseColor(value?: string | null) {
  const match = value?.match(/^#?([0-9a-f]{6})$/i);
  if (!match) return rgb(0.04, 0.35, 0.42);
  const hex = match[1];
  return rgb(Number.parseInt(hex.slice(0, 2), 16) / 255, Number.parseInt(hex.slice(2, 4), 16) / 255, Number.parseInt(hex.slice(4, 6), 16) / 255);
}

function safeText(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\u0000-\u00ff]/g, '?').trim();
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'SB';
}

async function readLocalImage(url?: string | null) {
  if (!url || !url.startsWith('/uploads/')) return null;
  const resolved = path.resolve(UPLOADS_ROOT, url.slice('/uploads/'.length));
  if (!resolved.startsWith(`${UPLOADS_ROOT}${path.sep}`)) return null;
  try {
    return await readFile(resolved);
  } catch {
    return null;
  }
}

async function drawPhoto(document: PDFDocument, page: PDFPage, photoUrl: string | null | undefined, x: number, y: number, width: number, height: number) {
  const bytes = await readLocalImage(photoUrl);
  if (!bytes) return false;
  try {
    const image = photoUrl?.toLowerCase().endsWith('.png')
      ? await document.embedPng(bytes)
      : await document.embedJpg(bytes);
    const scale = Math.max(width / image.width, height / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    page.drawImage(image, {
      x: x + (width - drawWidth) / 2,
      y: y + (height - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
    });
    page.drawRectangle({ x, y, width, height, borderWidth: 1.2, borderColor: rgb(1, 1, 1) });
    return true;
  } catch {
    return false;
  }
}

async function drawLogo(document: PDFDocument, page: PDFPage, logoUrl: string | null | undefined, x: number, y: number, size: number) {
  const bytes = await readLocalImage(logoUrl);
  if (!bytes) return false;
  try {
    const image = logoUrl?.toLowerCase().endsWith('.png')
      ? await document.embedPng(bytes)
      : await document.embedJpg(bytes);
    const scale = Math.min(size / image.width, size / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    page.drawImage(image, { x: x + (size - width) / 2, y: y + (size - height) / 2, width, height });
    return true;
  } catch {
    return false;
  }
}

export async function generateIdCardPdf(snapshot: IdCardRenderSnapshot) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const accent = parseColor(snapshot.school.primaryColor);
  const isPortrait = snapshot.templateId === 'crestClassic' || snapshot.templateId === 'earlyLearners';
  const pageWidth = isPortrait ? CARD_HEIGHT : CARD_WIDTH;
  const pageHeight = isPortrait ? CARD_WIDTH : CARD_HEIGHT;

  for (const student of snapshot.students) {
    const page = document.addPage([pageWidth, pageHeight]);
    const fullName = safeText([student.firstName, student.middleName, student.lastName].filter(Boolean).join(' '));
    const schoolName = safeText(snapshot.school.name || 'School');
    const nameSize = fullName.length > 25 ? 13 : 16;
    const bandColor = snapshot.templateId === 'inkSaver' ? rgb(0.15, 0.15, 0.15) : accent;
    const background = snapshot.templateId === 'earlyLearners' ? rgb(1, 0.97, 0.89) : rgb(0.98, 0.99, 0.99);

    page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: background });
    page.drawRectangle({ x: 0, y: pageHeight - 34, width: pageWidth, height: 34, color: bandColor });

    if (isPortrait) {
      await drawLogo(document, page, snapshot.school.logoUrl, 12, pageHeight - 29, 24);
      page.drawText(schoolName, { x: 42, y: pageHeight - 21, size: 10, font: bold, color: rgb(1, 1, 1), maxWidth: pageWidth - 54 });
      const photoWidth = 72;
      const photoHeight = 88;
      const photoX = (pageWidth - photoWidth) / 2;
      const photoY = pageHeight - 132;
      const hasPhoto = await drawPhoto(document, page, student.photoUrl, photoX, photoY, photoWidth, photoHeight);
      if (!hasPhoto) {
        page.drawRectangle({ x: photoX, y: photoY, width: photoWidth, height: photoHeight, color: rgb(0.9, 0.93, 0.93) });
        page.drawText(initials(fullName), { x: photoX + 24, y: photoY + 38, size: 22, font: bold, color: bandColor });
      }
      page.drawText(fullName, { x: 10, y: pageHeight - 148, size: nameSize, font: bold, color: rgb(0.08, 0.12, 0.14), maxWidth: pageWidth - 20 });
      page.drawText(`Admission: ${safeText(student.admissionNo || 'Not assigned')}`, { x: 10, y: 27, size: 8, font: regular, color: rgb(0.2, 0.25, 0.27), maxWidth: pageWidth - 20 });
      page.drawText(safeText(student.className || 'Class not assigned'), { x: 10, y: 15, size: 8, font: bold, color: bandColor, maxWidth: pageWidth - 20 });
    } else {
      await drawLogo(document, page, snapshot.school.logoUrl, 10, pageHeight - 29, 24);
      page.drawText(schoolName, { x: 40, y: pageHeight - 21, size: 10, font: bold, color: rgb(1, 1, 1), maxWidth: pageWidth - 50 });
      const photoWidth = 68;
      const photoHeight = 92;
      const photoX = 14;
      const photoY = 14;
      const hasPhoto = await drawPhoto(document, page, student.photoUrl, photoX, photoY, photoWidth, photoHeight);
      if (!hasPhoto) {
        page.drawRectangle({ x: photoX, y: photoY, width: photoWidth, height: photoHeight, color: rgb(0.9, 0.93, 0.93) });
        page.drawText(initials(fullName), { x: photoX + 20, y: photoY + 39, size: 22, font: bold, color: bandColor });
      }
      const textX = 94;
      page.drawText('STUDENT ID', { x: textX, y: pageHeight - 55, size: 7, font: bold, color: bandColor });
      page.drawText(fullName, { x: textX, y: pageHeight - 78, size: nameSize, font: bold, color: rgb(0.08, 0.12, 0.14), maxWidth: pageWidth - textX - 12 });
      page.drawText('ADMISSION NUMBER', { x: textX, y: pageHeight - 101, size: 6, font: bold, color: rgb(0.42, 0.48, 0.49) });
      page.drawText(safeText(student.admissionNo || 'Not assigned'), { x: textX, y: pageHeight - 114, size: 9, font: regular, color: rgb(0.1, 0.15, 0.16), maxWidth: pageWidth - textX - 12 });
      page.drawText('CLASS', { x: textX, y: 35, size: 6, font: bold, color: rgb(0.42, 0.48, 0.49) });
      page.drawText(safeText(student.className || 'Class not assigned'), { x: textX, y: 22, size: 9, font: bold, color: bandColor, maxWidth: pageWidth - textX - 12 });
    }
    page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, borderWidth: 1, borderColor: rgb(0.82, 0.86, 0.86) });
  }

  return new Uint8Array(await document.save());
}

export async function savePrivateIdCardArtifact(orderId: string, bytes: Uint8Array) {
  const storageRoot = path.resolve(process.env.ID_CARD_STORAGE_DIR || path.join(process.cwd(), 'private-storage', 'id-cards'));
  await mkdir(storageRoot, { recursive: true, mode: 0o700 });
  const artifactPath = path.join(storageRoot, `${orderId}.pdf`);
  await writeFile(artifactPath, bytes, { mode: 0o600 });
  return artifactPath;
}
