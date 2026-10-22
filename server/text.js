// Text helpers shared by every game: number words and typo-tolerant comparison.
export const NUMBER_WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 }
export const numberWordPattern = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})\\b`, 'g')
export const stripAccents = (value) => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '')

// Damerau-Levenshtein distance: one inserted, missing, wrong or swapped letter counts as 1.
export function editDistance(a, b) {
  const d=Array.from({length:a.length+1},(_,i)=>[i, ...Array(b.length).fill(0)])
  for(let j=1;j<=b.length;j++) d[0][j]=j
  for(let i=1;i<=a.length;i++) for(let j=1;j<=b.length;j++) {
    d[i][j]=Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+(a[i-1]===b[j-1]?0:1))
    if(i>1 && j>1 && a[i-1]===b[j-2] && a[i-2]===b[j-1]) d[i][j]=Math.min(d[i][j], d[i-2][j-2]+1)
  }
  return d[a.length][b.length]
}
