import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import { ID_CARD_TEMPLATES, type IdCardOrientation } from './id-card-pricing.js';

export type IdCardRenderSnapshot = {
  templateId: string;
  orientation?: IdCardOrientation;
  includeCardBack?: boolean;
  parentPortalQrUrl?: string | null;
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

function wrapText(value: string, font: PDFFont, size: number, maxWidth: number) {
  const lines: string[] = [];
  let line = '';
  for (const word of value.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
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
  const template = ID_CARD_TEMPLATES[snapshot.templateId as keyof typeof ID_CARD_TEMPLATES];
  if (!template) throw new Error('The selected card template is unavailable.');
  const orientation = snapshot.orientation || template.defaultOrientation;
  const isPortrait = orientation === 'PORTRAIT';
  const includeCardBack = snapshot.includeCardBack ?? Boolean(snapshot.parentPortalQrUrl);
  const pageWidth = isPortrait ? CARD_HEIGHT : CARD_WIDTH;
  const pageHeight = isPortrait ? CARD_WIDTH : CARD_HEIGHT;

  for (const student of snapshot.students) {
    const page = document.addPage([pageWidth, pageHeight]);
    const fullName = safeText([student.firstName, student.middleName, student.lastName].filter(Boolean).join(' '));
    const schoolName = safeText(snapshot.school.name || 'School');
    const nameSize = fullName.length > 25 ? 13 : 16;
    const isInkSaver = snapshot.templateId === 'inkSaver';
    const isEarlyLearners = snapshot.templateId === 'earlyLearners';
    const isHouseTeam = snapshot.templateId === 'houseTeam';
    const isSeniorCollege = snapshot.templateId === 'seniorCollege';
    const bandColor = isInkSaver ? rgb(0.15, 0.15, 0.15) : accent;
    const background = isEarlyLearners ? rgb(1, 0.97, 0.89) : rgb(0.98, 0.99, 0.99);

    page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: background });
    if (snapshot.templateId === 'crestClassic') {
      page.drawRectangle({ x: 0, y: pageHeight - 38, width: pageWidth, height: 38, color: bandColor });
      page.drawRectangle({ x: 0, y: pageHeight - 41, width: pageWidth, height: 3, color: isInkSaver ? rgb(0.45, 0.45, 0.45) : rgb(0.82, 0.7, 0.38) });
    } else if (isHouseTeam) {
      page.drawRectangle({ x: 0, y: 0, width: 10, height: pageHeight, color: bandColor });
      page.drawRectangle({ x: 10, y: pageHeight - 12, width: pageWidth - 10, height: 12, color: bandColor });
    } else if (isSeniorCollege) {
      page.drawRectangle({ x: 0, y: pageHeight - 7, width: pageWidth, height: 7, color: bandColor });
      page.drawRectangle({ x: 12, y: 12, width: pageWidth - 24, height: pageHeight - 24, borderWidth: 0.7, borderColor: rgb(0.72, 0.77, 0.77) });
    } else if (isEarlyLearners) {
      page.drawRectangle({ x: 0, y: pageHeight - 34, width: pageWidth, height: 34, color: bandColor });
      page.drawCircle({ x: pageWidth - 14, y: pageHeight - 36, size: 18, color: rgb(1, 0.89, 0.63), opacity: 0.7 });
    } else if (isInkSaver) {
      page.drawRectangle({ x: 0, y: pageHeight - 30, width: pageWidth, height: 30, color: rgb(1, 1, 1) });
      page.drawLine({ start: { x: 0, y: pageHeight - 31 }, end: { x: pageWidth, y: pageHeight - 31 }, thickness: 1.4, color: rgb(0.18, 0.18, 0.18) });
    } else {
      page.drawRectangle({ x: 0, y: pageHeight - 31, width: pageWidth, height: 31, color: bandColor });
      page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: 5, color: bandColor, opacity: 0.14 });
    }

    if (isPortrait) {
      const mastheadY = pageHeight - (snapshot.templateId === 'crestClassic' ? 33 : 29);
      await drawLogo(document, page, snapshot.school.logoUrl, 12, mastheadY, 22);
      page.drawText(schoolName, { x: 40, y: pageHeight - 22, size: 9, font: bold, color: snapshot.templateId === 'inkSaver' ? rgb(0.1, 0.1, 0.1) : rgb(1, 1, 1), maxWidth: pageWidth - 50 });
      const photoWidth = isEarlyLearners ? 82 : 72;
      const photoHeight = isEarlyLearners ? 94 : 88;
      const photoX = snapshot.templateId === 'houseTeam' ? 20 : (pageWidth - photoWidth) / 2;
      const photoY = isEarlyLearners ? pageHeight - 133 : pageHeight - 132;
      const hasPhoto = await drawPhoto(document, page, student.photoUrl, photoX, photoY, photoWidth, photoHeight);
      if (!hasPhoto) {
        page.drawRectangle({ x: photoX, y: photoY, width: photoWidth, height: photoHeight, color: rgb(0.9, 0.93, 0.93) });
        page.drawText(initials(fullName), { x: photoX + 24, y: photoY + 38, size: 22, font: bold, color: bandColor });
      }
      const textX = snapshot.templateId === 'houseTeam' ? 101 : 10;
      const textWidth = pageWidth - textX - 12;
      page.drawText(fullName, { x: textX, y: pageHeight - 148, size: nameSize, font: bold, color: rgb(0.08, 0.12, 0.14), maxWidth: textWidth });
      page.drawText('ADMISSION NUMBER', { x: textX, y: 27, size: 6, font: bold, color: rgb(0.42, 0.48, 0.49) });
      page.drawText(safeText(student.admissionNo || 'Not assigned'), { x: textX, y: 17, size: 8, font: regular, color: rgb(0.2, 0.25, 0.27), maxWidth: textWidth });
      page.drawText(safeText(student.className || 'Class not assigned'), { x: textX, y: 7, size: 7, font: bold, color: bandColor, maxWidth: textWidth });
    } else {
      const lightHeader = isInkSaver || isSeniorCollege;
      await drawLogo(document, page, snapshot.school.logoUrl, 12, pageHeight - 27, 21);
      page.drawText(schoolName, { x: 40, y: pageHeight - 21, size: 9, font: bold, color: lightHeader ? rgb(0.1, 0.12, 0.12) : rgb(1, 1, 1), maxWidth: pageWidth - 52 });
      const photoWidth = isSeniorCollege ? 62 : 68;
      const photoHeight = isSeniorCollege ? 84 : 92;
      const photoX = isHouseTeam ? 21 : 14;
      const photoY = isSeniorCollege ? 22 : 14;
      const hasPhoto = await drawPhoto(document, page, student.photoUrl, photoX, photoY, photoWidth, photoHeight);
      if (!hasPhoto) {
        page.drawRectangle({ x: photoX, y: photoY, width: photoWidth, height: photoHeight, color: rgb(0.9, 0.93, 0.93) });
        page.drawText(initials(fullName), { x: photoX + 20, y: photoY + 39, size: 22, font: bold, color: bandColor });
      }
      const textX = isHouseTeam ? 102 : 94;
      const textWidth = pageWidth - textX - 14;
      page.drawText(isSeniorCollege ? 'STUDENT IDENTIFICATION' : 'STUDENT ID', { x: textX, y: pageHeight - 53, size: 7, font: bold, color: bandColor });
      page.drawText(fullName, { x: textX, y: pageHeight - 76, size: nameSize, font: bold, color: rgb(0.08, 0.12, 0.14), maxWidth: textWidth });
      page.drawText('ADMISSION NUMBER', { x: textX, y: pageHeight - 98, size: 6, font: bold, color: rgb(0.42, 0.48, 0.49) });
      page.drawText(safeText(student.admissionNo || 'Not assigned'), { x: textX, y: pageHeight - 111, size: 9, font: regular, color: rgb(0.1, 0.15, 0.16), maxWidth: textWidth });
      page.drawText('CLASS', { x: textX, y: 37, size: 6, font: bold, color: rgb(0.42, 0.48, 0.49) });
      page.drawText(safeText(student.className || 'Class not assigned'), { x: textX, y: 24, size: 9, font: bold, color: bandColor, maxWidth: textWidth });
    }
    page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, borderWidth: 1, borderColor: rgb(0.82, 0.86, 0.86) });

    if (includeCardBack) {
      const back = document.addPage([pageWidth, pageHeight]);
      const backPaper = rgb(0.985, 0.99, 0.99);
      const ink = rgb(0.12, 0.18, 0.2);
      const softInk = rgb(0.33, 0.4, 0.42);
      const backAccent = isInkSaver ? rgb(0.18, 0.2, 0.21) : accent;
      back.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: backPaper });
      back.drawRectangle({ x: 0, y: pageHeight - 27, width: pageWidth, height: 27, color: backAccent });
      await drawLogo(document, back, snapshot.school.logoUrl, 10, pageHeight - 23, 18);
      back.drawText('STUDENT IDENTIFICATION', { x: 34, y: pageHeight - 17, size: 7, font: bold, color: rgb(1, 1, 1), maxWidth: pageWidth - 44 });

      const isBackPortrait = orientation === 'PORTRAIT';
      const textX = 12;
      const textWidth = pageWidth - 24;
      const issuedLabelY = pageHeight - (isBackPortrait ? 48 : 45);
      const schoolNameY = pageHeight - (isBackPortrait ? 62 : 58);
      const dividerY = pageHeight - (isBackPortrait ? 69 : 65);
      const foundLabelY = pageHeight - (isBackPortrait ? 85 : 79);
      const messageTopY = pageHeight - (isBackPortrait ? 98 : 92);
      back.drawText('THIS CARD IS ISSUED BY', { x: textX, y: issuedLabelY, size: 6, font: bold, color: backAccent, maxWidth: textWidth });
      back.drawText(schoolName, { x: textX, y: schoolNameY, size: 10, font: bold, color: ink, maxWidth: textWidth });
      back.drawLine({ start: { x: textX, y: dividerY }, end: { x: pageWidth - textX, y: dividerY }, thickness: 0.6, color: rgb(0.79, 0.83, 0.83) });

      back.drawText('IF FOUND', { x: textX, y: foundLabelY, size: 6, font: bold, color: backAccent });
      const returnMessage = 'Please return it to the school office or hand it to the nearest police station.';
      const returnLines = wrapText(returnMessage, regular, 7, textWidth);
      returnLines.forEach((line, index) => back.drawText(line, {
        x: textX,
        y: messageTopY - index * 9,
        size: 7,
        font: regular,
        color: softInk,
        maxWidth: textWidth,
      }));

      if (snapshot.parentPortalQrUrl) {
        const qrDataUrl = await QRCode.toDataURL(snapshot.parentPortalQrUrl, { errorCorrectionLevel: 'M', margin: 1, width: 512 });
        const qrBytes = Buffer.from(qrDataUrl.split(',')[1], 'base64');
        const qrImage = await document.embedPng(qrBytes);
        const qrSize = 42;
        const qrX = isBackPortrait ? (pageWidth - qrSize) / 2 : pageWidth - qrSize - 12;
        const qrY = 12;
        back.drawRectangle({ x: qrX - 4, y: qrY - 4, width: qrSize + 8, height: qrSize + 8, color: rgb(1, 1, 1), borderWidth: 0.6, borderColor: rgb(0.79, 0.83, 0.83) });
        back.drawImage(qrImage, { x: qrX, y: qrY, width: qrSize, height: qrSize });
        if (isBackPortrait) {
          back.drawText('PARENT PORTAL', { x: textX, y: 68, size: 6, font: bold, color: backAccent, maxWidth: textWidth });
        } else {
          back.drawText('PARENT PORTAL', { x: textX, y: 32, size: 6, font: bold, color: backAccent });
        }
      }
      back.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, borderWidth: 1, borderColor: rgb(0.82, 0.86, 0.86) });
    }
  }

  return new Uint8Array(await document.save());
}

export async function generateIdCardA4SheetPdf(snapshot: IdCardRenderSnapshot) {
  const cardBytes = await generateIdCardPdf(snapshot);
  const cardDocument = await PDFDocument.load(cardBytes);
  const sheetDocument = await PDFDocument.create();
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const firstPage = cardDocument.getPage(0);
  const cardWidth = firstPage.getWidth();
  const cardHeight = firstPage.getHeight();
  const margin = 28;
  const gap = 12;
  const columns = Math.max(1, Math.floor((pageWidth - 2 * margin + gap) / (cardWidth + gap)));
  const rows = Math.max(1, Math.floor((pageHeight - 2 * margin + gap) / (cardHeight + gap)));
  const perSheet = columns * rows;
  const embeddedPages = await sheetDocument.embedPdf(cardBytes, cardDocument.getPageIndices());
  const includeCardBack = snapshot.includeCardBack ?? Boolean(snapshot.parentPortalQrUrl);
  const sheetGroups = includeCardBack
    ? [embeddedPages.filter((_, index) => index % 2 === 0), embeddedPages.filter((_, index) => index % 2 === 1)]
    : [embeddedPages];

  for (const group of sheetGroups) {
    for (let start = 0; start < group.length; start += perSheet) {
      const page = sheetDocument.addPage([pageWidth, pageHeight]);
      const pageCards = group.slice(start, start + perSheet);
      pageCards.forEach((card, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const x = margin + column * (cardWidth + gap);
        const y = pageHeight - margin - cardHeight - row * (cardHeight + gap);
        page.drawPage(card, { x, y, width: cardWidth, height: cardHeight });
        const mark = 5;
        const inset = 1.5;
        const color = rgb(0.45, 0.48, 0.49);
        page.drawLine({ start: { x: x - inset, y }, end: { x: x - inset - mark, y }, thickness: 0.35, color });
        page.drawLine({ start: { x, y: y - inset }, end: { x, y: y - inset - mark }, thickness: 0.35, color });
        page.drawLine({ start: { x: x + cardWidth + inset, y }, end: { x: x + cardWidth + inset + mark, y }, thickness: 0.35, color });
        page.drawLine({ start: { x: x + cardWidth, y: y - inset }, end: { x: x + cardWidth, y: y - inset - mark }, thickness: 0.35, color });
        page.drawLine({ start: { x: x - inset, y: y + cardHeight }, end: { x: x - inset - mark, y: y + cardHeight }, thickness: 0.35, color });
        page.drawLine({ start: { x, y: y + cardHeight + inset }, end: { x, y: y + cardHeight + inset + mark }, thickness: 0.35, color });
        page.drawLine({ start: { x: x + cardWidth + inset, y: y + cardHeight }, end: { x: x + cardWidth + inset + mark, y: y + cardHeight }, thickness: 0.35, color });
        page.drawLine({ start: { x: x + cardWidth, y: y + cardHeight + inset }, end: { x: x + cardWidth, y: y + cardHeight + inset + mark }, thickness: 0.35, color });
      });
    }
  }

  return new Uint8Array(await sheetDocument.save());
}

export async function savePrivateIdCardArtifact(orderId: string, bytes: Uint8Array) {
  const storageRoot = path.resolve(process.env.ID_CARD_STORAGE_DIR || path.join(process.cwd(), 'private-storage', 'id-cards'));
  await mkdir(storageRoot, { recursive: true, mode: 0o700 });
  const artifactPath = path.join(storageRoot, `${orderId}.pdf`);
  await writeFile(artifactPath, bytes, { mode: 0o600 });
  return artifactPath;
}
