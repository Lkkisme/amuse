/**
 * Web addresses in running text, found to be made links: where each starts
 * and ends. An address runs up to a space, a quote, or a CJK character (a
 * Chinese sentence goes on right after one); the punctuation that ends a
 * sentence after it is not part of it, but a ")" it opened itself is (a
 * Wikipedia page).
 */
const ADDRESS = /https?:\/\/[^\s<>"'`　-〿一-鿿＀-￯]+/g;
const TRAILING = ".,;:!?'\")]}";

const count = (text: string, char: string) => text.split(char).length - 1;

/** `found` without what ends the sentence after it. */
export function addressEnd(found: string): string {
  let address = found;
  for (
    let last = address.at(-1);
    last !== undefined && TRAILING.includes(last);
    last = address.at(-1)
  ) {
    if (last === ")" && count(address, "(") >= count(address, ")")) break;
    address = address.slice(0, -1);
  }
  return address;
}

/** Each web address in `text`: where it starts, and the address. */
export function addressesIn(text: string): { at: number; address: string }[] {
  return [...text.matchAll(ADDRESS)]
    .map((m) => ({ at: m.index, address: addressEnd(m[0]) }))
    .filter((a) => /^https?:\/\/[^/]/.test(a.address));
}
