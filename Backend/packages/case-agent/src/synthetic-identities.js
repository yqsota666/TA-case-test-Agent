import {randomInt} from 'node:crypto';

const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
export function identityCheckDigit(first17) {
  if (!/^\d{17}$/.test(first17)) throw new Error('合成证件主体必须为17位数字');
  return '10X98765432'[[...first17].reduce((sum, digit, i) => sum + Number(digit) * weights[i], 0) % 11];
}

// These are generated test inputs, never verified identities or confirmed accounts.
export function syntheticIdentityCandidates(specification, plan) {
  const dates = plan.exchangePlan.steps.filter(s => s.direction === 'SEND' && s.businessTime.kind === 'DATE')
    .map(s => s.businessTime.value).sort();
  if (!dates.length) return [];
  const year = Number(dates[0].slice(0, 4));
  if (year < 1930) return [];
  const used = new Set();
  return specification.customers.flatMap((customer, customerIndex) => {
    if (customer.investorType !== '1') return [];
    let first17, birthday, sequence;
    do {
      birthday = new Date(Date.UTC(year - 30, 0, 1) + randomInt(365) * 86400000)
        .toISOString().slice(0, 10).replaceAll('-', '');
      sequence = String(randomInt(1, 1000)).padStart(3, '0');
      first17 = '110101' + birthday + sequence;
    } while (used.has(first17));
    used.add(first17);
    return [{customerIndex, synthetic: true, fields: {
      CertificateType: '0', CertificateNo: first17 + identityCheckDigit(first17),
      InvestorsBirthday: birthday, Sex: Number(sequence) % 2 ? '1' : '2',
      CertValidDate: `${year + 10}1231`,
    }}];
  });
}
