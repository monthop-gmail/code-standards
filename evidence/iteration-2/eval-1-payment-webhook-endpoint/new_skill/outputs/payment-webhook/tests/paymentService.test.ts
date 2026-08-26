import { describe, expect, it } from 'vitest';
import type { Logger } from '../src/logger.js';
import type { MarkOrderPaidInput, Order, OrderRepository, OrderStatus } from '../src/payments/orderRepository.js';
import { processPaymentSucceeded, type PaymentServiceDeps, type PaymentSucceededEvent } from '../src/payments/paymentService.js';

const PAID_AT = new Date('2026-08-26T10:00:00.000Z');

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: '8f1b9b6e-0f3e-4a4e-9a4a-2c9f0f2f8c11',
    customerEmail: 'somchai@example.com',
    customerName: 'สมชาย ใจดี',
    amountMinorUnits: 129_900,
    currency: 'THB',
    status: 'pending',
    ...overrides,
  };
}

function makeEvent(overrides: Partial<PaymentSucceededEvent> = {}): PaymentSucceededEvent {
  return {
    eventId: 'evt_01',
    eventType: 'payment.succeeded',
    orderId: '8f1b9b6e-0f3e-4a4e-9a4a-2c9f0f2f8c11',
    paymentReference: 'chrg_test_123',
    amountMinorUnits: 129_900,
    currency: 'THB',
    ...overrides,
  };
}

interface HarnessOptions {
  readonly order?: Order | null;
  readonly eventAlreadyProcessed?: boolean;
  /** จำลอง race: มี transaction อื่นอัปเดต order ไปก่อน */
  readonly markOrderPaidReturns?: boolean;
  readonly emailFails?: boolean;
  readonly markEmailSentFails?: boolean;
}

interface Harness {
  readonly deps: PaymentServiceDeps;
  readonly calls: {
    recordedEvents: string[];
    markPaidInputs: MarkOrderPaidInput[];
    emailedOrderIds: string[];
    emailSentMarks: string[];
    committed: boolean;
    rolledBack: boolean;
  };
}

function createHarness(options: HarnessOptions = {}): Harness {
  const calls: Harness['calls'] = {
    recordedEvents: [],
    markPaidInputs: [],
    emailedOrderIds: [],
    emailSentMarks: [],
    committed: false,
    rolledBack: false,
  };

  const order = options.order === undefined ? makeOrder() : options.order;

  const repository: OrderRepository = {
    recordWebhookEvent: async (eventId) => {
      calls.recordedEvents.push(eventId);
      return options.eventAlreadyProcessed !== true;
    },
    findOrderForUpdate: async () => order,
    markOrderPaid: async (input) => {
      calls.markPaidInputs.push(input);
      return options.markOrderPaidReturns ?? true;
    },
  };

  const deps: PaymentServiceDeps = {
    runInTransaction: async (fn) => {
      try {
        const result = await fn(repository);
        calls.committed = true;
        return result;
      } catch (error) {
        calls.rolledBack = true;
        throw error;
      }
    },
    sendOrderConfirmationEmail: async (target) => {
      if (options.emailFails === true) throw new Error('smtp unavailable');
      calls.emailedOrderIds.push(target.id);
    },
    markConfirmationEmailSent: async (orderId) => {
      if (options.markEmailSentFails === true) throw new Error('db unavailable');
      calls.emailSentMarks.push(orderId);
    },
    logger: silentLogger,
    now: () => PAID_AT,
  };

  return { deps, calls };
}

describe('processPaymentSucceeded', () => {
  it('อัปเดต order เป็น paid แล้วส่งอีเมลยืนยันหนึ่งครั้ง', async () => {
    const { deps, calls } = createHarness();

    const result = await processPaymentSucceeded(deps, makeEvent());

    expect(result).toMatchObject({ outcome: 'processed', confirmationEmailSent: true });
    expect(calls.markPaidInputs).toEqual([
      {
        orderId: '8f1b9b6e-0f3e-4a4e-9a4a-2c9f0f2f8c11',
        paymentReference: 'chrg_test_123',
        paidAt: PAID_AT,
      },
    ]);
    expect(calls.emailedOrderIds).toHaveLength(1);
    expect(calls.emailSentMarks).toHaveLength(1);
    expect(calls.committed).toBe(true);
  });

  it('ยิง event เดิมซ้ำ ไม่อัปเดตและไม่ส่งอีเมลซ้ำ', async () => {
    const { deps, calls } = createHarness({ eventAlreadyProcessed: true });

    const result = await processPaymentSucceeded(deps, makeEvent());

    expect(result).toEqual({ outcome: 'duplicate_event' });
    expect(calls.markPaidInputs).toHaveLength(0);
    expect(calls.emailedOrderIds).toHaveLength(0);
    expect(calls.committed).toBe(true);
  });

  it('ไม่พบ order → rollback เพื่อให้ retry ของ gateway ยังมีโอกาสสำเร็จ', async () => {
    const { deps, calls } = createHarness({ order: null });

    const result = await processPaymentSucceeded(deps, makeEvent());

    expect(result).toEqual({ outcome: 'order_not_found' });
    expect(calls.rolledBack).toBe(true);
    expect(calls.committed).toBe(false);
    expect(calls.emailedOrderIds).toHaveLength(0);
  });

  it('ยอดเงินไม่ตรงกับ order → ไม่อัปเดตเป็น paid และ rollback', async () => {
    const { deps, calls } = createHarness();

    const result = await processPaymentSucceeded(deps, makeEvent({ amountMinorUnits: 100 }));

    expect(result).toEqual({ outcome: 'amount_mismatch' });
    expect(calls.markPaidInputs).toHaveLength(0);
    expect(calls.rolledBack).toBe(true);
    expect(calls.emailedOrderIds).toHaveLength(0);
  });

  it('สกุลเงินไม่ตรงกับ order → ไม่อัปเดตเป็น paid', async () => {
    const { deps, calls } = createHarness();

    const result = await processPaymentSucceeded(deps, makeEvent({ currency: 'USD' }));

    expect(result).toEqual({ outcome: 'amount_mismatch' });
    expect(calls.markPaidInputs).toHaveLength(0);
  });

  it('order ที่จ่ายแล้ว ไม่ส่งอีเมลซ้ำ', async () => {
    const { deps, calls } = createHarness({ order: makeOrder({ status: 'paid' }) });

    const result = await processPaymentSucceeded(deps, makeEvent());

    expect(result).toEqual({ outcome: 'order_already_paid' });
    expect(calls.markPaidInputs).toHaveLength(0);
    expect(calls.emailedOrderIds).toHaveLength(0);
  });

  it.each<OrderStatus>(['cancelled', 'refunded', 'failed'])(
    'order สถานะ %s ไม่ถูกอัปเดตเป็น paid',
    async (status) => {
      const { deps, calls } = createHarness({ order: makeOrder({ status }) });

      const result = await processPaymentSucceeded(deps, makeEvent());

      expect(result).toEqual({ outcome: 'order_not_payable', status });
      expect(calls.markPaidInputs).toHaveLength(0);
      expect(calls.emailedOrderIds).toHaveLength(0);
    },
  );

  it('แพ้ race ตอน update (มีคนอัปเดตไปก่อน) → ไม่ส่งอีเมลซ้ำ', async () => {
    const { deps, calls } = createHarness({ markOrderPaidReturns: false });

    const result = await processPaymentSucceeded(deps, makeEvent());

    expect(result).toEqual({ outcome: 'order_already_paid' });
    expect(calls.emailedOrderIds).toHaveLength(0);
  });

  it('ส่งอีเมลไม่สำเร็จ ต้องไม่ทำให้การบันทึกว่าจ่ายแล้วล้มตาม', async () => {
    const { deps, calls } = createHarness({ emailFails: true });

    const result = await processPaymentSucceeded(deps, makeEvent());

    expect(result).toMatchObject({ outcome: 'processed', confirmationEmailSent: false });
    expect(calls.committed).toBe(true);
    expect(calls.markPaidInputs).toHaveLength(1);
    expect(calls.emailSentMarks).toHaveLength(0);
  });

  it('บันทึกสถานะอีเมลไม่สำเร็จ ก็ยังตอบว่าประมวลผลสำเร็จ', async () => {
    const { deps } = createHarness({ markEmailSentFails: true });

    const result = await processPaymentSucceeded(deps, makeEvent());

    expect(result).toMatchObject({ outcome: 'processed', confirmationEmailSent: false });
  });

  it('error ที่ไม่ใช่กรณีที่คาดไว้ (DB ล่ม) ต้องเด้งขึ้นไปให้ชั้นบนจัดการ', async () => {
    const { deps } = createHarness();
    const failingDeps: PaymentServiceDeps = {
      ...deps,
      runInTransaction: () => Promise.reject(new Error('connection terminated')),
    };

    await expect(processPaymentSucceeded(failingDeps, makeEvent())).rejects.toThrow('connection terminated');
  });
});
