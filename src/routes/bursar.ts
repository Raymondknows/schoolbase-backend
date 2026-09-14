import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthenticatedRequest, requireBursar, verifyAuth } from '../middleware/roleAuth.js';

const router = Router();
const prisma = new PrismaClient();

const DEFAULT_ACCOUNT_CATEGORIES = {
  INCOME: ['School Fees', 'Tuition Fees', 'Transport Fees', 'Exam Fees', 'Other Income'],
  EXPENSE: ['Staff Salaries', 'Utilities', 'Maintenance', 'Stationery', 'Transport', 'Admin Expenses', 'Other Expenses'],
} as const;

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

  return prisma.accountCategory.findMany({
    where: {
      schoolId,
      isActive: true,
    },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
  });
}

// Middleware: Apply to all routes
router.use(verifyAuth);
router.use(requireBursar);

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
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    
    // Fetch transactions for current month
    const monthlyTransactions = await prisma.financialTransaction.findMany({
      where: {
        schoolId,
        status: 'POSTED',
        transactionDate: {
          gte: firstDayOfMonth,
          lte: today,
        },
      },
      include: {
        category: true,
      },
    });

    // Calculate totals
    const income = monthlyTransactions
      .filter(t => t.type === 'INCOME')
      .reduce((sum, t) => sum + t.amount, 0);

    const expenses = monthlyTransactions
      .filter(t => t.type === 'EXPENSE')
      .reduce((sum, t) => sum + t.amount, 0);

    const cashPosition = income - expenses;

    // Get outstanding student fees
    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { currency: true },
    });

    // Get recent transactions
    const recentTransactions = await prisma.financialTransaction.findMany({
      where: {
        schoolId,
        status: 'POSTED',
      },
      include: {
        category: true,
        createdByUser: {
          select: { name: true, email: true },
        },
      },
      orderBy: { transactionDate: 'desc' },
      take: 10,
    });

    res.json({
      cashPosition,
      monthlyIncome: income,
      monthlyExpenses: expenses,
      currency: school?.currency || 'NGN',
      recentTransactions,
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
    } = req.body;

    if (!categoryId || !amount || !transactionDate) {
      return res.status(400).json({
        error: 'Missing required fields: categoryId, amount, transactionDate',
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

    // Create transaction as posted so the dashboard/cashbook immediately reflect the entry.
    const transaction = await prisma.financialTransaction.create({
      data: {
        schoolId,
        categoryId,
        type: 'INCOME',
        amount: Math.round(parseFloat(amount) * 100),
        description,
        referenceNumber,
        transactionDate: new Date(transactionDate),
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
    } = req.body;

    if (!categoryId || !amount || !transactionDate) {
      return res.status(400).json({
        error: 'Missing required fields: categoryId, amount, transactionDate',
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

    // Create transaction as posted so the dashboard/cashbook immediately reflect the entry.
    const transaction = await prisma.financialTransaction.create({
      data: {
        schoolId,
        categoryId,
        type: 'EXPENSE',
        amount: Math.round(parseFloat(amount) * 100),
        description,
        referenceNumber,
        transactionDate: new Date(transactionDate),
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

    // Update to POSTED
    const updated = await prisma.financialTransaction.update({
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

    res.json(updated);
  } catch (error) {
    console.error('Transaction post error:', error);
    res.status(500).json({ error: 'Failed to post transaction' });
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

    const { skip = '0', take = '50', type } = req.query;

    const where: any = {
      schoolId,
      status: 'POSTED',
    };

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
