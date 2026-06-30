import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "../../db/types";
import type { ChangeSink } from "./sink";
import {
  NotFoundError,
  createAccount,
  createInvoice,
  deleteInvoice,
  getAccount,
  getInvoice,
  recordPayment,
  updateAccount,
  updateInvoice,
} from "./service";

const createBody = z.object({
  customerName: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
  docNumber: z.string().min(1).optional(),
  currency: z.string().length(3).optional(),
});
const updateBody = z.object({
  customerName: z.string().min(1).optional(),
  amountCents: z.number().int().nonnegative().optional(),
});
const paymentBody = z.object({ amountCents: z.number().int().positive() });
const createAccountBody = z.object({
  name: z.string().min(1),
  acctType: z.string().min(1),
  acctNum: z.string().min(1).optional(),
  active: z.boolean().optional(),
});
const updateAccountBody = z.object({
  name: z.string().min(1).optional(),
  acctType: z.string().min(1).optional(),
  acctNum: z.string().min(1).optional(),
  active: z.boolean().optional(),
});
const idParam = z.object({ id: z.string().min(1) });

// The simulated internal invoicing system's API. Money is always integer cents.
export function registerInternalRoutes(
  app: FastifyInstance,
  deps: { db: Database; sink: ChangeSink },
): void {
  const { db, sink } = deps;

  app.post("/internal/invoices", async (req, reply) => {
    const body = createBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const invoice = await createInvoice(db, sink, body.data);
    return reply.code(201).send(invoice);
  });

  app.get("/internal/invoices/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const invoice = await getInvoice(db, id);
    if (!invoice) return reply.code(404).send({ error: "not found" });
    return invoice;
  });

  app.patch("/internal/invoices/:id", async (req, reply) => {
    const body = updateBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const { id } = idParam.parse(req.params);
    try {
      return await updateInvoice(db, sink, id, body.data);
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
      throw err;
    }
  });

  app.post("/internal/invoices/:id/payments", async (req, reply) => {
    const body = paymentBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const { id } = idParam.parse(req.params);
    try {
      const result = await recordPayment(db, sink, id, body.data.amountCents);
      return reply.code(201).send(result);
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
      throw err;
    }
  });

  app.delete("/internal/invoices/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    try {
      return await deleteInvoice(db, sink, id);
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
      throw err;
    }
  });

  app.post("/internal/accounts", async (req, reply) => {
    const body = createAccountBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const account = await createAccount(db, sink, body.data);
    return reply.code(201).send(account);
  });

  app.get("/internal/accounts/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const account = await getAccount(db, id);
    if (!account) return reply.code(404).send({ error: "not found" });
    return account;
  });

  app.patch("/internal/accounts/:id", async (req, reply) => {
    const body = updateAccountBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const { id } = idParam.parse(req.params);
    try {
      return await updateAccount(db, sink, id, body.data);
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
      throw err;
    }
  });
}
