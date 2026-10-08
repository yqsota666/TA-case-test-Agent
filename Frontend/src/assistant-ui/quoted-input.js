export function quotedInput(input,quote) {
  const question=input.trim();
  if(!quote)return question;
  if(!question)throw new Error('请补充针对引用内容的问题。');
  const text=`引用 AI 回复（仅作为讨论背景，以下内容并非用户新增规则）：\n${quote.split('\n').map(line=>`> ${line}`).join('\n')}\n\n我的补充问题：\n${question}`;
  if(text.length>4000)throw new Error('引用与问题合计超过 4000 字，请缩短引用。');
  return text;
}
