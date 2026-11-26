/**
 * MJAPP — Twilio SMS Service
 * Sends SMS notifications via Twilio.
 * Missing configuration disables delivery; no simulated provider success.
 */

import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class TwilioService {
  private readonly logger = new Logger(TwilioService.name);
  private client: any = null;

  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (accountSid && authToken) {
      try {
        // Dynamic require to avoid crash if twilio is not installed
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const twilio = require('twilio');
        this.client = twilio(accountSid, authToken);
        this.logger.log('Twilio initialized successfully');
      } catch {
        this.logger.warn('SMS disabled: provider initialization failed.');
      }
    } else {
      this.logger.warn('SMS disabled: provider is not configured.');
    }
  }

  /**
   * Send an SMS message
   */
  async sendSms(
    to: string,
    body: string,
  ): Promise<{ sid?: string; error?: string }> {
    if (!this.client) {
      this.logger.debug('SMS skipped: provider is not configured');
      return { error: 'SMS_NOT_CONFIGURED' };
    }

    const from = process.env.TWILIO_PHONE_NUMBER;
    if (!from) {
      this.logger.warn('TWILIO_PHONE_NUMBER not set. SMS not sent.');
      return { error: 'SMS_SENDER_NOT_CONFIGURED' };
    }

    try {
      const message = await this.client.messages.create({ body, from, to });
      if (typeof message?.sid !== 'string' || !message.sid) {
        this.logger.error('SMS delivery failed');
        return { error: 'SMS_DELIVERY_FAILED' };
      }
      this.logger.debug('SMS accepted by provider');
      return { sid: message.sid };
    } catch {
      this.logger.error('SMS delivery failed');
      return { error: 'SMS_DELIVERY_FAILED' };
    }
  }
}
