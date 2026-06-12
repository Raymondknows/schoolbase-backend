import { PDFDocument, PDFPage, rgb, degrees, PageSizes } from 'pdf-lib';
import ReportCardService from './report-card.service.js';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

interface ReportCardData {
  student: {
    id: string;
    name: string;
    admissionNo: string | null;
    gender: string | null;
    dateOfBirth: string | null;
    photoUrl: string | null;
  };
  school: {
    id: string;
    name: string;
    address: string | null;
    logoUrl: string | null;
    stampUrl: string | null;
    principalName: string | null;
    principalSignatureUrl: string | null;
    initials: string | null;
  };
  class: { name: string; phase: string };
  term: { name: string; session: string };
  subjects: Array<{
    subjectId: string;
    subjectName: string;
    totalScore: number;
    grade: string;
    subjectPosition: number | null;
    teacherRemark: string | null;
    comment: string | null;
  }>;
  averageScore: number;
  classPosition: number | null;
  totalSubjects: number;
  teacherRemark: string | null;
  principalRemark: string | null;
  statistics: {
    highestScore: number;
    lowestScore: number;
    passRate: number;
  };
}

class PDFReportCardService {
  private prisma: PrismaClient;
  private reportCardService: ReportCardService;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient || new PrismaClient();
    this.reportCardService = new ReportCardService(prismaClient);
  }

  /**
   * Generate PDF for a single report card
   */
  async generateReportCardPDF(
    assessmentId: string,
    pupilId: string,
    schoolId: string
  ): Promise<Uint8Array> {
    // Get report card data
    const reportCard = await this.reportCardService.generateReportCard(
      assessmentId,
      pupilId,
      schoolId
    );

    // Create PDF document (A4 size)
    const pdfDoc = await PDFDocument.create();
    const helvetica = await pdfDoc.embedFont('Helvetica');
    const page = pdfDoc.addPage(PageSizes.A4);
    const { width, height } = page.getSize();

    let yPosition = height - 40;
    const leftMargin = 40;
    const rightMargin = width - 40;
    const contentWidth = rightMargin - leftMargin;
    const lineHeight = 14;

    // Helper functions
    const drawText = (text: string, x: number, y: number, size: number = 11) => {
      page.drawText(text, {
        x,
        y,
        size,
        font: helvetica,
        color: rgb(0, 0, 0),
      });
    };

    const drawBoldText = (text: string, x: number, y: number, size: number = 11) => {
      page.drawText(text, {
        x,
        y,
        size,
        font: helvetica,
        color: rgb(0, 0, 0),
      });
    };

    const drawLine = (y: number) => {
      page.drawLine({
        start: { x: leftMargin, y },
        end: { x: rightMargin, y },
        thickness: 0.5,
        color: rgb(0.5, 0.5, 0.5),
      });
    };

    const drawRect = (x: number, y: number, width: number, height: number) => {
      page.drawRectangle({
        x,
        y,
        width,
        height,
        borderColor: rgb(0, 0, 0),
        borderWidth: 0.5,
      });
    };

    // 1. Header - School Info
    drawBoldText(reportCard.school.name, leftMargin, yPosition, 16);
    yPosition -= lineHeight * 1.5;

    if (reportCard.school.address) {
      drawText(`Address: ${reportCard.school.address}`, leftMargin, yPosition, 9);
      yPosition -= lineHeight;
    }

    drawText('REPORT CARD', leftMargin, yPosition - 10, 14);
    yPosition -= lineHeight * 2;

    drawLine(yPosition);
    yPosition -= 15;

    // 2. Student Info Section
    drawBoldText('STUDENT INFORMATION', leftMargin, yPosition, 11);
    yPosition -= lineHeight;

    const infoFieldWidth = contentWidth / 2;
    const col1X = leftMargin;
    const col2X = leftMargin + infoFieldWidth;

    drawText(`Name: ${reportCard.student.name}`, col1X, yPosition, 10);
    drawText(
      `Admission No: ${reportCard.student.admissionNo || 'N/A'}`,
      col2X,
      yPosition,
      10
    );
    yPosition -= lineHeight;

    drawText(`Class: ${reportCard.class.name}`, col1X, yPosition, 10);
    drawText(
      `Gender: ${reportCard.student.gender || 'N/A'}`,
      col2X,
      yPosition,
      10
    );
    yPosition -= lineHeight;

    drawText(`Term: ${reportCard.term.name}`, col1X, yPosition, 10);
    drawText(`Session: ${reportCard.term.session}`, col2X, yPosition, 10);
    yPosition -= lineHeight * 2;

    drawLine(yPosition);
    yPosition -= 15;

    // 3. Academic Results Section
    drawBoldText('ACADEMIC RESULTS', leftMargin, yPosition, 11);
    yPosition -= lineHeight;

    // Table header
    const tableX = leftMargin;
    const tableColWidths = [contentWidth * 0.35, contentWidth * 0.15, contentWidth * 0.15, contentWidth * 0.15, contentWidth * 0.2];

    const drawTableHeader = () => {
      drawBoldText('Subject', tableX, yPosition, 10);
      drawBoldText('Score', tableX + tableColWidths[0], yPosition, 10);
      drawBoldText('Grade', tableX + tableColWidths[0] + tableColWidths[1], yPosition, 10);
      drawBoldText('Position', tableX + tableColWidths[0] + tableColWidths[1] + tableColWidths[2], yPosition, 10);
      yPosition -= lineHeight;
      drawLine(yPosition);
      yPosition -= 8;
    };

    drawTableHeader();

    // Subject rows
    let maxScores = reportCard.subjects.map((s) => s.totalScore);
    let minScores = reportCard.subjects.map((s) => s.totalScore);

    for (const subject of reportCard.subjects) {
      if (yPosition < 100) {
        // Add new page if not enough space
        const newPage = pdfDoc.addPage(PageSizes.A4);
        yPosition = newPage.getSize().height - 40;
        drawTableHeader();
      }

      drawText(subject.subjectName.substring(0, 20), tableX, yPosition, 9);
      drawText(subject.totalScore.toFixed(2), tableX + tableColWidths[0], yPosition, 9);
      drawText(subject.grade, tableX + tableColWidths[0] + tableColWidths[1], yPosition, 9);
      drawText(
        subject.subjectPosition?.toString() || 'N/A',
        tableX + tableColWidths[0] + tableColWidths[1] + tableColWidths[2],
        yPosition,
        9
      );
      yPosition -= lineHeight;
    }

    yPosition -= 10;
    drawLine(yPosition);
    yPosition -= 15;

    // 4. Summary Section
    drawBoldText('SUMMARY', leftMargin, yPosition, 11);
    yPosition -= lineHeight;

    const summaryCol1 = leftMargin;
    const summaryCol2 = leftMargin + contentWidth / 3;
    const summaryCol3 = leftMargin + (contentWidth * 2) / 3;

    drawText(`Average Score: ${reportCard.averageScore.toFixed(2)}`, summaryCol1, yPosition, 10);
    drawText(`Class Position: ${reportCard.classPosition || 'N/A'}`, summaryCol2, yPosition, 10);
    drawText(`Total Subjects: ${reportCard.totalSubjects}`, summaryCol3, yPosition, 10);
    yPosition -= lineHeight * 2;

    // 5. Remarks Section
    if (reportCard.teacherRemark) {
      drawBoldText('TEACHER REMARK', leftMargin, yPosition, 11);
      yPosition -= lineHeight;
      const maxRemarkLength = 80;
      const remark = reportCard.teacherRemark.substring(0, maxRemarkLength);
      drawText(remark, leftMargin, yPosition, 9);
      yPosition -= lineHeight * 1.5;
    }

    if (reportCard.principalRemark) {
      drawBoldText('PRINCIPAL REMARK', leftMargin, yPosition, 11);
      yPosition -= lineHeight;
      const remark = reportCard.principalRemark.substring(0, 80);
      drawText(remark, leftMargin, yPosition, 9);
      yPosition -= lineHeight * 2;
    }

    // 6. Signature Section
    yPosition -= 20;

    const sigCol1 = leftMargin;
    const sigCol2 = leftMargin + contentWidth / 2;

    drawText('_________________________', sigCol1, yPosition, 9);
    drawText('_________________________', sigCol2, yPosition, 9);
    yPosition -= lineHeight;

    drawText("Teacher's Signature", sigCol1, yPosition, 9);
    drawText("Principal's Signature", sigCol2, yPosition, 9);
    yPosition -= lineHeight;

    drawText(`Date: ${new Date().toLocaleDateString()}`, sigCol1, yPosition, 9);

    // Serialize to bytes
    const pdfBytes = await pdfDoc.save();
    return pdfBytes;
  }

  /**
   * Generate PDFs for all students in an assessment
   * Returns zip file or individual PDFs
   */
  async generateBulkReportCardPDFs(
    assessmentId: string,
    schoolId: string
  ): Promise<Map<string, Uint8Array>> {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId },
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    // Get all students in this assessment
    const results = await this.prisma.result.findMany({
      where: { assessmentId },
      select: { pupilId: true },
      distinct: ['pupilId'],
    });

    const pdfMap = new Map<string, Uint8Array>();

    for (const result of results) {
      try {
        const pdfBytes = await this.generateReportCardPDF(
          assessmentId,
          result.pupilId,
          schoolId
        );

        // Get pupil name for filename
        const pupil = await this.prisma.pupil.findUnique({
          where: { id: result.pupilId },
        });

        const filename = `${pupil?.firstName}_${pupil?.lastName}_${assessmentId}.pdf`;
        pdfMap.set(filename, pdfBytes);
      } catch (error) {
        console.error(`Error generating PDF for pupil ${result.pupilId}:`, error);
      }
    }

    return pdfMap;
  }

  /**
   * Generate class ranking report PDF
   */
  async generateClassRankingPDF(
    assessmentId: string,
    schoolId: string
  ): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.create();
    const helvetica = await pdfDoc.embedFont('Helvetica');
    const page = pdfDoc.addPage(PageSizes.A4);
    const { width, height } = page.getSize();

    let yPosition = height - 40;
    const leftMargin = 40;
    const rightMargin = width - 40;
    const contentWidth = rightMargin - leftMargin;
    const lineHeight = 12;

    // Helper function
    const drawText = (text: string, x: number, y: number, size: number = 11) => {
      page.drawText(text, { x, y, size, font: helvetica, color: rgb(0, 0, 0) });
    };

    const drawBoldText = (text: string, x: number, y: number, size: number = 11) => {
      page.drawText(text, { x, y, size, font: helvetica, color: rgb(0, 0, 0) });
    };

    const drawLine = (y: number) => {
      page.drawLine({
        start: { x: leftMargin, y },
        end: { x: rightMargin, y },
        thickness: 0.5,
        color: rgb(0.5, 0.5, 0.5),
      });
    };

    // Get assessment details
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId },
      include: {
        class: true,
        term: { include: { academicYear: true } },
      },
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    // Header
    drawBoldText(assessment.class?.name || 'Class Report', leftMargin, yPosition, 16);
    yPosition -= lineHeight * 1.5;

    drawText(`Assessment: ${assessment.name}`, leftMargin, yPosition, 11);
    yPosition -= lineHeight;

    drawText(
      `Term: ${assessment.term?.name} - ${assessment.term?.academicYear?.name}`,
      leftMargin,
      yPosition,
      11
    );
    yPosition -= lineHeight * 2;

    drawLine(yPosition);
    yPosition -= 15;

    // Get ranking data
    const rankingData = await this.reportCardService.getReportCardSummaries(
      assessmentId,
      schoolId
    );

    // Table header
    drawBoldText('RANK', leftMargin, yPosition, 10);
    drawBoldText('STUDENT NAME', leftMargin + 60, yPosition, 10);
    drawBoldText('AVE. SCORE', leftMargin + 250, yPosition, 10);
    drawBoldText('GRADE', leftMargin + 330, yPosition, 10);

    yPosition -= lineHeight;
    drawLine(yPosition);
    yPosition -= 10;

    // Rankings
    for (const student of rankingData.summaries) {
      if (yPosition < 80) {
        const newPage = pdfDoc.addPage(PageSizes.A4);
        yPosition = newPage.getSize().height - 40;
      }

      drawText(student.classPosition?.toString() || '-', leftMargin, yPosition, 10);
      drawText(student.pupilName.substring(0, 30), leftMargin + 60, yPosition, 10);
      drawText(student.totalScore?.toFixed(2) || '-', leftMargin + 250, yPosition, 10);
      drawText(student.grade || '-', leftMargin + 330, yPosition, 10);

      yPosition -= lineHeight;
    }

    const pdfBytes = await pdfDoc.save();
    return pdfBytes;
  }
}

export default PDFReportCardService;
