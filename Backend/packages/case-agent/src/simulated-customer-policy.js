// Platform simulation policy supplied by the user; not a CSDC naming restriction.
export const isPersonalName = name => typeof name === 'string' && /^[\u4e00-\u9fff]{3}$/.test(name)
  && !/(模拟|客户|测试|广发|基金|销售|网点)/.test(name);

export function normalizeSimulatedCustomers(specification) {
  const surnames = [...'陈林张王李刘赵周吴郑'];
  const givenNames = ['思远', '雨桐', '子涵', '明轩', '嘉宁'];
  const used = new Set(specification.customers.filter(c => isPersonalName(c.name)).map(c => c.name));
  let next = 0;
  return {...specification, customers: specification.customers.map(customer => {
    if (String(customer.investorType) !== '1' || isPersonalName(customer.name)) return customer;
    let name;
    do {
      name = surnames[next % surnames.length] + givenNames[Math.floor(next / surnames.length) % givenNames.length];
      next++;
    } while (used.has(name));
    used.add(name);
    return {...customer, name};
  })};
}
