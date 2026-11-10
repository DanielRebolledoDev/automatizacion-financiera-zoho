const assert=require('node:assert/strict');
const {randomUUID,randomInt}=require('node:crypto');
const {resolve}=require('node:path');const {existsSync}=require('node:fs');
async function main(){
  assert.ok(['development','test'].includes(process.env.NODE_ENV));
  const url=new URL(process.env.DATABASE_URL);assert.equal(url.protocol,'mysql:');assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  for(const key of ['ZOHO_WRITE_PAYMENTS_ENABLED','ZOHO_AUTO_SYNC_PAYMENTS_ENABLED'])assert.equal(process.env[key]?.trim(),'false',`${key} debe ser false`);
  const root=[resolve(__dirname,'../dist'),resolve(__dirname,'../dist/src')].find(p=>existsSync(resolve(p,'modules/payments/payments.service.js')));
  const {PrismaClient}=require('@prisma/client');const {PaymentsService}=require(resolve(root,'modules/payments/payments.service.js'));const {calculateRutDv}=require(resolve(root,'common/utils/rut.util.js'));
  const db=new PrismaClient();const ids=[];const originalFetch=globalThis.fetch;
  globalThis.fetch=()=>{throw Error('HTTP prohibido');};
  const service=new PaymentsService(db,{}, {get:(key)=>key==='KHIPU_PROVIDER'?'mock':'false'}, {syncCustomerPaymentToZoho:()=>{throw Error('Zoho prohibido');}});
  async function fixture(conflict){
    const body=String(randomInt(90000000,99999999)),rut=`${body}-${calculateRutDv(body)}`;
    const customer=await db.customer.create({data:{rut,rutNormalized:rut,businessName:`PRUEBA CONFIRMACION TARDIA ${randomUUID()}`,documents:{create:{documentNumber:'TEST-LATE',dueDate:new Date(),totalAmount:1000,outstandingAmount:1000,currency:'CLP',status:'OVERDUE'}}},include:{documents:true}});ids.push(customer.id);
    const doc=customer.documents[0];
    const create=async(status)=>db.payment.create({data:{customerId:customer.id,mode:'TOTAL_DEBT',amount:1000,currency:'CLP',status,idempotencyKey:randomUUID(),khipuPaymentId:`test_late_${randomUUID()}`,documents:{create:{documentId:doc.id,amount:1000}}}});
    const payment=await create('EXPIRED');const other=conflict?await create('PENDING'):null;
    const params={localPaymentId:payment.id,khipuPaymentId:payment.khipuPaymentId,amount:1000,currency:'CLP',payload:{payment_id:payment.khipuPaymentId,transaction_id:payment.id,status:'done',amount:'1000',currency:'CLP'}};
    return {payment,other,doc,params};
  }
  try{
    await db.$connect();
    const safe=await fixture(false);
    await Promise.all([service.markPaymentAsPaidFromKhipuWebhook(safe.params),service.markPaymentAsPaidFromKhipuWebhook(safe.params)]);
    assert.equal((await db.payment.findUniqueOrThrow({where:{id:safe.payment.id}})).status,'PAID');
    assert.equal(await db.paymentEvent.count({where:{paymentId:safe.payment.id,eventType:'payment.paid.real'}}),1);
    assert.equal(await db.paymentAttempt.count({where:{paymentId:safe.payment.id,status:'PAID'}}),1);
    assert.equal((await db.customerDocument.findUniqueOrThrow({where:{id:safe.doc.id}})).outstandingAmount,0);
    console.log('OK: dos confirmaciones concurrentes, un pago aplicado y un evento.');
    const conflict=await fixture(true);await service.markPaymentAsPaidFromKhipuWebhook(conflict.params);await service.markPaymentAsPaidFromKhipuWebhook(conflict.params);
    for(const id of [conflict.payment.id,conflict.other.id])assert.equal((await db.payment.findUniqueOrThrow({where:{id}})).confirmationReviewRequired,true);
    assert.equal((await db.customerDocument.findUniqueOrThrow({where:{id:conflict.doc.id}})).outstandingAmount,1000);
    assert.equal(await db.paymentEvent.count({where:{paymentId:conflict.payment.id,eventType:'payment.confirmation.review_required'}}),1);
    await assert.rejects(service.createPayment({customerId:conflict.payment.customerId,mode:'TOTAL_DEBT'}),e=>e.getStatus?.()===409);
    console.log('OK: conflicto persistido en ambos cobros, saldo intacto y evidencia unica.');
    console.log('PRUEBA MYSQL CORRECTA. Solo datos sinteticos y respuestas Khipu simuladas.');
  }finally{console.log('Clientes de prueba conservados:',ids.join(', '));globalThis.fetch=originalFetch;await db.$disconnect();}
}
main().catch(e=>{console.error('PRUEBA DETENIDA:',e.code||e.name);if(e instanceof assert.AssertionError)console.error(e.message);process.exitCode=1;});
