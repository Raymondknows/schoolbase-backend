import { Router, Response } from 'express';
import { PaymentMethod, PrismaClient } from '@prisma/client';
import { AuthenticatedRequest, requireAccountingAccess, verifyAuth } from '../middleware/roleAuth.js';

const router = Router();
const prisma = new PrismaClient();

const DEFAULT_ACCOUNT_CATEGORIES = {
  INCOME: ['Other Income'],
  EXPENSE: ['Staff Salaries', 'Utilities', 'Maintenance', 'Stationery', 'Transport', 'Admin Expenses', 'Other Expenses'],
} as const;

function isFeeIncomeCategory(categoryName?: string | null) {
  if (!categoryName) return false;

  const normalized = categoryName.toLowerCase();
  return ['school fees', 'tuition fees', 'transport fees', 'exam fees', 'boarding fees', 'registration fees', 'books fees', 'uniform fees'].some((keyword) => normalized.includes(keyword));
}

export function parseAmountMinor(value: unknown) {
  const amount = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isFinite(amount) || amount <= 0 || amount > Number.MAX_SAFE_INTEGER / 100) {
    return null;
  }

  return Math.round(amount * 100);
}

export function parseTransactionDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parsePaymentMethod(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  return typeof value === 'string' && Object.values(PaymentMethod).includes(value as PaymentMethod)
    ? value as PaymentMethod
    : undefined;
}

export function calculateSchoolFinanceSummary({
  monthlyTransactions,
  monthlyPayments,
}: {
  monthlyTransactions: Array<{
    type: 'INCOME' | 'EXPENSE';
    amount: number;
    invoiceId?: string | null;
    description?: string | null;
    category?: { name?: string | null } | null;
  }>;
  monthlyPayments: Array<{ amount: number }>; 
}) {
  const feeIncome = monthlyPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const otherIncome = monthlyTransactions
    .filter((transaction) => transaction.type === 'INCOME' && !transaction.invoiceId && !isFeeIncomeCategory(transaction.category?.name ?? null))
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);

  const expenses = monthlyTransactions
    .filter((transaction) => transaction.type === 'EXPENSE')
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);

  const monthlyIncome = feeIncome + otherIncome;

  return {
    feeIncome,
    otherIncome,
    monthlyIncome,
    monthlyExpenses: expenses,
    cashPosition: monthlyIncome - expenses,
  };
}

async function ensureDefaultAccountCategories(schoolId: string) {
  const existing = await prisma.accountCategory.findMany({
    where: { schoolId },
    select: { type: true, name: true },
  });

  for (const type of Object.keys(DEFAULT_ACCOUNT_CATEGORIES) as Array<keyof typeof DEFAULT_ACCOUNT_CATEGORIES>) {
    for (const name of DEFAULT_ACCOUNT_CATEGORIES[type]) {
      const alreadyExists = existing.some((category) => category.type === type && category.name === name);
      if (!alreadyExists) {
        await prisma.accountCategory.create({
          data: {
            schoolId,
            type,
            name,
            description: `${type === 'INCOME' ? 'Default income' : 'Default expense'} category`,
          },
        });
      }
    }
  }

  const [categories, feeItems] = await Promise.all([
    prisma.accountCategory.findMany({
      where: { schoolId, isActive: true },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    }),
    prisma.feeScheduleItem.findMany({
      where: { schoolId },
      select: { name: true },
      distinct: ['name'],
    }),
  ]);

  const feeNames = new Set(feeItems.map((item) => item.name.trim().toLowerCase()));
  return categories.filter((category) => {
    if (category.type !== 'INCOME') return true;
    return !feeNames.has(category.name.trim().toLowerCase()) && !isFeeIncomeCategory(category.name);
  });
}

async function resolveFeeInvoicesForAcademicContext(schoolId: string, academicYearId?: string, termId?: string) {
  if (!academicYearId && !termId) {
    return { ids: [], invoiceNos: [] };
  }

  const where: Record<string, any> = { schoolId };

  if (termId) {
    where.feeSchedule = { termId };
  }

  if (academicYearId) {
    where.feeSchedule = {
      ...where.feeSchedule,
      term: {
        academicYearId,
      },
    };
  }

  const invoices = await prisma.invoice.findMany({
    where,
    select: { id: true, invoiceNo: true },
  });

  return {
    ids: invoices.map((invoice) => invoice.id),
    invoiceNos: invoices.map((invoice) => invoice.invoiceNo).filter(Boolean),
  };
}

// Middleware: Apply to all routes
router.use(verifyAuth);
router.use(requireAccountingAccess);

/**
 * GET /api/bursar/overview
 * Dashboard overview with cash position, monthly income/expense
 */
router.get('/overview', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const schoolId = req.user?.schoolId;
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const today = new Date();
    const rawStartDate = typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
    const rawEndDate = typeof req.query.endDate === 'string' ? req.query.endDate : undefined;
    const rawAcademicYearId = typeof req.query.academicYearId === 'string' ? req.query.academicYearId : undefined;
    const rawTermId = typeof req.query.termId === 'string' ? req.query.termId : undefined;
    const requestedPage = Number.parseInt(String(req.query.page ?? '1'), 10);
    const requestedLimit = Number.parseInt(String(req.query.limit ?? '10'), 10);
    const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 10;

    const startDate = rawStartDate ? new Date(rawStartDate) : null;
    const endDate = rawEndDate ? new Date(rawEndDate) : null;

    if ((startDate && Number.isNaN(startDate.getTime())) || (endDate && Number.isNaN(endDate.getTime()))) {
      return res.status(400).json({ error: 'Invalid date range' });
    }

    const feePaymentWhere: any = {
      invoice: {
        schoolId,
      },
    };

    if (startDate || endDate) {
      feePaymentWhere.paidAt = {};
      if (startDate) feePaymentWhere.paidAt.gte = startDate;
      if (endDate) feePaymentWhere.paidAt.lte = endDate;
    }

    const feeScheduleFilter: Record<string, any> = {};
    if (rawTermId) {
      feeScheduleFilter.termId = rawTermId;
    }
    if (rawAcademicYearId) {
      feeScheduleFilter.term = {
        academicYearId: rawAcademicYearId,
      };
    }

    if (Object.keys(feeScheduleFilter).length > 0) {
      feePaymentWhere.invoice = {
        ...feePaymentWhere.invoice,
        feeSchedule: feeScheduleFilter,
      };
    }

    const feeInvoices = await resolveFeeInvoicesForAcademicContext(schoolId, rawAcademicYearId, rawTermId);

    const financialTransactionWhere: Record<string, any> = {
      schoolId,
      status: 'POSTED',
    };

    if (startDate || endDate) {
      financialTransactionWhere.transactionDate = {};
      if (startDate) financialTransactionWhere.transactionDate.gte = startDate;
      if (endDate) financialTransactionWhere.transactionDate.lte = endDate;
    }

    if (rawAcademicYearId || rawTermId) {
      financialTransactionWhere.OR = [
        { invoiceId: { in: feeInvoices.ids.length > 0 ? feeInvoices.ids : ['__NO_MATCH__'] } },
        { invoiceId: null, referenceNumber: { in: feeInvoices.invoiceNos.length > 0 ? feeInvoices.invoiceNos : ['__NO_MATCH__'] } },
        { invoiceId: null },
      ];
    }

    const [monthlyTransactions, monthlyPayments, school] = await Promise.all([
      prisma.financialTransaction.findMany({
        where: financialTransactionWhere,
        include: {
          category: true,
        },
      }),
      prisma.payment.findMany({
        where: feePaymentWhere,
        select: {
          amount: true,
          paidAt: true,
        },
      }),
      prisma.school.findUnique({
        where: { id: schoolId },
        select: { currency: true },
      }),
    ]);

    const { feeIncome, otherIncome, monthlyIncome, monthlyExpenses, cashPosition } = calculateSchoolFinanceSummary({
      monthlyTransactions: monthlyTransactions.map((transaction) => ({
        type: transaction.type,
        amount: transaction.amount,
        description: transaction.description,
        invoiceId: transaction.invoiceId,
        category: transaction.category,
      })),
      monthlyPayments: monthlyPayments.map((payment) => ({
        amount: payment.amount,
      })),
    });

    const recentTransactionWhere: Record<string, any> = {
      schoolId,
      status: 'POSTED',
    };

    if (startDate || endDate) {
      recentTransactionWhere.transactionDate = {};
      if (startDate) recentTransactionWhere.transactionDate.gte = startDate;
      if (endDate) recentTransactionWhere.transactionDate.lte = endDate;
    }

    if (rawAcademicYearId || rawTermId) {
      recentTransactionWhere.OR = [
        { invoiceId: { in: feeInvoices.ids.length > 0 ? feeInvoices.ids : ['__NO_MATCH__'] } },
        { invoiceId: null, referenceNumber: { in: feeInvoices.invoiceNos.length > 0 ? feeInvoices.invoiceNos : ['__NO_MATCH__'] } },
        { invoiceId: null },
      ];
    }

    const [recentTransactions, transactionTotal] = await Promise.all([
      prisma.financialTransaction.findMany({
        where: recentTransactionWhere,
        include: {
          category: true,
          createdByUser: {
            select: { name: true, email: true },
          },
        },
        orderBy: { transactionDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.financialTransaction.count({ where: recentTransactionWhere }),
    ]);

    res.json({
      cashPosition,
      feeIncome,
      otherIncome,
      monthlyIncome,
      monthlyExpenses,
      currency: school?.currency || 'NGN',
      recentTransactions,
      transactionTotal,
      transactionPage: page,
      transactionLimit: limit,
      range: {
        startDate: startDate?.toISOString() ?? null,
        endDate: endDate?.toISOString() ?? today.toISOString(),
      },
    });
  } catch (error) {
    console.error('Bursar overview error:', error);
    res.status(500).json({ error: 'Failed to fetch overview' });
  }
});

/**
 * GET /api/bursar/categories
 * List all account categories
 */
router.get('/categories', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const schoolId = req.user?.schoolId;
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const categories = await ensureDefaultAccountCategories(schoolId);
    res.json(categories);
  } catch (error) {
    console.error('Categories fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

/**
 * POST /api/bursar/categories
 * Create a custom account category
 */
router.post('/categories', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const schoolId = req.user?.schoolId;
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const { name, type, description } = req.body ?? {};

    if (!name || !type || !['INCOME', 'EXPENSE'].includes(type)) {
      return res.status(400).json({ error: 'Name and type (INCOME or EXPENSE) are required' });
    }

    const normalizedName = String(name).trim();
    if (!normalizedName) {
      return res.status(400).json({ error: 'Category name cannot be empty' });
    }

    const category = await prisma.accountCategory.upsert({
      where: {
        schoolId_type_name: {
          schoolId,
          type,
          name: normalizedName,
        },
      },
      update: {
        description: description ?? undefined,
        isActive: true,
      },
      create: {
        schoolId,
        type,
        name: normalizedName,
        description,
      },
    });

    res.status(201).json(category);
  } catch (error) {
    console.error('Category creation error:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

/**
 * POST /api/bursar/income
 * Record income entry
 */
router.post('/income', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const schoolId = req.user?.schoolId;
    const userId = req.user?.userId;

    if (!schoolId || !userId) {
      return res.status(400).json({ error: 'Missing required auth data' });
    }

    const {
      categoryId,
      amount,
      description,
      referenceNumber,
      transactionDate,
      paymentMethod,
    } = req.body;

    const amountMinor = parseAmountMinor(amount);
    const parsedDate = parseTransactionDate(transactionDate);
    const normalizedPaymentMethod = parsePaymentMethod(paymentMethod);

    if (!categoryId || amountMinor === null || !parsedDate || normalizedPaymentMethod === undefined) {
      return res.status(400).json({
        error: 'Category, a positive amount, a valid date, and a valid payment method are required',
      });
    }

    // Verify category belongs to school and is for income
    const category = await prisma.accountCategory.findFirst({
      where: {
        id: categoryId,
        schoolId,
        type: 'INCOME',
        isActive: true,
      },
    });

    if (!category) {
      return res.status(404).json({ error: 'Income category not found' });
    }

    const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { currency: true } });

    // Income is posted immediately because it represents money already received.
    const transaction = await prisma.financialTransaction.create({
      data: {
        schoolId,
        categoryId,
        type: 'INCOME',
        amount: amountMinor,
        currency: school?.currency || 'NGN',
        paymentMethod: normalizedPaymentMethod,
        description,
        referenceNumber,
        transactionDate: parsedDate,
        status: 'POSTED',
        createdBy: userId,
        postedAt: new Date(),
        postedBy: userId,
      },
      include: {
        category: true,
      },
    });

    res.status(201).json(transaction);
  } catch (error) {
    console.error('Income creation error:', error);
    res.status(500).json({ error: 'Failed to create income entry' });
  }
});

/**
 * POST /api/bursar/expenses
 * Record expense entry
 */
router.post('/expenses', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const schoolId = req.user?.schoolId;
    const userId = req.user?.userId;

    if (!schoolId || !userId) {
      return res.status(400).json({ error: 'Missing required auth data' });
    }

    const {
      categoryId,
      amount,
      description,
      referenceNumber,
      transactionDate,
      paymentMethod,
    } = req.body;

    const amountMinor = parseAmountMinor(amount);
    const parsedDate = parseTransactionDate(transactionDate);
    const normalizedPaymentMethod = parsePaymentMethod(paymentMethod);

    if (!categoryId || amountMinor === null || !parsedDate || normalizedPaymentMethod === undefined) {
      return res.status(400).json({
        error: 'Category, a positive amount, a valid date, and a valid payment method are required',
      });
    }

    // Verify category belongs to school and is for expenses
    const category = await prisma.accountCategory.findFirst({
      where: {
        id: categoryId,
        schoolId,
        type: 'EXPENSE',
        isActive: true,
      },
    });

    if (!category) {
      return res.status(404).json({ error: 'Expense category not found' });
    }

    const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { currency: true } });

    // Expenses require review before they affect posted cashbook totals.
    const transaction = await prisma.financialTransaction.create({
      data: {
        schoolId,
        categoryId,
        type: 'EXPENSE',
        amount: amountMinor,
        currency: school?.currency || 'NGN',
        paymentMethod: normalizedPaymentMethod,
        description,
        referenceNumber,
        transactionDate: parsedDate,
        status: 'DRAFT',
        createdBy: userId,
      },
      include: {
        category: true,
      },
    });

    res.status(201).json(transaction);
  } catch (error) {
    console.error('Expense creation error:', error);
    res.status(500).json({ error: 'Failed to create expense entry' });
  }
});

/**
 * PATCH /api/bursar/transactions/:id/post
 * Post (approve) a transaction
 */
router.patch('/transactions/:id/post', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const schoolId = req.user?.schoolId;
    const userId = req.user?.userId;
    const { id } = req.params;

    if (!schoolId || !userId) {
      return res.status(400).json({ error: 'Missing required auth data' });
    }

    // Verify transaction belongs to school and is in DRAFT status
    const transaction = await prisma.financialTransaction.findFirst({
      where: {
        id,
        schoolId,
        status: 'DRAFT',
      },
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found or not in DRAFT status' });
    }

    if (transaction.createdBy === userId && req.user?.role !== 'SCHOOL_ADMIN') {
      return res.status(403).json({ error: 'A second staff member or school admin must approve this expense' });
    }

    const updated = await prisma.$transaction(async (transactionClient) => {
      const posted = await transactionClient.financialTransaction.update({
        where: { id },
        data: {
          status: 'POSTED',
          postedAt: new Date(),
          postedBy: userId,
        },
        include: {
          category: true,
        },
      });

      await transactionClient.financialAuditLog.create({
        data: {
          schoolId,
          transactionId: id,
          action: 'TRANSACTION_POSTED',
          previousValues: JSON.stringify({ status: 'DRAFT' }),
          newValues: JSON.stringify({ status: 'POSTED', postedBy: userId }),
          changedBy: userId,
        },
      });

      return posted;
    });

    res.json(updated);
  } catch (error) {
    console.error('Transaction post error:', error);
    res.status(500).json({ error: 'Failed to post transaction' });
  }
});

/**
 * POST /api/bursar/transactions/:id/reverse
 * Reverse a posted transaction without deleting or editing the original.
 */
router.post('/transactions/:id/reverse', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const schoolId = req.user?.schoolId;
    const userId = req.user?.userId;
    const { id } = req.params;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';

    if (!schoolId || !userId) {
      return res.status(400).json({ error: 'Missing required auth data' });
    }
    if (!reason) {
      return res.status(400).json({ error: 'A reversal reason is required' });
    }

    const result = await prisma.$transaction(async (transaction) => {
      const original = await transaction.financialTransaction.findFirst({
        where: { id, schoolId, status: 'POSTED' },
        include: { category: true },
      });

      if (!original) {
        throw new Error('TRANSACTION_NOT_FOUND');
      }

      const reversal = await transaction.financialTransaction.create({
        data: {
          schoolId,
          categoryId: original.categoryId,
          type: original.type,
          amount: -original.amount,
          currency: original.currency,
          paymentMethod: original.paymentMethod,
          description: `Reversal: ${original.description || original.category.name}`,
          referenceNumber: `REVERSAL:${original.id}`,
          transactionDate: new Date(),
          status: 'POSTED',
          createdBy: userId,
          postedAt: new Date(),
          postedBy: userId,
        },
        include: { category: true },
      });

      const updatedOriginal = await transaction.financialTransaction.update({
        where: { id: original.id },
        data: {
          status: 'REVERSED',
          reversalDate: new Date(),
          reversalReason: reason,
          reversedBy: userId,
        },
        include: { category: true },
      });

      await transaction.financialAuditLog.create({
        data: {
          schoolId,
          transactionId: original.id,
          action: 'TRANSACTION_REVERSED',
          previousValues: JSON.stringify({ status: original.status, amount: original.amount }),
          newValues: JSON.stringify({ status: updatedOriginal.status, reversalId: reversal.id, reason }),
          changedBy: userId,
        },
      });

      return { original: updatedOriginal, reversal };
    });

    res.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'TRANSACTION_NOT_FOUND') {
      return res.status(404).json({ error: 'Posted transaction not found or already reversed' });
    }
    console.error('Transaction reversal error:', error);
    res.status(500).json({ error: 'Failed to reverse transaction' });
  }
});

/**
 * GET /api/bursar/cashbook
 * Get chronological transaction ledger
 */
router.get('/cashbook', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const schoolId = req.user?.schoolId;
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const { skip = '0', take = '50', type, status } = req.query;

    const where: any = {
      schoolId,
    };

    if (status === 'ALL') {
      where.status = { in: ['DRAFT', 'POSTED', 'REVERSED', 'VOIDED'] };
    } else if (status === 'DRAFT' || status === 'REVERSED' || status === 'VOIDED') {
      where.status = status;
    } else {
      where.status = 'POSTED';
    }

    if (type === 'INCOME' || type === 'EXPENSE') {
      where.type = type;
    }

    const [transactions, total] = await Promise.all([
      prisma.financialTransaction.findMany({
        where,
        include: {
          category: true,
          createdByUser: {
            select: { name: true, email: true },
          },
        },
        orderBy: { transactionDate: 'desc' },
        skip: parseInt(skip as string, 10),
        take: parseInt(take as string, 10),
      }),
      prisma.financialTransaction.count({ where }),
    ]);

    res.json({
      transactions,
      total,
      skip: parseInt(skip as string, 10),
      take: parseInt(take as string, 10),
    });
  } catch (error) {
    console.error('Cashbook fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch cashbook' });
  }
});

/**
 * GET /api/bursar/reports/income-expense
 * Income vs Expense report
 */
router.get('/reports/income-expense', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const schoolId = req.user?.schoolId;
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const { startDate, endDate } = req.query;

    const where: any = {
      schoolId,
      status: 'POSTED',
    };

    if (startDate && endDate) {
      where.transactionDate = {
        gte: new Date(startDate as string),
        lte: new Date(endDate as string),
      };
    }

    const transactions = await prisma.financialTransaction.findMany({
      where,
      include: {
        category: true,
      },
    });

    // Group by category and calculate totals
    const incomeByCategory: Record<string, number> = {};
    const expenseByCategory: Record<string, number> = {};
    let totalIncome = 0;
    let totalExpenses = 0;

    transactions.forEach(t => {
      const categoryName = t.category.name;
      if (t.type === 'INCOME') {
        incomeByCategory[categoryName] = (incomeByCategory[categoryName] || 0) + t.amount;
        totalIncome += t.amount;
      } else {
        expenseByCategory[categoryName] = (expenseByCategory[categoryName] || 0) + t.amount;
        totalExpenses += t.amount;
      }
    });

    res.json({
      incomeByCategory,
      expenseByCategory,
      totalIncome,
      totalExpenses,
      netPosition: totalIncome - totalExpenses,
    });
  } catch (error) {
    console.error('Report generation error:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

export default router;
