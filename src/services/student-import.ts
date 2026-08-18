import fs from 'fs';
import path from 'path';

export type StudentImportRow = {
  firstName: string | null;
  lastName: string | null;
  middleName?: string | null;
  admissionNo?: string | null;
  classId?: string | null;
  className?: string | null;
  guardianFirst?: string | null;
  guardianLast?: string | null;
  guardianPhone?: string | null;
  guardianEmail?: string | null;
  birthDate?: string | null;
  gender?: string | null;
  address?: string | null;
  status?: string | null;
};

export type BulkStudentImportResult = {
  validRows: StudentImportRow[];
  errors: string[];
};

function normalizeCell(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result.map((cell) => cell.trim());
}

export function parseCsvText(csvText: string): string[][] {
  const lines = csvText.replace(/\r\n/g, '\n').split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  return lines.map((line) => splitCsvLine(line));
}

export function buildBulkStudentImportRows(
  rows: string[][],
  classes: Array<{ id: string; name: string; arm?: string | null }>,
  existingAdmissions: string[],
): BulkStudentImportResult {
  if (rows.length < 2) {
    return { validRows: [], errors: ['The CSV file is empty.'] };
  }

  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const firstNameIndex = headers.indexOf('firstname');
  const lastNameIndex = headers.indexOf('lastname');
  const classNameIndex = headers.indexOf('classname');
  const classIdIndex = headers.indexOf('classid');
  const middleNameIndex = headers.indexOf('middlename');
  const guardianFirstIndex = headers.indexOf('guardianfirst');
  const guardianLastIndex = headers.indexOf('guardianlast');
  const guardianPhoneIndex = headers.indexOf('guardianphone');
  const guardianEmailIndex = headers.indexOf('guardianemail');
  const birthDateIndex = headers.indexOf('dateofbirth');
  const genderIndex = headers.indexOf('gender');
  const addressIndex = headers.indexOf('address');
  const statusIndex = headers.indexOf('status');

  const errors: string[] = [];
  const validRows: StudentImportRow[] = [];
  const classLookup = new Map(classes.map((cls) => [cls.name.toLowerCase(), cls.id]));

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const firstName = normalizeCell(row[firstNameIndex] ?? null);
    const lastName = normalizeCell(row[lastNameIndex] ?? null);
    const middleName = normalizeCell(row[middleNameIndex] ?? null);
    const guardianFirst = normalizeCell(row[guardianFirstIndex] ?? null);
    const guardianLast = normalizeCell(row[guardianLastIndex] ?? null);
    const guardianPhone = normalizeCell(row[guardianPhoneIndex] ?? null);
    const guardianEmail = normalizeCell(row[guardianEmailIndex] ?? null);
    const birthDate = normalizeCell(row[birthDateIndex] ?? null);
    const gender = normalizeCell(row[genderIndex] ?? null);
    const address = normalizeCell(row[addressIndex] ?? null);
    const status = normalizeCell(row[statusIndex] ?? null) ?? 'ACTIVE';

    const lineNumber = rowIndex + 1;
    const issues: string[] = [];

    if (!firstName || !lastName) {
      issues.push('missing first name or last name');
    }

    const className = normalizeCell(row[classNameIndex] ?? row[classIdIndex] ?? null);
    let resolvedClassId: string | undefined;
    if (className) {
      resolvedClassId = classLookup.get(className.toLowerCase());
      if (!resolvedClassId) {
        issues.push(`class not found: ${className}`);
      }
    }

    if (issues.length > 0) {
      errors.push(`Row ${lineNumber}: ${issues.join(', ')}`);
      continue;
    }

    validRows.push({
      firstName,
      lastName,
      middleName: middleName ?? null,
      admissionNo: null,
      classId: resolvedClassId ?? null,
      className: className ?? null,
      guardianFirst: guardianFirst ?? null,
      guardianLast: guardianLast ?? null,
      guardianPhone: guardianPhone ?? null,
      guardianEmail: guardianEmail ?? null,
      birthDate: birthDate ?? null,
      gender: gender ?? null,
      address: address ?? null,
      status: status ?? null,
    });
  }

  return { validRows, errors };
}

export function createBulkStudentImportTemplate(outputPath: string) {
  const templateContent = [
    'firstName,lastName,middleName,className,guardianFirst,guardianLast,guardianPhone,guardianEmail,dateOfBirth,gender,address,status',
    'Ada,Okafor,,Primary 1,Ade,Okafor,08012345678,ade@example.com,2005-01-10,Female,12 Main Street,ACTIVE',
  ].join('\n');

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, templateContent, 'utf8');
  return outputPath;
}
