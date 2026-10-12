export function artifactReadError(error, subject) {
  if (['SyntaxError', 'TypeError'].includes(error?.name) || !error?.message) {
    return `${subject}读取失败，请重新尝试。`;
  }
  return error.message;
}
