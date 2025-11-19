import t from '@babel/types';

export const escapeMap = {
  "\\": "\\\\",
  "\r": "\\r",
  "\n": "\\n",
  "\t": "\\t",
  "\b": "\\b",
  "\f": "\\f",
  "\0": "\\0",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029"
}

export function escapeUnicodeHex(code) {
  return `\\u${code.toString(16).toUpperCase()}`
}

export function sanatizeTemplateString(templateString, qoute = '`') {
  // Regex and Code from jsesc

  return t.templateElement({
    raw: templateString.replace(/([\uD800-\uDBFF][\uDC00-\uDFFF])|([\uD800-\uDFFF])|[^]/g, (char, pair, lone, index, str) => {
      if (pair) {
        return escapeUnicodeHex(char.charCodeAt(0)) + escapeUnicodeHex(char.charCodeAt(1))
      }

      if (lone) {
        return escapeUnicodeHex(char.charCodeAt(0))
      }

      if (char === qoute) {
        return "\\" + qoute
      }

      if (escapeMap[char]) return escapeMap[char]

      return char
    })
  })
}