import {
  CustomerStatus,
  DocumentStatus,
  DocumentType,
  PrismaClient,
} from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const existingValidCustomer = await prisma.customer.findUnique({
    where: {
      rutNormalized: '76123456-0',
    },
  });

  if (!existingValidCustomer) {
    await prisma.customer.updateMany({
      where: {
        rutNormalized: '76123456-7',
      },
      data: {
        rut: '76.123.456-0',
        rutNormalized: '76123456-0',
      },
    });
  }
  const customer = await prisma.customer.upsert({
    where: {
      rutNormalized: '76123456-0',
    },
    update: {
      rut: '76.123.456-0',
      businessName: 'Empresa Demo SpA',
      email: 'contacto@empresademo.cl',
      phone: '+56 9 1234 5678',
      zohoCustomerId: 'ZOHO-CUSTOMER-DEMO-001',
      status: CustomerStatus.ACTIVE,
    },
    create: {
      rut: '76.123.456-0',
      rutNormalized: '76123456-0',
      businessName: 'Empresa Demo SpA',
      email: 'contacto@empresademo.cl',
      phone: '+56 9 1234 5678',
      zohoCustomerId: 'ZOHO-CUSTOMER-DEMO-001',
      status: CustomerStatus.ACTIVE,
    },
  });

  const documents = [
    {
      documentNumber: 'F-1001',
      zohoDocumentId: 'ZOHO-DOC-DEMO-1001',
      documentType: DocumentType.INVOICE,
      issueDate: new Date('2026-04-15T00:00:00.000Z'),
      dueDate: new Date('2026-05-15T00:00:00.000Z'),
      totalAmount: 120_000,
      outstandingAmount: 120_000,
      status: DocumentStatus.OVERDUE,
    },
    {
      documentNumber: 'F-1002',
      zohoDocumentId: 'ZOHO-DOC-DEMO-1002',
      documentType: DocumentType.INVOICE,
      issueDate: new Date('2026-05-01T00:00:00.000Z'),
      dueDate: new Date('2026-06-01T00:00:00.000Z'),
      totalAmount: 80_000,
      outstandingAmount: 80_000,
      status: DocumentStatus.OVERDUE,
    },
    {
      documentNumber: 'F-1003',
      zohoDocumentId: 'ZOHO-DOC-DEMO-1003',
      documentType: DocumentType.INVOICE,
      issueDate: new Date('2026-06-01T00:00:00.000Z'),
      dueDate: new Date('2026-06-30T00:00:00.000Z'),
      totalAmount: 150_000,
      outstandingAmount: 150_000,
      status: DocumentStatus.PENDING,
    },
    {
      documentNumber: 'F-1004',
      zohoDocumentId: 'ZOHO-DOC-DEMO-1004',
      documentType: DocumentType.INVOICE,
      issueDate: new Date('2026-05-20T00:00:00.000Z'),
      dueDate: new Date('2026-07-10T00:00:00.000Z'),
      totalAmount: 200_000,
      outstandingAmount: 75_000,
      status: DocumentStatus.PARTIALLY_PAID,
    },
    {
      documentNumber: 'F-1005',
      zohoDocumentId: 'ZOHO-DOC-DEMO-1005',
      documentType: DocumentType.INVOICE,
      issueDate: new Date('2026-03-10T00:00:00.000Z'),
      dueDate: new Date('2026-04-10T00:00:00.000Z'),
      totalAmount: 50_000,
      outstandingAmount: 0,
      status: DocumentStatus.PAID,
    },
  ];

  for (const document of documents) {
    await prisma.customerDocument.upsert({
      where: {
        customerId_documentNumber: {
          customerId: customer.id,
          documentNumber: document.documentNumber,
        },
      },
      update: {
        zohoDocumentId: document.zohoDocumentId,
        documentType: document.documentType,
        issueDate: document.issueDate,
        dueDate: document.dueDate,
        totalAmount: document.totalAmount,
        outstandingAmount: document.outstandingAmount,
        status: document.status,
        currency: 'CLP',
      },
      create: {
        customerId: customer.id,
        zohoDocumentId: document.zohoDocumentId,
        documentType: document.documentType,
        documentNumber: document.documentNumber,
        issueDate: document.issueDate,
        dueDate: document.dueDate,
        totalAmount: document.totalAmount,
        outstandingAmount: document.outstandingAmount,
        status: document.status,
        currency: 'CLP',
      },
    });
  }

  console.log('Seed ejecutado correctamente.');
  console.log(`Cliente creado/actualizado: ${customer.businessName}`);
  console.log(`RUT de prueba: ${customer.rut}`);
  console.log(`Documentos cargados: ${documents.length}`);
}

main()
  .catch((error) => {
    console.error('Error ejecutando seed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
