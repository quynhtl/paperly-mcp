// Checks the tests share.

/** False when the string holds half a surrogate pair. (String.prototype.isWellFormed needs Node 20.) */
export function wellFormed(text) {
  return !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(text);
}
