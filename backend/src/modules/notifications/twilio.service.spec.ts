import { Logger } from '@nestjs/common';
import { TwilioService } from './twilio.service';

jest.mock('twilio', () => jest.fn());
const twilioFactory = require('twilio') as jest.Mock;

describe('SMS delivery results and private-error boundaries (stub provider only)', () => {
  const names = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'] as const;
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const privateDetail = 'synthetic-provider-detail-that-must-not-leak';
  let create: jest.Mock;
  let logs: jest.SpyInstance[];
  beforeEach(() => {
    for (const name of names) delete process.env[name];
    twilioFactory.mockReset();
    create = jest.fn();
    twilioFactory.mockReturnValue({ messages: { create } });
    logs = ['log', 'warn', 'debug', 'error'].map(method => jest.spyOn(Logger.prototype, method as 'log').mockImplementation(() => {}));
  });
  afterEach(() => {
    expect(JSON.stringify(logs.flatMap(log => log.mock.calls))).not.toContain(privateDetail);
    logs.forEach(log => log.mockRestore());
    for (const name of names) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
  });
  const configure = () => {
    process.env.TWILIO_ACCOUNT_SID = 'synthetic-account';
    process.env.TWILIO_AUTH_TOKEN = privateDetail;
    process.env.TWILIO_PHONE_NUMBER = '+15550000001';
  };
  test('missing credentials disable delivery without a fake SID, mock success, or provider call', async () => {
    const result = await new TwilioService().sendSms('+15550000002', privateDetail);
    expect(result).toEqual({ error: 'SMS_NOT_CONFIGURED' });
    expect(twilioFactory).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });
  test('missing sender disables delivery even when the provider client is initialized', async () => {
    configure(); delete process.env.TWILIO_PHONE_NUMBER;
    expect(await new TwilioService().sendSms('+15550000002', privateDetail)).toEqual({ error: 'SMS_SENDER_NOT_CONFIGURED' });
    expect(create).not.toHaveBeenCalled();
  });
  test('only the successful provider response supplies a SID', async () => {
    configure(); create.mockResolvedValue({ sid: 'SM00000000000000000000000000000001' });
    expect(await new TwilioService().sendSms('+15550000002', privateDetail)).toEqual({ sid: 'SM00000000000000000000000000000001' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ to: '+15550000002', from: '+15550000001', body: privateDetail });
  });
  test('provider rejection returns only a fixed error code and does not log private details', async () => {
    configure(); create.mockRejectedValue(new Error(privateDetail));
    expect(await new TwilioService().sendSms('+15550000002', privateDetail)).toEqual({ error: 'SMS_DELIVERY_FAILED' });
  });
  test('provider initialization errors remain disabled and cannot leak exception details', async () => {
    configure(); twilioFactory.mockImplementation(() => { throw new Error(privateDetail); });
    expect(await new TwilioService().sendSms('+15550000002', privateDetail)).toEqual({ error: 'SMS_NOT_CONFIGURED' });
    expect(create).not.toHaveBeenCalled();
  });
  test('a malformed provider response cannot be reported as accepted delivery', async () => {
    configure(); create.mockResolvedValue({});
    expect(await new TwilioService().sendSms('+15550000002', privateDetail)).toEqual({ error: 'SMS_DELIVERY_FAILED' });
  });
});
