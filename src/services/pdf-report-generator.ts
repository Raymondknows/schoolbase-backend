// @ts-nocheck - PDF functionality disabled for now, will be replaced with easier solution
import { PDFDocument, PDFPage, rgb, degrees } from 'pdf-lib';
import { promises as fs } from 'fs';
import path from 'path';
// @ts-ignore - Disabled PDF functionality for now
// import archiver from 'archiver';
import { Readable } from 'stream';

export interface SubjectScore {
  subjectName: string;
  caScore?: number;
  testScore?: number;
  examScore?: number;
  projectScore?: number;
  totalScore: number;
  grade: string;
  subjectPosition?: number;
  remarks?: string;
  maxScore?: number;
}

export interface ReportCardInput {
  pupilId: string;
  pupilName: string;
  admissionNo: string;
  dateOfBirth?: string;
  gender?: string;
  photoUrl?: string;
  className: string;
  classPhase: string;
  termName: string;
  academicYear: string;
  assessmentName: string;
  schoolName: string;
  schoolAddress?: string;
  schoolLogoUrl?: string;
  principalName?: string;
  schoolStampUrl?: string;
  subjects: SubjectScore[];
  totalScore: number;
  averageScore: number;
  lowestScore: number;
  highestScore: number;
  classPosition?: number;
  totalStudents?: number;
  passRate: number;
  attendance?: number;
  maxAttendance?: number;
  teacherComment?: string;
  promotionStatus?: string;
  psychomotor?: string;
  affective?: string;
  orientation?: 'portrait' | 'landscape';
}

export class PdfReportGenerator {
  private static readonly MARGIN = 30;
  private static readonly LINE_HEIGHT = 12;
  private static readonly FONT_SIZE_HEADING = 16;
  private static readonly FONT_SIZE_SUBHEADING = 12;
  private static readonly FONT_SIZE_NORMAL = 10;
  private static readonly FONT_SIZE_SMALL = 8;

  static getPageDimensions(orientation: 'portrait' | 'landscape' = 'portrait') {
    if (orientation === 'landscape') {
      return { width: 842, height: 595 }; // A4 Landscape
    }
    return { width: 595, height: 842 }; // A4 Portrait
  }

  /**
   * Generate a single report card PDF
   */
  static async generateReportCard(input: ReportCardInput): Promise<Uint8Array> {
    const orientation = input.orientation || 'portrait';
    const dims = this.getPageDimensions(orientation);

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([dims.width, dims.height]);
    const { width, height } = page.getSize();

    let y = height - this.MARGIN;

    // Header Section
    y = await this.drawHeader(pdfDoc, page, y, input, width);

    // Student Information
    y = await this.drawStudentInfo(pdfDoc, page, y, input, width);

    // Results Table
    y = await this.drawResultsTable(pdfDoc, page, y, input, width, height);

    // Summary Section
    y = await this.drawSummary(pdfDoc, page, y, input, width);

    // Remarks Section
    y = await this.drawRemarks(pdfDoc, page, y, input, width);

    // Footer with signatures
    this.drawFooter(pdfDoc, page, input);

    return await pdfDoc.save();
  }

  /**
   * Generate multiple report cards as a ZIP file
   */
  static async generateBulkReportCards(
    reportInputs: ReportCardInput[]
  ): Promise<Readable> {
    const archive = archiver('zip', { zlib: { level: 9 } });

    // Process reports and add to archive
    for (const input of reportInputs) {
      const pdfBytes = await this.generateReportCard(input);
      const filename = `${input.admissionNo}_${input.pupilName.replace(/\s+/g, '_')}.pdf`;
      archive.append(Buffer.from(pdfBytes), { name: filename });
    }

    // Finalize archive
    archive.finalize();

    return archive;
  }

  /**
   * Generate class ranking sheet
   */
  static async generateClassRankingSheet(
    className: string,
    termName: string,
    academicYear: string,
    schoolName: string,
    rankings: Array<{
      position: number;
      name: string;
      admissionNo: string;
      totalScore: number;
      grade: string;
      subjects: number;
    }>
  ): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage([595, 842]); // A4 Portrait
    const { width, height } = page.getSize();

    let y = height - 30;

    // Header
    y -= 20;
    this.drawText(pdfDoc, page, schoolName, 30, y, 16, true);
    y -= 20;
    this.drawText(pdfDoc, page, `Class Ranking: ${className}`, 30, y, 12, true);
    y -= 15;
    this.drawText(
      pdfDoc,
      page,
      `${termName} - ${academicYear}`,
      30,
      y,
      10,
      false,
      rgb(0.4, 0.4, 0.4)
    );

    y -= 30;

    // Table Header
    const colX = [30, 80, 200, 280, 350, 430];
    const rowHeight = 20;

    this.drawText(pdfDoc, page, "#", colX[0], y, 10, true);
    this.drawText(pdfDoc, page, "Name", colX[1], y, 10, true);
    this.drawText(pdfDoc, page, "Admission No.", colX[2], y, 10, true);
    this.drawText(pdfDoc, page, "Total Score", colX[3], y, 10, true);
    this.drawText(pdfDoc, page, "Grade", colX[4], y, 10, true);
    this.drawText(pdfDoc, page, "Subjects", colX[5], y, 10, true);

    y -= 25;
    page.drawLine({ start: { x: 30, y }, end: { x: 550, y }, thickness: 1 });
    y -= 15;

    // Table Rows
    rankings.forEach((rank) => {
      if (y < 50) {
        const newPage = pdfDoc.addPage([595, 842]);
        page = newPage;
        y = 842 - 30;
      }

      this.drawText(pdfDoc, page, rank.position.toString(), colX[0], y, 10);
      this.drawText(pdfDoc, page, rank.name, colX[1], y, 10);
      this.drawText(pdfDoc, page, rank.admissionNo, colX[2], y, 10);
      this.drawText(pdfDoc, page, rank.totalScore.toString(), colX[3], y, 10);
      this.drawText(pdfDoc, page, rank.grade, colX[4], y, 10);
      this.drawText(pdfDoc, page, rank.subjects.toString(), colX[5], y, 10);

      y -= rowHeight;
    });

    return await pdfDoc.save();
  }

  // Helper Methods

  private static async drawHeader(
    pdfDoc: PDFDocument,
    page: PDFPage,
    y: number,
    input: ReportCardInput,
    width: number
  ): Promise<number> {
    // School name
    this.drawText(pdfDoc, page, input.schoolName, this.MARGIN, y, this.FONT_SIZE_HEADING, true);
    y -= 20;

    // Address
    if (input.schoolAddress) {
      this.drawText(pdfDoc, page, input.schoolAddress, this.MARGIN, y, this.FONT_SIZE_SMALL, false, rgb(0.4, 0.4, 0.4));
      y -= 15;
    }

    // Title
    y -= 5;
    this.drawText(
      pdfDoc,
      page,
      "STATEMENT OF RESULT",
      this.MARGIN,
      y,
      this.FONT_SIZE_SUBHEADING,
      true
    );
    y -= 20;

    // Term, Class, Assessment info
    this.drawText(pdfDoc, page, `Term: ${input.termName}`, this.MARGIN, y, this.FONT_SIZE_NORMAL);
    this.drawText(pdfDoc, page, `Class: ${input.className}`, width / 2, y, this.FONT_SIZE_NORMAL);
    y -= 15;

    this.drawText(pdfDoc, page, `Assessment: ${input.assessmentName}`, this.MARGIN, y, this.FONT_SIZE_NORMAL);
    this.drawText(pdfDoc, page, `Session: ${input.academicYear}`, width / 2, y, this.FONT_SIZE_NORMAL);
    y -= 20;

    return y;
  }

  private static async drawStudentInfo(
    pdfDoc: PDFDocument,
    page: PDFPage,
    y: number,
    input: ReportCardInput,
    width: number
  ): Promise<number> {
    // Student details box
    this.drawText(pdfDoc, page, "STUDENT INFORMATION", this.MARGIN, y, this.FONT_SIZE_SUBHEADING, true);
    y -= 18;

    const boxHeight = 60;
    page.drawRectangle({
      x: this.MARGIN,
      y: y - boxHeight,
      width: width - 2 * this.MARGIN,
      height: boxHeight,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    this.drawText(pdfDoc, page, `Name: ${input.pupilName}`, this.MARGIN + 5, y - 12, this.FONT_SIZE_NORMAL);
    this.drawText(pdfDoc, page, `Admission No.: ${input.admissionNo}`, this.MARGIN + 5, y - 25, this.FONT_SIZE_NORMAL);
    this.drawText(
      pdfDoc,
      page,
      `DOB: ${input.dateOfBirth || "—"} | Gender: ${input.gender || "—"}`,
      this.MARGIN + 5,
      y - 38,
      this.FONT_SIZE_NORMAL
    );
    this.drawText(pdfDoc, page, `Class: ${input.className}`, this.MARGIN + 5, y - 51, this.FONT_SIZE_NORMAL);

    y -= boxHeight + 15;
    return y;
  }

  private static async drawResultsTable(
    pdfDoc: PDFDocument,
    page: PDFPage,
    y: number,
    input: ReportCardInput,
    width: number,
    height: number
  ): Promise<number> {
    this.drawText(pdfDoc, page, "ACADEMIC PERFORMANCE", this.MARGIN, y, this.FONT_SIZE_SUBHEADING, true);
    y -= 18;

    const colWidths = this.getColumnWidths(input.subjects, width);
    const rowHeight = 16;
    let currentY = y;

    // Table header
    page.drawRectangle({
      x: this.MARGIN,
      y: currentY - rowHeight,
      width: width - 2 * this.MARGIN,
      height: rowHeight,
      color: rgb(0.2, 0.2, 0.2),
    });

    let colX = this.MARGIN;
    this.drawText(pdfDoc, page, "Subject", colX + 2, currentY - 12, this.FONT_SIZE_SMALL, true, rgb(1, 1, 1));
    colX += colWidths.subject;

    if (colWidths.ca > 0) {
      this.drawText(pdfDoc, page, "CA", colX + 2, currentY - 12, this.FONT_SIZE_SMALL, true, rgb(1, 1, 1));
      colX += colWidths.ca;
    }
    if (colWidths.test > 0) {
      this.drawText(pdfDoc, page, "Test", colX + 2, currentY - 12, this.FONT_SIZE_SMALL, true, rgb(1, 1, 1));
      colX += colWidths.test;
    }
    if (colWidths.exam > 0) {
      this.drawText(pdfDoc, page, "Exam", colX + 2, currentY - 12, this.FONT_SIZE_SMALL, true, rgb(1, 1, 1));
      colX += colWidths.exam;
    }

    this.drawText(pdfDoc, page, "Total", colX + 2, currentY - 12, this.FONT_SIZE_SMALL, true, rgb(1, 1, 1));
    colX += colWidths.total;

    this.drawText(pdfDoc, page, "Grade", colX + 2, currentY - 12, this.FONT_SIZE_SMALL, true, rgb(1, 1, 1));

    currentY -= rowHeight;

    // Table rows
    input.subjects.forEach((subject, idx) => {
      if (currentY - rowHeight < 50) {
        // New page needed
        const newPage = pdfDoc.addPage([width, height]);
        page = newPage;
        currentY = height - 30;
      }

      colX = this.MARGIN;

      this.drawText(pdfDoc, page, subject.subjectName, colX + 2, currentY - 12, this.FONT_SIZE_NORMAL);
      colX += colWidths.subject;

      if (colWidths.ca > 0) {
        this.drawText(pdfDoc, page, subject.caScore?.toString() || "—", colX + 2, currentY - 12, this.FONT_SIZE_NORMAL);
        colX += colWidths.ca;
      }
      if (colWidths.test > 0) {
        this.drawText(pdfDoc, page, subject.testScore?.toString() || "—", colX + 2, currentY - 12, this.FONT_SIZE_NORMAL);
        colX += colWidths.test;
      }
      if (colWidths.exam > 0) {
        this.drawText(pdfDoc, page, subject.examScore?.toString() || "—", colX + 2, currentY - 12, this.FONT_SIZE_NORMAL);
        colX += colWidths.exam;
      }

      this.drawText(pdfDoc, page, subject.totalScore.toString(), colX + 2, currentY - 12, this.FONT_SIZE_NORMAL, true);
      colX += colWidths.total;

      this.drawText(pdfDoc, page, subject.grade, colX + 2, currentY - 12, this.FONT_SIZE_NORMAL, true);

      // Draw row border
      page.drawLine({
        start: { x: this.MARGIN, y: currentY - rowHeight },
        end: { x: width - this.MARGIN, y: currentY - rowHeight },
        thickness: 0.5,
      });

      currentY -= rowHeight;
    });

    return currentY - 15;
  }

  private static async drawSummary(
    pdfDoc: PDFDocument,
    page: PDFPage,
    y: number,
    input: ReportCardInput,
    width: number
  ): Promise<number> {
    this.drawText(pdfDoc, page, "SUMMARY", this.MARGIN, y, this.FONT_SIZE_SUBHEADING, true);
    y -= 18;

    const boxWidth = (width - 3 * this.MARGIN) / 2;

    // Left box - Overall Summary
    page.drawRectangle({
      x: this.MARGIN,
      y: y - 90,
      width: boxWidth,
      height: 90,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    let boxY = y - 12;
    this.drawText(pdfDoc, page, "OVERALL SUMMARY", this.MARGIN + 5, boxY, this.FONT_SIZE_SMALL, true);
    boxY -= 15;

    this.drawText(pdfDoc, page, `Total Subjects: ${input.subjects.length}`, this.MARGIN + 5, boxY, this.FONT_SIZE_NORMAL);
    boxY -= 12;
    this.drawText(pdfDoc, page, `Average Score: ${input.averageScore.toFixed(1)}%`, this.MARGIN + 5, boxY, this.FONT_SIZE_NORMAL);
    boxY -= 12;
    this.drawText(pdfDoc, page, `Total Score: ${input.totalScore}`, this.MARGIN + 5, boxY, this.FONT_SIZE_NORMAL);
    boxY -= 12;

    if (input.classPosition) {
      this.drawText(
        pdfDoc,
        page,
        `Position: ${input.classPosition}/${input.totalStudents || "—"}`,
        this.MARGIN + 5,
        boxY,
        this.FONT_SIZE_NORMAL
      );
    }

    // Right box - Class Statistics
    const rightX = this.MARGIN + boxWidth + this.MARGIN;
    page.drawRectangle({
      x: rightX,
      y: y - 90,
      width: boxWidth,
      height: 90,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    boxY = y - 12;
    this.drawText(pdfDoc, page, "CLASS STATISTICS", rightX + 5, boxY, this.FONT_SIZE_SMALL, true);
    boxY -= 15;

    this.drawText(pdfDoc, page, `Highest: ${input.highestScore}`, rightX + 5, boxY, this.FONT_SIZE_NORMAL);
    boxY -= 12;
    this.drawText(pdfDoc, page, `Lowest: ${input.lowestScore}`, rightX + 5, boxY, this.FONT_SIZE_NORMAL);
    boxY -= 12;
    this.drawText(pdfDoc, page, `Pass Rate: ${input.passRate.toFixed(1)}%`, rightX + 5, boxY, this.FONT_SIZE_NORMAL);
    boxY -= 12;

    if (input.attendance !== undefined) {
      this.drawText(
        pdfDoc,
        page,
        `Attendance: ${input.attendance}/${input.maxAttendance || "—"}`,
        rightX + 5,
        boxY,
        this.FONT_SIZE_NORMAL
      );
    }

    y -= 105;
    return y;
  }

  private static async drawRemarks(
    pdfDoc: PDFDocument,
    page: PDFPage,
    y: number,
    input: ReportCardInput,
    width: number
  ): Promise<number> {
    if (!input.teacherComment && !input.psychomotor && !input.affective && !input.promotionStatus) {
      return y;
    }

    this.drawText(pdfDoc, page, "REMARKS", this.MARGIN, y, this.FONT_SIZE_SUBHEADING, true);
    y -= 18;

    if (input.psychomotor || input.affective) {
      const boxWidth = (width - 3 * this.MARGIN) / 2;

      if (input.psychomotor) {
        this.drawText(pdfDoc, page, "Psychomotor", this.MARGIN, y - 12, this.FONT_SIZE_SMALL, true);
        this.drawText(pdfDoc, page, input.psychomotor, this.MARGIN + 20, y - 12, this.FONT_SIZE_NORMAL);
      }

      if (input.affective) {
        this.drawText(pdfDoc, page, "Affective", this.MARGIN + boxWidth + this.MARGIN, y - 12, this.FONT_SIZE_SMALL, true);
        this.drawText(pdfDoc, page, input.affective, this.MARGIN + boxWidth + this.MARGIN + 20, y - 12, this.FONT_SIZE_NORMAL);
      }

      y -= 25;
    }

    if (input.teacherComment) {
      this.drawText(pdfDoc, page, "Teacher's Comment:", this.MARGIN, y, this.FONT_SIZE_SMALL, true);
      y -= 12;
      // Wrap text for comment
      const wrappedText = this.wrapText(input.teacherComment, 100);
      wrappedText.forEach((line) => {
        this.drawText(pdfDoc, page, line, this.MARGIN + 10, y, this.FONT_SIZE_NORMAL, false, rgb(0.3, 0.3, 0.3));
        y -= 12;
      });
      y -= 5;
    }

    if (input.promotionStatus) {
      page.drawRectangle({
        x: this.MARGIN,
        y: y - 20,
        width: width - 2 * this.MARGIN,
        height: 20,
        color: rgb(0.9, 0.9, 0.2),
        borderColor: rgb(0, 0, 0),
        borderWidth: 1,
      });
      this.drawText(pdfDoc, page, input.promotionStatus, this.MARGIN + 5, y - 12, this.FONT_SIZE_NORMAL, true);
      y -= 30;
    }

    return y;
  }

  private static drawFooter(pdfDoc: PDFDocument, page: PDFPage, input: ReportCardInput) {
    const { width, height } = page.getSize();

    // Signature lines
    const y = 40;
    const colWidth = (width - 60) / 3;

    this.drawText(pdfDoc, page, "Teacher", 30, y + 15, this.FONT_SIZE_SMALL, true);
    page.drawLine({ start: { x: 30, y: y + 5 }, end: { x: 30 + colWidth - 10, y: y + 5 }, thickness: 1 });

    this.drawText(pdfDoc, page, "Principal", 30 + colWidth, y + 15, this.FONT_SIZE_SMALL, true);
    page.drawLine({
      start: { x: 30 + colWidth, y: y + 5 },
      end: { x: 30 + 2 * colWidth - 10, y: y + 5 },
      thickness: 1,
    });

    this.drawText(pdfDoc, page, `Date: ${new Date().toLocaleDateString()}`, 30 + 2 * colWidth, y + 15, this.FONT_SIZE_SMALL, true);

    // Verification code
    this.drawText(pdfDoc, page, `Verification Code: ${input.pupilId.slice(0, 8).toUpperCase()}`, 30, 20, this.FONT_SIZE_SMALL);
  }

  private static drawText(
    pdfDoc: PDFDocument,
    page: PDFPage,
    text: string,
    x: number,
    y: number,
    fontSize: number,
    bold = false,
    color = rgb(0, 0, 0)
  ) {
    page.drawText(text, {
      x,
      y,
      size: fontSize,
      color,
    });
  }

  private static getColumnWidths(
    subjects: SubjectScore[],
    totalWidth: number
  ): Record<string, number> {
    const hasCA = subjects.some((s) => s.caScore !== undefined);
    const hasTest = subjects.some((s) => s.testScore !== undefined);
    const hasExam = subjects.some((s) => s.examScore !== undefined);

    const availableWidth = totalWidth - 60; // Margins
    const scoreColWidth = 30;
    const totalColWidth = 40;
    const gradeColWidth = 30;

    const numScoreCols = (hasCA ? 1 : 0) + (hasTest ? 1 : 0) + (hasExam ? 1 : 0);
    const scoreColsWidth = numScoreCols * scoreColWidth;

    const subjectColWidth = availableWidth - scoreColsWidth - totalColWidth - gradeColWidth;

    return {
      subject: subjectColWidth,
      ca: hasCA ? scoreColWidth : 0,
      test: hasTest ? scoreColWidth : 0,
      exam: hasExam ? scoreColWidth : 0,
      total: totalColWidth,
      grade: gradeColWidth,
    };
  }

  private static wrapText(text: string, maxCharsPerLine: number): string[] {
    const words = text.split(" ");
    const lines: string[] = [];
    let currentLine = "";

    words.forEach((word) => {
      if ((currentLine + word).length > maxCharsPerLine) {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine += (currentLine ? " " : "") + word;
      }
    });

    if (currentLine) lines.push(currentLine);
    return lines;
  }
}

export default PdfReportGenerator;
