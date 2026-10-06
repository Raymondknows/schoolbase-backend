import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { ID_CARD_TEMPLATES, type IdCardOrientation } from '../src/services/id-card-pricing.ts';
import { generateIdCardA4SheetPdf, generateIdCardPdf, type IdCardRenderSnapshot } from '../src/services/id-card-pdf.ts';

const sample: Omit<IdCardRenderSnapshot, 'templateId' | 'orientation'> = {
  school: { name: 'Greenfield Academy', initials: 'GA', primaryColor: '#0A6670' },
  students: [{ id: 'sample-student', firstName: 'Ada', middleName: null, lastName: 'Okafor', admissionNo: 'GA-001', className: 'JSS 1 A' }],
};

describe('ID card PDF layout', () => {
  for (const [templateId, template] of Object.entries(ID_CARD_TEMPLATES)) {
    it(`renders ${template.label} at CR80 dimensions in portrait and landscape`, async () => {
      for (const orientation of ['PORTRAIT', 'LANDSCAPE'] as const satisfies readonly IdCardOrientation[]) {
        const bytes = await generateIdCardPdf({ ...sample, templateId, orientation });
        const document = await PDFDocument.load(bytes);
        const [page] = document.getPages();
        assert.equal(document.getPageCount(), 1);
        assert.equal(Math.round(page.getWidth() * 100) / 100, orientation === 'PORTRAIT' ? 153.5 : 243.4);
        assert.equal(Math.round(page.getHeight() * 100) / 100, orientation === 'PORTRAIT' ? 243.4 : 153.5);
      }
    });
  }

  it('uses each template default orientation when old snapshots have no layout field', async () => {
    for (const [templateId, template] of Object.entries(ID_CARD_TEMPLATES)) {
      const bytes = await generateIdCardPdf({ ...sample, templateId });
      const document = await PDFDocument.load(bytes);
      const [page] = document.getPages();
      const portrait = template.defaultOrientation === 'PORTRAIT';
      assert.equal(page.getWidth() < page.getHeight(), portrait);
    }
  });

  it('renders generic Parent Portal QR backs without adding student data to the QR URL', async () => {
    const bytes = await generateIdCardPdf({
      ...sample,
      templateId: 'modernInstitution',
      orientation: 'LANDSCAPE',
      parentPortalQrUrl: 'https://schoolbase.live/parent/login?schoolSlug=greenfield-academy',
    });
    const document = await PDFDocument.load(bytes);
    assert.equal(document.getPageCount(), 2);
    assert.deepEqual(document.getPages().map((page) => [page.getWidth(), page.getHeight()]), [[243.4, 153.5], [243.4, 153.5]]);
  });

  it('imposes CR80 cards on exact A4 sheets and keeps duplex fronts and backs on separate aligned sheets', async () => {
    const base = { ...sample, templateId: 'modernInstitution', orientation: 'LANDSCAPE' as const };
    const singleSheet = await PDFDocument.load(await generateIdCardA4SheetPdf(base));
    assert.equal(singleSheet.getPageCount(), 1);
    assert.equal(Math.round(singleSheet.getPage(0).getWidth()), 595);
    assert.equal(Math.round(singleSheet.getPage(0).getHeight()), 842);

    const duplexSheets = await PDFDocument.load(await generateIdCardA4SheetPdf({
      ...base,
      parentPortalQrUrl: 'https://schoolbase.live/parent/login?schoolSlug=greenfield-academy',
      students: [sample.students[0], { ...sample.students[0], id: 'sample-student-2', admissionNo: 'GA-002' }],
    }));
    assert.equal(duplexSheets.getPageCount(), 2);
    for (const page of duplexSheets.getPages()) {
      assert.equal(Math.round(page.getWidth()), 595);
      assert.equal(Math.round(page.getHeight()), 842);
    }
  });
});
