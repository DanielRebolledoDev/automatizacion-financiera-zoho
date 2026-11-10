const assert = require('node:assert/strict');
const { test: check } = require('node:test');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');
const root = [resolve(__dirname,'../dist'),resolve(__dirname,'../dist/src')].find(p=>existsSync(resolve(p,'modules/payments/payments.service.js')));
assert.ok(root,'Ejecuta npm run build.');
const { PaymentsService }=require(resolve(root,'modules/payments/payments.service.js'));
function fixture(status='EXPIRED') {
  const record={id:'pay',customerId:'customer',mode:'TOTAL_DEBT',status,amount:1000,currency:'CLP',khipuPaymentId:'real_khipu',confirmationReviewRequired:false,confirmationReviewReason:null,
    zohoSyncStatus:'NOT_SYNCED',zohoCustomerPaymentId:null,zohoSyncRemotePaymentId:null,zohoSyncAttemptId:null,zohoSyncedAt:null,zohoSyncStartedAt:null,zohoSyncOrganizationId:null,zohoSyncPayload:null,zohoSyncError:null,
    documents:[{documentId:'doc',amount:1000,document:{id:'doc',customerId:'customer',currency:'CLP',outstandingAmount:1000,status:'OVERDUE'}}]};
  let state={payment:record,others:[],events:[],attempts:[]};
  let syncs=0, failEvent=false, failDoc=false;
  const copy=()=>structuredClone(state.payment);
  const tx={
    $queryRaw:async()=>[{id:'customer'}],
    payment:{
      findUniqueOrThrow:async()=>copy(),
      findMany:async()=>state.others,
      updateMany:async({where,data})=>{if(where.id.in.includes('pay'))Object.assign(state.payment,data);for(const p of state.others)if(where.id.in.includes(p.id))Object.assign(p,data);return{count:1};},
      update:async({data})=>{Object.assign(state.payment,data);return copy();},
    },
    customerDocument:{updateMany:async({data})=>{if(failDoc)return{count:0};Object.assign(state.payment.documents[0].document,data);return{count:1};}},
    paymentEvent:{
      findUnique:async({where})=>state.events.find(e=>e.externalEventId===where.externalEventId)??null,
      upsert:async({where,create})=>{if(failEvent)throw Error('event failed');if(!state.events.some(e=>e.externalEventId===where.externalEventId))state.events.push(create);return create;},
      create:async({data})=>{if(failEvent)throw Error('event failed');state.events.push(data);return data;},
    },
    paymentAttempt:{create:async({data})=>{state.attempts.push(data);return data;}},
  };
  const prisma={payment:{findUnique:async()=>copy()},$transaction:async(fn)=>{const before=structuredClone(state);try{return await fn(tx);}catch(e){state=before;throw e;}}};
  const service=new PaymentsService(prisma,{}, {get:()=> 'false'},{});
  service.tryAutoSyncPaidPaymentWithZoho=async()=>{syncs++;return{sentToZoho:false};};
  const params={localPaymentId:'pay',khipuPaymentId:'real_khipu',amount:1000,currency:'CLP',payload:{payment_id:'real_khipu',transaction_id:'pay',status:'done',amount:'1000.00',currency:'CLP'}};
  return {service,params,tx,state:()=>state,syncs:()=>syncs,failEvent:()=>{failEvent=true;},failDoc:()=>{failDoc=true;}};
}
for(const status of ['EXPIRED','CANCELLED','FAILED']) {
  check(`${status} sin conflicto: confirma exactamente una vez`,async()=>{
    const f=fixture(status);const first=await f.service.markPaymentAsPaidFromKhipuWebhook(f.params);
    assert.equal(first.payment.status,'PAID');assert.equal(f.state().payment.documents[0].document.outstandingAmount,0);
    const again=await f.service.markPaymentAsPaidFromKhipuWebhook(f.params);
    assert.equal(again.alreadyProcessed,true);assert.equal(f.state().events.length,1);assert.equal(f.state().attempts.length,1);assert.equal(f.syncs(),1);
  });
}
check('otro cobro: preserva saldo y estado, bloquea ambos y guarda evidencia una vez',async()=>{
  const f=fixture();f.state().others.push({id:'other',status:'PENDING'});
  const one=await f.service.markPaymentAsPaidFromKhipuWebhook(f.params);
  assert.equal(one.payment.status,'REVIEW_REQUIRED');assert.equal(f.state().payment.status,'EXPIRED');
  assert.equal(f.state().payment.documents[0].document.outstandingAmount,1000);assert.equal(f.state().others[0].confirmationReviewRequired,true);
  await f.service.markPaymentAsPaidFromKhipuWebhook(f.params);
  assert.equal(f.state().events.length,1);assert.equal(f.state().events[0].processed,false);assert.equal(f.syncs(),0);assert.equal(f.state().attempts.length,0);
});
for(const [field,value] of [['outstandingAmount',500],['currency','USD'],['status','VOID'],['customerId','other']]) {
  check(`documento distinto ${field}: revision sin aplicar saldo`,async()=>{
    const f=fixture();f.state().payment.documents[0].document[field]=value;
    const r=await f.service.markPaymentAsPaidFromKhipuWebhook(f.params);
    assert.equal(r.payment.status,'REVIEW_REQUIRED');assert.equal(f.syncs(),0);
  });
}
check('intento previo Zoho: no envia ni modifica saldo',async()=>{
  const f=fixture();f.state().payment.zohoSyncAttemptId='attempt';
  assert.equal((await f.service.markPaymentAsPaidFromKhipuWebhook(f.params)).payment.status,'REVIEW_REQUIRED');assert.equal(f.syncs(),0);
});
check('revision persistente no se libera aunque desaparezca el conflicto',async()=>{
  const f=fixture();f.state().others.push({id:'other'});await f.service.markPaymentAsPaidFromKhipuWebhook(f.params);
  f.state().others=[];
  assert.equal((await f.service.markPaymentAsPaidFromKhipuWebhook(f.params)).payment.status,'REVIEW_REQUIRED');assert.equal(f.syncs(),0);
});
check('fallo guardando evento revierte pago y documentos; no inicia sync',async()=>{
  const f=fixture();f.failEvent();await assert.rejects(f.service.markPaymentAsPaidFromKhipuWebhook(f.params));
  assert.equal(f.state().payment.status,'EXPIRED');assert.equal(f.state().payment.documents[0].document.outstandingAmount,1000);assert.equal(f.syncs(),0);
});
check('saldo cambia durante actualizacion: rollback sin confirmar',async()=>{
  const f=fixture();f.failDoc();await assert.rejects(f.service.markPaymentAsPaidFromKhipuWebhook(f.params));assert.equal(f.state().payment.status,'EXPIRED');assert.equal(f.syncs(),0);
});
check('respuesta API no done: rechaza sin evidencia falsa',async()=>{
  const f=fixture();f.params.payload.status='pending';await assert.rejects(f.service.markPaymentAsPaidFromKhipuWebhook(f.params));assert.equal(f.state().events.length,0);
});
check('reserva en revision bloquea otro cobro incluso si figura EXPIRED',async()=>{
  const f=fixture();f.state().payment.confirmationReviewRequired=true;
  f.tx.payment.findMany=async()=>[f.state().payment];
  await assert.rejects(f.service.findReservedPayment(f.tx,{customerId:'customer',amount:1000,documentIds:['doc'],provider:'real'}),e=>e.getStatus?.()===409);
});
check('cancelar o refrescar no libera la revision',async()=>{
  const f=fixture();f.state().payment.confirmationReviewRequired=true;
  await assert.rejects(f.service.cancelKhipuPayment('pay'),e=>e.getStatus?.()===409);
  await assert.rejects(f.service.refreshPaymentStatusFromKhipu('pay'),e=>e.getStatus?.()===409);
});
