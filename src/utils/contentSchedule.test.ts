import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOperationPayload, localPublicationInput, publicationInputInstant } from './operationForm';
import { operations } from '../config/operations';

test('publication editor serializes local date to an explicit UTC instant and preserves the round trip', () => {
  const instant=publicationInputInstant('2026-10-28T12:34:56');
  assert.equal(localPublicationInput(instant),'2026-10-28T12:34:56');
  assert.match(instant,/Z$/);
});
test('blank start omits rescheduling, blank end explicitly removes expiry, inverted window rejects', () => {
  const fields=[{key:'startAt',label:'start',type:'datetime-local' as const},{key:'endAt',label:'end',type:'datetime-local' as const}];
  assert.deepEqual(buildOperationPayload(fields,{startAt:'',endAt:''},true),{endAt:null});
  assert.throws(()=>buildOperationPayload(fields,{startAt:'2026-10-29T12:00',endAt:'2026-10-28T12:00'},true));
  assert.throws(()=>publicationInputInstant('2026-02-30T12:00'));
});
test('content and banner forms use actual scheduling fields and start as drafts', () => {
  for(const key of ['help-list','banner-list']) {
    const fields=operations[key].fields!;
    assert.ok(fields.some(field=>field.key==='startAt'&&field.type==='datetime-local'));
    assert.equal(fields.find(field=>['isPublished','isActive'].includes(field.key))?.defaultValue,false);
  }
});
