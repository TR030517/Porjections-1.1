import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateStaffDto } from './staff.dto';

const matrix: { name: string; value: string; bytes: number; accepted: boolean }[] = require('../../../test/staff-password-policy.matrix.cjs');
const input = { name: 'Synthetic staff', email: 'staff@example.invalid', phone: '+12025550123', permissions: ['BOOKINGS_READ'] };

describe('STAFF password DTO transport boundary', () => {
  test.each(matrix)('$name reaches the service unchanged for the authoritative byte policy', ({ value, bytes }) => {
    const dto = plainToInstance(CreateStaffDto, { ...input, password: value });
    expect(Buffer.byteLength(value, 'utf8')).toBe(bytes);
    expect(validateSync(dto)).toEqual([]);
    expect(dto.password).toBe(value);
  });
  test.each([undefined, null, 123456789012, '', 'a'.repeat(201)])('rejects missing, non-string or excessive transport input %#', password => {
    const errors = validateSync(plainToInstance(CreateStaffDto, { ...input, password }));
    expect(errors.some(error => error.property === 'password')).toBe(true);
  });
});
