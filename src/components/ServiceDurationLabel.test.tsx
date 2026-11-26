import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import ServiceDurationLabel from './ServiceDurationLabel';
import { normalizeSavedBooking } from '../utils/serviceDuration';

test('shared labels separate fixed service minutes, session blocks and a mixed itinerary span', () => {
  const timed = renderToStaticMarkup(<ServiceDurationLabel kind="TIMED" minutes={60} />);
  const session = renderToStaticMarkup(<ServiceDurationLabel kind="PER_SESSION" minutes={90} />);
  const variable = renderToStaticMarkup(<ServiceDurationLabel kind="VARIABLE" minutes={120} />);
  assert.match(timed, /固定服务 60 分钟/);
  assert.match(session, /按次 · 预约预留 90 分钟/); assert.doesNotMatch(session, /固定服务/);
  assert.match(variable, /时长不固定 · 预约预留 120 分钟/); assert.doesNotMatch(variable, /固定服务/);
  assert.match(renderToStaticMarkup(<ServiceDurationLabel total kind="MIXED" minutes={150} />), /混合项目 · 预约总跨度 150 分钟/);
});

test('the same saved order props stay session based when its live catalog changes to timed', () => {
  const saved = normalizeSavedBooking({ durationMin: 60, items: [{ durationMin: 60, durationKindSnapshot: 'PER_SESSION', service: { durationKind: 'TIMED', durationMin: 120 } }] });
  const html = renderToStaticMarkup(<><ServiceDurationLabel total kind={saved.durationKind} minutes={saved.reservedDurationMin} /><ServiceDurationLabel kind={saved.items[0].durationKind} minutes={saved.items[0].durationMin} /></>);
  assert.match(html, /按次 · 预约总跨度 60 分钟/); assert.match(html, /按次 · 预约预留 60 分钟/);
  assert.doesNotMatch(html, /固定服务|120/);
});
